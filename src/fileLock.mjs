import fs from 'fs'
import os from 'os'
import crypto from 'crypto'


//hostTag, 本機識別之短雜湊(主機名+開機時間至分鐘): 區分同主機名之複製機器, 重開機後PID重用亦不誤判; 供鎖與暫存夾名判斷是否為本機所建(他機一律不以PID判死)
let hostTag = () => {
    let boot = Math.floor((Date.now() - os.uptime() * 1000) / 60000)
    return crypto.createHash('sha1').update(`${os.hostname()}|${boot}`).digest('hex').slice(0, 12)
}


//isPidAlive, 本機行程是否存活
let isPidAlive = (pid) => {
    try {
        process.kill(pid, 0)
        return true
    }
    catch (err) {
        return err.code === 'EPERM'
    }
}


let sleep = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms))
}


let rmForce = (p) => {
    try {
        fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
    catch (err) {}
}


//readLock, 讀鎖檔: 回傳{ st, info }, st為lstat(bigint)結果, info為合法內容(pid、host、token)或null; 路徑不存在回傳null
let readLock = (fp) => {
    let st = null
    try {
        st = fs.lstatSync(fp, { bigint: true })
    }
    catch (err) {
        return null
    }
    let info = null
    if (st.isFile()) {
        try {
            let j = JSON.parse(fs.readFileSync(fp, 'utf8'))
            if (j && Number.isInteger(j.pid) && typeof j.host === 'string' && typeof j.token === 'string' && j.token !== '') {
                info = j
            }
        }
        catch (err) {}
    }
    return { st, info }
}


//sameIdentity, 兩次lstat是否為同一檔案物件(dev/ino/size/mtime)
let sameIdentity = (a, b) => {
    return a && b && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs
}


/**
 * 取得跨行程鎖(內部使用)
 *
 * 以'wx'建立鎖檔(內容pid、本機識別、token), 持有期間定時更新mtime; 等待者輪詢: done()為真即回傳null(他方已完成)
 * 過期判定: 本機識別相同且持有者PID已死, 或鎖檔之身分(dev/ino/size/mtime)於本機觀察連續staleMs未變(與兩機時鐘差無關)
 * 接手: 只接手一般檔案(合法內容, 或為空/無法解析之鎖), 以改名取得並比對改名前後身分, 非同一物件則盡量歸還且不刪除; 資料夾等其他項目一律不動, 等到逾時
 * 未取得鎖之每一輪皆檢查逾時並等待pollMs(不會同步空轉)
 *
 * @param {String} fpLock 輸入鎖檔路徑字串
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Function} [opt.done=null] 輸入是否已完成之函數, 回傳true則不需取得鎖
 * @param {Number} [opt.staleMs=60000] 輸入鎖連續多久未更新視為過期(ms)
 * @param {Number} [opt.heartbeatMs=5000] 輸入持有期間更新mtime之間隔(ms)
 * @param {Number} [opt.pollMs=300] 輸入等待時之輪詢間隔(ms)
 * @param {Number} [opt.timeoutMs=3600000] 輸入等待逾時(ms)
 * @returns {Promise} 回傳Promise, resolve為釋放鎖之函數(另帶touch方法可手動更新mtime), 或null代表done()已為真; 逾時reject Error(訊息含持有者資訊)
 */
async function acquireLock(fpLock, opt = {}) {
    let done = typeof opt.done === 'function' ? opt.done : () => false
    let staleMs = opt.staleMs ?? 60000
    let heartbeatMs = opt.heartbeatMs ?? 5000
    let pollMs = opt.pollMs ?? 300
    let timeoutMs = opt.timeoutMs ?? 60 * 60 * 1000
    let host = hostTag()
    let t0 = Date.now()
    let seen = null //{ key, at }: 本機觀察到之鎖身分與其最後變動之本機時間

    while (true) {

        //done
        if (done()) {
            return null
        }

        //create
        let token = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
        let fd = null
        try {
            fd = fs.openSync(fpLock, 'wx')
        }
        catch (err) {
            if (err.code !== 'EEXIST') {
                throw err
            }
        }
        if (fd !== null) {
            try {
                fs.writeSync(fd, JSON.stringify({ pid: process.pid, host, token, t: Date.now() }))
            }
            catch (err) {
                //寫入失敗不可留下空鎖
                try {
                    fs.closeSync(fd)
                }
                catch (e) {}
                try {
                    fs.unlinkSync(fpLock)
                }
                catch (e) {}
                throw err
            }
            fs.closeSync(fd)
            let isMine = () => {
                let r = readLock(fpLock)
                return r !== null && r.info !== null && r.info.token === token
            }
            let touch = () => {
                try {
                    if (isMine()) {
                        let now = new Date()
                        fs.utimesSync(fpLock, now, now)
                    }
                }
                catch (err) {}
            }
            let timer = setInterval(touch, heartbeatMs)
            timer.unref()
            let release = () => {
                clearInterval(timer)
                if (isMine()) {
                    try {
                        fs.unlinkSync(fpLock)
                    }
                    catch (err) {}
                }
            }
            release.touch = touch
            return release
        }

        //stale
        let r = readLock(fpLock)
        if (r !== null && r.st.isFile()) {
            let key = `${r.st.dev}|${r.st.ino}|${r.st.size}|${r.st.mtimeNs}`
            if (seen === null || seen.key !== key) {
                seen = { key, at: Date.now() }
            }
            let dead = r.info !== null && r.info.host === host && r.info.pid !== process.pid && !isPidAlive(r.info.pid)
            let expired = Date.now() - seen.at > staleMs
            if (dead || expired) {
                let fpStale = `${fpLock}.stale-${process.pid}-${Date.now()}-${host}`
                let moved = false
                try {
                    fs.renameSync(fpLock, fpStale)
                    moved = true
                }
                catch (err) {}
                if (moved) {
                    let st2 = null
                    try {
                        st2 = fs.lstatSync(fpStale, { bigint: true })
                    }
                    catch (err) {}
                    if (sameIdentity(r.st, st2)) {
                        rmForce(fpStale)
                        seen = null
                        continue //接手成功, 立即重試建立
                    }
                    //改名到之物件非所判定之鎖(他方剛建立之新鎖), 盡量歸還, 不刪除
                    if (!fs.existsSync(fpLock)) {
                        try {
                            fs.renameSync(fpStale, fpLock)
                        }
                        catch (err) {}
                    }
                }
            }
        }

        //timeout
        if (Date.now() - t0 > timeoutMs) {
            let r2 = readLock(fpLock)
            let holder = r2 === null ? 'none' : r2.info !== null ? `pid[${r2.info.pid}] host[${r2.info.host}]` : (r2.st.isFile() ? 'unparsable lock file' : 'non-file item occupies the lock path')
            throw new Error(`timeout waiting for lock[${fpLock}] after ${timeoutMs}ms, holder: ${holder}; another process may still be downloading, retry later`)
        }

        await sleep(pollMs)
    }
}


export { hostTag, isPidAlive, rmForce, readLock }
export default acquireLock
