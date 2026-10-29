import './tools/fetchBlock.mjs'
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { pathToFileURL } from 'url'
import WHtml2png from '../src/WHtml2png.mjs'
import { decodePng, classifyCenter } from './tools/png.mjs'
import { setBinEnv } from './tools/binEnv.mjs'


//已知限制(文件化): 未給funGetUrl時以setContent(about:blank)載入, html內本機file://與相對路徑資源不載入; data url與funGetUrl(goto file://)可載入
let fdTest = path.resolve('./test/_tmp/localRes')
let probe = 'window.addEventListener("load", function () { var i = document.getElementById("i"); document.body.style.background = (i.naturalWidth > 0) ? "rgb(0,255,0)" : "rgb(255,0,0)"; });'


describe('unit-localRes', function() {

    let fpImg = null
    let dataUrl = ''
    let restoreBin = null

    before(async function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        restoreBin = await setBinEnv('localResMirror') //套件自帶之chrome由本機鏡像經ensureBins取得, 不連外網
        fs.rmSync(fdTest, { recursive: true, force: true })
        fs.mkdirSync(path.join(fdTest, 'html'), { recursive: true })
        let b = Buffer.from(fs.readFileSync(path.resolve('./test/test-scla.b64'), 'utf8'), 'base64')
        fpImg = path.join(fdTest, 'img.png')
        fs.writeFileSync(fpImg, b)
        fs.writeFileSync(path.join(fdTest, 'html', 'rel.png'), b)
        dataUrl = `data:image/png;base64,${b.toString('base64')}`
    })

    after(async function() {
        await WHtml2png.close()
        fs.rmSync(fdTest, { recursive: true, force: true })
        if (restoreBin) {
            restoreBin()
        }
    })

    let draw = async (src, opt = {}) => {
        let b64 = await WHtml2png(200, 100, 1, `<img id="i" src="${src}" style="width:10px;height:10px">`, { mode: 'alive', retry: 1, execJsPost: probe, ...opt })
        return classifyCenter(decodePng(b64))
    }

    it('setContent: data url image loads', async function() {
        assert.strict.equal(await draw(dataUrl), 'green')
    })

    it('setContent: file:// image does not load (documented limitation)', async function() {
        assert.strict.equal(await draw(pathToFileURL(fpImg).href), 'red')
    })

    it('setContent: relative path image does not load (documented limitation)', async function() {
        assert.strict.equal(await draw('rel.png'), 'red')
    })

    it('funGetUrl (goto file://): relative path image loads', async function() {
        let c = await draw('rel.png', { fdHtml: path.join(fdTest, 'html'), funGetUrl: (fp) => pathToFileURL(fp).href })
        assert.strict.equal(c, 'green')
    })

})
