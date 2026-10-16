//假chrome分片與本機分片伺服器: 下載類測試永不連外(規則R9)
import fs from 'fs'
import path from 'path'
import http from 'http'
import crypto from 'crypto'
import mZip from 'w-zip/src/mZip.mjs'


let sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')


/**
 * 產生假分片: zip內含portable/App/Chrome-bin/<ver>/chrome.exe(隨機內容), 切成n片
 * @returns {Promise} resolve為{ dirShards, exeSha256, shards:[{fn,size,sha256}], verChrome }
 */
async function makeFakeShards(fdOut, { verChrome = '138.0.7204.97', sizeKB = 1024, n = 8 } = {}) {
    fs.rmSync(fdOut, { recursive: true, force: true })
    let fdWork = path.join(fdOut, '_work')
    let fdExe = path.join(fdWork, 'portable', 'App', 'Chrome-bin', verChrome)
    fs.mkdirSync(fdExe, { recursive: true })
    let exe = crypto.randomBytes(sizeKB * 1024)
    fs.writeFileSync(path.join(fdExe, 'chrome.exe'), exe)
    fs.writeFileSync(path.join(fdWork, 'portable', 'GoogleChromePortable.exe'), 'fake')
    let fpZip = path.join(fdOut, 'fake.zip')
    await mZip.zipFolder(path.join(fdWork, 'portable'), fpZip)
    let b = fs.readFileSync(fpZip)
    let size = Math.ceil(b.length / n)
    let shards = []
    for (let i = 0; i < n; i++) {
        let fn = `portable.zip.00${i + 1}`
        let part = b.subarray(i * size, Math.min(b.length, (i + 1) * size))
        fs.writeFileSync(path.join(fdOut, fn), part)
        shards.push({ fn, size: part.length, sha256: sha256(part) })
    }
    fs.rmSync(fdWork, { recursive: true, force: true })
    fs.rmSync(fpZip, { force: true })
    return { dirShards: fdOut, exeSha256: sha256(exe), shards, verChrome }
}


/**
 * 本機分片伺服器: GET /<fn> 回傳分片(可節流), 計數請求; mode: 'normal'、'hang:<fn>'(送出標頭後不再送資料)、'corrupt:<fn>'(內容竄改)、'slow:<fn>'(該片費時3秒)
 * @returns {Promise} resolve為{ url, count(), reset(), setMode(m), close() }
 */
async function startShardServer(dirShards, { port, delayMs = 0 } = {}) {
    let n = 0
    let mode = 'normal'
    let sockets = new Set()
    let server = http.createServer((req, res) => {
        let fn = decodeURIComponent(req.url.split('?')[0].replace(/^\//, ''))
        let fp = path.join(dirShards, fn)
        if (!/^portable\.zip\.00\d$/.test(fn) || !fs.existsSync(fp)) {
            res.writeHead(404)
            res.end()
            return
        }
        n++
        let b = fs.readFileSync(fp)
        if (mode === `corrupt:${fn}`) {
            b = Buffer.from(b)
            b[0] = b[0] ^ 0xff
        }
        res.writeHead(200, { 'content-length': String(b.length), 'content-type': 'application/octet-stream' })
        if (mode === `hang:${fn}`) {
            res.write(b.subarray(0, 10))
            return //不再送資料
        }
        let k = 10
        let size = Math.ceil(b.length / k)
        let i = 0
        let send = () => {
            if (i >= k) {
                res.end()
                return
            }
            res.write(b.subarray(i * size, Math.min(b.length, (i + 1) * size)))
            i++
            let d = mode === `slow:${fn}` ? 3000 : delayMs
            if (d > 0) {
                setTimeout(send, d / k)
            }
            else {
                setImmediate(send)
            }
        }
        send()
    })
    server.on('connection', (s) => {
        sockets.add(s)
        s.on('close', () => sockets.delete(s))
    })
    await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', resolve)
    })
    return {
        url: `http://127.0.0.1:${port}/`,
        count: () => n,
        reset: () => {
            n = 0
        },
        setMode: (m) => {
            mode = m
        },
        setDelay: (ms) => {
            delayMs = ms
        },
        close: async () => {
            for (let s of sockets) {
                s.destroy()
            }
            await new Promise((resolve) => server.close(resolve))
        },
    }
}


//placeFakeExe, 放置假chrome.exe(新版面可附完成標記; 舊版面只有exe)
function placeFakeExe(fdChromeRoot, verChrome, { layout = 'main', marker = true, content = 'PREINSTALLED' } = {}) {
    let fdBase = layout === 'main' ? path.join(fdChromeRoot, verChrome) : fdChromeRoot
    let fd = path.join(fdBase, 'portable', 'App', 'Chrome-bin', verChrome)
    fs.mkdirSync(fd, { recursive: true })
    let fpExe = path.join(fd, 'chrome.exe')
    fs.writeFileSync(fpExe, content)
    if (layout === 'main' && marker) {
        fs.writeFileSync(path.join(fdBase, '.installed'), '{}')
    }
    return fpExe
}


//listTree, 列出資料夾內全部檔案之相對路徑與大小(供斷言無殘留、使用者檔案未被動)
function listTree(fd) {
    let out = []
    let walk = (d) => {
        let es = []
        try {
            es = fs.readdirSync(d, { withFileTypes: true })
        }
        catch (err) {
            return
        }
        for (let e of es) {
            let p = path.join(d, e.name)
            if (e.isDirectory()) {
                out.push(path.relative(fd, p).split(path.sep).join('/') + '/')
                walk(p)
            }
            else {
                out.push(path.relative(fd, p).split(path.sep).join('/'))
            }
        }
    }
    walk(fd)
    return out
}


export { makeFakeShards, startShardServer, placeFakeExe, listTree, sha256 }
