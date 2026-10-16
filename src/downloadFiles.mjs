import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import fsMergeFiles from 'wsemi/src/fsMergeFiles.mjs'
import mZip from 'w-zip/src/mZip.mjs'
import acquireLock, { hostTag, isPidAlive, rmForce, readLock } from './fileLock.mjs'


//OWNER, 本套件所建安裝資料夾之擁有標記檔名(安裝前即與完成標記一併寫入, 改名後同時就位)
let OWNER = '.w-html2png-owner'


let sleep = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms))
}


let isFile = (fp) => {
    try {
        return fs.statSync(fp).isFile()
    }
    catch (err) {
        return false
    }
}


let lstatSafe = (fp) => {
    try {
        return fs.lstatSync(fp)
    }
    catch (err) {
        return null
    }
}


let readJson = (fp) => {
    try {
        return JSON.parse(fs.readFileSync(fp, 'utf8'))
    }
    catch (err) {
        return null
    }
}


//isRealDir, 一般資料夾(非符號連結/junction)
let isRealDir = (fp) => {
    let st = lstatSafe(fp)
    return st !== null && st.isDirectory() && !st.isSymbolicLink()
}


//relExe, relDll, 安裝資料夾內之執行檔與主要函式庫之相對路徑
let relExe = (verChrome) => path.join('portable', 'App', 'Chrome-bin', verChrome, 'chrome.exe')
let relDll = (verChrome) => path.join('portable', 'App', 'Chrome-bin', verChrome, 'chrome.dll')


//getInstallInfo, 安裝資料夾(<fdChromeRoot>/<verChrome>)內之執行檔與完成標記
let getInstallInfo = (fdChromeRoot, verChrome) => {
    let fdInstall = path.join(fdChromeRoot, verChrome)
    let fpExe = path.join(fdInstall, relExe(verChrome))
    let fpMarker = path.join(fdInstall, '.installed')
    return {
        fdInstall,
        fpExe,
        fpMarker,
    }
}


//isInstalledDir, 資料夾是否為完整安裝: 完成標記存在且其所記錄之檔案大小皆相符(只有exe而無標記、或檔案被隔離/截斷者視為殘缺)
let isInstalledDir = (fdInstall, verChrome) => {
    let mk = readJson(path.join(fdInstall, '.installed'))
    if (mk === null || !isFile(path.join(fdInstall, relExe(verChrome)))) {
        return false
    }
    let files = mk.files && typeof mk.files === 'object' ? mk.files : {}
    for (let [rel, size] of Object.entries(files)) {
        let st = null
        try {
            st = fs.statSync(path.join(fdInstall, rel))
        }
        catch (err) {
            return false
        }
        if (!st.isFile() || st.size !== size) {
            return false
        }
    }
    return true
}


//isInstalled, 主位置是否為完整安裝
let isInstalled = (fdChromeRoot, verChrome) => {
    return isInstalledDir(path.join(fdChromeRoot, verChrome), verChrome)
}


//isOwnedDir, 是否為本套件所建之安裝資料夾(一般資料夾且有擁有標記)
let isOwnedDir = (fd) => {
    if (!isRealDir(fd)) {
        return false
    }
    let j = readJson(path.join(fd, OWNER))
    return j !== null && j.owner === 'w-html2png'
}


//genName, 本套件自建項目之名稱: .<tag>-<ver>-<pid>-<ts>-<rand>-<host>
let genName = (tag, verChrome) => {
    return `.${tag}-${verChrome}-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${hostTag()}`
}


//sweep, 只清除本套件自建且擁有者(本機)已死之項目: .dl-/.old-資料夾(一般資料夾)、.lock-<ver>.stale-檔案, 以及includeLocks時本機已死持有者之.lock-<ver>檔案; 其他任何項目一律不動
let sweep = (fdChromeRoot, { includeLocks = false } = {}) => {
    let host = hostTag()
    let fns = []
    try {
        fns = fs.readdirSync(fdChromeRoot)
    }
    catch (err) {
        return
    }
    for (let fn of fns) {
        let fp = path.join(fdChromeRoot, fn)
        let m1 = /^\.(dl|old)-[0-9.]+-(\d+)-\d+-[0-9a-f]+-([0-9a-f]{12})$/.exec(fn)
        let m2 = /^\.lock-[0-9.]+\.stale-(\d+)-\d+-([0-9a-f]{12})$/.exec(fn)
        let m3 = includeLocks ? /^\.lock-[0-9.]+$/.exec(fn) : null
        if (m1) {
            let pid = Number(m1[2])
            if (m1[3] === host && pid !== process.pid && !isPidAlive(pid) && isRealDir(fp)) {
                rmForce(fp)
            }
        }
        else if (m2) {
            let pid = Number(m2[1])
            let st = lstatSafe(fp)
            if (m2[2] === host && pid !== process.pid && !isPidAlive(pid) && st !== null && st.isFile()) {
                rmForce(fp)
            }
        }
        else if (m3) {
            let r = readLock(fp)
            if (r !== null && r.info !== null && r.info.host === host && r.info.pid !== process.pid && !isPidAlive(r.info.pid)) {
                try {
                    fs.unlinkSync(fp)
                }
                catch (err) {}
            }
        }
    }
}


