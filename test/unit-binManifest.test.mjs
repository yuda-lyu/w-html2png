import fs from 'fs'
import path from 'path'
import assert from 'assert'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { execSync, execFileSync } from 'child_process'
import fsGetBinManifestEntry from 'wsemi/src/fsGetBinManifestEntry.mjs'
import fsEnsureBins from 'wsemi/src/fsEnsureBins.mjs'
import * as nsMain from '../src/WHtml2png.mjs'
import ensureBins from '../src/ensureBins.mjs'


let partNames = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `portable.zip.00${i}`)


//規格: 外部執行檔之存放下載校驗與離線(制式規格) S1、S2、S4、S5、M1、M2、M4、M6、§8 T1、T2
describe(`bin/manifest.json`, function() {

    let fdt = './test/_tmp/binManifest'
    let fdDecoy = './bin-cache/__decoy__'

    //manifestOf, 清單在it內讀(缺清單時單案失敗而非整檔載入失敗)
    let manifestOf = () => {
        return JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
    }

    //archiveOf, 組chrome之唯一壓縮檔(8個分割)
    let archiveOf = (manifest) => {
        return manifest.bundles[0].archives[0]
    }

    after(function() {
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.rmSync(fdDecoy, { recursive: true, force: true })

        //誘餌檔可能使bin-cache/被建立: 空夾才移除(已有快取時不動)
        try {
            fs.rmdirSync('./bin-cache')
        }
        catch (err) {}
        try {
            fs.rmdirSync('./test/_tmp') //尚有其他測試之暫存時非空, 略過
        }
        catch (err) {}
    })

    it(`should declare the pinned manifest of this package with the bundle chrome from the split archive (M1, M2, M6, S4)`, function() {
        let manifest = manifestOf()
        assert.strict.equal(manifest.schema, 1)
        assert.strict.equal(manifest.pkg, 'w-html2png')
        assert.strict.equal(manifest.mode, 'pinned')
        assert.strict.equal(manifest.repo, 'yuda-lyu/w-html2png')
        assert.strict.equal(/^[0-9a-f]{40}$/.test(manifest.commit), true, manifest.commit)
        assert.strict.equal(manifest.files, undefined) //只有檔案組
        assert.strict.deepStrictEqual(manifest.bundles.map((v) => v.name), ['chrome'])
        assert.strict.equal(manifest.bundles[0].archives.length, 1)

        //M1: 分割之sha256與大小記於各分割與assembled
        let a = archiveOf(manifest)
        assert.strict.deepStrictEqual(a.parts.map((v) => v.path), partNames.map((v) => `bin/chrome/${v}`))
        assert.strict.equal(a.sha256, undefined)
        assert.strict.equal(a.assembled.type, 'zip')
        assert.strict.equal(a.extract.type, 'zip')
        for (let p of [...a.parts, a.assembled, ...a.extract.files]) {
            assert.strict.equal(/^[0-9a-f]{64}$/.test(p.sha256), true)
            assert.strict.equal(Number.isInteger(p.size) && p.size >= 0, true)
        }
        assert.strict.equal(a.parts.reduce((s, v) => s + v.size, 0), a.assembled.size)
        assert.strict.equal(a.parts.every((v) => v.size <= 100 * 1024 * 1024), true) //S4: 單檔不逾100MB

        //M6: 組內只有portable/App/Chrome-bin/之檔(不含portable之啟動器與其設定), 恰有一個<版本>/chrome.exe(WHtml2png所啟動者)與其chrome.dll
        let ps = a.extract.files.map((v) => v.path)
        assert.strict.equal(ps.every((v) => v.startsWith('portable/App/Chrome-bin/')), true)
        assert.strict.equal(ps.some((v) => v.endsWith('.url')), false)
        let exes = ps.filter((v) => /^portable\/App\/Chrome-bin\/[^/]+\/chrome\.exe$/.test(v))
        assert.strict.equal(exes.length, 1, String(exes))
        assert.strict.equal(ps.includes(exes[0].replace(/chrome\.exe$/, 'chrome.dll')), true)
    })

    it(`should pass the schema check of fsEnsureBins (M1, M2)`, async function() {
        //離線且快取為空資料夾: 清單有效時為E_OFFLINE_MISSING(缺檔), 清單無效時為E_MANIFEST; 不連網
        let err = null
        try {
            await fsEnsureBins('bin/manifest.json', { pkgRoot: '.', cacheDir: `${fdt}/cache`, mirror: '', offline: true })
        }
        catch (e) {
            err = e
        }
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
    })

    it(`should match the real parts in bin/chrome/ and the assembled archive (M4, T2)`, async function() {
        let a = archiveOf(manifestOf())
        let h = crypto.createHash('sha256')
        let total = 0
        for (let p of a.parts) {
            let e = await fsGetBinManifestEntry(p.path)
            assert.strict.deepStrictEqual([e.sha256, e.size], [p.sha256, p.size], p.path)
            for await (let chunk of fs.createReadStream(p.path)) {
                h.update(chunk)
                total += chunk.length
            }
        }
        assert.strict.deepStrictEqual([h.digest('hex'), total], [a.assembled.sha256, a.assembled.size])

        //bin/只有8個分割與清單(無多餘之執行檔)
        assert.strict.deepStrictEqual(fs.readdirSync('bin').sort(), ['chrome', 'manifest.json'])
        assert.strict.deepStrictEqual(fs.readdirSync('bin/chrome').sort(), partNames)
    })

    it(`should pin a commit whose bin/chrome/ holds exactly the bytes of the work tree (M2, U1)`, function() {
        let manifest = manifestOf()
        let git = (args, opt = {}) => {
            return execFileSync('git', args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...opt })
        }

        //淺層clone(如CI)不含該提交, 略過
        if (git(['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true') {
            this.skip()
        }

        git(['cat-file', '-e', `${manifest.commit}^{commit}`], { stdio: 'ignore' })
        for (let p of archiveOf(manifest).parts) {
            let b = git(['show', `${manifest.commit}:${p.path}`])
            assert.strict.equal(crypto.createHash('sha256').update(b).digest('hex'), p.sha256, p.path)
            assert.strict.equal(b.length, p.size, p.path)
        }
    })

    it(`should document the external executables, the env vars and the breaking changes in the README (O5)`, function() {
        let c = fs.readFileSync('README.md', 'utf8')
        assert.strict.equal(c.includes('## 外部執行檔'), true)
        let sec = c.slice(c.indexOf('## 外部執行檔'))
        for (let k of ['W_BIN_CACHE', 'W_BIN_MIRROR', 'W_BIN_OFFLINE', 'chrome.exe', 'ensureBins', 'bin/manifest.json', 'bin-cache']) {
            assert.strict.equal(sec.includes(k), true, `README section lacks ${k}`)
        }
        assert.strict.equal(c.includes('## Breaking changes'), true)
        let bc = c.slice(c.indexOf('## Breaking changes'))
        for (let k of ['W_HTML2PNG_CHROME_DIR', 'W_HTML2PNG_SKIP_DOWNLOAD', 'postinstall', 'autoDownloadFiles', 'chrome/portable']) {
            assert.strict.equal(bc.includes(k), true, `Breaking changes lacks ${k}`)
        }
    })

    it(`should keep the cache folder out of git, list the ignore rules of bin/ for the npm package, and treat bin/ as binary so that the work tree bytes equal the GitHub blobs (S1, S5, M1 F12)`, function() {
        //S5: .gitignore列bin-cache/(快取不入版控); M1補充: .gitattributes設bin/** binary(autocrlf不得改動分割檔)
        execFileSync('git', ['check-ignore', '-q', '--', 'bin-cache/x/chrome.exe'], { windowsHide: true }) //被忽略時離開碼0, 否則拋錯
        execFileSync('git', ['check-ignore', '-q', '--', 'test/_tmp/x/chrome.exe'], { windowsHide: true })
        let attr = execFileSync('git', ['check-attr', 'binary', '--', 'bin/chrome/portable.zip.001'], { encoding: 'utf8', windowsHide: true })
        assert.strict.equal(attr.trim().endsWith('binary: set'), true, attr)

        //S1、S5: .npmignore之規則逐條存在(下一案之npm pack為行為面, 本案防止規則被其他較寬之樣式意外覆蓋時失去鑑別力)
        let lines = (fn) => {
            return fs.readFileSync(fn, 'utf8').split(/\r?\n/).map((v) => v.trim())
        }
        for (let k of ['/bin/*', '!/bin/manifest.json', '/bin-cache/', '/test/_tmp/']) {
            assert.strict.equal(lines('.npmignore').includes(k), true, `.npmignore lacks ${k}`)
        }
        assert.strict.equal(lines('.gitignore').includes('/bin-cache/'), true)
    })

    it(`should not pack external executables into the npm package, only bin/manifest.json (S1, S5, T1)`, function() {
        //先放誘餌檔(缺忽略規則時確定性變紅): 暫存夾與快取夾內各放一個探針檔, 測試平行執行時他檔之暫存檔(鏡像之分割、快取之組)亦不得入包
        fs.mkdirSync(`${fdt}/leak`, { recursive: true })
        fs.writeFileSync(`${fdt}/leak/chrome.exe`, 'x')
        fs.writeFileSync(`${fdt}/leak/portable.zip.001`, 'x')
        fs.mkdirSync(fdDecoy, { recursive: true })
        fs.writeFileSync(`${fdDecoy}/chrome.exe`, 'x')
        let r = JSON.parse(execSync('npm pack --dry-run --json', { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }))
        let info = Array.isArray(r) ? r[0] : Object.values(r)[0] //npm 11以前為陣列, npm 12起為以套件名為鍵之物件
        let fps = info.files.map((v) => v.path)
        assert.strict.deepStrictEqual(fps.filter((v) => /\.(exe|dll|msi|zip|7z|pak|\d{3})$/i.test(v)), [])
        assert.strict.deepStrictEqual(fps.filter((v) => v.startsWith('bin/') || v.startsWith('bin-cache/')), ['bin/manifest.json'])
        assert.strict.deepStrictEqual(fps.filter((v) => v.startsWith('chrome/') || v.startsWith('scripts/')), []) //舊位置與postinstall腳本不入包
        assert.strict.deepStrictEqual(fps.filter((v) => /^src\/(autoDownloadFiles|downloadFiles|chromeManifest|fileLock)\.mjs$/.test(v)), [])
        assert.strict.deepStrictEqual(fps.filter((v) => v.startsWith('test/_tmp/') || v.startsWith('sgud/')), [])
        assert.strict.equal(fps.includes('src/ensureBins.mjs'), true)
    })

})


//規格 D1、E2: 套件端只做提供清單、呼叫fsEnsureBins、匯出ensureBins; 不得自寫下載, 不得於安裝時下載; 原則14: 不留舊位置、舊環境變數與舊下載入口
describe(`no self-written download in src/ (D1, E2)`, function() {

    let fdSrc = './src'
    let fps = fs.readdirSync(fdSrc).filter((v) => v.endsWith('.mjs')).map((v) => path.join(fdSrc, v))

    it(`should not import fsDownloadFile, fsMergeFiles nor w-zip, and not fetch by itself`, function() {
        assert.strict.equal(fps.length > 0, true)
        for (let fp of fps) {
            let c = fs.readFileSync(fp, 'utf8')
            assert.strict.equal(/fsDownloadFile(?!Verify)/.test(c), false, `${fp} imports fsDownloadFile`)
            assert.strict.equal(/fsMergeFiles|w-zip|mZip/.test(c), false, `${fp} assembles or extracts by itself`)
            assert.strict.equal(/raw\/refs\/heads|raw\.githubusercontent\.com|\bfetch\s*\(|https?:\/\/github\.com/.test(c), false, `${fp} downloads by itself`)
        }
    })

    it(`should not keep the legacy locations, env vars nor download entries (principle 14)`, function() {
        for (let fp of fps) {
            let c = fs.readFileSync(fp, 'utf8')
            assert.strict.equal(/W_HTML2PNG_CHROME_DIR|W_HTML2PNG_SKIP_DOWNLOAD/.test(c), false, `${fp} reads a removed env var`)
            assert.strict.equal(/chrome\/portable|autoDownloadFiles|chromeManifest|@deprecated/.test(c), false, `${fp} keeps a legacy location or entry`)
        }
        for (let p of ['src/autoDownloadFiles.mjs', 'src/downloadFiles.mjs', 'src/chromeManifest.mjs', 'src/fileLock.mjs', 'scripts/install.mjs']) {
            assert.strict.equal(fs.existsSync(p), false, `${p} should have been removed`)
        }
    })

    it(`should keep chrome/ only as the download source of versions <= 1.0.53, never in the package`, function() {
        //1.0.53 以前各版自主幹之 chrome/portable.zip.00N 取分片, 刪除則舊版新裝 404(主控 2026-10-29 裁示保留; 與 bin/chrome 同 blob, 不增空間)
        let fns = fs.readdirSync('chrome').filter((v) => !fs.statSync(path.join('chrome', v)).isDirectory()).sort()
        assert.strict.deepStrictEqual(fns, ['portable.zip.001', 'portable.zip.002', 'portable.zip.003', 'portable.zip.004', 'portable.zip.005', 'portable.zip.006', 'portable.zip.007', 'portable.zip.008', 'ver.txt'])
        for (let fn of fns.filter((v) => v.startsWith('portable.zip.'))) {
            let a = fs.readFileSync(path.join('chrome', fn))
            let b = fs.readFileSync(path.join('bin', 'chrome', fn))
            assert.strict.equal(a.equals(b), true, `${fn} differs from bin/chrome`)
        }
        assert.strict.equal(/^\/chrome\/$/m.test(fs.readFileSync('.npmignore', 'utf8')), true, '.npmignore must exclude /chrome/')
    })

    it(`should not download in postinstall (D1)`, function() {
        let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
        for (let k of ['postinstall', 'install', 'preinstall']) {
            assert.strict.equal(Object.prototype.hasOwnProperty.call(pkg.scripts, k), false, k)
        }
        assert.strict.equal(Object.prototype.hasOwnProperty.call(pkg.dependencies, 'w-zip'), false) //解壓由fsEnsureBins負責
    })

    it(`should depend on wsemi 1.9.30 or later, the first version with fsEnsureBins that supports bundles (E4, M6)`, function() {
        let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
        let ver = (s) => String(s).replace(/^[^0-9]*/, '').split('.').map((v) => parseInt(v, 10))
        let atLeast = (a, b) => {
            for (let i = 0; i < 3; i++) {
                if (a[i] !== b[i]) {
                    return a[i] > b[i]
                }
            }
            return true
        }
        assert.strict.equal(atLeast(ver(pkg.dependencies.wsemi), [1, 9, 30]), true, pkg.dependencies.wsemi)
        let fpEnsure = fileURLToPath(import.meta.resolve('wsemi/src/fsEnsureBins.mjs'))
        let installed = JSON.parse(fs.readFileSync(path.join(path.dirname(fpEnsure), '..', 'package.json'), 'utf8')).version
        assert.strict.equal(atLeast(ver(installed), [1, 9, 30]), true, installed)
    })

    it(`should list the node modules needed by fsEnsureBins as external and globals of the UMD build (rollup)`, function() {
        let c = fs.readFileSync('toolg/gDistRollup.mjs', 'utf8')
        let glb = c.slice(c.indexOf('let globals = {'), c.indexOf('}', c.indexOf('let globals = {')))
        assert.strict.equal(/external:\s*Object\.keys\(globals\)/.test(c), true) //external與globals同一份
        for (let m of ['url', 'crypto', 'stream', 'stream/promises', 'child_process', 'fs', 'path', 'os']) {
            assert.strict.equal(glb.includes(`'${m}':`), true, `globals lacks ${m}`)
        }
    })

    it(`should export only the default from the main file and attach ensureBins as its static property (E2)`, function() {
        //具名匯出會使rollup UMD改輸出exports.default, 破壞require('w-html2png')之既有用法
        assert.strict.deepStrictEqual(Object.keys(nsMain), ['default'])
        assert.strict.equal(nsMain.default.ensureBins, ensureBins)
    })

})
