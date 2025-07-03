import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'
import kill from 'tree-kill'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import isnum from 'wsemi/src/isnum.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import ispm from 'wsemi/src/ispm.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'
import now2strp from 'wsemi/src/now2strp.mjs'
import genID from 'wsemi/src/genID.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsDeleteFolderSafe from 'wsemi/src/fsDeleteFolderSafe.mjs'
import downloadFiles from './downloadFiles.mjs'


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
 * @param {String} [opt.executablePath='chrome免安裝版執行檔路徑'] 輸入puppeteer的executablePath字串，預設'chrome免安裝版執行檔路徑'
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

    //check chrome, 若chrome不存在則由分拆zip檔解壓縮出來用
    if (!fsIsFile(fpExe)) {

        //downloadFiles
        await downloadFiles(fdBase)

    }

    //executablePath
    let executablePath = get(opt, 'executablePath', '')
    if (!isestr(executablePath)) {
        executablePath = fpExe //`./portable/App/Chrome-bin/138.0.7204.97/chrome.exe`
    }

    //executableFolder
    // let executableFolder = get(opt, 'executableFolder', '')
    // if (isestr(executableFolder) && !isestr(executablePath)) {
    //     //executablePath='C:\\Users\\user\\.cache\\puppeteer\\chrome\\win64-116.0.5845.96\\chrome-win64\\chrome.exe'
    //     //executableFolder='C:\\Users\\user\\.cache\\puppeteer'
    //     let fps = fsTreeFolder(executableFolder, null)
    //     let r = find(fps, (v) => {
    //         return v.name === 'chrome.exe'
    //     })
    //     // console.log('r', r)
    //     if (iseobj(r)) {
    //         executablePath = r.path
    //     }
    //     else {
    //         throw new Error(`can not find chrome.exe in executableFolder[${executableFolder}]`)
    //     }
    // }

    //wd
    let wd = process.cwd()

    //id
    let id = `${now2strp()}-${genID()}`

    //supplyHtml
    let supplyHtml = async (fun) => {
        let earrs = []

        //fnOut
        let fnOut = `./whpic-${id}.png` //一定要給副檔名, 否則puppeteer的screenshot會無法識別格式

        //fpOut
        let fpOut = path.resolve(wd, fnOut) //bbb
        // console.log('fpOut', fpOut)

        //fnHtml
        let fnHtml = `./whweb-${id}.html`

        //fpHtml
        let fpHtml = path.resolve(wd, fnHtml) //bbb
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
                let r = fun(fpHtml, fpOut)
                if (ispm(r)) {
                    r = await r
                }
            }
            catch (err) {
                //try catch也能攔截async函數
                earrs.push({
                    anchor: 'fun(fpHtml, fpOut)',
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
        if (fsIsFile(fpOut)) {
            try {
                fs.unlinkSync(fpOut)
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

        //fd
        let fd = `./_puppeteer_profile_${id}`
        // console.log('fd', fd)

        //puppeteerOpt
        let puppeteerOpt = {
            headless: modeHeadless,
            slowMo: 20,
            protocolTimeout: 60 * 1000, //延長protocol timeout
            // dumpio: true, //console.log chrome的stdout/stderr訊息
            userDataDir: fd,
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
            try {
                kill(pid, 'SIGKILL')
                // console.log('kill', r)
            }
            catch (err) {
                // console.log(err)
                //若有正常關閉會無法kill pid, 故不須儲存錯誤
                // earrs.push({
                //     anchor: `kill(pid, 'SIGKILL')`,
                //     err,
                // })
            }
        }

        //fsDeleteFolderSafe
        if (true) {
            try {
                await fsDeleteFolderSafe(fd)
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

    //core
    let core = async () => {
        let earrs = []
        let earrsSpe = []

        //b64
        let b64 = ''
        let resHtml = null
        let resBrowser = null
        let resPage = null

        //supplyHtml
        resHtml = await supplyHtml(async(fpHtml, fpOut) => {

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
                    await page.goto(fpHtml, {
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
                        path: fpOut,
                        timeout: 60 * 1000, //延長timeout
                    }) //fullPage: true

                })
                    .catch((err) => {
                        //已全攔截, 預期不會有catch
                        fs.writeFileSync(`./_err_${id}_supplyPage.json`, err.message, 'utf8')
                    })

            })
                .catch((err) => {
                    //已全攔截, 預期不會有catch
                    fs.writeFileSync(`./_err_${id}_supplyBrowser.json`, err.message, 'utf8')
                })

            //check
            if (get(resBrowser, 'state', '') === 'error') {
                return //有錯誤, 錯誤已儲存於resBrowser故直接跳出
            }

            //check, chrome雖未出錯, 但仍有可能screenshot時未能存出fpOut, 故須此處偵測
            if (!fsIsFile(fpOut)) {
                earrsSpe.push({
                    anchor: 'fsIsFile(fpOut)',
                    err: new Error(`no file[${fpOut}]`),
                })
                return //新錯誤, 儲存錯誤至errs並跳出
            }

            //readFileSync
            try {
                b64 = fs.readFileSync(fpOut, { encoding: 'base64' })
            }
            catch (err) {
                earrsSpe.push({
                    anchor: `fs.readFileSync(fpOut, { encoding: 'base64' })`,
                    err,
                })
                return //新錯誤, 儲存錯誤至errs並跳出
            }

            return null
        })
            .catch((err) => {
                //已全攔截, 預期不會有catch
                fs.writeFileSync(`./_err_${id}_supplyHtml.json`, err.message, 'utf8')
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
        //長期運行可能發生之錯誤:
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

            if (true) {
                let cm = ''
                each(earrs, (v) => {
                    let m = get(v, 'err.message', '')
                    cm += m + '\n'
                })
                fs.writeFileSync(`./_err_${id}_earrs.json`, cm, 'utf8')
            }

            //err
            let earr = earrs[0]
            // console.log('earrs', earr)
            let err = `${earr.err.message} in ${earr.anchor}`

            return Promise.reject(err)
        }

        //check
        if (!isestr(b64)) {
            return Promise.reject(`b64 is not an effective string`)
        }

        return b64
    }

    //b64
    let b64 = await core()
        // .catch((err) => { //錯誤直接往外傳
        // })
        .finally(() => {

            //fnHtml
            let fnHtml = `./whweb-${id}.html`
            if (fsIsFile(fnHtml)) {
                fs.writeFileSync(`./_err_${id}_fsIsFile_fnHtml.json`, `html檔[${fnHtml}]未正常刪除`, 'utf8')
            }

            //fd
            let fd = `./_puppeteer_profile_${id}`
            if (fsIsFolder(fd)) {
                fs.writeFileSync(`./_err_${id}_fsIsFolder_profile.json`, `profile資料夾[${fd}]未正常刪除`, 'utf8')
            }

            //fnOut
            let fnOut = `./whpic-${id}.png`
            if (fsIsFile(fnOut)) {
                fs.writeFileSync(`./_err_${id}_fsIsFile_fnPng.json`, `png檔[${fnOut}]未正常刪除`, 'utf8')
            }

        })

    return b64
}


export default WHtml2png
