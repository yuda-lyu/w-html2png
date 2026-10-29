//子行程: 載入指定之ensureBins模組(第1個參數, 絕對路徑), 以CHILD_CFG(JSON)之opt呼叫, 輸出 RESULT { cwd, ok, chrome, code, cachePath }
import { pathToFileURL } from 'url'


let cfg = JSON.parse(process.env.CHILD_CFG || '{}')
let ensureBins = (await import(pathToFileURL(process.argv[2]).href)).default
let r = await ensureBins(cfg.opt || {})
    .then((res) => ({ ok: true, chrome: res.chrome }), (err) => ({ ok: false, code: err.code, cachePath: err.missing && err.missing[0] ? err.missing[0].cachePath : null, err: err.message }))
r.cwd = process.cwd()
console.log('RESULT ' + JSON.stringify(r))
