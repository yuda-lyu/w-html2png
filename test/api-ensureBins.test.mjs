import fs from 'fs'
import http from 'http'
import path from 'path'
import crypto from 'crypto'
import assert from 'assert'
import { fileURLToPath, pathToFileURL } from 'url'
import { chromium } from 'playwright-core'
import ensureBins from '../src/ensureBins.mjs'
import WHtml2png from '../src/WHtml2png.mjs'
import { makeFakeBundle, makeFakePkg, putMirrorParts } from './tools/fakeBundle.mjs'
import { setBinEnv, getChromeExe } from './tools/binEnv.mjs'
import { decodePng, countNonWhite } from './tools/png.mjs'
import runChild from './tools/child.mjs'


//規格: 外部執行檔之存放下載校驗與離線(制式規格) D1~D5、O1~O4、M6、E2、E3、§8 T3~T7(T8為主幹模式, 本套件為釘選模式, 不適用)
//以本機HTTP伺服器扮raw.githubusercontent.com(自有檔網址為<repo>/<commit>/<path>), 以本地資料夾扮鏡像, 全程不連外網
//取捨: 421MB之真組chrome只在第一個describe實跑一次(整組下載、組合、解出、校驗、快取、命中); 竄改、不符、鏡像、離線、整組重取等邏輯以同形之小型假組(fakeBundle)驗證,
//      假組之清單放在假套件根(本套件src/ensureBins.mjs與src/pkgRoot.mjs之副本＋假bin/manifest.json), 故所測者仍為本套件之ensureBins


let keys = ['W_BIN_MIRROR', 'W_BIN_CACHE', 'W_BIN_OFFLINE']


//withEnv, 暫時設定環境變數(undefined為刪除)後執行fn, 結束時還原
let withEnv = async (vars, fn) => {
    let bk = {}
    for (let k of keys) {
        bk[k] = process.env[k]
        if (vars[k] === undefined) {
            delete process.env[k]
        }
        else {
            process.env[k] = vars[k]
        }
    }
    try {
        return await fn()
    }
    finally {
        for (let k of keys) {
            if (bk[k] === undefined) {
                delete process.env[k]
            }
            else {
                process.env[k] = bk[k]
            }
        }
    }
}


let catchErr = (fn) => {
    return Promise.resolve()
        .then(fn)
        .then(() => null, (e) => e)
}


//listFiles, 資料夾內全部一般檔之相對路徑(/分隔, 排序)
let listFiles = (fd) => {
    if (!fs.existsSync(fd)) {
        return []
    }
    return fs.readdirSync(fd, { recursive: true, withFileTypes: true })
        .filter((v) => v.isFile())
        .map((v) => path.relative(fd, path.join(v.parentPath, v.name)).split(path.sep).join('/'))
        .sort()
}


let hashFile = async (fp) => {
    let h = crypto.createHash('sha256')
    let size = 0
    for await (let chunk of fs.createReadStream(fp)) {
        h.update(chunk)
        size += chunk.length
    }
    return { sha256: h.digest('hex'), size }
}


//bundleIdOf, 組識別: 組內各檔依path排序後逐行'<sha256>  <path>\n'之SHA-256(規格M6)
let bundleIdOf = (files) => {
    let lines = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((f) => `${f.sha256}  ${f.path}\n`).join('')
    return crypto.createHash('sha256').update(lines).digest('hex')
}


//startServer, 本機HTTP伺服器扮raw.githubusercontent.com: routes為{ 請求路徑: () => Buffer或檔案路徑 }, 回傳{ server, urls, close }
let startServer = async (port, routes) => {
    let urls = []
    let server = http.createServer((req, res) => {
        urls.push(req.url)
        let get = routes[req.url]
        if (!get) {
            res.writeHead(404)
            res.end()
            return
        }
        let v = get()
        if (Buffer.isBuffer(v)) {
            res.writeHead(200, { 'content-length': String(v.length) })
            res.end(v)
            return
        }
        res.writeHead(200, { 'content-length': String(fs.statSync(v).size) })
        fs.createReadStream(v).pipe(res)
    })
    await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', resolve)
    })
    let close = () => {
        return new Promise((resolve) => {
            server.close(resolve)
        })
    }
    return { server, urls, close }
}


