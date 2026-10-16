import './tools/fetchBlock.mjs'
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import WHtml2png from '../src/WHtml2png.mjs'
import runChild from './tools/child.mjs'


//規則R12: alive只有瀏覽器層錯誤才重啟常駐瀏覽器(其他並發呼叫不受頁面層錯誤牽連); WHtml2png.close()後, close前開始之呼叫不再重試重啟, 行程可自然結束
let fdTest = path.resolve('./test/_tmp/alive')
let fpChild = fileURLToPath(new URL('./tools/childDraw.mjs', import.meta.url))
let fpSrc = fileURLToPath(new URL('../src/WHtml2png.mjs', import.meta.url))
// eslint-disable-next-line no-new-func
let waitMs = (ms) => new Function(`window.__t0 = window.__t0 || Date.now(); return Date.now() - window.__t0 > ${ms}`)


describe('unit-alive', function() {

    before(function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        fs.rmSync(fdTest, { recursive: true, force: true })
        fs.mkdirSync(fdTest, { recursive: true })
    })

    after(async function() {
        await WHtml2png.close()
        fs.rmSync(fdTest, { recursive: true, force: true })
    })

    it('a page-level failure of one call does not break concurrent calls', async function() {
        let html = '<div style="width:100px;height:50px;background:blue"></div>'
        let ok1 = WHtml2png(100, 50, 1, html, { mode: 'alive', retry: 1, funPageWait: waitMs(2500) })
        let ok2 = WHtml2png(100, 50, 1, html, { mode: 'alive', retry: 1, funPageWait: waitMs(2500) })
        //funGetUrl延遲1.5秒後失敗(此時ok1、ok2正在頁內等待), 為頁面層錯誤, 不得關閉共用瀏覽器
        let bad = WHtml2png(100, 50, 1, html, {
            mode: 'alive',
            retry: 2,
            fdHtml: path.join(fdTest, 'html'),
            funGetUrl: () => new Promise((resolve, reject) => setTimeout(() => reject('fail-on-purpose'), 1500)),
        })
        let rs = await Promise.allSettled([ok1, ok2, bad])
        assert.strict.equal(rs[0].status, 'fulfilled', String(rs[0].reason))
        assert.strict.equal(rs[1].status, 'fulfilled', String(rs[1].reason))
        assert.strict.equal(rs[2].status, 'rejected')
        assert.ok(String(rs[2].reason).includes('fail-on-purpose'))
    })

    it('close() while awaiting funGetUrl: no browser is launched and the process exits soon', async function() {
        let code = 'const W = (await import(__MOD__)).default\nconst { pathToFileURL } = await import(\'url\')\nsetTimeout(() => { W.close() }, 1000)\nlet t0 = Date.now()\nlet r = await W(100, 50, 1, \'<div>x</div>\', { mode: \'alive\', retry: 3, fdHtml: __FD__, funGetUrl: (fp) => new Promise((res) => setTimeout(() => res(pathToFileURL(fp).href), 2000)) })\n    .then(() => ({ ok: true }), (e) => ({ ok: false, err: String(e) }))\nr.ms = Date.now() - t0\nconsole.log(\'RESULT \' + JSON.stringify(r))'
            .replace('__MOD__', JSON.stringify(new URL('../src/WHtml2png.mjs', import.meta.url).href))
            .replace('__FD__', JSON.stringify(path.join(fdTest, 'html2')))
        let fpScript = path.join(fdTest, 'close-during-url.mjs')
        fs.writeFileSync(fpScript, code)
        let r = await runChild(fpScript, { timeoutMs: 40000 })
        assert.strict.equal(r.timedOut, false, 'child did not exit (browser launched after close)')
        assert.ok(r.result, r.out.slice(-500))
        assert.strict.equal(r.result.ok, false)
        assert.ok(/aborted by WHtml2png.close/.test(r.result.err), r.result.err)
    })

    it('close() during an in-flight call: no relaunch and the process exits soon', async function() {
        let cfg = { mod: fpSrc, opt: { mode: 'alive', retry: 3 }, funPageWaitMs: 4000, closeAfterMs: 1500 }
        let r = await runChild(fpChild, { env: { CHILD_CFG: JSON.stringify(cfg) }, timeoutMs: 40000 })
        assert.strict.equal(r.timedOut, false, 'child did not exit (resident browser relaunched or idle timer pending)')
        assert.ok(r.result, r.out.slice(-500))
        assert.strict.equal(r.result.ok, false)
        assert.ok(r.ms < 30000)
    })

})
