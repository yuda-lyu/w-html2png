import './tools/fetchBlock.mjs'
import fs from 'fs'
import http from 'http'
import path from 'path'
import assert from 'assert'
import WHtml2png from '../src/WHtml2png.mjs'
import { setBinEnv } from './tools/binEnv.mjs'
import { makeTracer } from './tools/fakeChromium.mjs'


//規則R17: opt.timeout(單次出圖(每次嘗試)之允許時長), 以真chrome驗證頁面層逾時、不牽連並發呼叫、重試、非預期輸入與啟動中逾時之收尾
//同步一律以opt.onTrace事件, 不以延時偵測; 瀏覽器層卡死(暫停真chrome行程)與強制結束之機制見unit-timeoutFake(假瀏覽器, 主程序為真實空轉行程)與報告之實測證據
//(暫停真chrome行程須作業系統層之行程暫停, Node無跨平台API, 需外部程式; 不放入套件測試)
let fdTest = path.resolve('./test/_tmp/timeout')
let html = '<div style="width:100px;height:50px;background:blue">timeout</div>'
let port = 9042
let never = () => false


//run, 回傳{ ok, msg }, 不拋錯
let run = async (opt, tr) => {
    return WHtml2png(100, 50, 1, html, { fdHtml: fdTest, fdErr: fdTest, ...opt, onTrace: tr.onTrace })
        .then(
            (b64) => ({ ok: typeof b64 === 'string' && b64.length > 0, msg: '' }),
            (e) => ({ ok: false, msg: String(e) }),
        )
}


