import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import wpw from 'w-playwright'


//測試用假playwright瀏覽器: 經w-playwright之測試接縫setBrowserTypeForTest取代其所呼叫之BrowserType(本套件之src與測試取同一個w-playwright, 同時生效), 使「瀏覽器卡死」可由測試以閘門(gate)精確控制, 不暫停真chrome行程
//替身收到之選項為w-playwright合併後者(含守門之--disable-features), 不呼叫next(), 故不啟動任何真瀏覽器
//主程序pid預設指向測試自行啟動之一個真實空轉行程(node), 使強制結束(樹狀結束pid)可被真實驗證: 行程是否結束以其exit事件為準
//只實作WHtml2png.mjs用到之介面子集: launch -> browser(on/off/isConnected/close/newContext/newBrowserCDPSession) -> context(route/newPage/browser/close) -> page(on/setDefaultNavigationTimeout/setViewportSize/setContent/goto/waitForLoadState/evaluate/waitForFunction/screenshot/close)


//makeGate, 建立閘門: pm為卡住之Promise, 由測試呼叫resolve/reject放行
function makeGate() {
    let gate = {}
    gate.pm = new Promise((resolve, reject) => {
        gate.resolve = resolve
        gate.reject = reject
    })
    return gate
}


//spawnIdle, 啟動空轉子行程(代表瀏覽器主程序), 結束時回傳之exited為Promise(以exit事件解決)
function spawnIdle() {
    let child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e6)'], { windowsHide: true, stdio: 'ignore' })
    child.exited = new Promise((resolve) => {
        child.once('exit', () => {
            resolve(true)
        })
    })
    return child
}


//installFake, 以setBrowserTypeForTest安裝假BrowserType之launch, 回傳env(env.restore還原); env.cfg為預設行為, 各瀏覽器建立時複製一份(browser.cfg), 可於執行中改動
//cfg.launch:'ok'|'hang'(hang時launch卡住直到env.launchGate.resolve())|'throw'(launch以錯誤結束, w-playwright依真啟動之規則轉為E_LAUNCH)
//cfg.cdp:'ok'|'hang'; cfg.pid:'child'(預設, 真實空轉行程)|數字|null(CDP不回browser行程)
//cfg.close:'ok'|'hang'; cfg.newPage:'ok'|'hang'; cfg.pageClose:'ok'|'hang'; cfg.pageWait:'ok'|'hang'(hang時頁內等待卡住, 頁面關閉即以錯誤結束)
//cfg.nav:'ok'|'gate'(setContent/goto待page.gateNav放行才返回, 代表networkidle尚未到達)
//cfg.load:'ok'(立即發出load)|'silent'(回報已load但不發出事件, 事件由測試於載入期間自行發出)|'gate'(待page.gateLoad放行才發出load)|'reject'(限時內未load)|'gate-reject'(待page.gateLoad放行後才以錯誤結束); 頁面關閉時等待中者以錯誤結束
//cfg.settle(頁內計時器, 即page.evaluate):'ok'(立即返回)|'gate'(每次待page.gateEval放行, 放行後換新閘門)|'hang'(不返回, 頁面關閉時以錯誤結束)|'reject'(每次以錯誤結束)|'reject1'(第一次以錯誤結束, 代表導覽使執行環境銷毀)
function installFake(cfg = {}) {
    let restoreSeam = null
    let launchWaiters = []
    let env = {
        cfg: { launch: 'ok', cdp: 'ok', pid: 'child', close: 'ok', newPage: 'ok', pageClose: 'ok', pageWait: 'ok', load: 'ok', settle: 'ok', ...cfg },
        launches: [],
        launchOpts: [], //替身收到之(合併後)選項, 含launch:'throw'而未建立瀏覽器者
        children: [],
        launchGate: makeGate(),
        restore: () => {
            restoreSeam()
        },
        //waitLaunch, 等到第n個假瀏覽器已建立(替身之launch已被呼叫)才解決: w-playwright於呼叫替身前另有非同步之前置(環境與版本檢查、登入守門開啟時讀錯誤次數), 替身不再於WHtml2png發起啟動之同一tick被呼叫, 依賴「啟動已發起」之時點者以此事件同步(不以延時偵測)
        //pm(選用)為該次出圖之Promise: 其先於替身被呼叫而結束時(如登入守門拒絕), 以含其結果之錯誤reject, 不懸置至測試逾時
        waitLaunch: (n, pm = null) => {
            let pmLaunch = null
            if (env.launches.length >= n) {
                pmLaunch = Promise.resolve(env.launches[n - 1])
            }
            else {
                pmLaunch = new Promise((resolve) => {
                    launchWaiters.push({ n, resolve })
                })
            }
            if (pm === null) {
                return pmLaunch
            }
            let pmEnd = Promise.resolve(pm).then((r) => {
                throw new Error(`the call settled before launch ${n}: ${JSON.stringify(r)}`)
            }, (err) => {
                throw new Error(`the call failed before launch ${n}: ${String(err)}`)
            })
            return Promise.race([pmLaunch, pmEnd])
        },
        //releaseAll, 放行所有卡住者並結束殘留之空轉行程(測試收尾用)
        releaseAll: async () => {
            env.launchGate.resolve()
            for (let b of env.launches) {
                b.releaseAll()
            }
            for (let child of env.children) {
                if (child.exitCode === null && child.signalCode === null) {
                    child.kill()
                }
            }
            await Promise.all(env.children.map((child) => child.exited))
        },
    }

    restoreSeam = wpw.setBrowserTypeForTest({
        launch: (opt) => {
            env.launchOpts.push(opt)
            if (env.cfg.launch === 'throw') {
                return Promise.reject(new Error('fake launch failure'))
            }
            let browser = new FakeBrowser(env, { ...env.cfg }, opt)
            env.launches.push(browser)
            launchWaiters = launchWaiters.filter((w) => {
                if (env.launches.length >= w.n) {
                    w.resolve(env.launches[w.n - 1])
                    return false
                }
                return true
            })
            if (browser.cfg.launch === 'hang') {
                return env.launchGate.pm.then(() => browser)
            }
            return Promise.resolve(browser)
        },
    })

    return env
}


