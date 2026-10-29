import './tools/fetchBlock.mjs'
import assert from 'assert'
import { createRequire } from 'module'
import fs from 'fs'
import WHtml2png from '../src/WHtml2png.mjs'
import { resolveLibFile } from '../src/libRoutes.mjs'
import { decodePng, classifyCenter } from './tools/png.mjs'
import { setBinEnv, getChromeExe } from './tools/binEnv.mjs'


//規則R11: 模板之lodash(_)與wsemi(w)由本套件相依之本機檔案供應, 頁內版本等於已安裝版本; w-hc2png之用法(_.isObject、_.set)可用
let verLodash = createRequire(import.meta.url)('lodash/package.json').version
let paint = (cond) => `document.body.style.background = (${cond}) ? "rgb(0,255,0)" : "rgb(255,0,0)";`


describe('unit-cdnLibs', function() {

    let restoreBin = null

    before(async function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        restoreBin = await setBinEnv('cdnLibsMirror') //套件自帶之chrome由本機鏡像經ensureBins取得, 不連外網
    })

    after(async function() {
        await WHtml2png.close()
        if (restoreBin) {
            restoreBin()
        }
    })

    //離線(context.setOffline)時模板之函式庫仍可用: 證明由本機供應而非CDN
    it('offline context: template libraries are still served locally', async function() {
        let { chromium } = await import('playwright-core')
        let { default: routeLibs } = await import('../src/libRoutes.mjs')
        let { default: buildHtml } = await import('../src/buildHtml.mjs')
        let fpExe = await getChromeExe()
        let browser = await chromium.launch({ executablePath: fpExe, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
        try {
            let ctx = await browser.newContext()
            await routeLibs(ctx)
            await ctx.setOffline(true)
            let page = await ctx.newPage()
            await page.setContent(buildHtml({ html: '<div></div>' }), { waitUntil: 'load', timeout: 30000 })
            let r = await page.evaluate(() => [typeof window._ === 'function' ? window._.VERSION : null, typeof window.wsemi])
            assert.strict.deepStrictEqual(r, [verLodash, 'object'])
        }
        finally {
            await browser.close()
        }
    })

    for (let mode of ['single', 'alive']) {

        it(`${mode}: _ is the installed lodash ${verLodash}`, async function() {
            let b64 = await WHtml2png(100, 50, 1, '<div></div>', { mode, retry: 1, execJsPost: paint(`typeof _ === "function" && _.VERSION === "${verLodash}"`) })
            assert.strict.equal(classifyCenter(decodePng(b64)), 'green')
        })

        it(`${mode}: w (wsemi) is available and _.isObject/_.set work`, async function() {
            let cond = 'typeof w === "object" && typeof w.isestr === "function" && w.isestr("a") === true && (function () { var o = {}; _.set(o, "a.b", 1); return _.isObject(o) && o.a.b === 1 })()'
            let b64 = await WHtml2png(100, 50, 1, '<div></div>', { mode, retry: 1, execJsPost: paint(cond) })
            assert.strict.equal(classifyCenter(decodePng(b64)), 'green')
        })

    }

})


//規則R11: 本機檔案自本套件根解析(被打包進他套件時仍可得), 不可得時回傳null(routeLibs不攔截該網址, 維持自CDN載入)
describe('unit-cdnLibs resolveLibFile', function() {

    it('resolves installed lodash and wsemi files', function() {
        for (let mod of ['lodash/lodash.min.js', 'wsemi/dist/wsemi.umd.js']) {
            let fp = resolveLibFile(mod)
            assert.ok(fp && fs.existsSync(fp), mod)
        }
    })

    it('returns null for an unresolvable module', function() {
        assert.strict.equal(resolveLibFile('not-exist-pkg-zz/x.js'), null)
    })

})