describe('unit-timeout', function() {

    this.timeout(180000)

    let restoreBin = null
    let server = null
    let ready = false

    before(async function() {
        if (process.platform !== 'win32') {
            this.skip() //套件自帶之免安裝chrome只支援Windows
        }
        fs.rmSync(fdTest, { recursive: true, force: true })
        fs.mkdirSync(fdTest, { recursive: true })
        restoreBin = await setBinEnv('timeoutMirror')

        //本機伺服器: /a為頁面, /ready為放行旗標(供「另一個進行中之呼叫」以事件放行, 不以延時)
        server = http.createServer((req, res) => {
            if (req.url === '/ready') {
                res.setHeader('Cache-Control', 'no-store')
                res.end(ready ? '1' : '0')
                return
            }
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end('<html><body><div style="width:100px;height:50px;background:green">a</div></body></html>')
        })
        await new Promise((resolve) => {
            server.listen(port, '127.0.0.1', resolve)
        })
    })

    after(async function() {
        await WHtml2png.close()
        if (server) {
            await new Promise((resolve) => {
                server.close(resolve)
                server.closeAllConnections()
            })
        }
        fs.rmSync(fdTest, { recursive: true, force: true })
        if (restoreBin) {
            restoreBin()
        }
    })

    beforeEach(function() {
        ready = false
    })

    //warm, 先以不限時之呼叫啟動常駐瀏覽器, 使其後帶timeout之案不把冷啟動計入時限(門檻本身以假時鐘驗於unit-timeoutFake)
    let warm = async () => {
        let r = await run({ mode: 'alive', retry: 1 }, makeTracer())
        assert.strict.equal(r.ok, true, r.msg)
    }


    //spec: issue60第2節第1項: { retry: 1, timeout, funPageWait: () => false }, alive與single皆逾時reject, 訊息開頭timeout[Nms] in funPageWait, 不等內部60秒
    for (let mode of ['alive', 'single']) {
        it(`${mode}: 頁內等待卡住, 於timeout逾時, 訊息指出卡在funPageWait(不是內部60秒之逾時)`, async function() {
            if (mode === 'alive') {
                await warm()
            }
            let tr = makeTracer()
            let r = await run({ mode, retry: 1, timeout: 8000, funPageWait: never }, tr)
            assert.strict.equal(r.ok, false)
            assert.strict.equal(r.msg, 'timeout[8000ms] in funPageWait')
            assert.strict.equal(tr.of('timeout')[0].step, 'funPageWait')
            assert.strict.equal(tr.of('page-close')[0].closed, true) //關得掉頁面: 頁面層問題
            assert.strict.equal(tr.of('browser-kill').length, 0)
            if (mode === 'alive') {
                assert.strict.equal(tr.of('browser-close').length, 0) //常駐瀏覽器不重啟
            }
            else {
                assert.strict.equal(tr.of('browser-close')[0].closed, true) //單次瀏覽器為本呼叫專屬, 正常關閉
            }
        })
    }

    //spec: issue60第2節第2項: 頁面層逾時時, 另一個進行中之呼叫仍成功(符合R12)
    it('alive: 頁面層逾時不牽連另一個進行中之呼叫(以事件放行, 不以延時)', async function() {
        await warm()
        let trA = makeTracer()
        //A: 載入本機頁面後, 頁內等待至/ready為1(同步XHR, 於networkidle之後才執行)
        // eslint-disable-next-line no-new-func
        let funPageWait = new Function(`var x = new XMLHttpRequest(); x.open('GET', 'http://127.0.0.1:${port}/ready', false); x.send(); return x.responseText === '1'`)
        let pmA = run({ mode: 'alive', retry: 1, funPageWait, funGetUrl: () => `http://127.0.0.1:${port}/a` }, trA)
        await trA.wait('step', (e) => e.step === 'funPageWait')
        let trB = makeTracer()
        let rB = await run({ mode: 'alive', retry: 1, timeout: 5000, funPageWait: never }, trB)
        assert.strict.equal(rB.msg, 'timeout[5000ms] in funPageWait')
        assert.strict.equal(trB.of('page-close')[0].closed, true)
        assert.strict.equal(trB.of('browser-close').length, 0)
        ready = true //B處置完畢後才放行A
        let rA = await pmA
        assert.strict.equal(rA.ok, true, rA.msg)
        assert.strict.equal(trA.of('retry').length, 0) //A未被牽連而重試
    })

    //spec: issue60第2節第3項: retry:2、timeout:1000, 每次嘗試各有此時長, 之間等待5秒(門檻本身以假時鐘驗於unit-timeoutFake)
    it('alive: 依retry重試, 每次嘗試各逾時一次', async function() {
        await warm()
        let tr = makeTracer()
        let r = await run({ mode: 'alive', retry: 2, timeout: 4000, funPageWait: never }, tr)
        assert.strict.equal(r.msg, 'timeout[4000ms] in funPageWait')
        assert.deepStrictEqual(tr.of('attempt').map((e) => e.attempt), [1, 2])
        assert.deepStrictEqual(tr.of('timeout').map((e) => e.attempt), [1, 2])
        assert.deepStrictEqual(tr.of('retry').map((e) => e.wait), [5000])
        let types = tr.events.map((e) => e.type).filter((v) => v === 'timeout' || v === 'retry' || v === 'attempt')
        assert.deepStrictEqual(types, ['attempt', 'timeout', 'retry', 'attempt', 'timeout']) //逾時 -> 重試 -> 再逾時
    })

    //spec: issue60第2節第4項(正常出圖部分): 非預期之輸入視為不限時, 正常出圖(輸入檢測之全格見unit-timeoutFake)
    it('alive: timeout為undefined、null、\'10s\'、0、-1、Infinity、{}皆視為不限時, 正常出圖', async function() {
        for (let timeout of [undefined, null, '10s', 0, -1, Infinity, {}]) {
            let tr = makeTracer()
            let r = await run({ mode: 'alive', retry: 1, timeout }, tr)
            assert.strict.equal(r.ok, true, `${String(timeout)}: ${r.msg}`)
            assert.strict.equal(tr.of('attempt')[0].timeout, null)
        }
    })

    it('alive與single: 允許時長內完成不受影響', async function() {
        for (let mode of ['alive', 'single']) {
            let tr = makeTracer()
            let r = await run({ mode, retry: 1, timeout: 60000 }, tr)
            assert.strict.equal(r.ok, true, `${mode}: ${r.msg}`)
            assert.strict.equal(tr.of('timeout').length, 0)
        }
    })

    it('single: 瀏覽器啟動中即逾時: 訊息指出卡在strategy.acquire, 其後啟動完成之瀏覽器被放棄並關閉(不留孤兒瀏覽器)', async function() {
        await WHtml2png.close()
        let tr = makeTracer()
        let r = await run({ mode: 'single', retry: 1, timeout: 1 }, tr)
        assert.strict.equal(r.msg, 'timeout[1ms] in strategy.acquire')
        //啟動完成即登記釋放函數並因已逾時而立即釋放(之後建立context因瀏覽器已關閉而失敗, 不再出圖)
        assert.strict.equal((await tr.wait('browser-close')).closed, true)
        assert.strict.equal(tr.of('browser-kill').length, 0)
        assert.strict.equal(tr.events.some((e) => e.type === 'step' && e.step === 'context.newPage()'), false)
    })

    it('alive: 瀏覽器啟動中即逾時: 下一次呼叫另啟新瀏覽器並成功', async function() {
        await WHtml2png.close() //無常駐瀏覽器, 本呼叫必須啟動
        let tr = makeTracer()
        let r = await run({ mode: 'alive', retry: 1, timeout: 1 }, tr)
        assert.strict.equal(r.msg, 'timeout[1ms] in strategy.acquire (browser will be closed after launch)')
        let r2 = await run({ mode: 'alive', retry: 1, timeout: 60000 }, makeTracer())
        assert.strict.equal(r2.ok, true, r2.msg)
    })

})
