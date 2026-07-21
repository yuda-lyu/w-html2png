import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright-core'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import isnum from 'wsemi/src/isnum.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispm from 'wsemi/src/ispm.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'
import cint from 'wsemi/src/cint.mjs'
import genID from 'wsemi/src/genID.mjs'
import now2strp from 'wsemi/src/now2strp.mjs'
import delay from 'wsemi/src/delay.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import fsDeleteFile from 'wsemi/src/fsDeleteFile.mjs'


//調用chrome免安裝版, 須至just-cool.net下載:
//https://blog.just-cool.net/google-chrome-portable/


let fdSrv = path.resolve()


//timeIdle, alive模式閒置自動關閉常駐瀏覽器之時間(ms)
let timeIdle = 60 * 60 * 1000 //1hr


//常駐瀏覽器狀態(模組層單例), 供alive模式使用
let browserPm = null //chromium.launch之Promise, 非null代表可用或啟動中(await即可取得), null代表下次呼叫須重新啟動
let ctxPms = {} //以deviceScaleFactor為key之context Promise快取
let refCount = 0 //繪圖中之呼叫數
let timerIdle = null //閒置計時器


function isWindows() {
    return process.platform === 'win32'
}


//getLaunchOpt, 組合chromium啟動參數, alive與single模式共用
let getLaunchOpt = (executablePath, modeHeadless) => {

    //headless, playwright僅支援布林, modeHeadless=false時顯示UI, 其餘視為無頭
    let headless = modeHeadless !== false

    //launchOpt
    let launchOpt = {
        headless,
        timeout: 60 * 1000, //延長launch timeout
        args: [
            '--lang=en-US', //未指定font-family時預設字型依瀏覽器UI語系解析, zh-TW系統會變成微軟正黑(無襯線), 固定en-US使其與puppeteer時代輸出一致(Times New Roman襯線)
            '--no-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-sync',
            '--disable-extensions',
            '--disable-default-apps',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
        ],
    }
    if (isestr(executablePath)) {
        launchOpt.executablePath = executablePath
    }

    return launchOpt
}


//getBrowser, 取得常駐瀏覽器, 未啟動時lazy啟動, 併發呼叫共用同一個launch Promise
let getBrowser = (executablePath, modeHeadless) => {

    if (browserPm === null) {

        //launch, 同步指派browserPm, 同一tick後之併發呼叫直接await同一個Promise, 不會重複launch
        let pmSelf = chromium.launch(getLaunchOpt(executablePath, modeHeadless))
            .then((browser) => {

                //disconnected, 瀏覽器意外死亡時歸零, 使下次呼叫重新啟動; 僅在browserPm仍指向本瀏覽器時歸零, 避免蓋掉他處新啟動之瀏覽器
                browser.on('disconnected', () => {
                    if (browserPm === pmSelf) {
                        browserPm = null
                        ctxPms = {}
                    }
                })

                return browser
            })
            .catch((err) => {

                //啟動失敗歸零, 使下次呼叫可重試啟動
                if (browserPm === pmSelf) {
                    browserPm = null
                    ctxPms = {}
                }

                return Promise.reject(err)
            })
        browserPm = pmSelf

    }

    return browserPm
}


//getContext, 取得指定deviceScaleFactor之常駐context, playwright之deviceScaleFactor為context層級故依scale分快取
let getContext = async (executablePath, modeHeadless, scale) => {

    //browser
    let browser = await getBrowser(executablePath, modeHeadless)

    //key
    let key = `dsf-${scale}`

    //newContext
    if (ctxPms[key] === undefined) {
        let pmCtx = browser.newContext({
            viewport: {
                width: 1280,
                height: 720,
            },
            deviceScaleFactor: scale,
        })
            .catch((err) => {

                //建立失敗清除快取, 使下次呼叫可重試建立
                if (ctxPms[key] === pmCtx) {
                    delete ctxPms[key]
                }

                return Promise.reject(err)
            })
        ctxPms[key] = pmCtx
    }

    return ctxPms[key]
}