//renameRetry, Windows下新寫入之檔案可能被防毒短暫鎖定, EPERM/EBUSY/EACCES時重試(約60秒); 目標已存在則立即拋錯(非防毒鎖定)
let renameRetry = async (fpOld, fpNew, n = 240) => {
    for (let i = 0; ; i++) {
        try {
            fs.renameSync(fpOld, fpNew)
            return
        }
        catch (err) {
            if (i >= n || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code) || lstatSafe(fpNew) !== null) {
                throw err
            }
            await sleep(250)
        }
    }
}


//fetchToFile, 下載網址至檔案, 含連線逾時與閒置逾時
let fetchToFile = async (url, fp, { connectTimeoutMs, idleTimeoutMs }) => {
    let ac = new AbortController()
    let timerConnect = setTimeout(() => ac.abort(new Error(`connect timeout ${connectTimeoutMs}ms`)), connectTimeoutMs)
    let timerIdle = null
    try {
        let res = await fetch(url, { signal: ac.signal })
        clearTimeout(timerConnect)
        if (!res.ok) {
            try {
                await res.body.cancel()
            }
            catch (err) {}
            throw new Error(`status[${res.status}]`)
        }
        let resetIdle = () => {
            clearTimeout(timerIdle)
            timerIdle = setTimeout(() => ac.abort(new Error(`idle timeout ${idleTimeoutMs}ms`)), idleTimeoutMs)
        }
        resetIdle()
        let tr = new Transform({
            transform(chunk, enc, cb) {
                resetIdle()
                cb(null, chunk)
            },
        })
        await pipeline(Readable.fromWeb(res.body), tr, fs.createWriteStream(fp))
    }
    finally {
        clearTimeout(timerConnect)
        clearTimeout(timerIdle)
    }
}


//sha256File
let sha256File = async (fp) => {
    let h = crypto.createHash('sha256')
    await pipeline(fs.createReadStream(fp), h)
    return h.digest('hex')
}


//downloadShard, 下載單片並核對大小與SHA-256, 失敗重試
let downloadShard = async (url, fp, shard, opt) => {
    let errLast = null
    for (let i = 0; i < opt.retries; i++) {
        try {
            await fetchToFile(url, fp, opt)
            let size = fs.statSync(fp).size
            if (size !== shard.size) {
                throw new Error(`size mismatch, expected[${shard.size}] received[${size}]`)
            }
            let sha = await sha256File(fp)
            if (sha !== shard.sha256) {
                throw new Error(`sha256 mismatch, expected[${shard.sha256}] received[${sha}]`)
            }
            return
        }
        catch (err) {
            errLast = err
            rmForce(fp)
            if (i < opt.retries - 1) {
                await sleep(opt.retryDelayMs)
            }
        }
    }
    throw new Error(`failed to download url[${url}]: ${errLast && errLast.message}`)
}


/**
 * 下載並安裝套件自帶之免安裝chrome至<fdChromeRoot>/<verChrome>/portable(內部使用)
 *
 * 跨行程以鎖檔互斥; 各行程於自己建立之隔離夾下載、核對大小與SHA-256、合併、解壓, 驗證後寫入擁有標記與完成標記, 再以改名原子安裝
 * 只刪除本套件自建之項目: 隔離夾(確由本次建立者)、擁有者已死之殘留、帶擁有標記之殘缺安裝; 主位置已存在而非本套件所建者不刪除並reject
 *
 * @param {String} fdChromeRoot 輸入chrome根資料夾(絕對路徑)
 * @param {Object} manifest 輸入下載清單, 含verChrome、urlBase、shards(fn、size、sha256)
 * @param {Object} [opt={}] 輸入設定物件(connectTimeoutMs、idleTimeoutMs、retries、retryDelayMs、staleMs、heartbeatMs、pollMs、lockTimeoutMs、log)
 * @returns {Promise} 回傳Promise, resolve為無, reject為Error
 */
