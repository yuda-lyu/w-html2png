import './tools/fetchBlock.mjs'
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { mock } from 'node:test'
import WHtml2png from '../src/WHtml2png.mjs'
import { installFake, makeTracer } from './tools/fakeChromium.mjs'


//規則R18: 載入返回(networkidle)不代表頁面完成; 檢查頁面錯誤與截圖前須等到load與靜止窗
//以假playwright瀏覽器精確控制事件順序(networkidle先於load、窗內才出現之請求等), 窗與上限以假時鐘(node:test mock.timers, 含Date)驗證, 其餘以onTrace與頁面操作事件同步, 不以延時偵測
let fdTest = path.resolve('./test/_tmp/pageSettleFake')
let exe = process.execPath //executablePath只需為存在之檔案(w-playwright所呼叫之BrowserType已以setBrowserTypeForTest取代, 不會執行)
let call = (opt) => WHtml2png(100, 50, 1, '<div>x</div>', { executablePath: exe, retry: 1, fdHtml: fdTest, fdErr: fdTest, ...opt })
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
let navs = [
    { nav: 'setContent', opt: {} },
    { nav: 'goto', opt: { funGetUrl: () => 'file:///x.html' } },
]
let modes = ['alive', 'single']


describe('unit-pageSettleFake', function() {

    this.timeout(60000)

    let env = null
    let unhandled = []
    let onUnhandled = (err) => {
        unhandled.push(String(err))
    }

    //start, 以cfg安裝假瀏覽器並開始一次出圖, 等進入載入步驟且其後之microtask跑完後回傳頁面(此時載入已返回, 即networkidle已到達)
    //不等waitPageSettled步驟: 使未實作等待之版本於「load前即截圖、漏判頁面錯誤」等斷言紅, 而不是等不到步驟名
    let start = async (cfg, opt = {}) => {
        env = installFake({ pid: null, ...cfg })
        let tr = makeTracer()
        let pm = settle(call({ onTrace: tr.onTrace, ...opt }))
        await tr.wait('step', (e) => e.step === 'page.setContent()' || e.step === 'page.goto()')
        await flush()
        return { tr, pm, page: env.launches[0].pages[0] }
    }

    //假時鐘於整個檔案只啟用一次(各案相對推進), 理由見unit-timeoutFake; 含Date使靜止窗之計算可控
    before(function() {
        process.on('unhandledRejection', onUnhandled)
        mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 })
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
        env = null
    })

    afterEach(async function() {
        if (env) {
            await env.releaseAll()
            await WHtml2png.close()
            env.restore()
        }
        await flush()
        assert.strict.deepEqual(unhandled, [], 'unhandled rejection')
    })


    describe('load: 載入返回(networkidle)後, 須等load才檢查頁面錯誤與截圖', function() {

        for (let mode of modes) {
            for (let { nav, opt } of navs) {

                //spec: R18第1項: 截圖須於load之後(頁尾腳本與load事件處理皆已執行)
                it(`${mode}+${nav}: load到達前不截圖, 到達後才截圖`, async function() {
                    let { pm, page } = await start({ load: 'gate' }, { mode, ...opt })
                    assert.strict.equal(page.order.includes('screenshot'), false, 'screenshot before load')
                    page.gateLoad.resolve()
                    let r = await pm
                    assert.strict.equal(r.ok, true, r.e)
                    assert.deepStrictEqual(page.order, [nav, 'waitForLoadState', 'evaluate', 'screenshot'])
                })

                //spec: R7、R18第1項: rejectOnPageError時, 頁面錯誤晚於networkidle而早於load者不得漏判
                it(`${mode}+${nav}: 頁面錯誤晚於載入返回而早於load: 該次失敗(未截圖), 訊息含頁面錯誤`, async function() {
                    let { pm, page } = await start({ load: 'gate' }, { mode, rejectOnPageError: true, ...opt })
                    page.emit('pageerror', new Error('late-boom'))
                    page.gateLoad.resolve()
                    let r = await pm
                    assert.strict.equal(r.ok, false, 'rejectOnPageError missed the page error')
                    assert.ok(r.e.includes('page error') && r.e.includes('late-boom'), r.e)
                    assert.strict.equal(page.order.includes('screenshot'), false)
                })

            }
        }

        //spec: R7: 依retry重試; R18: 每次嘗試各自等待
        it('頁面錯誤使第一次失敗, 第二次無錯誤: 依retry重試後成功', async function() {
            env = installFake({ pid: null, load: 'gate' })
            let tr = makeTracer()
            let pm = settle(call({ mode: 'single', retry: 2, rejectOnPageError: true, onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.attempt === 1 && e.step === 'page.setContent()')
            await flush()
            let page1 = env.launches[0].pages[0]
            assert.strict.equal(page1.order.includes('screenshot'), false, 'screenshot before load')
            page1.emit('pageerror', new Error('first'))
            page1.gateLoad.resolve()
            await tr.wait('retry')
            await tick(5000)
            await tr.wait('step', (e) => e.attempt === 2 && e.step === 'page.setContent()')
            await flush()
            let page2 = env.launches[1].pages[0]
            page2.gateLoad.resolve()
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
            assert.strict.equal(page1.order.includes('screenshot'), false)
            assert.strict.equal(page2.order.includes('screenshot'), true)
        })

        //spec: R18: funPageWait於頁面完成後才開始; R7: 等待失敗時附上已收到之頁面錯誤(unit-errors同型)
        it('funPageWait於load與靜止窗之後才開始; 等待失敗時保留早於load之頁面錯誤', async function() {
            let fn = () => false
            fn.fake = 'reject'
            let { pm, page } = await start({ load: 'gate' }, { mode: 'alive', rejectOnPageError: true, funPageWait: fn })
            assert.strict.equal(page.order.includes('waitForFunction'), false, 'funPageWait before load')
            page.emit('pageerror', new Error('boom-before-wait'))
            page.gateLoad.resolve()
            let r = await pm
            assert.strict.equal(r.ok, false)
            assert.ok(r.e.includes('boom-before-wait') && r.e.includes('in pageerror'), r.e)
            assert.deepStrictEqual(page.order, ['setContent', 'waitForLoadState', 'evaluate', 'waitForFunction'])
        })

        //spec: 既有行為: 未開rejectOnPageError時頁面錯誤不影響出圖
        it('未開rejectOnPageError: 頁面錯誤不影響出圖', async function() {
            let { pm, page } = await start({ load: 'gate' }, { mode: 'alive' })
            page.emit('pageerror', new Error('ignored'))
            page.gateLoad.resolve()
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
        })

        //spec: R18: 等待load之時限為上限timeSettleMax
        it('等待load之引數: load、時限60秒', async function() {
            let { pm, page } = await start({}, { mode: 'alive' })
            await pm
            assert.strict.equal(page.loadOpts.state, 'load')
            assert.strict.equal(page.loadOpts.timeout, 60000)
        })

    })


    describe('靜止窗: load後以頁內計時器等待, 窗內出現之頁面錯誤與請求皆須反映', function() {

        //spec: R18第2項: 窗結束前不截圖; 窗內之頁面錯誤不得漏判
        it('頁內計時器返回前不截圖; 窗內到達之頁面錯誤使該次失敗', async function() {
            let { pm, page } = await start({ settle: 'gate' }, { mode: 'alive', rejectOnPageError: true })
            await page.waitOrder('evaluate')
            await flush()
            assert.strict.equal(page.order.includes('screenshot'), false)
            page.emit('pageerror', new Error('in-window'))
            page.gateEval.resolve()
            let r = await pm
            assert.strict.equal(r.ok, false)
            assert.ok(r.e.includes('in-window'), r.e)
            assert.strict.equal(page.order.includes('screenshot'), false)
        })

        //spec: R18第2項: 等待須於頁面內進行(頁面自身之計時器), 不可於Node端; 引數為毫秒數
        it('等待於頁面內以setTimeout進行: 傳入之函數依引數毫秒數才解決', async function() {
            let { pm, page } = await start({}, { mode: 'alive' })
            await pm
            let done = false
            page.evalFn(50).then(() => {
                done = true
            })
            await tick(49)
            assert.strict.equal(done, false)
            await tick(1)
            assert.strict.equal(done, true)
        })

        //spec: R18第2項: 窗自load起算
        it('窗自load起算: load之後已過200ms才返回載入者只再等300ms', async function() {
            let { pm, page, tr } = await (async () => {
                env = installFake({ pid: null, nav: 'gate', load: 'silent' })
                let tr2 = makeTracer()
                let pm2 = settle(call({ mode: 'alive', onTrace: tr2.onTrace }))
                await tr2.wait('step', (e) => e.step === 'page.setContent()')
                return { tr: tr2, pm: pm2, page: env.launches[0].pages[0] }
            })()
            page.emit('load')
            await tick(200)
            page.gateNav.resolve()
            await tr.wait('page-settled')
            assert.deepStrictEqual(page.evals, [300])
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
        })

        //spec: R18第2項: 窗已過亦至少往返頁面一次(已到期之計時器與已排入之回報先執行)
        it('load之後已超過窗長才返回載入者: 仍往返頁面一次(1ms)', async function() {
            env = installFake({ pid: null, nav: 'gate', load: 'silent' })
            let tr = makeTracer()
            let pm = settle(call({ mode: 'alive', onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'page.setContent()')
            let page = env.launches[0].pages[0]
            page.emit('load')
            await tick(800)
            page.gateNav.resolve()
            await tr.wait('page-settled')
            assert.deepStrictEqual(page.evals, [1])
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
        })

        //spec: R18第2項: 窗自最後一次網路活動起算, 上限為窗長
        it('窗自最後一次網路活動起算(上限500ms): load後請求才結束者自其結束再等滿窗', async function() {
            env = installFake({ pid: null, nav: 'gate', load: 'silent' })
            let tr = makeTracer()
            let pm = settle(call({ mode: 'alive', onTrace: tr.onTrace }))
            await tr.wait('step', (e) => e.step === 'page.setContent()')
            let page = env.launches[0].pages[0]
            let req = {}
            page.emit('request', req)
            page.emit('load')
            await tick(100)
            page.emit('requestfinished', req)
            await tick(100)
            page.gateNav.resolve()
            await tr.wait('page-settled')
            assert.deepStrictEqual(page.evals, [400])
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
        })

        //spec: R18第2項: 進行中之請求未結束不算靜止(load前已發出、載入已返回者, 如頁尾腳本之fetch)
        for (let ev of ['requestfinished', 'requestfailed']) {
            it(`load時仍有進行中之請求: 其${ev}前不開窗不截圖`, async function() {
                let { pm, page } = await start({ load: 'gate' }, { mode: 'alive' })
                let req = {}
                page.emit('request', req)
                page.gateLoad.resolve()
                await flush()
                assert.strict.equal(page.order.includes('evaluate'), false)
                assert.strict.equal(page.order.includes('screenshot'), false, 'screenshot with a request in flight')
                page.emit(ev, req)
                let r = await pm
                assert.strict.equal(r.ok, true, r.e)
                assert.deepStrictEqual(page.order, ['setContent', 'waitForLoadState', 'evaluate', 'screenshot'])
            })
        }

        //spec: R18第2項: 窗內才發出之請求(load事件處理或計時器所發)須等其結束, 並自其結束再等滿窗
        it('窗內才發出請求: 等其結束後再開一個完整之窗才截圖', async function() {
            let { pm, page, tr } = await start({ settle: 'gate' }, { mode: 'alive' })
            await page.waitOrder('evaluate')
            let req = {}
            page.emit('request', req)
            page.gateEval.resolve()
            await flush()
            assert.strict.equal(page.order.filter((v) => v === 'evaluate').length, 1) //請求未結束, 不開下一個窗
            assert.strict.equal(page.order.includes('screenshot'), false)
            page.emit('requestfinished', req)
            await page.waitOrder('evaluate', 2)
            assert.strict.equal(page.evals[1], 500)
            await flush()
            assert.strict.equal(page.order.includes('screenshot'), false)
            page.gateEval.resolve()
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
            assert.strict.equal(tr.of('page-settled')[0].result, 'settled')
        })

        //spec: R18第2項: 窗內請求已起訖者同樣不算靜止
        it('窗內請求已起訖: 再開一個窗才截圖', async function() {
            let { pm, page } = await start({ settle: 'gate' }, { mode: 'alive' })
            await page.waitOrder('evaluate')
            let req = {}
            page.emit('request', req)
            page.emit('requestfinished', req)
            page.gateEval.resolve()
            await page.waitOrder('evaluate', 2)
            await flush()
            assert.strict.equal(page.order.includes('screenshot'), false)
            page.gateEval.resolve()
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
        })

    })


    describe('導覽與未達成時之處置: 不因等待本身失敗, 續往下維持出圖', function() {

        //spec: R18: 頁面自行導覽(頁內等待因執行環境銷毀而失敗)時, 重新等待新文件之load與窗
        it('頁內計時器因導覽失敗: 重新等待load與窗, 結果settled', async function() {
            let { pm, page, tr } = await start({ settle: 'reject1' }, { mode: 'alive' })
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
            assert.deepStrictEqual(page.order, ['setContent', 'waitForLoadState', 'evaluate', 'waitForLoadState', 'evaluate', 'screenshot'])
            assert.strict.equal(tr.of('page-settled')[0].result, 'settled')
        })

        //spec: R18: 反覆失敗有次數上限, 不空轉; 既有行為: 仍出圖
        it('頁內計時器持續失敗: 5次後結果error, 仍出圖', async function() {
            let { pm, page, tr } = await start({ settle: 'reject' }, { mode: 'alive' })
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
            assert.strict.equal(page.order.filter((v) => v === 'evaluate').length, 5)
            assert.strict.equal(tr.of('page-settled')[0].result, 'error')
            assert.strict.equal(page.order.includes('screenshot'), true)
        })

        //spec: 既有行為不變: 頁面永不load(如document.open未close)時, 修前可出圖, 修後仍出圖
        it('限時內未load: 結果no-load, 仍出圖', async function() {
            let { pm, page, tr } = await start({ load: 'reject' }, { mode: 'alive' })
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
            assert.strict.equal(tr.of('page-settled')[0].result, 'no-load')
            assert.strict.equal(page.order.includes('evaluate'), false)
            assert.strict.equal(page.order.includes('screenshot'), true)
        })

        //spec: R18: 上限60秒(假時鐘): 頁內計時器不回應(主執行緒卡住或setTimeout被頁面取代)
        it('頁內計時器不回應: 60秒整點才放棄等待, 結果no-timer, 仍出圖', async function() {
            let { pm, page, tr } = await start({ settle: 'hang' }, { mode: 'alive' })
            await page.waitOrder('evaluate')
            await flush()
            await tick(59999)
            assert.strict.equal(tr.of('page-settled').length, 0)
            await tick(1)
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
            assert.strict.equal(tr.of('page-settled')[0].result, 'no-timer')
            assert.strict.equal(page.order.includes('screenshot'), true)
        })

        //spec: R18: 上限60秒(假時鐘): 請求持續進行中(如長輪詢)
        it('請求持續進行中: 60秒整點才放棄等待, 結果busy, 仍出圖', async function() {
            let { pm, page, tr } = await start({ load: 'gate' }, { mode: 'alive' })
            page.emit('request', {})
            page.gateLoad.resolve()
            await flush()
            await tick(59999)
            assert.strict.equal(tr.of('page-settled').length, 0)
            await tick(1)
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
            assert.strict.equal(tr.of('page-settled')[0].result, 'busy')
            assert.strict.equal(page.order.includes('evaluate'), false)
        })

        //spec: R18: 窗內反覆有活動且已過上限: 不再開窗
        it('窗內持續有活動且已過上限: 結果busy, 不再開下一個窗', async function() {
            let { pm, page, tr } = await start({ settle: 'gate' }, { mode: 'alive' })
            await page.waitOrder('evaluate')
            let req = {}
            page.emit('request', req)
            page.emit('requestfinished', req)
            mock.timers.setTime(Date.now() + 60001) //只推進時刻, 不觸發計時器, 使頁內計時器先於上限返回
            page.gateEval.resolve()
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
            assert.strict.equal(tr.of('page-settled')[0].result, 'busy')
            assert.strict.equal(page.order.filter((v) => v === 'evaluate').length, 1)
        })

    })


    describe('與opt.timeout: 等待期間逾時即放棄, 不再往下操作頁面', function() {

        //spec: R17第3項: 訊息含卡住之步驟; R18: 新步驟名waitPageSettled
        for (let mode of modes) {
            it(`${mode}: 等待load期間逾時: 訊息指出卡在waitPageSettled, 頁面關閉, 未截圖`, async function() {
                let { pm, page, tr } = await start({ load: 'gate' }, { mode, timeout: 2000 })
                await tick(2000)
                let r = await pm
                assert.strict.equal(r.ok, false)
                assert.strict.equal(r.e, 'timeout[2000ms] in waitPageSettled')
                assert.strict.equal((await tr.wait('page-close')).closed, true)
                assert.strict.equal(page.order.includes('screenshot'), false)
            })
        }

        //spec: R17第7項: 被放棄之嘗試不再往下; R18: 頁面關閉即結束等待(不留60秒計時器)
        it('等待進行中請求期間逾時: 頁面關閉即結束等待(未走到60秒上限), 不再往下', async function() {
            let { pm, page, tr } = await start({ load: 'gate' }, { mode: 'alive', timeout: 2000 })
            page.emit('request', {})
            page.gateLoad.resolve()
            await flush()
            await tick(2000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[2000ms] in waitPageSettled')
            assert.strict.equal((await tr.wait('page-settled')).result, 'no-load')
            assert.strict.equal((await tr.wait('cancelled')).step, 'waitPageSettled')
            assert.strict.equal(page.order.includes('screenshot'), false)
        })

        //spec: R17第7項
        it('頁內計時器等待期間逾時: 頁面關閉後不再往下', async function() {
            let { pm, page, tr } = await start({ settle: 'hang' }, { mode: 'alive', timeout: 2000 })
            await page.waitOrder('evaluate')
            await flush()
            await tick(2000)
            let r = await pm
            assert.strict.equal(r.e, 'timeout[2000ms] in waitPageSettled')
            await tr.wait('cancelled')
            assert.strict.equal(page.order.includes('screenshot'), false)
        })

    })


    describe('觀察回調', function() {

        //spec: dspec〈計時器相關函數之觀察回調與測試〉: 事件凍結、欄位固定; 未傳回調時行為不變
        it('page-settled事件: 凍結, 欄位固定, 順序在截圖步驟之前', async function() {
            let { pm, tr } = await start({}, { mode: 'alive' })
            let r = await pm
            assert.strict.equal(r.ok, true, r.e)
            let e = tr.of('page-settled')[0]
            assert.ok(Object.isFrozen(e))
            assert.deepStrictEqual(Object.keys(e).sort(), ['attempt', 'result', 'type'])
            assert.deepStrictEqual({ ...e }, { type: 'page-settled', attempt: 1, result: 'settled' })
            let steps = tr.events.filter((v) => v.type === 'step' || v.type === 'page-settled').map((v) => v.step || v.type)
            let i = steps.indexOf('waitPageSettled')
            assert.deepStrictEqual(steps.slice(i, i + 3), ['waitPageSettled', 'page-settled', 'page.screenshot()'])
        })

        //spec: 同上: 五種回調案結果相同
        for (let [name, onTrace] of [['未傳', undefined], ['拋錯', () => {
            throw new Error('trace boom')
        }], ['回傳rejection', () => Promise.reject(new Error('trace rej'))], ['非函數', 'x']]) {
            it(`onTrace為${name}: 順序保證不變(load前不截圖)`, async function() {
                env = installFake({ pid: null, load: 'gate' })
                let pm = settle(call({ mode: 'alive', rejectOnPageError: true, onTrace }))
                let st = { ended: null }
                pm.then((v) => {
                    st.ended = v
                })
                while (st.ended === null && (!env.launches[0] || !env.launches[0].pages[0])) {
                    await flush()
                }
                assert.strict.equal(st.ended, null, `the call settled before the page opened: ${JSON.stringify(st.ended)}`) //如啟動前置被拒(登入守門), 不空轉至逾時
                let page = env.launches[0].pages[0]
                await page.waitOrder('setContent')
                await flush()
                page.emit('pageerror', new Error('late-boom'))
                page.gateLoad.resolve()
                let r = await pm
                assert.strict.equal(r.ok, false, 'rejectOnPageError missed the page error')
                assert.ok(r.e.includes('late-boom'), r.e)
            })
        }

    })

})
