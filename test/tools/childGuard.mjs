//子行程: 以假BrowserType(經w-playwright之setBrowserTypeForTest; 不呼叫next(), 不啟動任何瀏覽器)呼叫WHtml2png一次, 輸出 RESULT { ok, errType, err, nLaunch }
//CHILD_MODE: 'single'|'alive'; 供以子行程之環境變數(登入守門開啟且讀不到錯誤次數)斷言啟動前即被拒絕
import { fileURLToPath } from 'url'
import WHtml2png from '../../src/WHtml2png.mjs'
import { installFake } from './fakeChromium.mjs'


let env = installFake()
let exe = fileURLToPath(import.meta.url) //存在之非執行檔: 未經替身之啟動於建立行程即失敗, 不起任何程式
let r = await WHtml2png(100, 50, 1, '<div>x</div>', { mode: process.env.CHILD_MODE || 'single', executablePath: exe, retry: 1 })
    .then((b64) => ({ ok: true, len: b64.length }), (err) => ({ ok: false, errType: typeof err, err: err instanceof Error ? err.message : String(err) }))
r.nLaunch = env.launchOpts.length
await env.releaseAll()
await WHtml2png.close()
env.restore()
console.log('RESULT ' + JSON.stringify(r))
