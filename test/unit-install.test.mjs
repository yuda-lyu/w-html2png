import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import { placeFakeExe, listTree } from './tools/fakeChrome.mjs'
import runChild from './tools/child.mjs'


//規則R14: postinstall與執行期同一定位/下載函式; 非win32不下載; W_HTML2PNG_SKIP_DOWNLOAD; 以路徑段判斷node_modules; 失敗不使安裝失敗(離開碼0)
let fdTest = path.resolve('./test/_tmp/install')
let fdRepo = path.resolve('.')
let fpFakePlatform = fileURLToPath(new URL('./tools/fakePlatform.mjs', import.meta.url))
let ver = '138.0.7204.97'
let iCase = 0


let makePkg = (fdPkg) => {
    for (let d of ['src', 'scripts']) {
        fs.mkdirSync(path.join(fdPkg, d), { recursive: true })
        for (let fn of fs.readdirSync(path.join(fdRepo, d))) {
            fs.copyFileSync(path.join(fdRepo, d, fn), path.join(fdPkg, d, fn))
        }
    }
    fs.copyFileSync(path.join(fdRepo, 'package.json'), path.join(fdPkg, 'package.json'))
    return path.join(fdPkg, 'scripts', 'install.mjs')
}


let runInstall = async (fdPkg, env = {}, preload = []) => {
    iCase++
    let fpLog = path.join(fdTest, `fetch-${iCase}.log`)
    let r = await runChild(path.join(fdPkg, 'scripts', 'install.mjs'), { cwd: fdPkg, preload, env: { FETCH_BLOCK_LOG: fpLog, W_HTML2PNG_CHROME_DIR: '', W_HTML2PNG_SKIP_DOWNLOAD: '', ...env }, timeoutMs: 60000 })
    let fetched = fs.existsSync(fpLog) ? fs.readFileSync(fpLog, 'utf8').trim().split('\n').filter(Boolean) : []
    return { code: r.code, fetched, out: r.out }
}


describe('unit-install', function() {

    before(function() {
        fs.rmSync(fdTest, { recursive: true, force: true })
        fs.mkdirSync(fdTest, { recursive: true })
    })

    after(function() {
        fs.rmSync(fdTest, { recursive: true, force: true })
    })

    it('non-win32: does not download', async function() {
        let fdPkg = path.join(fdTest, 'a', 'node_modules', 'w-html2png')
        makePkg(fdPkg)
        let r = await runInstall(fdPkg, { FAKE_PLATFORM: 'linux' }, [fpFakePlatform])
        assert.strict.equal(r.code, 0)
        assert.strict.deepStrictEqual(r.fetched, [])
        assert.ok(!fs.existsSync(path.join(fdPkg, 'chrome')))
    })

    it('W_HTML2PNG_SKIP_DOWNLOAD=1: does not download', async function() {
        let fdPkg = path.join(fdTest, 'b', 'node_modules', 'w-html2png')
        makePkg(fdPkg)
        let r = await runInstall(fdPkg, { W_HTML2PNG_SKIP_DOWNLOAD: '1', FAKE_PLATFORM: 'win32' }, [fpFakePlatform])
        assert.strict.equal(r.code, 0)
        assert.strict.deepStrictEqual(r.fetched, [])
        assert.ok(!fs.existsSync(path.join(fdPkg, 'chrome')))
    })

    it('not under a node_modules path segment (package repo itself): does not download', async function() {
        let fdPkg = path.join(fdTest, 'c', 'my_node_modules_like', 'w-html2png')
        makePkg(fdPkg)
        let r = await runInstall(fdPkg, { FAKE_PLATFORM: 'win32' }, [fpFakePlatform])
        assert.strict.equal(r.code, 0)
        assert.strict.deepStrictEqual(r.fetched, [])
    })

    it('already installed (env dir): no download, exit 0', async function() {
        let fdPkg = path.join(fdTest, 'd', 'node_modules', 'w-html2png')
        makePkg(fdPkg)
        placeFakeExe(path.join(fdTest, 'd', 'envdir'), ver)
        let r = await runInstall(fdPkg, { W_HTML2PNG_CHROME_DIR: path.join(fdTest, 'd', 'envdir'), FAKE_PLATFORM: 'win32' }, [fpFakePlatform])
        assert.strict.equal(r.code, 0)
        assert.strict.deepStrictEqual(r.fetched, [])
    })

    it('not installed: uses the same pinned download into the package, failure keeps exit code 0', async function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        let fdPkg = path.join(fdTest, 'e', 'node_modules', 'w-html2png')
        makePkg(fdPkg)
        let r = await runInstall(fdPkg)
        assert.strict.equal(r.code, 0)
        assert.ok(r.fetched.length > 0)
        assert.ok(r.fetched.every((l) => /\/raw\/[0-9a-f]{40}\/chrome\/portable\.zip\.001$/.test(l)), r.fetched.join('\n'))
        assert.strict.deepStrictEqual(listTree(path.join(fdPkg, 'chrome')).filter((f) => /^\.(dl|old)-|^\.lock-/.test(f)), [])
    })

})