//fetchVia, 僅放行raw.githubusercontent.com之網址並改指本機伺服器, 其餘一律拒絕(確保測試不連外網)
let fetchVia = (port) => {
    return (url, init) => {
        let u = String(url)
        if (!u.startsWith('https://raw.githubusercontent.com/')) {
            return Promise.reject(new Error(`unexpected url[${u}]`))
        }
        return globalThis.fetch(u.replace('https://raw.githubusercontent.com', `http://127.0.0.1:${port}`), init)
    }
}


describe(`ensureBins: the real bundle chrome (T3, M6)`, function() {
    this.timeout(180000)

    let port = 9040
    let fdt = path.resolve('./test/_tmp/ensureBinsReal')
    let srv = null

    before(async function() {
        fs.rmSync(fdt, { recursive: true, force: true })
        let manifest = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
        let routes = {}
        for (let p of manifest.bundles[0].archives[0].parts) {
            routes[`/${manifest.repo}/${manifest.commit}/${p.path}`] = () => path.resolve(p.path)
        }
        srv = await startServer(port, routes)
    })

    after(async function() {
        await srv.close()
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
        try {
            fs.rmdirSync(path.resolve('./test/_tmp')) //尚有其他測試之暫存時非空, 略過
        }
        catch (err) {}
    })

    it(`should download the 8 pinned parts, assemble, extract and verify the 107 files of the bundle into <cache>/<bundle id>/, and hit the cache without network the second time (T3, D1~D5, O2, M6)`, async function() {
        let manifest = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
        let a = manifest.bundles[0].archives[0]
        let id = bundleIdOf(a.extract.files)
        let cacheDir = path.join(fdt, 'cache')

        let r = await ensureBins({ fetch: fetchVia(port), cacheDir, mirror: '', offline: false })
        assert.strict.deepStrictEqual(Object.keys(r), ['chrome'])
        assert.strict.equal(r.chrome, path.join(cacheDir, id)) //D3、M6: <快取>/<組識別>
        assert.strict.equal(r.bundles.chrome.id, id)
        assert.strict.deepStrictEqual(srv.urls, a.parts.map((p) => `/${manifest.repo}/${manifest.commit}/${p.path}`)) //M2: 網址ref為清單之40碼提交

        //快取只有組內之檔(無分割、組合之zip、暫存夾), 且逐檔與清單相符
        assert.strict.deepStrictEqual(listFiles(cacheDir), a.extract.files.map((f) => `${id}/${f.path}`).sort())
        for (let f of a.extract.files) {
            let fp = r.bundles.chrome.files[f.path]
            assert.strict.equal(fp, path.join(cacheDir, id, ...f.path.split('/')))
            assert.strict.deepStrictEqual(await hashFile(fp), { sha256: f.sha256, size: f.size }, f.path)
        }

        //D4: 第二次快取命中(校驗), 不連網
        let nNet = 0
        let noNet = () => {
            nNet++
            return Promise.reject(new Error('network must not be used'))
        }
        let r2 = await ensureBins({ fetch: noNet, cacheDir, mirror: '', offline: false })
        assert.strict.equal(r2.chrome, r.chrome)
        assert.strict.equal(nNet, 0)
        assert.strict.equal(srv.urls.length, a.parts.length)
    })

})