//closeBrowser, 關閉常駐瀏覽器; 先歸零再關閉, 使後續呼叫直接啟動新瀏覽器, 不會取得關閉中之瀏覽器
let closeBrowser = async () => {

    //pmOld
    let pmOld = browserPm

    //歸零
    browserPm = null
    ctxPms = {}

    //close
    if (pmOld !== null) {
        await pmOld
            .then((browser) => {
                return browser.close()
            })
            .catch(() => {})
    }

}


//scheduleIdleClose, 重設閒置計時器, 閒置超過timeIdle且無繪圖中呼叫時自動關閉常駐瀏覽器
let scheduleIdleClose = () => {

    //clear
    clearTimeout(timerIdle)
    timerIdle = null

    //check, 無瀏覽器則無須排程
    if (browserPm === null) {
        return
    }

    //setTimeout
    timerIdle = setTimeout(() => {
        timerIdle = null
        if (refCount === 0 && browserPm !== null) {
            closeBrowser()
        }
    }, timeIdle)

}


//aliveStrategy, 常駐模式: 使用模組層常駐瀏覽器與context, 出圖後不釋放, 失敗重試前重啟瀏覽器自癒
let aliveStrategy = {
    acquire: async ({ executablePath, modeHeadless, scale }) => {
        let context = await getContext(executablePath, modeHeadless, scale)
        return {
            context,
            release: null, //常駐不釋放, 瀏覽器交由閒置計時器或WHtml2png.close()關閉
        }
    },
    heal: async () => {
        await closeBrowser()
    },
}


//singleStrategy, 單次模式: 每次啟動新瀏覽器, 出圖後即關閉釋放
let singleStrategy = {
    acquire: async ({ executablePath, modeHeadless, scale }) => {

        //browser
        let browser = await chromium.launch(getLaunchOpt(executablePath, modeHeadless))

        //context
        let context = null
        try {
            context = await browser.newContext({
                viewport: {
                    width: 1280,
                    height: 720,
                },
                deviceScaleFactor: scale,
            })
        }
        catch (err) {
            //建立context失敗須關閉已啟動之瀏覽器避免洩漏
            await browser.close()
                .catch(() => {})
            throw err
        }

        return {
            context,
            release: async () => {
                await browser.close()
            },
        }
    },
    heal: async () => {},
}


