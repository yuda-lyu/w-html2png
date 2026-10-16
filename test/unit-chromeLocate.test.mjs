import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import { placeFakeExe, listTree } from './tools/fakeChrome.mjs'
import runChild from './tools/child.mjs'


//規則R2、R13: 公開之autoDownloadFiles定位與cwd無關、舊位置唯讀查找、永不寫入cwd; 子行程預載fetch守門(任何對外下載即失敗並記錄)
let fdTest = path.resolve('./test/_tmp/chromeLocate')
let fdRepo = path.resolve('.')
let fpChild = fileURLToPath(new URL('./tools/childEnsure.mjs', import.meta.url))
let ver = '138.0.7204.97'
let iCase = 0
let junctions = []


//makePkg, 以套件之package.json與src/複本建立一份「已安裝之套件」(無chrome)
let makePkg = (fdPkg, { withPackageJson = true } = {}) => {
    fs.mkdirSync(path.join(fdPkg, 'src'), { recursive: true })
    if (withPackageJson) {
        fs.copyFileSync(path.join(fdRepo, 'package.json'), path.join(fdPkg, 'package.json'))
    }
    for (let fn of fs.readdirSync(path.join(fdRepo, 'src'))) {
        fs.copyFileSync(path.join(fdRepo, 'src', fn), path.join(fdPkg, 'src', fn))
    }
    return path.join(fdPkg, 'src', 'autoDownloadFiles.mjs')
}


let newCase = () => {
    iCase++
    let D = path.join(fdTest, `case${iCase}`)
    fs.mkdirSync(path.join(D, 'other'), { recursive: true })
    return D
}


let auto = async (fpMod, cwd, env = {}) => {
    let fpLog = path.join(fdTest, `fetch-${iCase}.log`)
    let r = await runChild(fpChild, { cwd, env: { CHILD_CFG: JSON.stringify({ mod: fpMod, fn: 'auto' }), FETCH_BLOCK_LOG: fpLog, W_HTML2PNG_CHROME_DIR: '', ...env }, timeoutMs: 60000 })
    let c = r.result ? r.result.results[0] : { ok: false, err: r.out.slice(-300) }
    let fetched = fs.existsSync(fpLog) ? fs.readFileSync(fpLog, 'utf8').trim().split('\n').filter(Boolean) : []
    return { c, fetched }
}


