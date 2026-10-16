import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { makeFakeShards, startShardServer, placeFakeExe, listTree } from './tools/fakeChrome.mjs'
import runChild from './tools/child.mjs'
import { hostTag } from '../src/fileLock.mjs'
import { OWNER } from '../src/downloadFiles.mjs'


//規則R3、R5、R10、R13: 首次下載跨行程安全、只動本套件自建之項目; 全程以本機分片伺服器(埠9040)供應假分片, 不連外
let fdTest = path.resolve('./test/_tmp/chromeDownload')
let fpMod = fileURLToPath(new URL('../src/autoDownloadFiles.mjs', import.meta.url))
let fpChild = fileURLToPath(new URL('./tools/childEnsure.mjs', import.meta.url))
let ver = '138.0.7204.97'
let fake = null
let srv = null
let iCase = 0


let newRoot = () => {
    iCase++
    let fd = path.join(fdTest, `case${iCase}`, 'chrome')
    fs.mkdirSync(fd, { recursive: true })
    return fd
}


let manifest = () => ({ verChrome: ver, commit: 'test', urlBase: srv.url, shards: fake.shards })


let ensureInChildren = async (fdChromeRoot, { nProc = 1, instances = 1, calls = 1, opt = {}, killAfterMs = 0, killWhen = null, timeoutMs = 60000 } = {}) => {
    let cfg = { mod: fpMod, fn: 'ensure', instances, calls, opt: { manifest: manifest(), fdChromeRoot, legacy: false, retries: 1, connectTimeoutMs: 5000, idleTimeoutMs: 5000, failCooldownMs: 0, ...opt } }
    let rs = await Promise.all(Array.from({ length: nProc }, () => runChild(fpChild, { env: { CHILD_CFG: JSON.stringify(cfg) }, killAfterMs, killWhen, timeoutMs })))
    return rs
}


let calls = (rs) => rs.flatMap((r) => (r.result ? r.result.results : [{ ok: false, err: `child exit ${r.code} killed=${r.killed} timedOut=${r.timedOut}` }]))


let ownLeftovers = (fdChromeRoot) => listTree(fdChromeRoot).filter((f) => /^\.(dl|old)-|^\.lock-/.test(f))


let deadPid = () => {
    let r = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' })
    return Number(r.stdout.trim())
}


let writeTree = (root, items) => {
    for (let [k, v] of Object.entries(items)) {
        fs.mkdirSync(path.dirname(path.join(root, k)), { recursive: true })
        fs.writeFileSync(path.join(root, k), v)
    }
}