//core, alive與single共用之出圖流程: 驗證輸入, 組合html, 依strategy取得context, 開page載入渲染截圖, 失敗重試, 回傳base64
async function core(width, height, scale, html, opt, strategy) {

    //isWindows
    if (!isWindows()) {
        return Promise.reject('operating system is not windows')
    }

    //width
    if (!isnum(width)) {
        return Promise.reject('width is not a number')
    }
    width = cint(width)
    if (width <= 0) {
        return Promise.reject('width <= 0')
    }

    //height
    if (!isnum(height)) {
        return Promise.reject('height is not a number')
    }
    height = cint(height)
    if (height <= 0) {
        return Promise.reject('height <= 0')
    }

    //scale
    if (!isnum(scale)) {
        return Promise.reject('scale is not a number')
    }
    scale = cdbl(scale)
    if (scale <= 0) {
        return Promise.reject('scale <= 0')
    }

    //html
    if (!isestr(html)) {
        return Promise.reject('html is not an effective string')
    }
    let cHtml = html

    //modeHeadless
    let modeHeadless = get(opt, 'modeHeadless')
    if (modeHeadless !== true && modeHeadless !== false && modeHeadless !== 'new' && modeHeadless !== 'shell') {
        modeHeadless = 'new' //無頭, 不顯示UI
        // modeHeadless = false //顯示UI
    }

    //stylesHead
    let stylesHead = get(opt, 'stylesHead')
    if (!isearr(stylesHead)) {
        stylesHead = []
    }

    //cStylesHead
    let cStylesHead = ''
    each(stylesHead, (v) => {
        let c = `<link href="${v}" rel="stylesheet" />`
        cStylesHead += c
    })

    //scriptsHead
    let scriptsHead = get(opt, 'scriptsHead')
    if (!isearr(scriptsHead)) {
        scriptsHead = []
    }

    //cScriptsHead
    let cScriptsHead = ''
    each(scriptsHead, (v) => {
        let c = `<script src="${v}"></script>\n`
        cScriptsHead += c
    })

    //execJsHead
    let execJsHead = get(opt, 'execJsHead')
    if (isestr(execJsHead)) {
        execJsHead = [execJsHead]
    }
    if (!isearr(execJsHead)) {
        execJsHead = []
    }

    //cExecJsHead
    let cExecJsHead = ''
    each(execJsHead, (v) => {
        let c = `<script>${v}</script>\n\n`
        cExecJsHead += c
    })

    //execJsPost
    let execJsPost = get(opt, 'execJsPost')
    if (isestr(execJsPost)) {
        execJsPost = [execJsPost]
    }
    if (!isearr(execJsPost)) {
        execJsPost = []
    }

    //cExecJsPost
    let cExecJsPost = ''
    each(execJsPost, (v) => {
        let c = `<script>${v}</script>\n\n`
        cExecJsPost += c
    })

    //funGetUrl
    let funGetUrl = get(opt, 'funGetUrl')

    //funPageWait
    let funPageWait = get(opt, 'funPageWait')

    //executablePath, 可由外部指定瀏覽器執行檔(如本機安裝Chrome或playwright託管chromium), 未指定則使用套件自帶之免安裝chrome
    let executablePath = get(opt, 'executablePath')
    if (isestr(executablePath)) {

        //check
        if (!fsIsFile(executablePath)) {
            throw new Error(`invalid opt.executablePath[${executablePath}]`)
        }

    }
    else {

        //fdBase
        let fdBaseSelf = `${fdSrv}/chrome/`
        let fdBaseDist = `${fdSrv}/node_modules/w-html2png/chrome/`
        let fdBase = fdBaseSelf
        if (fsIsFolder(fdBaseDist)) {
            fdBase = fdBaseDist
        }
        // console.log('fdBase', fdBase)

        //fdExe
        let fdExe = `${fdBase}portable/App/Chrome-bin/138.0.7204.97/`
        // console.log('fdExe', fdExe)

        //fpExe
        let fpExe = `${fdExe}chrome.exe`
        // console.log('fpExe', fpExe)

        //check
        if (!fsIsFile(fpExe)) {
            //已使用npm i postinstall, 預期有fpExe可執行
            throw new Error(`invalid fpExe[${fpExe}], need to run postinstall`)
        }

        //executablePath
        executablePath = fpExe

    }

    //retry
    let retry = get(opt, 'retry')
    if (!ispint(retry)) {
        retry = 3
    }
    retry = cint(retry)

    //writeError
    let writeError = get(opt, 'writeError')
    if (!isbol(writeError)) {
        writeError = false
    }

    //fdHtml
    let fdHtml = get(opt, 'fdHtml')
    if (!isestr(fdHtml)) {
        fdHtml = './_convertTemp'
    }

    //fdErr
    let fdErr = get(opt, 'fdErr')
    if (!isestr(fdErr)) {
        fdErr = './_convertTemp'
    }

    //idpm
    let idpm = `${now2strp()}-${genID(6)}`

    //iCore
    let iCore = 0

    //exec, 增加計數器, 執行coreDraw, 檢測非預期問題
    let exec = async() => {
        let errTemp = null
        let b64 = ''

        //iCore
        iCore++

        //id
        let id = `${idpm}-${iCore}`

        //coreDraw
        let coreDraw = async () => {
            let earrs = []

            //html
            let g = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>highcharts to png</title>

  {cStylesHead}

  <script src="https://cdn.jsdelivr.net/npm/lodash/lodash.min.js"></script>

  <script src="https://cdn.jsdelivr.net/npm/wsemi/dist/wsemi.umd.js"></script>
  <script>
      let w = wsemi
  </script>

  {cScriptsHead}

  {cExecJsHead}

</head>
<body style="padding:0; margin:0;">

    <div id="pl">
        {cHtml}
    </div>

    {cExecJsPost}

</body>
</html>
`

            //html與style先取代, 避免取代到引入程式碼
            g = g.replace('{cHtml}', cHtml)

            //引入程式碼
            g = g.replace('{cStylesHead}', cStylesHead)
            g = g.replace('{cScriptsHead}', cScriptsHead)
            g = g.replace('{cExecJsHead}', cExecJsHead)
            g = g.replace('{cExecJsPost}', cExecJsPost)

            //fpHtml與url, 僅funGetUrl場景需寫html暫存檔, 否則直接以setContent灌入html字串
            let fpHtml = null
            let url = null
            if (isfun(funGetUrl)) {

                //fsCreateFolder
                if (!fsIsFolder(fdHtml)) {
                    fsCreateFolder(fdHtml)
                }

                //fpHtml
                fpHtml = path.resolve(fdHtml, `whweb_${id}.html`)
                // console.log('fpHtml', fpHtml)

                //writeFileSync
                try {
                    fs.writeFileSync(fpHtml, g, 'utf8')
                }
                catch (err) {
                    earrs.push({
                        anchor: `fs.writeFileSync(fpHtml, g, 'utf8')`,
                        err,
                    })
                }

                //funGetUrl
                if (size(earrs) === 0) {
                    try {
                        url = funGetUrl(fpHtml)
                        if (ispm(url)) {
                            url = await url
                        }
                    }
                    catch (err) {
                        earrs.push({
                            anchor: 'funGetUrl(fpHtml)',
                            err,
                        })
                    }
                }

            }

            //b64
            let b64 = ''

            //page流程
            if (size(earrs) === 0) {

                //acquire, 依strategy取得context與釋放函數
                let context = null
                let release = null
                try {
                    let ac = await strategy.acquire({ executablePath, modeHeadless, scale })
                    context = ac.context
                    release = ac.release
                }
                catch (err) {
                    earrs.push({
                        anchor: 'strategy.acquire',
                        err,
                    })
                }

                //page
                let page = null
                if (context !== null) {
                    try {
                        page = await context.newPage()
                        page.setDefaultNavigationTimeout(60 * 1000) //延長timeout
                    }
                    catch (err) {
                        earrs.push({
                            anchor: 'context.newPage()',
                            err,
                        })
                    }
                }

                //draw
                if (page !== null) {
                    try {

                        //setViewportSize, deviceScaleFactor已由context給定
                        await page.setViewportSize({
                            width: Number(width),
                            height: Number(height),
                        })

                        //show page, networkidle代表500ms內無網路連線, 對應puppeteer之networkidle系列
                        if (url !== null) {
                            await page.goto(url, {
                                waitUntil: 'networkidle',
                                timeout: 60 * 1000, //延長timeout
                            })
                        }
                        else {
                            await page.setContent(g, {
                                waitUntil: 'networkidle',
                                timeout: 60 * 1000, //延長timeout
                            })
                        }

                        //delay
                        if (isfun(funPageWait)) {
                            await page.waitForFunction(funPageWait, null, { polling: 200, timeout: 60 * 1000 }) //200ms偵測一次, 延長timeout
                        }

                        //screenshot, 直接取Buffer, 不落地png暫存檔
                        let buf = await page.screenshot({
                            timeout: 60 * 1000, //延長timeout
                        })

                        //b64
                        b64 = Buffer.from(buf).toString('base64')

                    }
                    catch (err) {
                        //try catch也能攔截async函數
                        earrs.push({
                            anchor: 'fun(page)',
                            err,
                        })
                    }

                    //close
                    try {
                        await page.close()
                    }
                    catch (err) {
                        earrs.push({
                            anchor: 'page.close()',
                            err,
                        })
                    }
                }

                //release, single模式關閉本次啟動之瀏覽器, alive模式為null不釋放
                if (isfun(release)) {
                    try {
                        await release()
                    }
                    catch (err) {
                        earrs.push({
                            anchor: 'release()',
                            err,
                        })
                    }
                }

            }

            //delete
            if (fpHtml !== null && fsIsFile(fpHtml)) {
                try {
                    fs.unlinkSync(fpHtml)
                }
                catch (err) {}
            }

            //check
            if (size(earrs) > 0) {

                //cearrs
                let cearrs = ''
                each(earrs, (earr) => {
                    let m = get(earr, 'err.message', '')
                    let c = `${m} in ${earr.anchor}`
                    cearrs += c + '\n'
                })

                //writeFileSync
                if (writeError) {
                    if (!fsIsFolder(fdErr)) {
                        fsCreateFolder(fdErr)
                    }
                    let fpJson = path.resolve(fdErr, `err_${id}_all.json`)
                    // console.log('fpJson', fpJson)
                    fs.writeFileSync(fpJson, cearrs, 'utf8')
                }

                return Promise.reject(cearrs)
            }

            //check
            if (!isestr(b64)) {
                return Promise.reject(`b64 is not an effective string`)
            }

            return b64
        }

        //coreDraw
        await coreDraw()
            .then((res) => {
                b64 = res
            })
            .catch((err) => {
                errTemp = err
            })
            .finally(() => {

                //fpHtml, 防禦性清除, 預期coreDraw內已刪除
                let fpHtml = path.resolve(fdHtml, `whweb_${id}.html`)
                if (fsIsFile(fpHtml)) {
                    fsDeleteFile(fpHtml)
                }
                if (fsIsFile(fpHtml) && writeError) {
                    if (!fsIsFolder(fdErr)) {
                        fsCreateFolder(fdErr)
                    }
                    let fpJson = path.resolve(fdErr, `err_${id}_fpHtml.json`)
                    fs.writeFileSync(fpJson, `can not delete html[whweb_${id}.html}]`, 'utf8')
                }

            })

        //state
        let state = errTemp === null ? 'success' : 'error'

        //r
        let r = {
            state,
            message: errTemp,
            b64,
        }

        return r
    }

    //proc, 失敗時重試
    let proc = async() => {
        let errTemp = null
        let b64 = ''

        while (true) {

            //exec
            let r = await exec()
                .catch(() => {
                    //已全攔截, 預期不會有catch
                })

            //check, r.state='success'
            if (get(r, 'state', '') === 'success') {
                //儲存b64並跳出
                b64 = r.b64
                break
            }

            //check, 來到此處必為r.state='error'
            if (iCore >= retry) {
                //若retry=3, 執行3次都失敗時iCore=3, 則視為不再重試, 儲存錯誤並跳出
                errTemp = r.message //使用最後執行之錯誤訊息回傳
                break
            }

            //自癒, 失敗重試前依strategy處置, 常駐模式重啟瀏覽器使重試取得全新瀏覽器
            await strategy.heal()

            //延遲再重試
            await delay(5000)

        }

        //check
        if (errTemp !== null) {
            return Promise.reject(errTemp)
        }

        return b64
    }

    //proc
    let b64 = await proc()

    return b64
}


//coreAlive, 常駐模式: 出圖後瀏覽器留存供同行程後續呼叫重用, 含引用計數, 結束時重設閒置關閉排程
async function coreAlive(width, height, scale, html, opt = {}) {
    refCount++
    try {
        let b64 = await core(width, height, scale, html, opt, aliveStrategy)
        return b64
    }
    finally {
        refCount--
        scheduleIdleClose()
    }
}


//coreSingle, 單次模式: 每次啟動新瀏覽器出圖後即關閉釋放, Node行程可自然結束
async function coreSingle(width, height, scale, html, opt = {}) {
    let b64 = await core(width, height, scale, html, opt, singleStrategy)
    return b64
}


/**
 * 呼叫Chromium轉Html為png圖
 *
 * 提供兩種瀏覽器使用模式(opt.mode):
 * 'single'為每次呼叫啟動新瀏覽器, 出圖後即關閉釋放, Node行程可自然結束, 適合排程批次;
 * 'alive'為常駐瀏覽器, 第一次呼叫時啟動, 同行程後續呼叫重用故出圖較快, 閒置超過1小時自動關閉,
 * 批次腳本結束前可呼叫WHtml2png.close()主動關閉常駐瀏覽器, 使Node行程可立即退出
 *
 * @class
 * @param {Number} [width=700] 輸入圖片原始寬度數字，單位px，預設700
 * @param {Number} [height=400] 輸入圖片原始高度數字，單位px，預設400
 * @param {Number} [scale=3] 輸入欲將圖片放大比例數字，單位px，預設3
 * @param {String} [html=''] 輸入HTML字串，預設''
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.mode='single'] 輸入瀏覽器使用模式字串，'single'代表每次呼叫啟閉瀏覽器，'alive'代表常駐瀏覽器供同行程重用，預設'single'
 * @param {String} [opt.executablePath=''] 輸入瀏覽器執行檔路徑字串，可指定本機安裝Chrome或playwright託管chromium等，未給則使用套件自帶之免安裝chrome；注意alive模式之常駐瀏覽器由同行程第一次呼叫決定執行檔，欲切換須先呼叫WHtml2png.close()，預設''
 * @param {Array} [opt.stylesHead=[]] 輸入引用css程式碼網址陣列，預設[]
 * @param {Array} [opt.scriptsHead=[]] 輸入引用js程式碼網址陣列，預設[]
 * @param {String|Array} [opt.execJsHead=''] 輸入插入head內執行js程式碼字串或陣列，預設''
 * @param {String|Array} [opt.execJsPost=''] 輸入於dom末插入執行js程式碼字串或陣列，預設''
 * @param {Function} [opt.funGetUrl=null] 輸入轉換goto所使用本機網址(fpHtml)成為url之函數，預設null
 * @param {Function} [opt.funPageWait=null] 輸入前端瀏覽器內偵測等待完成之函數，可用window或document等，回傳true則代表渲染完成可進行截圖，預設null
 * @param {Integer} [opt.retry=3] 輸入失敗重試次數整數，預設3
 * @param {Boolean} [opt.writeError=false] 輸入是否輸出錯誤訊息至檔案布林值，預設false
 * @param {String} [opt.fdHtml='./_convertTemp'] 輸入臨時儲存繪圖用html檔之資料夾位置字串，僅設定opt.funGetUrl時會產生html暫存檔，預設'./_convertTemp'
 * @param {String} [opt.fdErr='./_convertTemp'] 輸入臨時儲存錯誤檔之資料夾位置字串，預設'./_convertTemp'
 * @returns {Promise} 回傳Promise，resolve為回傳base64圖片，reject為錯誤訊息
 * @example
 *
 * async function testa() {
 *
 *     let html = `
 * <div style="padding:10px; display:inline-block;">
 *     <div style="background-color: rgb(255, 255, 255); border-radius: 5px; width: 600px; box-shadow:0 3px 1px -2px rgba(0,0,0,.2), 0 2px 2px 0 rgba(0,0,0,.14), 0 1px 5px 0 rgba(0,0,0,.12);">
 *         <div style="padding: 20px; border-bottom: 1px solid rgb(221, 221, 221); background-color: rgb(250, 250, 250); border-radius: 5px 5px 0px 0px; display: flex; justify-content: flex-start; align-items: center;">
 *             <div>
 *                 <div style="font-size: 2rem;">Panel Title</div>
 *             </div>
 *         </div>
 *         <div style="border-radius: 0px;">
 *             <div style="padding: 20px;">
 *                 Here is a panel content, Morbi mattis ullamcorper velit. Donec orci lectus, aliquam ut, faucibus non, euismod id, nulla. In ut quam vitae odio lacinia tincidunt.
 *             </div>
 *         </div>
 *         <div style="padding: 20px; border-top: 1px solid rgb(221, 221, 221); background-color: rgb(250, 250, 250); border-radius: 0px 0px 5px 5px;">
 *             Here is a panel footer
 *         </div>
 *     </div>
 * </div>
 *     `
 *     let width = 620
 *     let height = 235
 *     let scale = 3
 *
 *     let b64 = await WHtml2png(width, height, scale, html)
 *     // console.log('b64', b64)
 *
 *     // fs.writeFileSync('./test-scla.b64', b64, 'utf8')
 *     fs.writeFileSync('./test-scla.png', b64, { encoding: 'base64' })
 *
 *     console.log('finish')
 * }
 * testa()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function WHtml2png(width = 700, height = 400, scale = 3, html = '', opt = {}) {
    // console.log('WHtml2png', width, height, scale, opt)

    //mode
    let mode = get(opt, 'mode')
    if (mode !== 'single' && mode !== 'alive') {
        mode = 'single'
    }

    //dispatch
    if (mode === 'alive') {
        return coreAlive(width, height, scale, html, opt)
    }
    return coreSingle(width, height, scale, html, opt)
}


//close, 主動關閉alive模式之常駐瀏覽器並清除閒置計時器, 供批次腳本結束前呼叫使Node行程可立即退出
WHtml2png.close = async () => {
    clearTimeout(timerIdle)
    timerIdle = null
    await closeBrowser()
}


export default WHtml2png
