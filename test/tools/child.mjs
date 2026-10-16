//子行程工具: 以明確cwd與env啟動node子行程, 預載fetch守門(fetchBlock.mjs, 對外fetch一律拋錯並記錄), 收集最後一行RESULT之JSON
import path from 'path'
import { spawn } from 'child_process'
import { pathToFileURL, fileURLToPath } from 'url'


let fdTools = path.dirname(fileURLToPath(import.meta.url))


/**
 * @param {String} fpScript 子行程腳本
 * @param {Object} opt
 * @param {String} [opt.cwd]
 * @param {Object} [opt.env] 額外環境變數
 * @param {Array} [opt.args=[]]
 * @param {Number} [opt.killAfterMs=0] 指定毫秒後終止子行程
 * @param {Function} [opt.killWhen=null] 每100ms檢查, 回傳true即終止子行程(使終止時點具決定性)
 * @param {Number} [opt.timeoutMs=120000] 逾時即終止
 * @param {Array} [opt.preload=[]] 額外預載模組(絕對路徑)
 * @returns {Promise} resolve為{ code, killed, timedOut, ms, result, out }
 */
function runChild(fpScript, opt = {}) {
    let { cwd = process.cwd(), env = {}, args = [], killAfterMs = 0, killWhen = null, timeoutMs = 120000, preload = [] } = opt
    let imports = [path.join(fdTools, 'fetchBlock.mjs'), ...preload].flatMap((p) => ['--import', pathToFileURL(p).href])
    return new Promise((resolve) => {
        let t0 = Date.now()
        let cp = spawn(process.execPath, [...imports, fpScript, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        cp.stdout.on('data', (d) => {
            out += d
        })
        cp.stderr.on('data', (d) => {
            out += d
        })
        let killed = false
        let timedOut = false
        let t1 = null
        let t2 = null
        if (killAfterMs > 0) {
            t1 = setTimeout(() => {
                killed = true
                cp.kill()
            }, killAfterMs)
        }
        let t3 = null
        if (typeof killWhen === 'function') {
            t3 = setInterval(() => {
                if (!killed && killWhen()) {
                    killed = true
                    cp.kill()
                }
            }, 100)
        }
        t2 = setTimeout(() => {
            timedOut = true
            cp.kill()
        }, timeoutMs)
        cp.on('close', (code) => {
            clearTimeout(t1)
            clearTimeout(t2)
            clearInterval(t3)
            let line = out.split('\n').reverse().find((l) => l.startsWith('RESULT '))
            let result = null
            if (line) {
                try {
                    result = JSON.parse(line.slice(7))
                }
                catch (err) {}
            }
            resolve({ code, killed, timedOut, ms: Date.now() - t0, result, out })
        })
    })
}


export default runChild