describe(`ensureBins: bundle logic with a small bundle of the same shape (T3~T7, M6)`, function() {
    this.timeout(180000)

    let port = 9041
    let fdt = path.resolve('./test/_tmp/ensureBins')
    let fb = null
    let fdPkg = path.join(fdt, 'pkg')
    let fpEnsure = ''
    let ensureFake = null
    let srv = null
    let body = {} //伺服器目前回傳之各分割內容
    let seq = 0
    let cacheDir = ''
    let nNet = 0

    let noNet = () => {
        nNet++
        return Promise.reject(new Error('network must not be used'))
    }

    let newDir = (tag) => {
        return path.join(fdt, `${tag}${++seq}`)
    }

    let bundleFiles = () => {
        return fb.members.map((m) => `${fb.bundleId}/${m.path}`).sort()
    }

    //assertBundle, 組資料夾內恰為清單所列之檔且內容相符
    let assertBundle = (r, root) => {
        assert.strict.equal(r.chrome, path.join(root, fb.bundleId))
        assert.strict.deepStrictEqual(listFiles(root), bundleFiles())
        for (let m of fb.members) {
            assert.strict.equal(Buffer.compare(fs.readFileSync(r.bundles.chrome.files[m.path]), m.bytes), 0, m.path)
        }
    }

    before(async function() {
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.mkdirSync(fdt, { recursive: true })
        fb = makeFakeBundle(fdt)
        fpEnsure = makeFakePkg(fdPkg, fb.manifest)
        ensureFake = (await import(pathToFileURL(fpEnsure).href)).default
        let routes = {}
        for (let p of fb.parts) {
            routes[`/yuda-lyu/w-html2png/${fb.commit}/${p.path}`] = () => body[p.name]
        }
        srv = await startServer(port, routes)
    })

    after(async function() {
        await srv.close()
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
        try {
            fs.rmdirSync(path.resolve('./test/_tmp')) //尚有其他測試之暫存時非空, 略過
        }
        catch (err) {}
    })

    beforeEach(function() {
        for (let p of fb.parts) {
            body[p.name] = p.bytes
        }
        srv.urls.length = 0
        nNet = 0
        cacheDir = newDir('cache')
    })

    it(`T3: first call downloads the pinned parts, extracts only the listed members and publishes the whole bundle; the second call hits the cache without network (D3, D4, D5, O2, M6)`, async function() {
        let r = await ensureFake({ fetch: fetchVia(port), cacheDir, mirror: '', offline: false })
        assertBundle(r, cacheDir) //壓縮檔內未列入清單之portable/GoogleChromePortable.exe不入組; 不留分割與zip
        assert.strict.deepStrictEqual(srv.urls, fb.parts.map((p) => `/yuda-lyu/w-html2png/${fb.commit}/${p.path}`))
        assert.strict.equal(r.bundles.chrome.id, fb.bundleId)

        let r2 = await ensureFake({ fetch: noNet, cacheDir, mirror: '', offline: false })
        assert.strict.equal(r2.chrome, r.chrome)
        assert.strict.equal(nNet, 0)
        assert.strict.equal(srv.urls.length, fb.parts.length)
    })

    it(`T3: concurrent calls share one download of the bundle (E2)`, async function() {
        let fetch = fetchVia(port) //同一來源設定(同一fetch)之併發呼叫才共用
        let rs = await Promise.all([1, 2, 3].map(() => ensureFake({ fetch, cacheDir, mirror: '', offline: false })))
        assert.strict.deepStrictEqual(rs.map((r) => r.chrome), [1, 2, 3].map(() => path.join(cacheDir, fb.bundleId)))
        assert.strict.equal(srv.urls.length, fb.parts.length)
        assertBundle(rs[0], cacheDir)
    })

    it(`T4: a part whose content or size does not match the manifest is refused and leaves no file (D2, E3)`, async function() {
        let p2 = fb.parts[1]
        let bad = Buffer.from(p2.bytes)
        bad[10] = bad[10] ^ 0xff
        for (let [label, name, b, code] of [
            ['same size, different content', p2.name, bad, 'E_HASH_MISMATCH'],
            ['truncated', fb.parts[2].name, fb.parts[2].bytes.subarray(0, fb.parts[2].bytes.length - 10), 'E_SIZE_MISMATCH'],
        ]) {
            for (let p of fb.parts) {
                body[p.name] = p.bytes
            }
            body[name] = b
            let err = await catchErr(() => ensureFake({ fetch: fetchVia(port), cacheDir, mirror: '', offline: false, maxAttempts: 1, retryDelayMs: 0 }))
            assert.strict.equal(err instanceof Error, true, label)
            assert.strict.equal(err.code, code, `${label}: ${err && err.message}`)
            assert.strict.deepStrictEqual(listFiles(cacheDir), [], label)
        }
    })

    it(`T5: W_BIN_MIRROR (local folder holding the parts) is used before GitHub without network, and the mirror is left untouched (O1, O2)`, async function() {
        let fdMirror = newDir('mirror')
        putMirrorParts(fdMirror, fb.parts)
        let before = listFiles(fdMirror)
        let r = await withEnv({ W_BIN_MIRROR: fdMirror }, () => ensureFake({ fetch: noNet, cacheDir, offline: true }))
        assertBundle(r, cacheDir)
        assert.strict.equal(nNet, 0)
        assert.strict.deepStrictEqual(listFiles(fdMirror), before)
    })

    it(`T5: a W_BIN_CACHE folder serves as a mirror holding the bundle folder (O4), and a tampered file in it is refused (O2)`, async function() {
        //O4: 設W_BIN_CACHE=<資料夾>後取得一次, 該資料夾即為鏡像(<鏡像>/<pkg>/<組識別>/<path>)
        let fdMirror = newDir('mirror')
        let r0 = await withEnv({ W_BIN_CACHE: fdMirror, W_BIN_MIRROR: undefined, W_BIN_OFFLINE: undefined }, () => ensureFake({ fetch: fetchVia(port) }))
        assert.strict.equal(r0.chrome, path.join(fdMirror, 'w-html2png', fb.bundleId))
        let r = await ensureFake({ fetch: noNet, cacheDir, mirror: fdMirror, offline: true })
        assertBundle(r, cacheDir)
        assert.strict.equal(nNet, 0)
        assert.strict.equal(srv.urls.length, fb.parts.length) //只有製作鏡像時下載一次

        //鏡像之組內一檔被竄改(同大小): 離線時無其他來源, 整組不發布
        let fpT = r0.bundles.chrome.files[fb.relExe]
        let bad = Buffer.from(fs.readFileSync(fpT))
        bad[0] = bad[0] ^ 0xff
        fs.writeFileSync(fpT, bad)
        let cacheDir2 = newDir('cache')
        let err = await catchErr(() => ensureFake({ fetch: noNet, cacheDir: cacheDir2, mirror: fdMirror, offline: true }))
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.strict.deepStrictEqual(listFiles(cacheDir2), [])
        assert.strict.equal(nNet, 0)
    })

    it(`T5: a tampered mirror part is refused: online it falls back to GitHub (still verified), offline it is E_OFFLINE_MISSING and caches nothing (O2, O3)`, async function() {
        let fdMirror = newDir('mirror')
        let bad = Buffer.from(fb.parts[0].bytes)
        bad[5] = bad[5] ^ 0xff
        putMirrorParts(fdMirror, fb.parts, { [fb.parts[0].name]: bad })

        let r = await ensureFake({ fetch: fetchVia(port), cacheDir, mirror: fdMirror, offline: false })
        assertBundle(r, cacheDir)
        assert.strict.deepStrictEqual(srv.urls, [`/yuda-lyu/w-html2png/${fb.commit}/${fb.parts[0].path}`]) //只有被竄改之分割改自GitHub取得

        let cacheDir2 = newDir('cache')
        let err = await catchErr(() => ensureFake({ fetch: noNet, cacheDir: cacheDir2, mirror: fdMirror, offline: true }))
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.strict.deepStrictEqual(listFiles(cacheDir2), [])
        assert.strict.equal(nNet, 0)
    })

    it(`T6: W_BIN_OFFLINE=1 without cache or mirror is E_OFFLINE_MISSING listing every file of the bundle, the bundle folder to place and the parts (O3, D3, M6)`, async function() {
        let shared = newDir('shared')
        let err = await withEnv({ W_BIN_OFFLINE: '1', W_BIN_CACHE: shared, W_BIN_MIRROR: undefined }, () => catchErr(() => ensureFake({ fetch: noNet })))
        assert.strict.equal(err instanceof Error, true)
        assert.strict.equal(err.code, 'E_OFFLINE_MISSING', err.message)
        assert.strict.equal(nNet, 0)
        assert.strict.equal(srv.urls.length, 0)

        //D3: 共用快取之組資料夾為<W_BIN_CACHE>/<套件>/<組識別>
        let fdBundle = path.join(shared, 'w-html2png', fb.bundleId)
        let m = err.missing[0]
        assert.strict.equal(m.name, 'chrome')
        assert.strict.equal(m.cachePath, fdBundle)
        assert.strict.deepStrictEqual(m.bundle.files.map((v) => v.path).sort(), fb.members.map((v) => v.path).sort())
        assert.strict.equal(m.bundle.files.every((v) => v.missing === true), true)
        for (let s of [fdBundle, ...fb.members.map((v) => v.path), ...fb.parts.map((v) => v.name)]) {
            assert.strict.equal(err.message.includes(s), true, `message should include [${s}]`)
        }
        assert.strict.deepStrictEqual(listFiles(shared), [])
    })

    it(`T6: with an offline mirror configured, the error also names the bundle folder in the mirror (O3, O1)`, async function() {
        let fdMirror = newDir('mirror') //不存在之鏡像
        let err = await catchErr(() => ensureFake({ fetch: noNet, cacheDir, mirror: fdMirror, offline: true }))
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        let fdM = path.join(fdMirror, 'w-html2png', fb.bundleId)
        assert.strict.equal(err.missing[0].mirrorPath, fdM)
        assert.strict.equal(err.message.includes(fdM), true)
    })

    it(`T7: one file of the cached bundle altered (same size) or removed makes the whole bundle fetched again (D4, M6)`, async function() {
        let r = await ensureFake({ fetch: fetchVia(port), cacheDir, mirror: '', offline: false })
        assert.strict.equal(srv.urls.length, fb.parts.length)

        //同大小而內容不同
        let fp = r.bundles.chrome.files[fb.relExe]
        let bad = Buffer.from(fs.readFileSync(fp))
        bad[0] = bad[0] ^ 0xff
        fs.writeFileSync(fp, bad)
        fs.utimesSync(fp, 1, 1)
        let traces = []
        let r2 = await ensureFake({ fetch: fetchVia(port), cacheDir, mirror: '', offline: false, onTrace: (ev) => traces.push(ev) })
        assertBundle(r2, cacheDir)
        assert.strict.equal(srv.urls.length, fb.parts.length * 2) //整組重取: 全部分割再下載一次
        assert.strict.deepStrictEqual(traces.filter((v) => v.type === 'publish').map((v) => v.result), ['replaced'])

        //組內一檔被刪除
        fs.rmSync(r2.bundles.chrome.files['portable/App/Chrome-bin/chrome.exe'])
        let r3 = await ensureFake({ fetch: fetchVia(port), cacheDir, mirror: '', offline: false })
        assertBundle(r3, cacheDir)
        assert.strict.equal(srv.urls.length, fb.parts.length * 3)
    })

    it(`T7: offline, a bundle with a tampered file is never returned (D4, O3)`, async function() {
        let r = await ensureFake({ fetch: fetchVia(port), cacheDir, mirror: '', offline: false })
        let fp = r.bundles.chrome.files[fb.relExe]
        let bad = Buffer.from(fs.readFileSync(fp))
        bad[1] = bad[1] ^ 0xff
        fs.writeFileSync(fp, bad)
        fs.utimesSync(fp, 1, 1)
        let err = await catchErr(() => ensureFake({ fetch: noNet, cacheDir, mirror: '', offline: true }))
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.strict.equal(nNet, 0)
    })

    it(`should read W_BIN_CACHE, W_BIN_MIRROR and W_BIN_OFFLINE from the environment (D3, O1, O3)`, async function() {
        let fdMirror = newDir('mirror')
        putMirrorParts(fdMirror, fb.parts)
        let envRoot = newDir('envroot')
        let r = await withEnv({ W_BIN_CACHE: envRoot, W_BIN_MIRROR: fdMirror, W_BIN_OFFLINE: '1' }, () => ensureFake({ fetch: noNet }))
        assertBundle(r, path.join(envRoot, 'w-html2png')) //D3: <W_BIN_CACHE>/<套件>/<組識別>
        assert.strict.equal(nNet, 0)
    })

    it(`should place the default cache under the package root even when the module is loaded from another working directory (D3)`, async function() {
        //pkgRoot以模組位置推得(src/pkgRoot.mjs), 故以子行程於他處工作目錄載入假套件根之ensureBins; 離線無鏡像: 缺檔之應放路徑為(假)套件根下之預設快取, 與cwd無關
        let cwdOther = newDir('elsewhere')
        fs.mkdirSync(cwdOther, { recursive: true })
        let fpChild = fileURLToPath(new URL('./tools/childEnsure.mjs', import.meta.url))
        let env = { W_BIN_OFFLINE: '1', W_BIN_MIRROR: '', W_BIN_CACHE: '', CHILD_CFG: JSON.stringify({ opt: {} }) }
        let c = await runChild(fpChild, { cwd: cwdOther, env, args: [fpEnsure], timeoutMs: 60000 })
        assert.ok(c.result, c.out.slice(-800))
        assert.strict.equal(path.resolve(c.result.cwd), cwdOther) //確實於他處載入
        assert.strict.equal(c.result.code, 'E_OFFLINE_MISSING', c.result.err)
        assert.strict.equal(c.result.cachePath, path.join(fdPkg, 'bin-cache', fb.bundleId))
        assert.strict.deepStrictEqual(fs.readdirSync(cwdOther), []) //不寫入工作目錄
    })

    it(`should not forward floatingManifestUrl, which would change the trust anchor of the manifest (E2)`, async function() {
        let fdMirror = newDir('mirror')
        putMirrorParts(fdMirror, fb.parts)
        let r = await ensureFake({ fetch: noNet, cacheDir, mirror: fdMirror, offline: true, floatingManifestUrl: 'not-a-valid-url' })
        assertBundle(r, cacheDir)
        assert.strict.equal(nNet, 0)
    })

})


