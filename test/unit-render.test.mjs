import './tools/fetchBlock.mjs'
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import WHtml2png from '../src/WHtml2png.mjs'
import { decodePng, classifyCenter } from './tools/png.mjs'


//規則R1: 內容中之$樣式與佔位字樣於頁面中逐字呈現; 頁內自檢後塗色: 綠=逐字, 紅=被改寫, 白=腳本壞掉; 自檢碼本身以字元碼組期望字串


let codes = (s) => `String.fromCharCode(${[...s].map((c) => c.charCodeAt(0)).join(',')})`
let paint = (cond) => `document.body.style.background = (${cond}) ? "rgb(0,255,0)" : "rgb(255,0,0)";`
let onload = (body) => `window.addEventListener("load", function () { ${body} });`


let draw = async (html, opt) => {
    let b64 = await WHtml2png(200, 100, 1, html, { mode: 'alive', retry: 1, ...opt })
    let img = decodePng(b64)
    assert.strict.equal(`${img.width}x${img.height}`, '200x100')
    return classifyCenter(img)
}


describe('unit-render', function() {

    before(function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
    })

    after(async function() {
        await WHtml2png.close()
    })

    for (let tok of ['plain', '$&', '$\'', '$`', '$$']) {
        it(`execJsPost string literal with ${tok} is verbatim`, async function() {
            let val = `A${tok}B`
            let c = await draw('<div></div>', { execJsPost: `var s = "${val}"; ${paint(`s === ${codes(val)}`)}` })
            assert.strict.equal(c, 'green')
        })
    }

    for (let tok of ['$&', '$$']) {
        it(`execJsHead string literal with ${tok} is verbatim`, async function() {
            let val = `A${tok}B`
            let c = await draw('<div></div>', { execJsHead: `var s = "${val}"; ${onload(paint(`s === ${codes(val)}`))}` })
            assert.strict.equal(c, 'green')
        })
    }

    for (let tok of ['$&', '{cExecJsPost}']) {
        it(`html text with ${tok} is verbatim`, async function() {
            let val = `A${tok}B`
            let c = await draw(`<p id="t">${val}</p>`, { execJsPost: onload(paint(`document.getElementById("t").childNodes[0].nodeValue === ${codes(val)}`)) })
            assert.strict.equal(c, 'green')
        })
    }

    it('injected library code (lodash.min.js contains "\\$&") works', async function() {
        let code = fs.readFileSync(path.resolve('./node_modules/lodash/lodash.min.js'), 'utf8')
        assert.ok(code.includes('$&'))
        let c = await draw('<div></div>', {
            execJsHead: code,
            execJsPost: paint(`_.escapeRegExp("a.b") === "a" + String.fromCharCode(92) + ".b"`),
        })
        assert.strict.equal(c, 'green')
    })

})
