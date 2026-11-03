import './tools/fetchBlock.mjs'
import fs from 'fs'
import http from 'http'
import path from 'path'
import assert from 'assert'
import { pathToFileURL } from 'url'
import WHtml2png from '../src/WHtml2png.mjs'
import { decodePng, classifyCenter, countNonWhite } from './tools/png.mjs'
import { setBinEnv } from './tools/binEnv.mjs'
import { makeTracer } from './tools/fakeChromium.mjs'


//規則R18: 真chrome: 頁內人為阻塞使載入返回(networkidle)必早於頁尾腳本與load, 使競態情境決定性地發生(不依賴機器負載):
//head內同步阻塞(block)期間解析器停住且無網路活動, playwright之networkidle(Node端500ms計時器)於阻塞中即到達, 此時頁面錯誤尚未發生、內容尚未繪製
//修前: 載入一返回即檢查頁面錯誤並截圖 -> 漏判頁面錯誤、拿到未完成之圖; 修後: 等load與靜止窗
let fdTest = path.resolve('./test/_tmp/pageSettle')
let port = 9043
let block = 'var t0 = Date.now(); while (Date.now() - t0 < 1500) {}'
let paint = 'document.body.style.background = "rgb(0,255,0)";'
let onload = (js) => `window.addEventListener("load", function () { ${js} });`
let timeout = (js, ms) => `setTimeout(function () { ${js} }, ${ms});`
let boom = (msg) => `throw new Error("${msg}");`
let navs = [
    { nav: 'setContent', opt: () => ({}) },
    { nav: 'goto', opt: () => ({ fdHtml: fdTest, funGetUrl: (fp) => pathToFileURL(fp).href }) },
]


