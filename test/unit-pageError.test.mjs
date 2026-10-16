import './tools/fetchBlock.mjs'
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { pathToFileURL } from 'url'
import WHtml2png from '../src/WHtml2png.mjs'
import { decodePng, countNonWhite } from './tools/png.mjs'


//規則R7: opt.rejectOnPageError=true時, 頁面端未捕捉之例外(同步、語法錯、非同步、未處理之rejection)使該次失敗並reject字串(含頁面錯誤); 預設false維持出圖


let html = '<div id="c" style="width:200px;height:100px;"></div>'
let draw = 'document.getElementById("c").style.background = "rgb(0,0,255)";'
let cases = [
    { id: 'sync throw', post: `throw new Error("boom1"); ${draw}`, msg: 'boom1' },
    { id: 'syntax error', post: `var a = ; ${draw}`, msg: 'Unexpected token' },
    { id: 'async throw', post: 'setTimeout(function () { throw new Error("late2") }, 50);', msg: 'late2' },
    { id: 'unhandled rejection', post: 'Promise.reject(new Error("rej3"));', msg: 'rej3' },
]


describe('unit-pageError', function() {

    before(function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
    })

    after(async function() {
        await WHtml2png.close()
    })

    it('control: no page error renders with rejectOnPageError=true', async function() {
        let b64 = await WHtml2png(200, 100, 1, html, { mode: 'alive', retry: 1, rejectOnPageError: true, execJsPost: draw })
        assert.ok(countNonWhite(decodePng(b64)) > 10000)
    })

    it('page errors are retried according to retry', async function() {
        let n = 0
        let fdHtml = path.resolve('./test/_tmp/pageError')
        fs.mkdirSync(fdHtml, { recursive: true })
        let err = null
        await WHtml2png(100, 50, 1, html, {
            retry: 2,
            rejectOnPageError: true,
            execJsPost: 'throw new Error("again")',
            fdHtml,
            funGetUrl: (fp) => {
                n++
                return pathToFileURL(fp).href
            },
        }).catch((e) => {
            err = e
        })
        fs.rmSync(fdHtml, { recursive: true, force: true })
        assert.strict.equal(n, 2)
        assert.ok(String(err).includes('again'))
    })

    for (let c of cases) {

        it(`${c.id}: rejectOnPageError=true rejects with page error message`, async function() {
            let err = null
            await WHtml2png(200, 100, 1, html, { mode: 'alive', retry: 1, rejectOnPageError: true, execJsPost: c.post })
                .catch((e) => {
                    err = e
                })
            assert.strict.equal(typeof err, 'string')
            assert.ok(err.includes('page error') && err.includes(c.msg), err)
        })

        it(`${c.id}: default keeps resolving (backward compatible)`, async function() {
            let b64 = await WHtml2png(200, 100, 1, html, { mode: 'alive', retry: 1, execJsPost: c.post })
            assert.ok(typeof b64 === 'string' && b64.length > 0)
        })

    }

})
