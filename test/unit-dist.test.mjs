import './tools/fetchBlock.mjs'
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { builtinModules, createRequire } from 'module'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { placeFakeExe } from './tools/fakeChrome.mjs'
import { decodePng, countNonWhite, diffCount } from './tools/png.mjs'
import runChild from './tools/child.mjs'
import WHtml2png from '../src/WHtml2png.mjs'


//規則R4、R8: 由現行src建出dist至test/_tmp(不改寫repo之dist/): 離開碼0、0筆could not be resolved、無invalid runin; 語法錯以非0結束; 外部模組⊆Node內建∪dependencies; dist可載入、定位與cwd無關、出圖與src容差內
let fdTest = path.resolve('./test/_tmp/dist')
let fdRepo = path.resolve('.')
let fpChild = fileURLToPath(new URL('./tools/childDraw.mjs', import.meta.url))
let ver = '138.0.7204.97'


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

    before(function() {
        fs.rmSync(fdTest, { recursive: true, force: true })
        fdOk = prep('ok')
        resOk = build(fdOk)
    })

    after(async function() {
        await WHtml2png.close()
        fs.rmSync(fdTest, { recursive: true, force: true })
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

    it('dist installed in a project locates chrome by module position from a subfolder cwd', async function() {
        let fdPkg = path.join(fdTest, 'cons', 'proj', 'node_modules', 'w-html2png')
        fs.mkdirSync(path.join(fdPkg, 'dist'), { recursive: true })
        fs.mkdirSync(path.join(fdTest, 'cons', 'proj', 'sub'), { recursive: true })
        fs.copyFileSync(path.join(fdRepo, 'package.json'), path.join(fdPkg, 'package.json'))
        fs.copyFileSync(path.join(fdOk, 'dist', 'w-html2png.umd.js'), path.join(fdPkg, 'dist', 'w-html2png.umd.js'))
        let fpExe = placeFakeExe(path.join(fdPkg, 'chrome'), ver, { content: 'not a browser' })
        let cfg = { mod: path.join(fdPkg, 'dist', 'w-html2png.umd.js'), cjs: true, opt: { retry: 1 } }
        let r = await runChild(fpChild, { cwd: path.join(fdTest, 'cons', 'proj', 'sub'), env: { CHILD_CFG: JSON.stringify(cfg), W_HTML2PNG_CHROME_DIR: '' } })
        assert.ok(r.result, r.out.slice(-500))
        assert.strict.equal(r.result.ok, false) //假執行檔必然啟動失敗, 訊息含實際啟動之路徑
        assert.ok(r.result.err.includes(fpExe), r.result.err.slice(0, 600))
        assert.strict.deepStrictEqual(fs.readdirSync(path.join(fdTest, 'cons', 'proj', 'sub')), [])
    })

    it('dist renders the same as src (tolerance)', async function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        let html = '<div style="padding:10px;font-size:20px;">Panel $& Title</div>'
        let Wd = createRequire(import.meta.url)(path.join(fdOk, 'dist', 'w-html2png.umd.js'))
        let a = decodePng(await Wd(300, 80, 2, html, { retry: 1 }))
        let b = decodePng(await WHtml2png(300, 80, 2, html, { retry: 1 }))
        assert.ok(countNonWhite(a) > 1000)
        let d = diffCount(a, b)
        assert.ok(d.sameSize)
        assert.ok(d.diff <= 50, `diff ${d.diff}`)
    })

})
