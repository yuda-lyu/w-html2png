import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import isnum from 'wsemi/src/isnum.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
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
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import fsDeleteFolderSafe from 'wsemi/src/fsDeleteFolderSafe.mjs'
import execProcessKillPid from 'wsemi/src/execProcessKillPid.mjs'


//調用chrome免安裝版, 須至just-cool.net下載:
//https://blog.just-cool.net/google-chrome-portable/


let fdSrv = path.resolve()


function isWindows() {
    return process.platform === 'win32'
}


/**
 * 呼叫Chromium轉Html為png圖
 *
 * @class
 * @param {Number} [width=700] 輸入圖片原始寬度數字，單位px，預設700
 * @param {Number} [height=400] 輸入圖片原始高度數字，單位px，預設400
 * @param {Number} [scale=3] 輸入欲將圖片放大比例數字，單位px，預設3
 * @param {String} [html=''] 輸入HTML字串，預設''
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Array} [opt.scriptsHead=[]] 輸入引用js程式碼網址陣列，預設[]
 * @param {String|Array} [opt.execJsHead=''] 輸入插入head內執行js程式碼字串或陣列，預設''
 * @param {String|Array} [opt.execJsPost=''] 輸入於dom末插入執行js程式碼字串或陣列，預設''
 * @param {Integer} [opt.retry=3] 輸入失敗重試次數整數，預設3
 * @param {Boolean} [opt.writeError=false] 輸入是否輸出錯誤訊息至檔案布林值，預設false
 * @param {String} [opt.fdPng='./_convertTemp'] 輸入臨時儲存圖片png檔之資料夾位置字串，預設'./_convertTemp'
 * @param {String} [opt.fdHtml='./_convertTemp'] 輸入臨時儲存繪圖用html檔之資料夾位置字串，預設'./_convertTemp'
 * @param {String} [opt.fdProfile='./_convertTemp'] 輸入臨時儲存瀏覽器使用者資料之資料夾位置字串，預設'./_convertTemp'
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

    //isWindows
    if (!isWindows()) {
        return Promise.reject('operating system is not windows')
    }

    //width
    if (!isnum(width)) {
        return Promise.reject('width is not a number')
    }
    width = cdbl(width)
    if (width <= 0) {
        return Promise.reject('width <= 0')
    }

    //height
    if (!isnum(height)) {
        return Promise.reject('height is not a number')
    }
    height = cdbl(height)
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

    //funGetUrl
    let funGetUrl = get(opt, 'funGetUrl')

    //cExecJsPost
    let cExecJsPost = ''
    each(execJsPost, (v) => {
        let c = `<script>${v}</script>\n\n`
        cExecJsPost += c
    })

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
    let executablePath = fpExe

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

    //fdPng
    let fdPng = get(opt, 'fdPng')
    if (!isestr(fdPng)) {
        fdPng = './_convertTemp'
    }
    if (!fsIsFolder(fdPng)) {
        fsCreateFolder(fdPng)
    }

    //fdHtml
    let fdHtml = get(opt, 'fdHtml')
    if (!isestr(fdHtml)) {
        fdHtml = './_convertTemp'
    }
    if (!fsIsFolder(fdHtml)) {
        fsCreateFolder(fdHtml)
    }

    //fdProfile
    let fdProfile = get(opt, 'fdProfile')
    if (!isestr(fdProfile)) {
        fdProfile = './_convertTemp'
    }
    if (!fsIsFolder(fdProfile)) {
        fsCreateFolder(fdProfile)
    }

    //fdErr
    let fdErr = get(opt, 'fdErr')
    if (!isestr(fdErr)) {
        fdErr = './_convertTemp'
    }
    if (!fsIsFolder(fdErr)) {
        fsCreateFolder(fdErr)
    }

    //idpm
    let idpm = `${now2strp()}-${genID(6)}`

    //iCore
    let iCore = 0

    //exec, 增加計數器, 執行core, 檢測非預期問題
    let exec = async() => {
        let errTemp = null
        let b64 = ''

        //iCore
        iCore++

        //id
        let id = `${idpm}-${iCore}`

        //core
        let core = async () => {
            let earrs = []
            let earrsSpe = []

            //supplyHtml
            let supplyHtml = async (fun) => {
                let earrs = []

                //fpPng
                let fpPng = path.resolve(fdPng, `whpic_${id}.png`) //一定要給副檔名, 否則puppeteer的screenshot會無法識別格式
                // console.log('fpPng', fpPng)

                //fpHtml
                let fpHtml = path.resolve(fdHtml, `whweb_${id}.html`)
                // console.log('fpHtml', fpHtml)

                //html
                let g = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>highcharts to png</title>

  <script src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"></script>

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
                g = g.replace('{cScriptsHead}', cScriptsHead)
                g = g.replace('{cExecJsHead}', cExecJsHead)
                g = g.replace('{cExecJsPost}', cExecJsPost)

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

                //call fun
                if (size(earrs) === 0) {
                    try {
                        let r = fun(fpHtml, fpPng)
                        if (ispm(r)) {
                            r = await r
                        }
                    }
                    catch (err) {
                        //try catch也能攔截async函數
                        earrs.push({
                            anchor: 'fun(fpHtml, fpPng)',
                            err,
                        })
                    }
                }

                //delete
                if (fsIsFile(fpHtml)) {
                    try {
                        fs.unlinkSync(fpHtml)
                    }
                    catch (err) {}
                }

                //delete
                if (fsIsFile(fpPng)) {
                    try {
                        fs.unlinkSync(fpPng)
                    }
                    catch (err) {}
                }

                if (size(earrs) > 0) {
                    return {
                        state: 'error',
                        msg: earrs,
                    }
                }
                return {
                    state: 'success',
                    msg: '',
                }
            }

            //supplyBrowser
            let supplyBrowser = async (fun) => {
                let earrs = []

                //fdUserData
                let fdUserData = path.resolve(fdProfile, `profile_${id}`)
                // console.log('fdUserData', fdUserData)

                //puppeteerOpt
                let puppeteerOpt = {
                    headless: modeHeadless,
                    slowMo: 20,
                    protocolTimeout: 60 * 1000, //延長protocol timeout
                    // dumpio: true, //console.log chrome的stdout/stderr訊息
                    userDataDir: fdUserData,
                    args: [
                        // '--single-process',
                        '--no-sandbox',
                        '--incognito',
                        '--disable-gpu',
                        '--disable-software-rasterizer',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-sync',
                        '--disable-extensions',
                        '--disable-default-apps',
                        '--disable-features=VizDisplayCompositor',
                        // '--disable-background-networking',
                        '--metrics-recording-only',
                        '--mute-audio',
                        '--no-first-run',
                        '--safebrowsing-disable-auto-update',
                        // '--log-level=3', //強制免安裝chrome不顯示info,debug
                    ],
                    // stdio: 'ignore', //強制免安裝chrome不顯示stdio
                    // stdout: 'ignore', //強制免安裝chrome不顯示stdout
                    // stderr: 'ignore', //強制免安裝chrome不顯示stderr
                }
                if (isestr(executablePath)) {
                    puppeteerOpt.executablePath = executablePath
                }
                // console.log('puppeteerOpt.executablePath', puppeteerOpt.executablePath)

                //browser
                let browser = null
                let prc = null
                let pid = null
                try {
                    browser = await puppeteer.launch(puppeteerOpt)
                    prc = browser.process()
                    pid = get(prc, 'pid', '')
                    // console.log('prc', prc)
                    // console.log('pid', pid)
                }
                catch (err) {
                    earrs.push({
                        anchor: 'puppeteer.launch(puppeteerOpt)',
                        err,
                    })
                }

                //call fun
                if (browser !== null) {
                    try {
                        let r = fun(browser)
                        if (ispm(r)) {
                            r = await r
                        }
                    }
                    catch (err) {
                        //try catch也能攔截async函數
                        earrs.push({
                            anchor: 'fun(browser)',
                            err,
                        })
                    }
                }

                // //disconnect, 不使用, 會出現Error: EBUSY: resource busy or locked, unlink '...first_party_sets.db-journal'
                // if (browser !== null) {
                //     try {
                //         await browser.disconnect()
                //     }
                //     catch (err) {
                //         //不一定能disconnect, 故不紀錄錯誤
                //         // earrs.push({
                //         //     anchor: 'browser.disconnect()',
                //         //     err,
                //         // })
                //     }
                // }

                //close
                if (browser !== null) {
                    try {
                        await browser.close()
                    }
                    catch (err) {
                        earrs.push({
                            anchor: 'browser.close()',
                            err,
                        })
                    }
                }

                //pid
                if (isp0int(pid)) {
                    await execProcessKillPid(pid)
                        .catch(() => {
                            // console.log('execProcessKillPid catch', err)
                        })
                }

                //fsDeleteFolderSafe
                if (true) {
                    try {
                        await fsDeleteFolderSafe(fdUserData)
                    }
                    catch (err) {
                        earrs.push({
                            anchor: 'fsDeleteFolderSafe(fd)',
                            err,
                        })
                    }
                }

                if (size(earrs) > 0) {
                    return {
                        state: 'error',
                        msg: earrs,
                    }
                }
                return {
                    state: 'success',
                    msg: '',
                }
            }

            //supplyPage
            let supplyPage = async(browser, fun) => {
                let earrs = []

                //page
                let page = null
                try {
                    page = await browser.newPage()
                    page.setDefaultNavigationTimeout(60 * 1000) //延長timeout
                }
                catch (err) {
                    earrs.push({
                        anchor: 'browser.newPage()',
                        err,
                    })
                }

                //call fun
                if (page !== null) {
                    try {
                        let r = fun(page)
                        if (ispm(r)) {
                            r = await r
                        }
                    }
                    catch (err) {
                        //try catch也能攔截async函數
                        earrs.push({
                            anchor: 'fun(page)',
                            err,
                        })
                    }
                }

                //close
                if (page !== null) {
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

                if (size(earrs) > 0) {
                    return {
                        state: 'error',
                        msg: earrs,
                    }
                }
                return {
                    state: 'success',
                    msg: '',
                }
            }

            //b64, resHtml, resBrowser, resPage
            let b64 = ''
            let resHtml = null
            let resBrowser = null
            let resPage = null

            //supplyHtml
            resHtml = await supplyHtml(async(fpHtml, fpPng) => {

                //url
                let url = fpHtml
                if (isfun(funGetUrl)) {
                    url = funGetUrl(fpHtml)
                    if (ispm(url)) {
                        url = await url
                    }
                }

                //supplyPage
                resBrowser = await supplyBrowser(async(browser) => {

                    //supplyPage
                    resPage = await supplyPage(browser, async(page) => {

                        //viewport
                        let viewport = {
                            x: 0,
                            y: 0,
                            width: Number(width),
                            height: Number(height),
                            deviceScaleFactor: Number(scale),
                        }
                        //console.log('viewport',viewport)

                        //show page
                        await page.goto(url, {
                            waitUntil: [
                                'domcontentloaded', //HTML 文件完全解析完成時觸發，但不一定等到圖片、樣式或附屬框架全載入也不會等到其他資源完成。它速度最快，但若你依賴圖像或 CSS，這個事件可能太早觸發，使得截圖不完整
                                'networkidle2', //在 500 毫秒內，網絡連線數不超過 2 條就被視為「較穩定、資料改動已過」，但仍容許少量持續活動（例如輪詢後台資源）
                            ],
                            timeout: 60 * 1000, //延長timeout
                        })
                        await page.setViewport(viewport)

                        // //delay 3s for highchart rendered
                        // await page.waitFor(3000)

                        //screenshot
                        await page.screenshot({
                            path: fpPng,
                            timeout: 60 * 1000, //延長timeout
                        })

                    })
                        .catch((err) => {
                            //已全攔截, 預期不會有catch
                            if (writeError) {
                                fs.writeFileSync(`./_err_${id}_supplyPage.json`, err.message, 'utf8')
                            }
                        })

                })
                    .catch((err) => {
                        //已全攔截, 預期不會有catch
                        if (writeError) {
                            fs.writeFileSync(`./_err_${id}_supplyBrowser.json`, err.message, 'utf8')
                        }
                    })

                //check
                if (get(resBrowser, 'state', '') === 'error') {
                    return //有錯誤, 錯誤已儲存於resBrowser故直接跳出
                }

                //check, chrome雖未出錯, 但仍有可能screenshot時未能存出fpPng, 故須此處偵測
                if (!fsIsFile(fpPng)) {
                    earrsSpe.push({
                        anchor: 'fsIsFile(fpPng)',
                        err: new Error(`no file[${fpPng}]`),
                    })
                    return //新錯誤, 儲存錯誤至errs並跳出
                }

                //readFileSync
                try {
                    b64 = fs.readFileSync(fpPng, { encoding: 'base64' })
                }
                catch (err) {
                    earrsSpe.push({
                        anchor: `fs.readFileSync(fpPng, { encoding: 'base64' })`,
                        err,
                    })
                    return //新錯誤, 儲存錯誤至errs並跳出
                }

                return null
            })
                .catch((err) => {
                    //已全攔截, 預期不會有catch
                    if (writeError) {
                        fs.writeFileSync(`./_err_${id}_supplyHtml.json`, err.message, 'utf8')
                    }
                })

            //merge earrs
            if (get(resHtml, 'state', '') === 'error') {
                earrs = [
                    ...earrs,
                    ...resHtml.msg,
                ]
            }
            if (get(resBrowser, 'state', '') === 'error') {
                earrs = [
                    ...earrs,
                    ...resBrowser.msg,
                ]
            }
            if (get(resPage, 'state', '') === 'error') {
                earrs = [
                    ...earrs,
                    ...resPage.msg,
                ]
            }
            if (size(earrsSpe) > 0) {
                earrs = [
                    ...earrs,
                    ...earrsSpe,
                ]
            }
            //長期運行安裝版chrome可能會發生之錯誤:
            // Navigating frame was detached in fun(page)
            // Navigation timeout of 30000 ms exceeded in fun(page)
            // Target.createTarget timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed. in browser.newPage()
            // Page.captureScreenshot timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed. in fun(page)
            // Network.enable timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed. in browser.newPage()
            // Timed out after waiting 30000ms in browser.newPage()
            // Timed out after 30000 ms while waiting for the WS endpoint URL to appear in stdout! in puppeteer.launch(puppeteerOpt)
            // EBUSY: resource busy or locked, unlink 'C:\Windows\TEMP\puppeteer_dev_chrome_profile-JqNjnX\first_party_sets.db-journal' in browser.close()
            // EBUSY: resource busy or locked, unlink 'C:\Windows\TEMP\puppeteer_dev_chrome_profile-vl41VZ\first_party_sets.db' in browser.close()

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

        //core
        await core()
            .then((res) => {
                b64 = res
            })
            .catch((err) => {
                errTemp = err
            })
            .finally(() => {

                //fpHtml
                let fpHtml = path.resolve(fdHtml, `whweb_${id}.html`)
                if (fsIsFile(fpHtml)) {
                    fsDeleteFile(fpHtml)
                }
                if (fsIsFile(fpHtml) && writeError) {
                    let fpJson = path.resolve(fdErr, `err_${id}_fpHtml.json`)
                    fs.writeFileSync(fpJson, `can not delete html[whweb_${id}.html}]`, 'utf8')
                }

                //fdUserData
                let fdUserData = path.resolve(fdProfile, `profile_${id}`)
                if (fsIsFolder(fdUserData)) {
                    fsDeleteFolder(fdUserData)
                }
                if (fsIsFolder(fdUserData) && writeError) {
                    let fpJson = path.resolve(fdErr, `err_${id}_fdUserData.json`)
                    fs.writeFileSync(fpJson, `can not delete fdUserData[profile_${id}]`, 'utf8')
                }

                //fpPng
                let fpPng = path.resolve(fdPng, `whpic_${id}.png`)
                if (fsIsFile(fpPng)) {
                    fsDeleteFile(fpPng)
                }
                if (fsIsFile(fpPng) && writeError) {
                    let fpJson = path.resolve(fdErr, `err_${id}_fpPng.json`)
                    fs.writeFileSync(fpJson, `can not delete png[whpic_${id}.png]`, 'utf8')
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


export default WHtml2png