describe('unit-chromeDownload', function() {

    before(async function() {
        fs.rmSync(fdTest, { recursive: true, force: true })
        fake = await makeFakeShards(path.join(fdTest, 'shards'), { verChrome: ver, sizeKB: 1024 })
        srv = await startShardServer(fake.dirShards, { port: 9040, delayMs: 250 })
    })

    after(async function() {
        if (srv) {
            await srv.close()
        }
        fs.rmSync(fdTest, { recursive: true, force: true })
    })

    beforeEach(function() {
        srv.reset()
        srv.setMode('normal')
        srv.setDelay(250)
    })

    //R3: 單一行程首次下載, 安裝於<root>/<ver>/portable且附完成與擁有標記, 無殘留
    it('installs once into versioned folder with markers and no leftovers', async function() {
        let root = newRoot()
        let cs = calls(await ensureInChildren(root))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true])
        assert.strict.equal(cs[0].sha, fake.exeSha256)
        assert.ok(cs[0].fpExe.startsWith(path.join(root, ver, 'portable')))
        assert.ok(fs.existsSync(path.join(root, ver, '.installed')))
        assert.ok(fs.existsSync(path.join(root, ver, OWNER)))
        assert.strict.equal(srv.count(), 8)
        assert.strict.deepStrictEqual(ownLeftovers(root), [])
    })

    //R3: 同行程同模組實例3次併發 → 以Promise合併, 只下載一份
    it('3 concurrent calls in one module instance: downloaded once', async function() {
        let root = newRoot()
        let cs = calls(await ensureInChildren(root, { calls: 3 }))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true, true, true], JSON.stringify(cs))
        assert.strict.equal(srv.count(), 8)
    })

    //R3: 2個行程同時首次使用 → 皆成功, 只下載一份
    it('2 processes first use concurrently: all succeed, downloaded once', async function() {
        let root = newRoot()
        let cs = calls(await ensureInChildren(root, { nProc: 2 }))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true, true], JSON.stringify(cs))
        assert.ok(cs.every((c) => c.sha === fake.exeSha256))
        assert.strict.equal(srv.count(), 8)
        assert.strict.deepStrictEqual(ownLeftovers(root), [])
    })

    //R3: 3個行程同時
    it('3 processes first use concurrently: all succeed, downloaded once', async function() {
        let root = newRoot()
        let cs = calls(await ensureInChildren(root, { nProc: 3 }))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true, true, true], JSON.stringify(cs))
        assert.strict.equal(srv.count(), 8)
        assert.strict.deepStrictEqual(ownLeftovers(root), [])
    })

    //R3: 同行程2份模組實例(main+src雙實例)
    it('2 module instances in one process: all succeed, downloaded once', async function() {
        let root = newRoot()
        let cs = calls(await ensureInChildren(root, { instances: 2 }))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true, true], JSON.stringify(cs))
        assert.strict.equal(srv.count(), 8)
    })

    //R3: 心跳 — 下載時間遠大於staleMs時, 等待者不得接手持有者之鎖(仍只下載一份)
    it('heartbeat keeps the lock while download takes longer than staleMs', async function() {
        let root = newRoot()
        srv.setMode('slow:portable.zip.001') //第1片費時3秒, 片內只有計時器心跳更新鎖
        let cs = calls(await ensureInChildren(root, { nProc: 2, opt: { staleMs: 1500, heartbeatMs: 300, pollMs: 100 } }))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true, true], JSON.stringify(cs))
        assert.strict.equal(srv.count(), 8)
    })

    //R13: 下載中被終止(確認已建立隔離夾與鎖後才終止), 重跑成功並清除被終止者之隔離夾與鎖
    it('killed during download: rerun succeeds and sweeps leftovers', async function() {
        let root = newRoot()
        let hasDl = () => listTree(root).some((f) => /^\.dl-/.test(f))
        let r1 = await ensureInChildren(root, { killWhen: hasDl })
        assert.ok(r1[0].killed)
        assert.ok(ownLeftovers(root).some((f) => /^\.dl-/.test(f)), 'precondition: isolated folder left by killed process')
        assert.ok(ownLeftovers(root).some((f) => /^\.lock-/.test(f)), 'precondition: lock left by killed process')
        let cs = calls(await ensureInChildren(root))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true], JSON.stringify(cs))
        assert.strict.equal(cs[0].sha, fake.exeSha256)
        assert.strict.deepStrictEqual(ownLeftovers(root), [])
    })

    //R13: 本套件所建而殘缺之安裝(有擁有標記、無完成標記) → 重裝
    it('incomplete own install (owner marker, no completion marker) is replaced', async function() {
        let root = newRoot()
        placeFakeExe(root, ver, { layout: 'main', marker: false, content: 'BROKEN' })
        fs.writeFileSync(path.join(root, ver, OWNER), JSON.stringify({ owner: 'w-html2png', verChrome: ver }))
        let cs = calls(await ensureInChildren(root))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true], JSON.stringify(cs))
        assert.strict.equal(cs[0].sha, fake.exeSha256)
        assert.ok(fs.existsSync(path.join(root, ver, '.installed')))
        assert.strict.deepStrictEqual(ownLeftovers(root), [])
    })

    //R13: 完成標記所記錄之檔案大小不符(檔案被截斷/隔離) → 視為殘缺而重裝
    it('installed files damaged after install: reinstalled', async function() {
        let root = newRoot()
        let cs1 = calls(await ensureInChildren(root))
        assert.strict.equal(cs1[0].ok, true)
        fs.writeFileSync(cs1[0].fpExe, 'TRUNCATED')
        srv.reset()
        let cs2 = calls(await ensureInChildren(root))
        assert.strict.equal(cs2[0].ok, true, JSON.stringify(cs2))
        assert.strict.equal(cs2[0].sha, fake.exeSha256)
        assert.strict.equal(srv.count(), 8)
    })

    //R13、A-6: 主位置已存在而非本套件所建(無擁有標記) → 不刪除, reject字串
    it('existing version folder not created by w-html2png is kept and rejected', async function() {
        let root = newRoot()
        writeTree(root, { [`${ver}/user.txt`]: 'MINE', [`${ver}/portable/App/Chrome-bin/${ver}/chrome.exe`]: 'USER-CHROME' })
        let cs = calls(await ensureInChildren(root))
        assert.strict.equal(cs[0].ok, false)
        assert.strict.equal(cs[0].errType, 'string')
        assert.ok(/not created by w-html2png/.test(cs[0].err), cs[0].err)
        assert.strict.equal(fs.readFileSync(path.join(root, ver, 'user.txt'), 'utf8'), 'MINE')
        assert.strict.equal(fs.readFileSync(path.join(root, ver, 'portable', 'App', 'Chrome-bin', ver, 'chrome.exe'), 'utf8'), 'USER-CHROME')
        assert.strict.deepStrictEqual(ownLeftovers(root), [])
    })

    //R10: 分片SHA-256不符 → reject字串, 不安裝, 無殘留
    it('sha256 mismatch: rejects with string, installs nothing', async function() {
        let root = newRoot()
        srv.setMode('corrupt:portable.zip.003')
        let cs = calls(await ensureInChildren(root))
        assert.strict.equal(cs[0].ok, false)
        assert.strict.equal(cs[0].errType, 'string')
        assert.ok(/sha256 mismatch/.test(cs[0].err), cs[0].err)
        assert.ok(!fs.existsSync(path.join(root, ver)))
        assert.strict.deepStrictEqual(ownLeftovers(root), [])
    })

    //B-7: 下載懸置 → 閒置逾時後reject, 不永久卡住
    it('stalled download: rejects after idle timeout', async function() {
        let root = newRoot()
        srv.setMode('hang:portable.zip.002')
        let t0 = Date.now()
        let cs = calls(await ensureInChildren(root, { opt: { idleTimeoutMs: 1500 } }))
        assert.strict.equal(cs[0].ok, false)
        assert.ok(/idle timeout/.test(cs[0].err), cs[0].err)
        assert.ok(Date.now() - t0 < 30000)
        assert.strict.deepStrictEqual(ownLeftovers(root), [])
    })

    //R13、A-6: chrome根資料夾內既有之使用者檔案(含舊版固定名)不被覆寫或刪除
    it('user files in chrome root are untouched', async function() {
        let root = newRoot()
        let items = {
            'temp/user.txt': 'U1',
            'portable.zip': 'U2',
            'portable.zip.001': 'U3',
            'portable/keep.txt': 'U4',
        }
        writeTree(root, items)
        let cs = calls(await ensureInChildren(root))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true], JSON.stringify(cs))
        for (let [k, v] of Object.entries(items)) {
            assert.strict.equal(fs.readFileSync(path.join(root, k), 'utf8'), v, k)
        }
    })

    //R10: 套件repo新clone版面(chrome/下有受版控之分片與ver.txt)→ 分片不被覆寫或刪除
    it('tracked shards in repo chrome folder are untouched', async function() {
        let root = newRoot()
        for (let i = 1; i <= 8; i++) {
            fs.writeFileSync(path.join(root, `portable.zip.00${i}`), `TRACKED-${i}`)
        }
        fs.writeFileSync(path.join(root, 'ver.txt'), ver)
        let cs = calls(await ensureInChildren(root))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true], JSON.stringify(cs))
        for (let i = 1; i <= 8; i++) {
            assert.strict.equal(fs.readFileSync(path.join(root, `portable.zip.00${i}`), 'utf8'), `TRACKED-${i}`)
        }
        assert.strict.equal(fs.readFileSync(path.join(root, 'ver.txt'), 'utf8'), ver)
    })

    //R3: 鎖之持有者(本機)已死 → 接手並完成
    it('lock held by a dead process is taken over', async function() {
        let root = newRoot()
        fs.writeFileSync(path.join(root, `.lock-${ver}`), JSON.stringify({ pid: deadPid(), host: hostTag(), token: 'dead', t: Date.now() }))
        let cs = calls(await ensureInChildren(root))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true], JSON.stringify(cs))
        assert.strict.deepStrictEqual(ownLeftovers(root), [])
    })

    //R3: 空鎖(建立者寫入前被終止)於本機觀察staleMs未變後接手, 不會同步空轉
    it('empty lock file is taken over after staleMs without busy looping', async function() {
        let root = newRoot()
        fs.writeFileSync(path.join(root, `.lock-${ver}`), '')
        let t0 = Date.now()
        let cs = calls(await ensureInChildren(root, { opt: { staleMs: 1000, pollMs: 100 }, timeoutMs: 40000 }))
        assert.strict.deepStrictEqual(cs.map((c) => c.ok), [true], JSON.stringify(cs))
        assert.ok(Date.now() - t0 < 30000)
        assert.strict.deepStrictEqual(ownLeftovers(root), [])
    })

    //R3: 鎖之持有者存活且鎖未過期 → 等待逾時後reject, 訊息含持有者
    it('live lock holder: waits then rejects with holder info after lockTimeoutMs', async function() {
        let root = newRoot()
        fs.writeFileSync(path.join(root, `.lock-${ver}`), JSON.stringify({ pid: process.pid, host: hostTag(), token: 'live', t: Date.now() }))
        let cs = calls(await ensureInChildren(root, { opt: { lockTimeoutMs: 1500, pollMs: 100 } }))
        assert.strict.equal(cs[0].ok, false)
        assert.ok(/timeout waiting for lock/.test(cs[0].err) && cs[0].err.includes(`pid[${process.pid}]`), cs[0].err)
        assert.ok(fs.existsSync(path.join(root, `.lock-${ver}`)))
        assert.strict.equal(srv.count(), 0)
    })

    //R13: 鎖路徑為資料夾(非本套件所建) → 一律不動, 逾時reject
    it('a folder occupying the lock path is never removed', async function() {
        let root = newRoot()
        writeTree(root, { [`.lock-${ver}/user.txt`]: 'KEEP' })
        let cs = calls(await ensureInChildren(root, { opt: { lockTimeoutMs: 1500, staleMs: 300, pollMs: 100 } }))
        assert.strict.equal(cs[0].ok, false)
        assert.ok(/non-file item occupies the lock path/.test(cs[0].err), cs[0].err)
        assert.strict.equal(fs.readFileSync(path.join(root, `.lock-${ver}`, 'user.txt'), 'utf8'), 'KEEP')
    })

    //R13: 清掃只刪本機擁有者已死之自建資料夾; 擁有者存活、他機、非資料夾者不動
    it('sweep removes only dead own folders', async function() {
        let root = newRoot()
        let h = hostTag()
        let dp = deadPid()
        let keepAlive = `.dl-${ver}-${process.pid}-1-aa-${h}`
        let keepOther = `.dl-${ver}-${dp}-1-bb-0123456789ab`
        let keepFile = `.dl-${ver}-${dp}-1-cc-${h}`
        let gone = `.dl-${ver}-${dp}-1-dd-${h}`
        writeTree(root, { [`${keepAlive}/x`]: '1', [`${keepOther}/x`]: '2', [keepFile]: '3', [`${gone}/x`]: '4' })
        let cs = calls(await ensureInChildren(root))
        assert.strict.equal(cs[0].ok, true, JSON.stringify(cs))
        let t = listTree(root)
        assert.ok(t.includes(`${keepAlive}/`) && t.includes(`${keepOther}/`) && t.includes(keepFile), JSON.stringify(t))
        assert.ok(!t.includes(`${gone}/`), JSON.stringify(t))
    })

    //R13: 每行程首次定位成功時清掃(主位置已完整, 不需下載): 清除已死者之隔離夾與鎖
    it('first successful locate in a new process sweeps dead leftovers', async function() {
        let root = newRoot()
        let cs1 = calls(await ensureInChildren(root))
        assert.strict.equal(cs1[0].ok, true)
        let dp = deadPid()
        let h = hostTag()
        writeTree(root, { [`.dl-${ver}-${dp}-1-ee-${h}/x`]: '1' })
        fs.writeFileSync(path.join(root, `.lock-${ver}`), JSON.stringify({ pid: dp, host: h, token: 'dead', t: Date.now() }))
        srv.reset()
        let cs2 = calls(await ensureInChildren(root))
        assert.strict.equal(cs2[0].ok, true)
        assert.strict.equal(srv.count(), 0)
        assert.strict.deepStrictEqual(ownLeftovers(root), [])
    })

})