describe('unit-pageSettle', function() {

    this.timeout(180000)

    let restoreBin = null
    let server = null

    before(async function() {
        if (process.platform !== 'win32') {
            this.skip() //套件自帶之免安裝chrome只支援Windows
        }
        fs.rmSync(fdTest, { recursive: true, force: true })
        fs.mkdirSync(fdTest, { recursive: true })
        restoreBin = await setBinEnv('pageSettleMirror')

        //本機伺服器: /slow延遲回應(遠超過靜止窗, 不是靠窗等到), /page為導覽目的頁
        server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Cache-Control', 'no-store')
            if (req.url === '/slow') {
                setTimeout(() => {
                    res.end('ok')
                }, 1500)
                return
            }
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end('<html><body style="margin:0;background:rgb(0,255,0)"></body></html>')
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

    //run, 回傳{ ok, msg, b64, tr }, 不拋錯
    let run = async (html, opt) => {
        let tr = makeTracer()
        let r = await WHtml2png(100, 50, 1, html, { retry: 1, execJsHead: block, onTrace: tr.onTrace, ...opt })
            .then((b64) => ({ ok: true, b64 }), (e) => ({ ok: false, msg: String(e) }))
        return { ...r, tr }
    }
    let color = (r) => {
        assert.strict.equal(r.ok, true, r.msg)
        return classifyCenter(decodePng(r.b64))
    }
    let assertPageError = (r, msg) => {
        assert.strict.equal(r.ok, false, 'rejectOnPageError missed the page error')
        assert.ok(r.msg.includes('page error') && r.msg.includes(msg), r.msg)
    }


    for (let { nav, opt } of navs) {

        //spec: R7(頁面端未捕捉之例外使該次失敗)、R18第1項
        for (let mode of ['single', 'alive']) {
            it(`${mode}+${nav}: 頁尾腳本拋錯(晚於networkidle): rejectOnPageError不漏判`, async function() {
                let r = await run('<div></div>', { mode, rejectOnPageError: true, execJsPost: boom('again'), ...opt() })
                assertPageError(r, 'again')
                assert.strict.equal(r.tr.of('page-settled')[0].result, 'settled')
            })
        }

        //spec: R18第1項(截圖含頁尾腳本之繪製); 既有測試unit-cdnLibs同型
        it(`single+${nav}: 頁尾腳本塗色(晚於networkidle): 截圖含其結果`, async function() {
            let r = await run('<div></div>', { mode: 'single', execJsPost: paint, ...opt() })
            assert.strict.equal(color(r), 'green')
        })

        //spec: R18第1項(截圖含html內容); 既有測試unit-dist同型: 解析器被擋時body尚未存在
        it(`single+${nav}: html內容(晚於networkidle才解析): 截圖含內容`, async function() {
            let r = await run('<div style="width:100px;height:50px;background:rgb(0,255,0)"></div>', { mode: 'single', ...opt() })
            let img = decodePng(r.b64)
            assert.ok(countNonWhite(img) > 1000)
            assert.strict.equal(classifyCenter(img), 'green')
        })

        //spec: R18第1項: load事件處理已執行; 既有測試unit-localRes同型
        it(`alive+${nav}: load事件處理塗色: 截圖含其結果`, async function() {
            let r = await run('<div></div>', { mode: 'alive', execJsPost: onload(paint), ...opt() })
            assert.strict.equal(color(r), 'green')
        })

    }

    //spec: R18第1項: load事件處理之例外
    it('load事件處理拋錯: rejectOnPageError不漏判', async function() {
        let r = await run('<div></div>', { mode: 'alive', rejectOnPageError: true, execJsPost: onload(boom('in-load')) })
        assertPageError(r, 'in-load')
    })

    //spec: R18第2項: 未處理之rejection於下一個工作才回報(可晚於load), 須於截圖前收到
    it('頁尾腳本之未處理rejection: rejectOnPageError不漏判', async function() {
        let r = await run('<div></div>', { mode: 'alive', rejectOnPageError: true, execJsPost: 'Promise.reject(new Error("rej-late"));' })
        assertPageError(r, 'rej-late')
    })

    //spec: R18第2項: load前所設、延遲不超過窗長之計時器必先執行
    it('頁尾腳本之計時器(400ms)拋錯: rejectOnPageError不漏判', async function() {
        let r = await run('<div></div>', { mode: 'alive', rejectOnPageError: true, execJsPost: timeout(boom('timer-late'), 400) })
        assertPageError(r, 'timer-late')
    })

    //spec: R18第2項: 同上(繪製)
    it('頁尾腳本之計時器(400ms)塗色: 截圖含其結果', async function() {
        let r = await run('<div></div>', { mode: 'alive', execJsPost: timeout(paint, 400) })
        assert.strict.equal(color(r), 'green')
    })

    //spec: R18第2項: load事件處理內所設之計時器
    it('load事件處理內之計時器(300ms)塗色: 截圖含其結果', async function() {
        let r = await run('<div></div>', { mode: 'alive', execJsPost: onload(timeout(paint, 300)) })
        assert.strict.equal(color(r), 'green')
    })

    //spec: R18第2項: 窗內發出之請求須等其結束(回應1500ms, 遠超過窗長, 不是靠窗等到)
    for (let [name, js] of [
        ['頁尾腳本', (v) => v],
        ['load事件處理', onload],
    ]) {
        it(`${name}內fetch回應後才塗色: 截圖含其結果`, async function() {
            let r = await run('<div></div>', { mode: 'alive', execJsPost: js(`fetch("http://127.0.0.1:${port}/slow").then(function (res) { return res.text() }).then(function () { ${paint} });`) })
            assert.strict.equal(color(r), 'green')
            assert.strict.equal(r.tr.of('page-settled')[0].result, 'settled')
        })
    }

    //spec: R18: 頁面自行導覽時, 等待新文件完成(結果settled, 截圖為新文件)
    it('頁尾腳本導覽至另一頁: 截圖為導覽後之頁面', async function() {
        let r = await run('<div></div>', { mode: 'alive', execJsPost: `location.replace("http://127.0.0.1:${port}/page");` })
        assert.strict.equal(color(r), 'green')
        assert.strict.equal(r.tr.of('page-settled')[0].result, 'settled')
    })

    //spec: 既有行為不變: rejectOnPageError預設false, 頁面錯誤不影響出圖
    it('未開rejectOnPageError: 頁尾腳本拋錯仍出圖', async function() {
        let r = await run('<div></div>', { mode: 'alive', execJsPost: `${paint}${boom('ignored')}` })
        assert.strict.equal(color(r), 'green')
    })

    //spec: README〈頁面完成〉: 窗外之非同步由funPageWait表達; R7: 等待期間之頁面錯誤於截圖前檢查
    it('funPageWait等到之旗標之前發生之頁面錯誤(晚於靜止窗): rejectOnPageError不漏判', async function() {
        let r = await run('<div></div>', {
            mode: 'alive',
            rejectOnPageError: true,
            execJsHead: '',
            execJsPost: `setTimeout(function () { window.flag = 1; ${boom('before-flag')} }, 1500);`,
            funPageWait: () => window.flag === 1,
        })
        assertPageError(r, 'before-flag')
    })

    //spec: 無阻塞之控制組: 流程不受影響
    it('控制組(無阻塞): 正常出圖, 無頁面錯誤', async function() {
        let r = await run('<div></div>', { mode: 'alive', rejectOnPageError: true, execJsHead: '', execJsPost: paint })
        assert.strict.equal(color(r), 'green')
        assert.strict.equal(r.tr.of('page-settled')[0].result, 'settled')
    })

})