describe('unit-chromeLocate', function() {

    before(function() {
        fs.rmSync(fdTest, { recursive: true, force: true })
        fs.mkdirSync(fdTest, { recursive: true })
    })

    after(function() {
        for (let j of junctions) {
            try {
                fs.rmdirSync(j)
            }
            catch (err) {}
        }
        fs.rmSync(fdTest, { recursive: true, force: true })
    })

    //主位置(本套件根/chrome/<ver>, 附完成標記), cwd為無關資料夾 → 找到, 不下載, 不寫cwd
    it('main location under package root is found from an unrelated cwd', async function() {
        let D = newCase()
        let fpMod = makePkg(path.join(D, 'pkg'))
        let fpExe = placeFakeExe(path.join(D, 'pkg', 'chrome'), ver)
        let { c, fetched } = await auto(fpMod, path.join(D, 'other'))
        assert.strict.equal(c.ok, true, c.err)
        assert.strict.equal(path.resolve(c.fpExe), fpExe)
        assert.strict.deepStrictEqual(fetched, [])
        assert.strict.deepStrictEqual(listTree(path.join(D, 'other')), [])
    })

    //舊版面(本套件根/chrome/portable, 只有exe) → 唯讀查找找到
    it('legacy layout under package root is found (read-only)', async function() {
        let D = newCase()
        let fpMod = makePkg(path.join(D, 'pkg'))
        let fpExe = placeFakeExe(path.join(D, 'pkg', 'chrome'), ver, { layout: 'legacy' })
        let { c, fetched } = await auto(fpMod, path.join(D, 'other'))
        assert.strict.equal(c.ok, true, c.err)
        assert.strict.equal(path.resolve(c.fpExe), fpExe)
        assert.strict.deepStrictEqual(fetched, [])
    })

    //舊位置cwd/chrome/portable(deprecated) → 唯讀查找找到, cwd內容不變
    it('legacy cwd/chrome/portable is found and cwd is not modified', async function() {
        let D = newCase()
        let fpMod = makePkg(path.join(D, 'pkg'))
        let fdProj = path.join(D, 'proj')
        let fpExe = placeFakeExe(path.join(fdProj, 'chrome'), ver, { layout: 'legacy' })
        let before = listTree(fdProj)
        let { c, fetched } = await auto(fpMod, fdProj)
        assert.strict.equal(c.ok, true, c.err)
        assert.strict.equal(path.resolve(c.fpExe), fpExe)
        assert.strict.deepStrictEqual(fetched, [])
        assert.strict.deepStrictEqual(listTree(fdProj), before)
        assert.strict.equal(fs.readFileSync(fpExe, 'utf8'), 'PREINSTALLED')
    })

    //舊位置cwd/node_modules/w-html2png/chrome/portable(deprecated) → 唯讀查找找到
    it('legacy cwd/node_modules/w-html2png/chrome/portable is found', async function() {
        let D = newCase()
        let fpMod = makePkg(path.join(D, 'pkg'))
        let fdProj = path.join(D, 'proj')
        let fpExe = placeFakeExe(path.join(fdProj, 'node_modules', 'w-html2png', 'chrome'), ver, { layout: 'legacy' })
        let { c } = await auto(fpMod, fdProj)
        assert.strict.equal(c.ok, true, c.err)
        assert.strict.equal(path.resolve(c.fpExe), fpExe)
    })

    //主位置與舊位置並存 → 主位置優先
    it('main location wins over legacy locations', async function() {
        let D = newCase()
        let fpMod = makePkg(path.join(D, 'pkg'))
        let fpMain = placeFakeExe(path.join(D, 'pkg', 'chrome'), ver)
        placeFakeExe(path.join(D, 'pkg', 'chrome'), ver, { layout: 'legacy' })
        let fdProj = path.join(D, 'proj')
        placeFakeExe(path.join(fdProj, 'chrome'), ver, { layout: 'legacy' })
        let { c } = await auto(fpMod, fdProj)
        assert.strict.equal(c.ok, true, c.err)
        assert.strict.equal(path.resolve(c.fpExe), fpMain)
    })

    //套件根不可得(無package.json且無法以套件名解析)且無環境變數 → reject字串並提示環境變數與executablePath
    it('package root unavailable without env: rejects with guidance', async function() {
        let D = newCase()
        let fpMod = makePkg(path.join(D, 'nopkg'), { withPackageJson: false })
        let { c, fetched } = await auto(fpMod, path.join(D, 'other'))
        assert.strict.equal(c.ok, false)
        assert.strict.equal(c.errType, 'string')
        assert.ok(/can not locate w-html2png package root/.test(c.err) && /W_HTML2PNG_CHROME_DIR/.test(c.err) && /executablePath/.test(c.err), c.err)
        assert.strict.deepStrictEqual(fetched, [])
    })

    //環境變數W_HTML2PNG_CHROME_DIR(絕對路徑) → 優先於套件根
    it('env W_HTML2PNG_CHROME_DIR (absolute) takes precedence', async function() {
        let D = newCase()
        let fpMod = makePkg(path.join(D, 'pkg'))
        placeFakeExe(path.join(D, 'pkg', 'chrome'), ver)
        let fpExe = placeFakeExe(path.join(D, 'envdir'), ver)
        let { c } = await auto(fpMod, path.join(D, 'other'), { W_HTML2PNG_CHROME_DIR: path.join(D, 'envdir') })
        assert.strict.equal(c.ok, true, c.err)
        assert.strict.equal(path.resolve(c.fpExe), fpExe)
    })

    //環境變數為相對路徑 → reject字串並說明須為絕對路徑
    it('env W_HTML2PNG_CHROME_DIR relative path is rejected', async function() {
        let D = newCase()
        let fpMod = makePkg(path.join(D, 'pkg'))
        let { c } = await auto(fpMod, path.join(D, 'other'), { W_HTML2PNG_CHROME_DIR: 'rel/dir' })
        assert.strict.equal(c.ok, false)
        assert.strict.equal(c.errType, 'string')
        assert.ok(/absolute path/.test(c.err), c.err)
    })

    //套件以junction掛入專案(pnpm直接相依、npm link) → 以模組位置定位, 不落到cwd
    it('package linked by junction is located by module position', async function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        let D = newCase()
        makePkg(path.join(D, 'pkg2'))
        let fpExe = placeFakeExe(path.join(D, 'pkg2', 'chrome'), ver)
        let fdNm = path.join(D, 'jproj', 'node_modules')
        fs.mkdirSync(path.join(D, 'jproj', 'sub'), { recursive: true })
        fs.mkdirSync(fdNm, { recursive: true })
        let fpLink = path.join(fdNm, 'w-html2png')
        fs.symlinkSync(path.join(D, 'pkg2'), fpLink, 'junction')
        junctions.push(fpLink)
        let { c, fetched } = await auto(path.join(fpLink, 'src', 'autoDownloadFiles.mjs'), path.join(D, 'jproj', 'sub'))
        assert.strict.equal(c.ok, true, c.err)
        assert.strict.equal(fs.realpathSync(c.fpExe), fs.realpathSync(fpExe))
        assert.strict.deepStrictEqual(fetched, [])
        assert.strict.deepStrictEqual(listTree(path.join(D, 'jproj', 'sub')), [])
    })

    //皆無 → 嘗試下載至套件根(網址釘選commit), 被守門擋下時reject字串, 不寫cwd、無殘留
    it('nothing installed: download is attempted into package root only (pinned url), never into cwd', async function() {
        let D = newCase()
        let fpMod = makePkg(path.join(D, 'pkg'))
        let fdCwd = path.join(D, 'other')
        let { c, fetched } = await auto(fpMod, fdCwd)
        assert.strict.equal(c.ok, false)
        assert.strict.equal(c.errType, 'string')
        assert.ok(/can not download chrome/.test(c.err), c.err)
        assert.ok(/W_HTML2PNG_CHROME_DIR/.test(c.err) && /executablePath/.test(c.err), c.err)
        assert.ok(fetched.length > 0)
        assert.ok(fetched.every((l) => /\/raw\/[0-9a-f]{40}\/chrome\/portable\.zip\.001$/.test(l)), fetched.join('\n'))
        assert.strict.deepStrictEqual(listTree(fdCwd), [])
        assert.strict.deepStrictEqual(listTree(path.join(D, 'pkg', 'chrome')).filter((f) => /^\.(dl|old)-|^\.lock-/.test(f)), [])
    })

})
