//子行程: 載入指定之WHtml2png(src或dist), 依CHILD_CFG出圖, 可於指定毫秒後呼叫WHtml2png.close(), 輸出 RESULT {ok, err, len, ms}
//CHILD_CFG: { mod, cjs, width, height, scale, html, opt, closeAfterMs }
import { createRequire } from 'module'
import { pathToFileURL } from 'url'


let cfg = JSON.parse(process.env.CHILD_CFG || '{}')
let W = null
if (cfg.cjs) {
    W = createRequire(import.meta.url)(cfg.mod)
}
else {
    W = (await import(pathToFileURL(cfg.mod).href)).default
}

let opt = { ...(cfg.opt || {}) }
if (cfg.funPageWaitMs) {
    //頁內等待指定毫秒後才視為完成
    // eslint-disable-next-line no-new-func
    opt.funPageWait = new Function(`window.__t0 = window.__t0 || Date.now(); return Date.now() - window.__t0 > ${Number(cfg.funPageWaitMs)}`)
}

let t0 = Date.now()
if (cfg.closeAfterMs) {
    setTimeout(() => {
        W.close()
    }, cfg.closeAfterMs)
}
let r = await W(cfg.width || 200, cfg.height || 100, cfg.scale || 1, cfg.html || '<div>x</div>', opt)
    .then((b64) => ({ ok: true, len: b64.length }), (err) => ({ ok: false, errType: typeof err, err: err instanceof Error ? err.message : String(err) }))
r.ms = Date.now() - t0
console.log('RESULT ' + JSON.stringify(r))