class FakeBrowser extends EventEmitter {

    constructor(env, cfg, launchOpt) {
        super()
        this.env = env
        this.cfg = cfg
        this.launchOpt = launchOpt
        this.connected = true
        this.pendings = [] //卡住中之操作, 瀏覽器斷線時以錯誤結束(同playwright)
        this.gates = { close: makeGate(), newPage: makeGate(), cdp: makeGate() }
        this.onClose = makeGate()
        this.calls = { close: 0, cdp: 0, newContext: 0, newPage: 0, pageClose: 0, setContent: 0, goto: 0, screenshot: 0 }
        this.pages = []
        this.child = null
        this.pid = cfg.pid
        if (cfg.pid === 'child') {
            this.child = spawnIdle()
            env.children.push(this.child)
            this.pid = this.child.pid
            this.child.once('exit', () => {
                this.disconnect()
            })
        }
    }

    isConnected() {
        return this.connected
    }

    //disconnect, 瀏覽器斷線: 發出disconnected並使卡住中之操作以錯誤結束
    disconnect() {
        if (!this.connected) {
            return
        }
        this.connected = false
        for (let p of this.pendings) {
            p.reject(new Error('Target page, context or browser has been closed'))
        }
        this.pendings = []
        this.emit('disconnected')
    }

    //hang, 建立卡住之Promise, 瀏覽器斷線時以錯誤結束
    hang() {
        let gate = makeGate()
        this.pendings.push(gate)
        return gate.pm
    }

    releaseAll() {
        this.gates.close.resolve()
        this.gates.newPage.resolve()
        this.gates.cdp.resolve()
        for (let p of this.pendings) {
            p.reject(new Error('released by test'))
        }
        this.pendings = []
        for (let pg of this.pages) {
            pg.releaseAll()
        }
    }

    close() {
        this.calls.close++
        this.onClose.resolve() //供測試以事件等待「已被要求關閉」
        if (this.cfg.close === 'hang') {
            return this.gates.close.pm.then(() => {
                this.disconnect()
            })
        }
        if (this.cfg.close === 'reject') {
            return Promise.reject(new Error('close failed')) //拋錯但行程仍在(仍連線)
        }
        this.disconnect()
        return Promise.resolve()
    }