async function downloadFiles(fdChromeRoot, manifest, opt = {}) {
    let { verChrome, urlBase, shards } = manifest
    let o = {
        connectTimeoutMs: opt.connectTimeoutMs ?? 30 * 1000,
        idleTimeoutMs: opt.idleTimeoutMs ?? 60 * 1000,
        retries: opt.retries ?? 3,
        retryDelayMs: opt.retryDelayMs ?? 1000,
        staleMs: opt.staleMs ?? 60 * 1000,
        heartbeatMs: opt.heartbeatMs ?? 5 * 1000,
        pollMs: opt.pollMs ?? 300,
        lockTimeoutMs: opt.lockTimeoutMs ?? 60 * 60 * 1000,
        log: typeof opt.log === 'function' ? opt.log : (msg) => console.error(msg),
    }

    //mkdir
    fs.mkdirSync(fdChromeRoot, { recursive: true })

    //lock
    let release = await acquireLock(path.join(fdChromeRoot, `.lock-${verChrome}`), {
        done: () => isInstalled(fdChromeRoot, verChrome),
        staleMs: o.staleMs,
        heartbeatMs: o.heartbeatMs,
        pollMs: o.pollMs,
        timeoutMs: o.lockTimeoutMs,
    })
    if (release === null) {
        return
    }

    let fdWork = path.join(fdChromeRoot, genName('dl', verChrome))
    let createdWork = false
    try {

        //check, 等待鎖期間他方已完成
        if (isInstalled(fdChromeRoot, verChrome)) {
            return
        }

        //sweep
        sweep(fdChromeRoot)

        //fdWork, 非遞迴建立, 已存在即拋錯; 只有確由本次建立者才於結束時刪除
        fs.mkdirSync(fdWork)
        createdWork = true

        //download
        let fps = []
        for (let shard of shards) {
            let url = `${urlBase}${shard.fn}`
            let fp = path.join(fdWork, shard.fn)
            o.log(`w-html2png: downloading chrome url[${url}] to fp[${fp}]...`)
            await downloadShard(url, fp, shard, o)
            fps.push(fp)
            release.touch()
        }

        //merge, 完成後會刪除fps(皆位於隔離夾內)
        let fpZip = path.join(fdWork, 'portable.zip')
        await fsMergeFiles(fps, fpZip)
            .catch((err) => {
                throw new Error(`merge failed: ${err && err.message ? err.message : err}`)
            })
        release.touch()

        //unzip, 目標位於隔離夾內(不存在), 不觸及隔離夾外之任何檔案
        let fdUnz = path.join(fdWork, 'unz')
        await mZip.unzip(fpZip, fdUnz)
            .catch((err) => {
                throw new Error(`unzip failed: ${err && err.message ? err.message : err}`)
            })
        release.touch()
        rmForce(fpZip)

        //verify
        let fpExeNew = path.join(fdUnz, relExe(verChrome))
        if (!isFile(fpExeNew)) {
            throw new Error(`downloaded archive does not contain chrome.exe of version[${verChrome}]`)
        }

        //marker, 先寫入擁有標記與完成標記(含主要檔案大小), 使改名後安裝內容與標記同時就位
        let files = {}
        for (let rel of [relExe(verChrome), relDll(verChrome)]) {
            if (isFile(path.join(fdUnz, rel))) {
                files[rel.split(path.sep).join('/')] = fs.statSync(path.join(fdUnz, rel)).size
            }
        }
        fs.writeFileSync(path.join(fdUnz, OWNER), JSON.stringify({ owner: 'w-html2png', verChrome }), 'utf8')
        fs.writeFileSync(path.join(fdUnz, '.installed'), JSON.stringify({ verChrome, commit: manifest.commit || '', installedAt: new Date().toISOString(), files }), 'utf8')

        //install
        let { fdInstall } = getInstallInfo(fdChromeRoot, verChrome)
        if (isInstalled(fdChromeRoot, verChrome)) {
            return
        }
        if (lstatSafe(fdInstall) !== null) {

            //主位置已存在而非本套件所建: 不刪除, reject
            if (!isOwnedDir(fdInstall)) {
                throw new Error(`[${fdInstall}] exists but was not created by w-html2png, remove it or set env W_HTML2PNG_CHROME_DIR to a dedicated folder`)
            }

            //本套件所建之殘缺安裝: 先移開; 若移開者其實是他方剛完成之安裝(鎖被誤判之競態)則還原並視為完成
            let fdOld = path.join(fdChromeRoot, genName('old', verChrome))
            await renameRetry(fdInstall, fdOld)
            if (isInstalledDir(fdOld, verChrome)) {
                try {
                    fs.renameSync(fdOld, fdInstall)
                    return
                }
                catch (err) {}
            }
            rmForce(fdOld)

        }
        try {
            await renameRetry(fdUnz, fdInstall)
        }
        catch (err) {
            //改名失敗時若主位置已完整(他方已完成), 視為完成
            if (isInstalled(fdChromeRoot, verChrome)) {
                return
            }
            throw err
        }

        //check
        if (!isInstalled(fdChromeRoot, verChrome)) {
            throw new Error(`install failed, chrome.exe or marker not found in [${fdInstall}]`)
        }

    }
    finally {
        if (createdWork) {
            rmForce(fdWork)
        }
        release()
    }

}


export { getInstallInfo, isInstalled, isOwnedDir, sweep, OWNER }
export default downloadFiles
