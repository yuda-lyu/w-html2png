import './tools/fetchBlock.mjs'
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { mock } from 'node:test'
import WHtml2png from '../src/WHtml2png.mjs'
import { installFake, makeTracer } from './tools/fakeChromium.mjs'


//規則R17: opt.timeout(單次出圖(每次嘗試)之允許時長)與瀏覽器卡死之處置
//以假playwright瀏覽器精確控制「卡死」(不暫停真chrome), 計時門檻以假時鐘(node:test mock.timers)驗證, 其餘以opt.onTrace事件同步, 不以延時偵測;
//瀏覽器主程序pid指向測試自行啟動之真實空轉行程, 使強制結束(樹狀結束pid)可被真實驗證(以該行程之exit事件為準, 且絕不指向任何他人行程)
let fdTest = path.resolve('./test/_tmp/timeoutFake')
let html = '<div>x</div>'
let exe = process.execPath //executablePath只需為存在之檔案(w-playwright所呼叫之BrowserType已以setBrowserTypeForTest取代, 不會執行)
let call = (opt) => WHtml2png(100, 50, 1, html, { mode: 'alive', executablePath: exe, fdHtml: fdTest, fdErr: fdTest, ...opt })
let settle = (pm) => pm.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: String(e) }))
let flush = async () => { //讓所有microtask與已排入之I/O回呼跑完(setImmediate不被假時鐘取代, 多輪使其不受單輪事件迴圈順序影響)
    for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setImmediate(resolve))
    }
}
let tick = async (ms) => {
    mock.timers.tick(ms)
    await flush()
}
let mkFn = (fake) => {
    let f = () => false
    f.fake = fake //假頁面依此決定頁內等待行為: hang卡住, gate待測試放行, 其餘立即完成
    return f
}
let isAlive = (child) => child.exitCode === null && child.signalCode === null
let realSetTimeout = globalThis.setTimeout
//guardOn, w-playwright之執行期登入守門是否開啟(其README: 未設、''、'0'、'false'為關): 開啟時啟動前置含子行程讀取錯誤次數, 假時鐘推進之逾時必先於替身被呼叫
let guardOn = !['', '0', 'false'].includes(String(process.env.W_PLAYWRIGHT_LOGON_GUARD ?? ''))