    async newContext() {
        this.calls.newContext++
        if (this.cfg.newContext === 'hang') {
            return this.hang()
        }
        return new FakeContext(this)
    }

    async newBrowserCDPSession() {
        this.calls.cdp++
        if (this.cfg.cdp === 'hang') {
            return this.hang()
        }
        if (this.cfg.cdp === 'gate') {
            await this.gates.cdp.pm //待測試放行(browser.gates.cdp.resolve())
        }
        if (this.cfg.cdp === 'fail1' && this.calls.cdp === 1) {
            throw new Error('cdp failed once') //第一次失敗, 之後正常
        }
        let processInfo = [{ type: 'renderer', id: 1 }]
        if (this.pid !== null && this.pid !== undefined) {
            processInfo.unshift({ type: 'browser', id: this.pid })
        }
        return {
            send: async () => {
                return { processInfo }
            },
            detach: async () => {},
        }
    }

}


class FakeContext {

    constructor(browser) {
        this.b = browser
    }

    async route() {}

    browser() {
        return this.b
    }

    async close() {}

    newPage() {
        this.b.calls.newPage++
        if (this.b.cfg.newPage === 'hang') {
            return this.b.gates.newPage.pm.then(() => this.mk())
        }
        if (this.b.cfg.newPage === 'fail') {
            return Promise.reject(new Error('newPage failed'))
        }
        return Promise.resolve(this.mk())
    }

    mk() {
        let pg = new FakePage(this.b)
        this.b.pages.push(pg)
        return pg
    }

}


class FakePage {

    constructor(browser) {
        this.b = browser
        this.closed = false
        this.pendings = []
        this.gateWait = makeGate()
        this.gateNav = makeGate()
        this.gateLoad = makeGate()
        this.gateEval = makeGate()
        this.listeners = {}
        this.order = [] //頁面操作之依序紀錄, 供斷言事件順序
        this.evals = [] //page.evaluate之引數(頁內計時器之毫秒數)
        this.waiters = []
        this.nEvalReject = 0
    }

    setDefaultNavigationTimeout() {}

    on(ev, fn) {
        this.listeners[ev] = this.listeners[ev] || []
        this.listeners[ev].push(fn)
    }

    //emit, 由測試發出頁面事件(pageerror、load、request、requestfinished、requestfailed、close)
    emit(ev, arg) {
        for (let fn of this.listeners[ev] || []) {
            fn(arg)
        }
    }

    //record, 記錄頁面操作並放行等待該操作之測試
    record(name) {
        this.order.push(name)
        for (let w of this.waiters.slice()) {
            if (this.order.filter((v) => v === w.name).length >= w.n) {
                this.waiters.splice(this.waiters.indexOf(w), 1)
                w.resolve()
            }
        }
    }

    //waitOrder, 等第n次該頁面操作(含已發生者), 以事件同步, 不以延時偵測
    waitOrder(name, n = 1) {
        if (this.order.filter((v) => v === name).length >= n) {
            return Promise.resolve()
        }
        return new Promise((resolve) => {
            this.waiters.push({ name, n, resolve })
        })
    }

    async setViewportSize() {}

    async setContent() {
        this.b.calls.setContent++
        this.record('setContent')
        if (this.b.cfg.nav === 'gate') {
            await this.gateNav.pm
        }
    }

    async goto() {
        this.b.calls.goto++
        this.record('goto')
        if (this.b.cfg.nav === 'gate') {
            await this.gateNav.pm
        }
    }

    //waitForLoadState, 行為由cfg.load決定; 引數記於loadOpts
    waitForLoadState(state, opt) {
        this.record('waitForLoadState')
        this.loadOpts = { state, ...opt }
        if (this.closed) {
            return Promise.reject(new Error('Target page, context or browser has been closed'))
        }
        let mode = this.b.cfg.load
        let fired = () => {
            this.emit('load')
        }
        if (mode === 'silent') {
            return Promise.resolve() //load事件已由測試發出(於載入完成前), 只回報已到達
        }
        if (mode === 'reject') {
            return Promise.reject(new Error('Timeout 60000ms exceeded.'))
        }
        if (mode === 'gate' || mode === 'gate-reject') {
            return this.pending(this.gateLoad.pm.then(() => {
                if (mode === 'gate-reject') {
                    throw new Error('Timeout 60000ms exceeded.')
                }
                fired()
            }))
        }
        fired()
        return Promise.resolve()
    }

