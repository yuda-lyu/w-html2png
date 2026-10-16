//子行程: 呼叫指定模組之ensureChrome或預設匯出(autoDownloadFiles), 輸出 RESULT {results:[{ok,fpExe,sha,err}]}
//設定以環境變數CHILD_CFG(JSON)給予: mod(模組絕對路徑)、fn('ensure'|'auto')、instances、calls、opt(ensureChrome之opt)
import fs from 'fs'
import crypto from 'crypto'
import { pathToFileURL } from 'url'


let cfg = JSON.parse(process.env.CHILD_CFG || '{}')
let nInst = cfg.instances || 1
let nCalls = cfg.calls || 1

let fns = []
for (let i = 0; i < nInst; i++) {
    let m = await import(pathToFileURL(cfg.mod).href + (i > 0 ? `?inst=${i}` : ''))
    fns.push(cfg.fn === 'auto' ? m.default : () => m.ensureChrome(cfg.opt || {}))
}

let one = (f) => f().then((r) => {
    let sha = null
    try {
        sha = crypto.createHash('sha256').update(fs.readFileSync(r.fpExe)).digest('hex')
    }
    catch (err) {}
    return { ok: true, fpExe: r.fpExe, sha }
}, (err) => {
    return { ok: false, errType: typeof err, err: err instanceof Error ? err.message : String(err) }
})

let results = await Promise.all(fns.flatMap((f) => Array.from({ length: nCalls }, () => one(f))))
console.log('RESULT ' + JSON.stringify({ pid: process.pid, results }))