//WHtml2png主函數無法注入fetch, 故攔截全域fetch: 被呼叫即記錄並拋錯, 斷言未被呼叫(否則回歸為直連時測試仍會因真網路而綠);
//另包裝chromium.launch記錄所啟動之執行檔, 斷言為ensureBins回傳之組內chrome.exe(規格§9: 主函數類入口須斷言所啟動者)
describe(`WHtml2png gets chrome through ensureBins (E2, D1)`, function() {
    this.timeout(180000)

    let fdt = path.resolve('./test/_tmp/ensureBinsEntry')
    let restoreBin = null
    let fetchBak = null
    let launchBak = null
    let launchOwn = false
    let netCalls = []
    let launched = []
    let html = '<div style="width:120px;height:40px;background:rgb(0,0,255)"></div>'

    before(async function() {
        if (process.platform !== 'win32') {
            this.skip() //套件自帶之免安裝chrome只支援Windows
        }
        fs.rmSync(fdt, { recursive: true, force: true })
        restoreBin = await setBinEnv('ensureBinsEntryMirror')
        fetchBak = globalThis.fetch
        globalThis.fetch = (url) => {
            netCalls.push(String(url && url.url ? url.url : url))
            throw new Error(`network access is forbidden in tests: ${url}`)
        }
        launchOwn = Object.prototype.hasOwnProperty.call(chromium, 'launch')
        launchBak = chromium.launch
        chromium.launch = function(opt) {
            launched.push(opt && opt.executablePath)
            return launchBak.call(this, opt)
        }
    })

    after(async function() {
        await WHtml2png.close()
        if (fetchBak) {
            globalThis.fetch = fetchBak
        }
        if (launchBak) {
            if (launchOwn) {
                chromium.launch = launchBak
            }
            else {
                delete chromium.launch
            }
        }
        if (restoreBin) {
            restoreBin()
        }
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    })

    beforeEach(function() {
        netCalls = []
        launched = []
    })

    it(`should catch a call to the global fetch (the interception below is effective)`, async function() {
        //對照案: 不離線、無鏡像且未注入fetch時, 下載核心使用全域fetch, 本攔截必須記錄到, 其他案之netCalls為空才有意義
        let manifest = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
        let err = await catchErr(() => ensureBins({ cacheDir: path.join(fdt, 'cache-probe'), mirror: '', offline: false, maxAttempts: 1, retryDelayMs: 0 }))
        assert.strict.equal(err instanceof Error, true)
        assert.strict.equal(netCalls.length > 0, true)
        assert.strict.equal(netCalls[0], `https://raw.githubusercontent.com/${manifest.repo}/${manifest.commit}/bin/chrome/portable.zip.001`)
    })

    for (let mode of ['single', 'alive']) {
        it(`${mode}: without executablePath, launches chrome.exe of the bundle obtained by ensureBins (cache under the package root), without network`, async function() {
            let r = await ensureBins()
            let fpExe = await getChromeExe()
            let b64 = await WHtml2png(120, 40, 1, html, { mode, retry: 1 })
            assert.ok(countNonWhite(decodePng(b64)) > 1000)
            assert.strict.deepStrictEqual(launched, [fpExe])
            assert.strict.equal(fpExe.startsWith(r.chrome + path.sep), true, fpExe)
            assert.strict.equal(r.chrome.startsWith(path.resolve('bin-cache') + path.sep), true, r.chrome) //D3: 預設快取<套件根>/bin-cache/
            assert.strict.equal(/[\\/]portable[\\/]App[\\/]Chrome-bin[\\/][^\\/]+[\\/]chrome\.exe$/.test(fpExe), true, fpExe)
            assert.strict.deepStrictEqual(netCalls, [])
            await WHtml2png.close()
        })
    }

    it(`with executablePath, launches the given chrome and does not obtain the bundle`, async function() {
        let fpExe = await getChromeExe()
        await WHtml2png.close()

        //若仍取組: 快取為空資料夾、離線且無鏡像, 必以E_OFFLINE_MISSING失敗
        let cacheEmpty = path.join(fdt, 'cache-empty')
        let b64 = await withEnv({ W_BIN_CACHE: cacheEmpty, W_BIN_MIRROR: undefined, W_BIN_OFFLINE: '1' }, () => {
            return WHtml2png(120, 40, 1, html, { executablePath: fpExe, retry: 1 })
        })
        assert.ok(countNonWhite(decodePng(b64)) > 1000)
        assert.strict.deepStrictEqual(launched, [fpExe])
        assert.strict.deepStrictEqual(listFiles(cacheEmpty), [])
        assert.strict.deepStrictEqual(netCalls, [])
    })

    it(`rejects with the string "[code] message" when the bundle can not be obtained, and launches nothing (E3)`, async function() {
        let manifest = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
        let id = bundleIdOf(manifest.bundles[0].archives[0].extract.files)
        let cacheEmpty = path.join(fdt, 'cache-missing')
        let err = await withEnv({ W_BIN_CACHE: cacheEmpty, W_BIN_MIRROR: undefined, W_BIN_OFFLINE: '1' }, () => {
            return catchErr(() => WHtml2png(120, 40, 1, html, { retry: 1 }))
        })
        assert.strict.equal(typeof err, 'string') //既有之reject型態為字串(規則R6)
        assert.strict.equal(err.startsWith('[E_OFFLINE_MISSING] '), true, err.slice(0, 300))
        assert.strict.equal(err.includes(path.join(cacheEmpty, 'w-html2png', id)), true, err.slice(0, 600))
        assert.strict.deepStrictEqual(launched, [])
        assert.strict.deepStrictEqual(netCalls, [])

        //既有之輸入檢核訊息不變
        let e2 = await catchErr(() => WHtml2png(-1, 40, 1, html))
        assert.strict.equal(e2, 'width <= 0')
    })

    it(`exposes ensureBins as the static property WHtml2png.ensureBins (E2)`, function() {
        assert.strict.equal(WHtml2png.ensureBins, ensureBins)
    })

})
