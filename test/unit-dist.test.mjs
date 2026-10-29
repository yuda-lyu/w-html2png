import './tools/fetchBlock.mjs'
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { builtinModules, createRequire } from 'module'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { makeFakeBundle, putMirrorParts } from './tools/fakeBundle.mjs'
import { setBinEnv, getChromeExe } from './tools/binEnv.mjs'
import { decodePng, countNonWhite, diffCount } from './tools/png.mjs'
import runChild from './tools/child.mjs'
import WHtml2png from '../src/WHtml2png.mjs'


//規則R4、R8: 由現行src建出dist至test/_tmp(不改寫repo之dist/): 離開碼0、0筆could not be resolved、無invalid runin; 語法錯以非0結束; 外部模組⊆Node內建∪dependencies; dist可載入、取得chrome之快取在其套件根(與cwd無關)、出圖與src容差內
let fdTest = path.resolve('./test/_tmp/dist')
let fdRepo = path.resolve('.')
let fpChild = fileURLToPath(new URL('./tools/childDraw.mjs', import.meta.url))


let prep = (name, mutate = null) => {
    let fd = path.join(fdTest, name)
    fs.mkdirSync(path.join(fd, 'src'), { recursive: true })
    fs.mkdirSync(path.join(fd, 'toolg'), { recursive: true })
    for (let fn of fs.readdirSync(path.join(fdRepo, 'src'))) {
        fs.copyFileSync(path.join(fdRepo, 'src', fn), path.join(fd, 'src', fn))
    }
    fs.copyFileSync(path.join(fdRepo, 'toolg', 'gDistRollup.mjs'), path.join(fd, 'toolg', 'gDistRollup.mjs'))
    fs.copyFileSync(path.join(fdRepo, 'package.json'), path.join(fd, 'package.json'))
    if (mutate) {
        let fp = path.join(fd, 'src', 'WHtml2png.mjs')
        fs.writeFileSync(fp, mutate(fs.readFileSync(fp, 'utf8')))
    }
    return fd
}


let build = (fd) => {
    let r = spawnSync(process.execPath, ['toolg/gDistRollup.mjs'], { cwd: fd, encoding: 'utf8', timeout: 300000 })
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}


