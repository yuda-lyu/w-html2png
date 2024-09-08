import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import find from 'lodash-es/find.js'
import isnum from 'wsemi/src/isnum.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'
import now2strp from 'wsemi/src/now2strp.mjs'
import genID from 'wsemi/src/genID.mjs'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
// import fsCopyFolder from 'wsemi/src/fsCopyFolder.mjs'


//已不須自動複製chromium, node_modules/puppeteer/.local-chromium/win64-884014


//wd
let wd = process.cwd()
// console.log('process.cwd()', wd)


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
 * @param {String} [opt.executablePath=''] 輸入puppeteer的executablePath字串，預設''
 * @param {String} [opt.executableFolder=''] 輸入不提供executablePath時則提供搜索chrome.exe所在資料夾字串，找到後將自動給予puppeteer的executablePath，預設''
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
        modeHeadless = 'shell' //shell為舊版, true為新版, 但新版會出現瞬間chrome白視窗會拿焦點, 故暫時預設舊版
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

    //executablePath
    let executablePath = get(opt, 'executablePath', '')
    //若不給則由puppeteer偵測取得或給executableFolder搜尋取得

    //executableFolder
    let executableFolder = get(opt, 'executableFolder', '')
    if (isestr(executableFolder) && !isestr(executablePath)) {
        //executablePath='C:\\Users\\user\\.cache\\puppeteer\\chrome\\win64-116.0.5845.96\\chrome-win64\\chrome.exe'
        //executableFolder='C:\\Users\\user\\.cache\\puppeteer'
        let fps = fsTreeFolder(executableFolder, null)
        let r = find(fps, (v) => {
            return v.name === 'chrome.exe'
        })
        // console.log('r', r)
        if (iseobj(r)) {
            executablePath = r.path
        }
        else {
            throw new Error(`can not find chrome.exe in executableFolder[${executableFolder}]`)
        }
    }

    //fnOut
    let fnOut = `./whpic-${now2strp()}-${genID()}.png` //一定要給副檔名, 否則puppeteer的screenshot會無法識別格式

    //fpOut
    let fpOut = path.resolve(wd, fnOut)
    // console.log('fpOut', fpOut)

    //fnHtml
    let fnHtml = `./whweb-${now2strp()}-${genID()}.html`

    //fpHtml
    let fpHtml = path.resolve(wd, fnHtml)
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
    fs.writeFileSync(fpHtml, g, 'utf8')

    //b64
    let b64 = ''
    let core = async () => {

        //puppeteerOpt
        let puppeteerOpt = {
            headless: modeHeadless,
            slowMo: 20,
        }
        if (isestr(executablePath)) {
            puppeteerOpt.executablePath = executablePath
        }

        //browser
        let browser = await puppeteer.launch(puppeteerOpt)

        //page
        let page = await browser.newPage()

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
        await page.goto(fpHtml)
        await page.setViewport(viewport)

        // //delay 3s for highchart rendered
        // await page.waitFor(3000)

        //screenshot
        await page.screenshot({ path: fpOut }) //fullPage: true

        //close
        // await page.close()
        await browser.close()

        //readFileSync
        b64 = fs.readFileSync(fpOut, { encoding: 'base64' })

    }
    await core()
        .catch((err) => {
            console.log(err)
        })

    //delete
    if (fsIsFile(fpHtml)) {
        fs.unlinkSync(fpHtml)
    }

    //delete
    if (fsIsFile(fpOut)) {
        fs.unlinkSync(fpOut)
    }

    return b64
}


export default WHtml2png