    //evaluate, 代表頁內計時器, 行為由cfg.settle決定; 引數(毫秒數)記於evals
    evaluate(fn, arg) {
        this.record('evaluate')
        this.evals.push(arg)
        this.evalFn = fn
        if (this.closed) {
            return Promise.reject(new Error('Target page, context or browser has been closed'))
        }
        let mode = this.b.cfg.settle
        if (mode === 'reject' || (mode === 'reject1' && this.nEvalReject === 0)) {
            this.nEvalReject++
            return Promise.reject(new Error('Execution context was destroyed, most likely because of a navigation'))
        }
        if (mode === 'hang') {
            return this.pending(new Promise(() => {}))
        }
        if (mode === 'gate') {
            let g = this.gateEval
            return this.pending(g.pm.then(() => {
                if (this.gateEval === g) {
                    this.gateEval = makeGate()
                }
            }))
        }
        return Promise.resolve()
    }

    //pending, 等待中之頁面操作: 頁面或瀏覽器關閉時以錯誤結束(同playwright)
    pending(pm) {
        let gate = makeGate()
        this.pendings.push(gate)
        this.b.pendings.push(gate)
        pm.then(gate.resolve, gate.reject)
        return gate.pm
    }

    //waitForFunction, 行為由funPageWait函數之fake屬性(優先)或cfg.pageWait決定: hang卡住(頁面或瀏覽器關閉即以錯誤結束), gate等測試放行(page.gateWait.resolve()), 其餘立即完成
    waitForFunction(fn) {
        this.record('waitForFunction')
        let mode = (fn && fn.fake) || this.b.cfg.pageWait
        if (mode === 'reject') {
            return Promise.reject(new Error('waitForFunction failed'))
        }
        if (mode === 'hang') {
            let gate = makeGate()
            this.pendings.push(gate)
            this.b.pendings.push(gate)
            return gate.pm
        }
        if (mode === 'gate') {
            return this.gateWait.pm
        }
        return Promise.resolve()
    }

    async screenshot() {
        this.b.calls.screenshot++
        this.record('screenshot')
        return Buffer.from('fake-png')
    }

    close() {
        this.b.calls.pageClose++
        if (this.b.cfg.pageClose === 'hang') {
            return this.b.hang()
        }
        this.closed = true
        this.emit('close')
        for (let p of this.pendings) {
            p.reject(new Error('Target page, context or browser has been closed'))
        }
        this.pendings = []
        return Promise.resolve()
    }

    releaseAll() {
        this.gateWait.resolve()
        this.gateNav.resolve()
        this.gateLoad.resolve()
        this.gateEval.resolve()
        for (let p of this.pendings) {
            p.reject(new Error('released by test'))
        }
        this.pendings = []
    }

}


//makeTracer, 收集onTrace事件並提供以事件同步之等待(不以延時偵測): wait(type, pred)回傳第一個符合之事件(含已發生者), waitCount(type, n)等第n個該型事件
function makeTracer() {
    let events = []
    let waiters = []
    let onTrace = (e) => {
        events.push(e)
        for (let w of waiters.slice()) {
            if (w.test(e)) {
                waiters.splice(waiters.indexOf(w), 1)
                w.resolve(e)
            }
        }
    }
    let wait = (type, pred = () => true) => {
        let test = (e) => e.type === type && pred(e)
        let hit = events.find(test)
        if (hit) {
            return Promise.resolve(hit)
        }
        return new Promise((resolve) => {
            waiters.push({ test, resolve })
        })
    }
    let waitCount = (type, n) => {
        let hits = events.filter((e) => e.type === type)
        if (hits.length >= n) {
            return Promise.resolve(hits[n - 1])
        }
        return new Promise((resolve) => {
            let c = hits.length
            waiters.push({
                test: (e) => e.type === type && ++c >= n,
                resolve,
            })
        })
    }
    let of = (type) => events.filter((e) => e.type === type)
    return { events, onTrace, wait, waitCount, of }
}


export { installFake, makeGate, makeTracer }