describe('unit-timeoutFake', function() {

    this.timeout(60000)

    let env = null
    let unhandled = []
    let onUnhandled = (err) => {
        unhandled.push(String(err))
    }

    //假時鐘於整個檔案只啟用一次(各案相對推進, 不逐案reset/enable): Node的reset()清空佇列時不重設各計時器之佇列位置,
    //前一案被放棄之嘗試其後才執行的clearTimeout(舊計時器)會依殘留位置移除新佇列中他人之計時器, 造成偶發懸置
    before(function() {
        process.on('unhandledRejection', onUnhandled)
        mock.timers.enable({ apis: ['setTimeout'] })
    })

    after(function() {
        mock.timers.reset()
        process.off('unhandledRejection', onUnhandled)
        fs.rmSync(fdTest, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.resolve('./test/_tmp')) //尚有其他測試之暫存時非空, 略過
        }
        catch (err) {}
    })

    beforeEach(function() {
        fs.rmSync(fdTest, { recursive: true, force: true })
        fs.mkdirSync(fdTest, { recursive: true })
        unhandled = []
        env = installFake()
    })

    afterEach(async function() {
        await env.releaseAll()
        await WHtml2png.close()
        env.restore()
        await flush()
        assert.strict.deepEqual(unhandled, [], 'unhandled rejection')
    })


    describe('opt.timeout輸入檢測: 有效正數取值, 非預期之輸入視為未給(不限時, 不取pid)', function() {

        //spec: issue60第2節第4項; dspec〈輸入參數之檢測機制〉K3(opt非預期之輸入視為未給改用預設, 超出範圍亦同)、N2範圍子型(計時毫秒為正數, 上限2147483647)
        let valid = [
            [2000, 2000],
            ['2000', 2000],
            [' 2000 ', 2000],
            ['1e3', 1000],
            [1.5, 2], //計時器以整數毫秒為粒度(Node截斷小數), 向上取整使不早於所給時長
            [0.4, 1],
            [2147483647, 2147483647],
        ]
        let invalid = [
            ['undefined', undefined], ['null', null], ['10s', '10s'], ['0', 0], ['-1', -1], ['Infinity', Infinity], ['-Infinity', -Infinity], ['NaN', NaN],
            ['{}', {}], ['[]', []], ['[5]', [5]], ['true', true], ['false', false], ['empty string', ''], ['blank string', '  '], ['0x10', '0x10'],
            ['"Infinity"', 'Infinity'], ['"-5"', '-5'], ['"0"', '0'], ['2147483648', 2147483648], ['1e21', 1e21], ['BigInt', BigInt(100)],
            // eslint-disable-next-line no-new-wrappers
            ['Symbol', Symbol('t')], ['Number object', new Number(5)], ['function', () => 5],
        ]

        for (let [v, n] of valid) {
            it(`valid ${typeof v} ${String(v).trim()} -> ${n}ms`, async function() {
                let tr = makeTracer()
                let r = await settle(call({ mode: 'single', timeout: v, onTrace: tr.onTrace }))
                assert.strict.equal(r.ok, true, r.e)
                assert.strict.equal(tr.of('attempt')[0].timeout, n)
                assert.strict.equal(env.launches[0].calls.cdp, 1) //給了有效timeout才取pid
            })
        }

        for (let [name, v] of invalid) {
            it(`invalid ${name} -> unlimited`, async function() {
                let tr = makeTracer()
                let r = await settle(call({ mode: 'single', timeout: v, onTrace: tr.onTrace }))
                assert.strict.equal(r.ok, true, r.e)
                assert.strict.equal(tr.of('attempt')[0].timeout, null)
                assert.strict.equal(env.launches[0].calls.cdp, 0) //視為未給: 流程與未支援前相同, 不多一次CDP查詢
                assert.strict.equal(tr.of('timeout').length, 0)
            })
        }

    })


    describe('opt.timeout讀取拋錯視為未給(修前不讀此鍵, 修後不得因此失敗)', function() {

        it('opt.timeout為拋錯之getter: 視為未給, 正常出圖', async function() {
            let tr = makeTracer()
            let opt = { mode: 'single', executablePath: exe, fdHtml: fdTest, fdErr: fdTest, onTrace: tr.onTrace }
            Object.defineProperty(opt, 'timeout', {
                enumerable: true,
                get: () => {
                    throw new Error('getter boom')
                },
            })
            let r = await settle(WHtml2png(100, 50, 1, html, opt))
            assert.strict.equal(r.ok, true, r.e)
            assert.strict.equal(tr.of('attempt')[0].timeout, null)
            assert.strict.equal(env.launches[0].calls.cdp, 0)
        })

    })


    describe('逾時門檻與重試(假時鐘)', function() {

        it('逾時發生於timeout整點: 未到不逾時, 到了逾時; 訊息含卡住之步驟(issue60第2節第1項)', async function() {
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 2000, funPageWait: mkFn('hang'), onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'funPageWait')
            await tick(1999)
            assert.strict.equal(tr.of('timeout').length, 0)
            await tick(1)
            let ev = await tr.wait('timeout')
            assert.strict.equal(ev.step, 'funPageWait')
            assert.strict.equal(ev.timeout, 2000)
            let r = await pm
            assert.strict.equal(r.ok, false)
            assert.strict.equal(r.e, 'timeout[2000ms] in funPageWait')
        })

        it('時限內完成不受影響, 之後不再逾時(計時器已清除)', async function() {
            let tr = makeTracer()
            let r = await settle(call({ retry: 1, timeout: 2000, onTrace: tr.onTrace }))
            assert.strict.equal(r.ok, true, r.e)
            await tick(10000)
            assert.strict.equal(tr.of('timeout').length, 0)
        })

        it('retry:2: 每次嘗試各有timeout, 兩次之間等待5秒(issue60第2節第3項)', async function() {
            let tr = makeTracer()
            let pm = settle(call({ retry: 2, timeout: 1000, funPageWait: mkFn('hang'), onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.attempt === 1 && e.step === 'funPageWait')
            await tick(1000)
            await tr.waitCount('timeout', 1)
            let ev = await tr.wait('retry')
            assert.strict.equal(ev.attempt, 1)
            assert.strict.equal(ev.wait, 5000)
            await tick(4999)
            assert.strict.equal(tr.of('attempt').length, 1) //等待未滿5秒不重試
            await tick(1)
            await tr.waitCount('attempt', 2)
            await tr.wait('step', (e) => e.attempt === 2 && e.step === 'funPageWait') //第二次嘗試亦卡在頁內等待
            await tick(999)
            assert.strict.equal(tr.of('timeout').length, 1)
            await tick(1)
            await tr.waitCount('timeout', 2)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1000ms] in funPageWait')
            assert.deepStrictEqual(tr.of('attempt').map((e) => e.attempt), [1, 2])
            assert.deepStrictEqual(tr.of('timeout').map((e) => e.attempt), [1, 2])
        })

    })


    describe('頁面層逾時: 關得掉頁面代表瀏覽器仍可回應, 不重啟, 不牽連並發呼叫(R12)', function() {

        it('alive: 關閉頁面成功, 不關閉瀏覽器, 下一次呼叫仍用同一個瀏覽器', async function() {
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 2000, funPageWait: mkFn('hang'), onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'funPageWait')
            await tick(2000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[2000ms] in funPageWait') //頁面層無瀏覽器處置之註記
            assert.strict.equal(tr.of('page-close')[0].closed, true)
            assert.strict.equal(tr.of('browser-close').length, 0)
            assert.strict.equal(env.launches[0].calls.close, 0)
            let r2 = await settle(call({ retry: 1, timeout: 2000 }))
            assert.strict.equal(r2.ok, true, r2.e)
            assert.strict.equal(env.launches.length, 1)
        })

        it('alive: 頁面層逾時時另一個進行中之呼叫不受影響且仍成功(issue60第2節第2項)', async function() {
            let trB = makeTracer()
            let pmB = settle(call({ retry: 1, funPageWait: mkFn('gate'), onTrace: trB.onTrace })) //B未給timeout, 進行中(頁內等待)
            await trB.wait('step', (e) => e.step === 'funPageWait')
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 1500, funPageWait: mkFn('hang'), onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'funPageWait')
            await tick(1500)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1500ms] in funPageWait')
            assert.strict.equal(env.launches.length, 1)
            assert.strict.equal(env.launches[0].calls.close, 0)
            env.launches[0].pages[0].gateWait.resolve() //放行B
            let rB = await pmB
            assert.strict.equal(rB.ok, true, rB.e)
            assert.strict.equal(trB.of('retry').length, 0) //B一次成功, 未被牽連重試
        })

        it('single: 頁面層逾時: 關得掉頁面, 瀏覽器為本呼叫專屬而照常正常釋放(不強制結束)', async function() {
            let tr = makeTracer()
            let pm = settle(call({ mode: 'single', retry: 1, timeout: 2000, funPageWait: mkFn('hang'), onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'funPageWait')
            await tick(2000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[2000ms] in funPageWait')
            assert.strict.equal(tr.of('page-close')[0].closed, true)
            assert.strict.equal(tr.of('browser-close')[0].closed, true)
            assert.strict.equal(tr.of('browser-kill').length, 0)
            assert.strict.equal(env.launches[0].calls.close, 1) //逾時處置與exec收尾共用同一次關閉
        })

        it('alive: 逾時後被放棄之嘗試於其頁內等待結束後自行收尾, 錯誤檔為逾時訊息(writeError)', async function() {
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 2000, funPageWait: mkFn('hang'), writeError: true, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'funPageWait')
            await tick(2000)
            await pm
            await flush() //被放棄之exec因頁面關閉而返回並收尾(僅microtask)
            let fns = fs.readdirSync(fdTest).filter((v) => /^err_.*_all\.json$/.test(v))
            assert.strict.equal(fns.length, 1)
            assert.strict.equal(fs.readFileSync(path.join(fdTest, fns[0]), 'utf8'), 'timeout[2000ms] in funPageWait\n')
        })

    })


    describe('瀏覽器層逾時: 限時關閉, 主程序卡死時確認歸屬後樹狀強制結束, 下一次呼叫不再用卡住之瀏覽器', function() {

        it('alive: context.newPage()卡住且瀏覽器關不掉: 限時10秒後強制結束該pid(issue60第2節第5項之等價)', async function() {
            env.cfg.newPage = 'hang'
            env.cfg.close = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 3000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'context.newPage()')
            let b = env.launches[0]
            await tick(3000)
            await tr.wait('timeout')
            await tr.wait('browser-close-start') //限時關閉之計時器已建立
            assert.strict.equal(tr.of('browser-close').length, 0) //限時未到
            await tick(9999)
            assert.strict.equal(tr.of('browser-close').length, 0)
            await tick(1)
            assert.strict.equal((await tr.wait('browser-close')).closed, false)
            let k = await tr.wait('browser-kill')
            assert.strict.equal(k.result, 'killed')
            assert.strict.equal(k.pid, b.pid)
            await b.child.exited //該行程確實已結束
            let r = await pm
            assert.strict.equal(r.e, 'timeout[3000ms] in context.newPage() (browser force-killed)')
            assert.strict.equal(b.calls.close, 1)

            //下一次呼叫: 不再用到卡住之瀏覽器, 另啟新瀏覽器
            env.cfg.newPage = 'ok'
            env.cfg.close = 'ok'
            let r2 = await settle(call({ retry: 1, timeout: 3000 }))
            assert.strict.equal(r2.ok, true, r2.e)
            assert.strict.equal(env.launches.length, 2)
            assert.strict.equal(b.calls.newPage, 1)
        })

        it('alive: 頁面關不掉(頁面層無法確認瀏覽器可回應)視為瀏覽器層, 關閉瀏覽器, 關不掉則強制結束', async function() {
            env.cfg.pageWait = 'hang'
            env.cfg.pageClose = 'hang'
            env.cfg.close = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 2000, onTrace: tr.onTrace, funPageWait: () => false }))
            await tr.wait('step', (e) => e.step === 'funPageWait')
            let b = env.launches[0]
            await tick(2000)
            await tr.wait('timeout')
            await tr.wait('page-close-start') //限時關頁之計時器已建立
            await tick(4999)
            assert.strict.equal(tr.of('page-close').length, 0)
            await tick(1)
            assert.strict.equal((await tr.wait('page-close')).closed, false)
            await tr.wait('browser-close-start') //限時關閉瀏覽器之計時器已建立
            await tick(10000)
            assert.strict.equal((await tr.wait('browser-kill')).result, 'killed')
            await b.child.exited
            let r = await pm
            assert.strict.equal(r.e, 'timeout[2000ms] in funPageWait (browser force-killed)')
        })

        it('alive: 瀏覽器可正常關閉時只關閉不強制結束, 訊息註記瀏覽器已重啟', async function() {
            env.cfg.newPage = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 1000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'context.newPage()')
            let b = env.launches[0]
            await tick(1000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1000ms] in context.newPage() (browser closed)')
            assert.strict.equal(tr.of('browser-close')[0].closed, true)
            assert.strict.equal(tr.of('browser-kill').length, 0)
            assert.strict.equal(isAlive(b.child), true) //空轉行程由假瀏覽器之close不處理, 證明未被誤殺
        })

        it('alive: 未取得pid(CDP無回應)時不殺, 並於訊息寫明', async function() {
            env.cfg.cdp = 'hang'
            env.cfg.newPage = 'hang'
            env.cfg.close = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 20000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'strategy.acquire')
            await env.waitLaunch(1, pm) //經w-playwright之前置後才呼叫替身
            await flush()
            await tick(5000) //pid查詢限時5秒
            await tr.wait('step', (e) => e.step === 'context.newPage()')
            let b = env.launches[0]
            await tick(15000)
            await tr.wait('timeout')
            await tr.wait('browser-close-start')
            await tick(10000)
            let k = await tr.wait('browser-kill')
            assert.strict.equal(k.result, 'no-pid')
            assert.strict.equal(k.pid, null)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[20000ms] in context.newPage() (browser not killed, pid unknown)')
            assert.strict.equal(isAlive(b.child), true) //無法確認歸屬, 不殺
        })

        it('alive: 瀏覽器已斷線時(行程已結束, pid可能已被他人重用)不殺該pid', async function() {
            env.cfg.newPage = 'hang'
            env.cfg.close = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 3000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'context.newPage()')
            let b = env.launches[0]
            b.connected = false //瀏覽器行程已不在本實例掌握; 其pid現為測試之空轉行程, 模擬「pid被他人行程重用」
            await tick(3000)
            await tr.wait('timeout')
            await tr.wait('browser-close-start')
            await tick(10000)
            let k = await tr.wait('browser-kill')
            assert.strict.equal(k.result, 'gone')
            let r = await pm
            assert.strict.equal(r.e, 'timeout[3000ms] in context.newPage() (browser disconnected)')
            assert.strict.equal(isAlive(b.child), true) //不得殺
        })

        it('alive: 瀏覽器啟動中即逾時: 不等待啟動, 啟動完成後於背景關閉; 下一次呼叫另啟新瀏覽器', async function() {
            env.cfg.launch = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 1000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'strategy.acquire')
            await env.waitLaunch(1, pm) //啟動已發起(替身卡住中)
            await tick(1000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1000ms] in strategy.acquire (browser will be closed after launch)')
            let b = env.launches[0]
            assert.strict.equal(b.calls.close, 0)
            env.launchGate.resolve() //啟動完成
            await b.onClose.pm //被要求關閉
            assert.strict.equal(b.calls.close, 1)
            env.cfg.launch = 'ok'
            let r2 = await settle(call({ retry: 1, timeout: 3000 }))
            assert.strict.equal(r2.ok, true, r2.e)
            assert.strict.equal(env.launches.length, 2)
        })

        it('alive: 逾時後開頁才返回: 被放棄之嘗試不再出圖, 關閉該頁面(cancelled)', async function() {
            env.cfg.newPage = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 1000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'context.newPage()')
            let b = env.launches[0]
            await tick(1000)
            await pm
            b.gates.newPage.resolve() //開頁晚到
            let ev = await tr.wait('cancelled')
            assert.strict.equal(ev.step, 'context.newPage()')
            assert.strict.equal(b.calls.setContent, 0)
            assert.strict.equal(b.pages[0].closed, true)
        })

        it('alive: 瀏覽器層逾時牽連使用同一瀏覽器之並發呼叫, 其由自己的retry接住', async function() {
            let fnB = mkFn('hang')
            let trB = makeTracer()
            let pmB = settle(call({ retry: 2, funPageWait: fnB, onTrace: trB.onTrace })) //B未給timeout
            await trB.wait('step', (e) => e.step === 'funPageWait')
            let b = env.launches[0]
            b.cfg.newPage = 'hang' //之後在此瀏覽器開頁卡住
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 1000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'context.newPage()')
            await tick(1000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1000ms] in context.newPage() (browser closed)')
            await trB.wait('retry') //B因瀏覽器被關閉而失敗, 準備重試
            fnB.fake = 'ok'
            await tick(5000)
            let rB = await pmB
            assert.strict.equal(rB.ok, true, rB.e)
            assert.strict.equal(env.launches.length, 2) //B重試時另啟新瀏覽器
        })

        it('single: context.newPage()卡住且瀏覽器關不掉: 同樣限時後強制結束', async function() {
            env.cfg.newPage = 'hang'
            env.cfg.close = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ mode: 'single', retry: 1, timeout: 2000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'context.newPage()')
            let b = env.launches[0]
            await tick(2000)
            await tr.wait('timeout')
            await tr.wait('browser-close-start')
            await tick(10000)
            assert.strict.equal((await tr.wait('browser-kill')).result, 'killed')
            await b.child.exited
            let r = await pm
            assert.strict.equal(r.e, 'timeout[2000ms] in context.newPage() (browser force-killed)')
        })

        it('single: 瀏覽器啟動中即逾時: 其後啟動完成之瀏覽器立即釋放, 不開頁', async function() {
            env.cfg.launch = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ mode: 'single', retry: 1, timeout: 1000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'strategy.acquire')
            await env.waitLaunch(1, pm) //啟動已發起(替身卡住中)
            await tick(1000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1000ms] in strategy.acquire')
            let b = env.launches[0]
            env.launchGate.resolve() //啟動完成: 登記釋放函數時已逾時, 立即釋放
            assert.strict.equal((await tr.wait('browser-close')).closed, true)
            //假瀏覽器於關閉後仍可建context, 故取得後走到取消檢查(真Chrome則因瀏覽器已關閉而建context失敗)
            assert.strict.equal((await tr.wait('cancelled')).step, 'strategy.acquire')
            assert.strict.equal(b.calls.newPage, 0) //不開頁
            assert.strict.equal(b.calls.close, 1)
        })

        //spec(R17之5、R19): 啟動經w-playwright, 其前置(環境、版本檢查、登入守門讀取錯誤次數)期間替身尚未被呼叫; 逾時或close()落在此期間, 處置同「啟動中」: 不等待, 啟動完成後關閉, 不開頁
        let tracerAt = (tr, at) => (e) => {
            if (e.type === 'timeout') {
                at.n = env.launches.length //逾時當下替身被呼叫之次數
            }
            tr.onTrace(e)
        }

        it('alive: 逾時落在w-playwright之啟動前置: 不等待, 其後啟動完成即於背景關閉, 不開頁; 下一次呼叫另啟新瀏覽器', async function() {
            env.cfg.launch = 'hang'
            let tr = makeTracer()
            let at = { n: null }
            let pm = settle(call({ retry: 1, timeout: 1000, onTrace: tracerAt(tr, at) }))
            await tr.wait('step', (e) => e.step === 'strategy.acquire')
            await tick(1000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1000ms] in strategy.acquire (browser will be closed after launch)')
            if (guardOn) {
                assert.strict.equal(at.n, 0) //登入守門開啟時, 逾時確實落在替身被呼叫之前
            }
            let b = await env.waitLaunch(1)
            env.launchGate.resolve() //啟動完成
            await b.onClose.pm //被要求關閉
            assert.strict.equal(b.calls.close, 1)
            assert.strict.equal(b.calls.newPage, 0)
            env.cfg.launch = 'ok'
            let r2 = await settle(call({ retry: 1, timeout: 3000 }))
            assert.strict.equal(r2.ok, true, r2.e)
            assert.strict.equal(env.launches.length, 2)
        })

        it('single: 逾時落在w-playwright之啟動前置: 其後啟動完成之瀏覽器立即釋放, 不開頁', async function() {
            env.cfg.launch = 'hang'
            let tr = makeTracer()
            let at = { n: null }
            let pm = settle(call({ mode: 'single', retry: 1, timeout: 1000, onTrace: tracerAt(tr, at) }))
            await tr.wait('step', (e) => e.step === 'strategy.acquire')
            await tick(1000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1000ms] in strategy.acquire')
            if (guardOn) {
                assert.strict.equal(at.n, 0)
            }
            let b = await env.waitLaunch(1)
            env.launchGate.resolve() //啟動完成: 登記釋放函數時已逾時, 立即釋放
            assert.strict.equal((await tr.wait('browser-close')).closed, true)
            assert.strict.equal((await tr.wait('cancelled')).step, 'strategy.acquire')
            assert.strict.equal(b.calls.newPage, 0)
            assert.strict.equal(b.calls.close, 1)
        })

        it('alive(未給timeout): WHtml2png.close()落在w-playwright之啟動前置: 啟動完成後關閉, 該呼叫不開頁、不重試', async function() {
            env.cfg.launch = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ retry: 3, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'strategy.acquire')
            let launchesAtClose = env.launches.length
            let pmClose = WHtml2png.close()
            if (guardOn) {
                assert.strict.equal(launchesAtClose, 0) //close()確實落在替身被呼叫之前
            }
            let b = await env.waitLaunch(1)
            env.launchGate.resolve()
            await pmClose
            assert.strict.equal(b.calls.close, 1)
            let r = await pm
            assert.strict.equal(r.ok, false)
            assert.strict.equal(r.e.includes('resident browser has been closed'), true, r.e)
            assert.strict.equal(b.calls.newPage, 0)
            assert.strict.equal(tr.of('retry').length, 0) //close()前開始之呼叫不再重試(R12)
            assert.strict.equal(env.launches.length, 1)
        })

    })


    describe('外審補強(terra, 2026-11-03): 釋放函數提早登記、pid延遲取值、共用關閉、關閉拋錯、取消檢查、pid查詢重試', function() {

        it('single: 瀏覽器已啟動但建立context卡住而逾時: 仍關閉該瀏覽器, 關不掉則強制結束(不洩漏)', async function() {
            env.cfg.newContext = 'hang'
            env.cfg.close = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ mode: 'single', retry: 1, timeout: 2000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'strategy.acquire')
            await env.waitLaunch(1, pm) //經w-playwright之前置後才呼叫替身
            await flush()
            let b = env.launches[0]
            assert.strict.equal(b.calls.newContext, 1)
            await tick(2000)
            await tr.wait('timeout')
            await tr.wait('browser-close-start')
            await tick(10000)
            assert.strict.equal((await tr.wait('browser-kill')).result, 'killed')
            await b.child.exited
            let r = await pm
            assert.strict.equal(r.e, 'timeout[2000ms] in strategy.acquire (browser force-killed)')
        })

        it('browser.close()拋錯而仍連線: 不算已關閉, 不等10秒立即走確認後強制結束', async function() {
            env.cfg.newPage = 'hang'
            env.cfg.close = 'reject'
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 3000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'context.newPage()')
            let b = env.launches[0]
            await tick(3000)
            let k = await tr.wait('browser-kill') //不tick 10000
            assert.strict.equal(k.result, 'killed')
            assert.strict.equal((await tr.wait('browser-close')).closed, false)
            await b.child.exited
            let r = await pm
            assert.strict.equal(r.e, 'timeout[3000ms] in context.newPage() (browser force-killed)')
        })

        it('pid於關閉等待期間才取得: 結束當下才取值, 仍可確認歸屬後結束', async function() {
            env.cfg.cdp = 'gate'
            env.cfg.close = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 1000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'strategy.acquire')
            await env.waitLaunch(1, pm) //經w-playwright之前置後才呼叫替身
            await flush()
            let b = env.launches[0]
            await tick(1000) //取pid(CDP)尚未回應即逾時
            await tr.wait('timeout')
            await tr.wait('browser-close-start')
            b.gates.cdp.resolve() //關閉等待期間pid才查得
            await flush()
            await tick(10000)
            let k = await tr.wait('browser-kill')
            assert.strict.equal(k.result, 'killed')
            assert.strict.equal(k.pid, b.pid)
            await b.child.exited
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1000ms] in strategy.acquire (browser force-killed)')
        })

        it('alive: 瀏覽器啟動中即逾時, 其後啟動完成才取pid並關閉; 關不掉則強制結束', async function() {
            env.cfg.launch = 'hang'
            env.cfg.close = 'hang'
            let pm = settle(call({ retry: 1, timeout: 1000 }))
            await env.waitLaunch(1, pm) //啟動已發起(替身卡住中)
            await flush()
            await tick(1000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1000ms] in strategy.acquire (browser will be closed after launch)')
            let b = env.launches[0]
            env.launchGate.resolve() //啟動完成: 背景先取pid再關閉
            await b.onClose.pm
            await flush()
            await tick(10000)
            await b.child.exited //強制結束之pid來自啟動完成後才取得者
            assert.strict.equal(b.calls.close, 1)
        })

        it('同一世代同時兩個瀏覽器層逾時: 共用同一次關閉, 只結束一次', async function() {
            env.cfg.newPage = 'hang'
            env.cfg.close = 'hang'
            let trA = makeTracer()
            let trB = makeTracer()
            let pmA = settle(call({ retry: 1, timeout: 3000, onTrace: trA.onTrace }))
            let pmB = settle(call({ retry: 1, timeout: 3000, onTrace: trB.onTrace }))
            let mark = 'start'
            let dbg = realSetTimeout(() => {
                console.log('DBG', mark, JSON.stringify({ A: trA.events, B: trB.events, calls: env.launches.map((x) => x.calls), launches: env.launches.length }))
            }, 8000)
            await trA.wait('step', (e) => e.step === 'context.newPage()')
            mark = 'A-step'
            await trB.wait('step', (e) => e.step === 'context.newPage()')
            mark = 'B-step'
            let b = env.launches[0]
            await tick(3000)
            mark = 'ticked3000'
            await trA.wait('timeout')
            mark = 'A-timeout'
            await trB.wait('timeout')
            mark = 'B-timeout'
            await Promise.race([trA.wait('browser-close-start'), trB.wait('browser-close-start')]) //共用之限時關閉(由先處置者建立)之計時器已建立
            mark = 'close-start'
            await tick(10000)
            mark = 'ticked10000'
            await b.child.exited
            mark = 'exited'
            globalThis.clearTimeout(dbg)
            let rA = await pmA
            let rB = await pmB
            assert.strict.equal(rA.e, 'timeout[3000ms] in context.newPage() (browser force-killed)')
            assert.strict.equal(rB.e, 'timeout[3000ms] in context.newPage() (browser force-killed)')
            assert.strict.equal(b.calls.close, 1)
            assert.strict.equal(trA.of('browser-kill').length + trB.of('browser-kill').length, 1)
        })

        it('取pid失敗不永久快取: 下一個給timeout之呼叫再試(每世代最多2次)', async function() {
            env.cfg.cdp = 'fail1'
            let r1 = await settle(call({ retry: 1, timeout: 5000 }))
            assert.strict.equal(r1.ok, true, r1.e)
            let b = env.launches[0]
            assert.strict.equal(b.calls.cdp, 1) //第一次失敗
            let r2 = await settle(call({ retry: 1, timeout: 5000 }))
            assert.strict.equal(r2.ok, true, r2.e)
            assert.strict.equal(b.calls.cdp, 2) //再試成功
            let r3 = await settle(call({ retry: 1, timeout: 5000 }))
            assert.strict.equal(r3.ok, true, r3.e)
            assert.strict.equal(b.calls.cdp, 2) //已取得, 共用
        })

        it('被放棄之嘗試於頁內等待晚返回後不再截圖(取消檢查)', async function() {
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 1000, funPageWait: mkFn('gate'), onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'funPageWait')
            await tick(1000)
            await pm
            let b = env.launches[0]
            b.pages[0].gateWait.resolve() //頁內等待晚返回
            await flush()
            assert.strict.equal(b.calls.screenshot, 0)
            assert.strict.equal(tr.events.some((e) => e.type === 'step' && e.step === 'page.screenshot()'), false)
            assert.strict.equal(tr.of('cancelled')[0].step, 'funPageWait') //放棄之嘗試於頁面步驟返回後通知
        })

        it('single: 逾時時瀏覽器尚在啟動, 其後啟動完成才卡在建立context: 啟動完成即釋放, 關不掉則強制結束(不洩漏)', async function() {
            env.cfg.launch = 'hang'
            env.cfg.newContext = 'hang'
            env.cfg.close = 'hang'
            let tr = makeTracer()
            let pm = settle(call({ mode: 'single', retry: 1, timeout: 1000, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'strategy.acquire')
            await env.waitLaunch(1, pm) //啟動已發起(替身卡住中)
            await tick(1000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1000ms] in strategy.acquire') //逾時當下尚無瀏覽器可釋放
            let b = env.launches[0]
            assert.strict.equal(b.calls.close, 0)
            env.launchGate.resolve() //啟動完成: 登記釋放函數時已逾時, 立即釋放
            await b.onClose.pm
            await flush()
            await tick(10000)
            assert.strict.equal((await tr.wait('browser-kill')).result, 'killed')
            await b.child.exited
        })

        it('小數毫秒向上取整: timeout 1.5 於 1ms 不逾時, 2ms 逾時', async function() {
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 1.5, funPageWait: mkFn('hang'), onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'funPageWait')
            await tick(1)
            assert.strict.equal(tr.of('timeout').length, 0)
            await tick(1)
            assert.strict.equal((await tr.wait('timeout')).timeout, 2)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[2ms] in funPageWait')
        })

    })


    describe('尚未取用瀏覽器之逾時(funGetUrl卡住): 不動瀏覽器, 不牽連並發呼叫, 刪除暫存html', function() {

        it('alive: funGetUrl卡住逾時, 另一進行中之呼叫之瀏覽器不被關閉', async function() {
            let trB = makeTracer()
            let pmB = settle(call({ retry: 1, funPageWait: mkFn('gate'), onTrace: trB.onTrace }))
            await trB.wait('step', (e) => e.step === 'funPageWait')
            let tr = makeTracer()
            let pm = settle(call({ retry: 1, timeout: 1000, funGetUrl: () => new Promise(() => {}), onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'funGetUrl')
            await tick(1000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[1000ms] in funGetUrl')
            assert.strict.equal(env.launches.length, 1) //只有B之瀏覽器
            assert.strict.equal(env.launches[0].calls.close, 0)
            assert.strict.equal(tr.of('browser-close').length, 0)
            assert.strict.equal(fs.readdirSync(fdTest).filter((v) => /^whweb_.*\.html$/.test(v)).length, 0) //暫存html已刪
            env.launches[0].pages[0].gateWait.resolve()
            let rB = await pmB
            assert.strict.equal(rB.ok, true, rB.e)
        })

    })


    describe('WHtml2png.close()與閒置關閉: 只對曾給timeout之瀏覽器限時, 未給者維持原行為', function() {

        it('曾給timeout之瀏覽器: close()限時, 關不掉則強制結束', async function() {
            let r = await settle(call({ retry: 1, timeout: 5000 }))
            assert.strict.equal(r.ok, true, r.e)
            let b = env.launches[0]
            b.cfg.close = 'hang'
            let done = false
            let pmClose = WHtml2png.close().then(() => {
                done = true
            })
            await flush()
            await tick(9999)
            assert.strict.equal(done, false)
            await tick(1)
            await pmClose
            await b.child.exited
            assert.strict.equal(b.calls.close, 1)
        })

        it('未給timeout之瀏覽器: close()不限時, 不取pid, 不強制結束(與未支援前相同)', async function() {
            let r = await settle(call({ retry: 1 }))
            assert.strict.equal(r.ok, true, r.e)
            let b = env.launches[0]
            assert.strict.equal(b.calls.cdp, 0)
            b.cfg.close = 'hang'
            let done = false
            let pmClose = WHtml2png.close().then(() => {
                done = true
            })
            await flush()
            await tick(3 * 60 * 60 * 1000) //遠超任何限時
            assert.strict.equal(done, false)
            assert.strict.equal(isAlive(b.child), true)
            assert.strict.equal(b.calls.close, 1) //直接browser.close()一次
            assert.strict.equal(b.calls.cdp, 0)
            b.gates.close.resolve()
            await pmClose
            assert.strict.equal(done, true)
        })

        it('給與未給timeout之呼叫共用同一瀏覽器: 之後才給timeout者使該瀏覽器受限(取pid一次/瀏覽器)', async function() {
            let r1 = await settle(call({ retry: 1 }))
            assert.strict.equal(r1.ok, true, r1.e)
            let b = env.launches[0]
            assert.strict.equal(b.calls.cdp, 0)
            let r2 = await settle(call({ retry: 1, timeout: 5000 }))
            let r3 = await settle(call({ retry: 1, timeout: 5000 }))
            assert.strict.equal(r2.ok && r3.ok, true)
            assert.strict.equal(env.launches.length, 1)
            assert.strict.equal(b.calls.cdp, 1)
        })

    })


    describe('opt.onTrace: 事件格式與未傳回調時行為不變(五種回調案)', function() {

        let cases = [
            ['undefined', undefined],
            ['null', null],
            ['not a function', 'x'],
            ['throws', () => {
                throw new Error('boom')
            }],
            ['returns rejected promise', () => Promise.reject(new Error('rej'))],
        ]

        for (let [name, cb] of cases) {
            it(`${name}: 成功與逾時之結果與未給回調相同`, async function() {
                let ok = await settle(call({ mode: 'single', retry: 1, timeout: 5000, onTrace: cb }))
                assert.strict.equal(ok.ok, true, ok.e)
                let pm = settle(call({ mode: 'single', retry: 1, timeout: 2000, funPageWait: mkFn('hang'), onTrace: cb }))
                await env.waitLaunch(2, pm) //single之第二次呼叫之瀏覽器(經w-playwright之前置後才呼叫替身)
                await flush()
                await tick(2000)
                let r = await pm
                assert.strict.equal(r.e, 'timeout[2000ms] in funPageWait')
            })
        }

        it('事件為凍結物件, 欄位僅含原始值, type為固定字串', async function() {
            let tr = makeTracer()
            let pm = settle(call({ mode: 'single', retry: 1, timeout: 2000, funPageWait: mkFn('hang'), onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'funPageWait')
            await tick(2000)
            await pm
            let types = new Set(['attempt', 'step', 'page-settled', 'timeout', 'page-close-start', 'page-close', 'browser-close-start', 'browser-close', 'browser-kill', 'cancelled', 'retry'])
            assert.ok(tr.events.length > 5)
            for (let e of tr.events) {
                assert.strict.equal(Object.isFrozen(e), true)
                assert.strict.equal(types.has(e.type), true, e.type)
                for (let v of Object.values(e)) {
                    assert.ok(v === null || ['string', 'number', 'boolean'].includes(typeof v), `${e.type}: ${typeof v}`)
                }
            }
        })

        it('未給timeout時流程與事件: 不取pid, 無逾時處置事件, attempt之timeout為null', async function() {
            let tr = makeTracer()
            let r = await settle(call({ retry: 1, onTrace: tr.onTrace }))
            assert.strict.equal(r.ok, true, r.e)
            assert.strict.equal(env.launches[0].calls.cdp, 0)
            assert.deepStrictEqual(tr.of('attempt').map((e) => e.timeout), [null])
            for (let t of ['timeout', 'page-close-start', 'page-close', 'browser-close-start', 'browser-close', 'browser-kill', 'cancelled', 'retry']) {
                assert.strict.equal(tr.of(t).length, 0, t)
            }
        })

    })


    //本組須置於檔案最後: 改用真計時器(之後不再使用假時鐘)
    describe('計時器清除(真計時器): 完成後不留未清除之逾時計時器', function() {

        it('single 成功完成後,本呼叫建立之逾時計時器全部已清除', async function() {
            mock.timers.reset() //改用真計時器, 以記錄包裝追蹤本呼叫期間經setTimeout建立而未被clearTimeout者
            let live = new Set()
            let st = globalThis.setTimeout
            let ct = globalThis.clearTimeout
            globalThis.setTimeout = (...a) => {
                let t = st(...a)
                live.add(t)
                return t
            }
            globalThis.clearTimeout = (t) => {
                live.delete(t)
                return ct(t)
            }
            let r
            try {
                r = await settle(call({ mode: 'single', retry: 1, timeout: 60000 }))
            }
            finally {
                globalThis.setTimeout = st
                globalThis.clearTimeout = ct
            }
            assert.strict.equal(r.ok, true, r.e)
            assert.strict.equal(live.size, 0) //60秒之逾時計時器若未清除, 此處會多一個
            for (let t of live) {
                ct(t)
            }
        })

    })

})