describe('unit-dist', function() {

    let fdOk = null
    let resOk = null
    let restoreBin = null

    before(async function() {
        fs.rmSync(fdTest, { recursive: true, force: true })
        fdOk = prep('ok')
        resOk = build(fdOk)
        if (process.platform === 'win32') {
            restoreBin = await setBinEnv('distMirror') //套件自帶之chrome由本機鏡像經ensureBins取得, 不連外網
        }
    })

    after(async function() {
        await WHtml2png.close()
        fs.rmSync(fdTest, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
        if (restoreBin) {
            restoreBin()
        }
    })

    it('build exits 0 without unresolved imports or invalid runin', function() {
        assert.strict.equal(resOk.code, 0, resOk.out.slice(-1000))
        assert.ok(!/could not be resolved/.test(resOk.out), resOk.out)
        assert.ok(!/invalid runin/.test(resOk.out), resOk.out)
        assert.ok(fs.existsSync(path.join(fdOk, 'dist', 'w-html2png.umd.js')))
    })

    it('build of a source with a syntax error exits non-zero', function() {
        let fd = prep('syntax', (c) => c.replace('let timeIdle = 60 * 60 * 1000', 'let timeIdle = = 60'))
        let r = build(fd)
        assert.strict.equal(r.code, 1, r.out.slice(-500))
    })

    it('external modules are node builtins or declared dependencies', function() {
        let c = fs.readFileSync(path.join(fdOk, 'dist', 'w-html2png.umd.js'), 'utf8')
        let reqs = [...new Set([...c.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]))]
        let deps = Object.keys(JSON.parse(fs.readFileSync(path.join(fdRepo, 'package.json'), 'utf8')).dependencies)
        let bad = reqs.filter((m) => !builtinModules.includes(m) && !deps.includes(m))
        assert.ok(reqs.length > 0)
        assert.strict.deepStrictEqual(bad, [])
    })

    it('no top-level __filename/__dirname declarations and import.meta only uses url in src', function() {
        for (let fn of fs.readdirSync(path.join(fdRepo, 'src'))) {
            let c = fs.readFileSync(path.join(fdRepo, 'src', fn), 'utf8')
            assert.ok(!/^\s*(export\s+)?(let|const|var)\s+__(filename|dirname)\b/m.test(c), fn)
            assert.ok(!/import\.meta\.(dirname|filename|resolve)/.test(c), fn)
        }
    })

    it('dist loads (require) and exposes close', function() {
        let W = createRequire(import.meta.url)(path.join(fdOk, 'dist', 'w-html2png.umd.js'))
        assert.strict.equal(typeof W, 'function')
        assert.strict.equal(typeof W.close, 'function')
    })

    it('dist installed in a project obtains the bundle chrome by ensureBins into the cache under its package root from a subfolder cwd, and launches its chrome.exe', async function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        //小型假組(同形; chrome.exe非瀏覽器, 啟動必失敗, 錯誤訊息含實際啟動之路徑), 以本地鏡像離線供檔: 驗dist之ensureBins(含以tar解出成員)、快取位置與啟動路徑
        let fb = makeFakeBundle(path.join(fdTest, 'cons'))
        let fdPkg = path.join(fdTest, 'cons', 'proj', 'node_modules', 'w-html2png')
        let fdSub = path.join(fdTest, 'cons', 'proj', 'sub')
        let fdMirror = path.join(fdTest, 'cons', 'mirror')
        fs.mkdirSync(path.join(fdPkg, 'dist'), { recursive: true })
        fs.mkdirSync(path.join(fdPkg, 'bin'), { recursive: true })
        fs.mkdirSync(fdSub, { recursive: true })
        fs.copyFileSync(path.join(fdRepo, 'package.json'), path.join(fdPkg, 'package.json'))
        fs.copyFileSync(path.join(fdOk, 'dist', 'w-html2png.umd.js'), path.join(fdPkg, 'dist', 'w-html2png.umd.js'))
        fs.writeFileSync(path.join(fdPkg, 'bin', 'manifest.json'), JSON.stringify(fb.manifest))
        putMirrorParts(fdMirror, fb.parts)
        let cfg = { mod: path.join(fdPkg, 'dist', 'w-html2png.umd.js'), cjs: true, opt: { retry: 1 } }
        let r = await runChild(fpChild, { cwd: fdSub, env: { CHILD_CFG: JSON.stringify(cfg), W_BIN_MIRROR: fdMirror, W_BIN_OFFLINE: '1', W_BIN_CACHE: '' } })
        assert.ok(r.result, r.out.slice(-500))
        assert.strict.equal(r.result.ok, false)
        let fpExe = path.join(fdPkg, 'bin-cache', fb.bundleId, ...fb.relExe.split('/'))
        assert.ok(r.result.err.includes(fpExe), r.result.err.slice(0, 600))
        for (let m of fb.members) {
            let fp = path.join(fdPkg, 'bin-cache', fb.bundleId, ...m.path.split('/'))
            assert.strict.equal(Buffer.compare(fs.readFileSync(fp), m.bytes), 0, m.path)
        }
        assert.strict.deepStrictEqual(fs.readdirSync(fdSub), []) //不寫入工作目錄
    })

    it('dist renders the same as src (tolerance)', async function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        //dist之套件根(test/_tmp/dist/ok)無清單, 兩者皆給同一chrome(ensureBins取得之組內chrome.exe); dist取得chrome之接線見上一案
        let fpExe = await getChromeExe()
        let html = '<div style="padding:10px;font-size:20px;">Panel $& Title</div>'
        let Wd = createRequire(import.meta.url)(path.join(fdOk, 'dist', 'w-html2png.umd.js'))
        let a = decodePng(await Wd(300, 80, 2, html, { executablePath: fpExe, retry: 1 }))
        let b = decodePng(await WHtml2png(300, 80, 2, html, { retry: 1 }))
        assert.ok(countNonWhite(a) > 1000)
        let d = diffCount(a, b)
        assert.ok(d.sameSize)
        assert.ok(d.diff <= 50, `diff ${d.diff}`)
    })

})
