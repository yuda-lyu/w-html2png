import './tools/fetchBlock.mjs'
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import WHtml2png from '../src/WHtml2png.mjs'
import errToMsg from '../src/errToMsg.mjs'
import runChild from './tools/child.mjs'
import { setBinEnv } from './tools/binEnv.mjs'


//規則R6: reject一律字串且保留原因、去除ANSI、寫錯誤檔失敗不覆蓋原因; 規則R15: 給executablePath時不限平台
let fdTest = path.resolve('./test/_tmp/errors')
let fpChild = fileURLToPath(new URL('./tools/childDraw.mjs', import.meta.url))
let fpFakePlatform = fileURLToPath(new URL('./tools/fakePlatform.mjs', import.meta.url))
let fpSrc = fileURLToPath(new URL('../src/WHtml2png.mjs', import.meta.url))


describe('unit-errors', function() {

    let restoreBin = null

    before(async function() {
        fs.rmSync(fdTest, { recursive: true, force: true })
        fs.mkdirSync(fdTest, { recursive: true })
        if (process.platform === 'win32') {
            restoreBin = await setBinEnv('errorsMirror') //套件自帶之chrome由本機鏡像經ensureBins取得, 不連外網
        }
    })

    after(function() {
        fs.rmSync(fdTest, { recursive: true, force: true })
        if (restoreBin) {
            restoreBin()
        }
    })

    it('errToMsg: Error, string, null, object and ANSI codes', function() {
        assert.strict.equal(errToMsg(new Error('e1')), 'e1')
        assert.strict.equal(errToMsg('s1'), 's1')
        assert.strict.equal(errToMsg(null), 'null')
        assert.strict.equal(errToMsg({ message: 'm1' }), 'm1')
        assert.strict.equal(errToMsg('a\u001b[2mb\u001b[22mc'), 'abc')
        let e = new Error('x')
        e.message = 123
        assert.strict.equal(errToMsg(e), '123')
        assert.strict.equal(errToMsg({ message: null }), 'null')
        assert.strict.equal(errToMsg(Symbol('s')), 'Symbol(s)')
    })

    it('unexpected input (Symbol in stylesHead) still rejects with a string', async function() {
        let fpDummy = path.join(fdTest, 'dummy2.exe')
        fs.writeFileSync(fpDummy, 'x')
        let err = null
        await WHtml2png(100, 50, 1, '<div>x</div>', { executablePath: fpDummy, retry: 1, stylesHead: [Symbol('x')] }).catch((e) => {
            err = e
        })
        assert.strict.equal(typeof err, 'string')
    })

    it('rejectOnPageError: page errors are kept when waiting fails', async function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        let err = null
        await WHtml2png(100, 50, 1, '<div>x</div>', {
            retry: 1,
            rejectOnPageError: true,
            execJsPost: 'throw new Error("boom-before-wait")',
            funPageWait: () => {
                return window.notDefinedFlag.ready
            },
        }).catch((e) => {
            err = e
        })
        assert.strict.equal(typeof err, 'string')
        assert.ok(err.includes('boom-before-wait') && err.includes('pageerror'), err)
    })

    it('invalid executablePath rejects with string', async function() {
        let err = null
        await WHtml2png(100, 50, 1, '<div>x</div>', { executablePath: path.join(fdTest, 'not-exist.exe') }).catch((e) => {
            err = e
        })
        assert.strict.equal(typeof err, 'string')
        assert.ok(err.includes('invalid opt.executablePath'), err)
    })

    it('funGetUrl rejecting with a string keeps the reason', async function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        let err = null
        await WHtml2png(100, 50, 1, '<div>x</div>', { retry: 1, fdHtml: path.join(fdTest, 'html'), funGetUrl: () => Promise.reject('my-reason-str') }).catch((e) => {
            err = e
        })
        assert.strict.equal(typeof err, 'string')
        assert.ok(err.includes('my-reason-str') && err.includes('funGetUrl'), err)
    })

    it('writeError failing to write does not override the original reason', async function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        let fpFile = path.join(fdTest, 'iam-a-file')
        fs.writeFileSync(fpFile, 'x')
        let err = null
        await WHtml2png(100, 50, 1, '<div>x</div>', {
            retry: 1,
            writeError: true,
            fdErr: path.join(fpFile, 'sub'),
            fdHtml: path.join(fdTest, 'html'),
            funGetUrl: () => {
                throw new Error('orig-reason')
            }
        }).catch((e) => {
            err = e
        })
        assert.strict.equal(typeof err, 'string')
        assert.ok(err.includes('orig-reason'), err)
        assert.ok(err.includes('can not write error file'), err)
    })

    it('non-windows without executablePath rejects with platform message', async function() {
        let r = await runChild(fpChild, { preload: [fpFakePlatform], env: { FAKE_PLATFORM: 'linux', CHILD_CFG: JSON.stringify({ mod: fpSrc }) } })
        assert.ok(r.result, r.out.slice(-500))
        assert.strict.equal(r.result.ok, false)
        assert.ok(/operating system is not windows/.test(r.result.err), r.result.err)
        assert.ok(/executablePath/.test(r.result.err))
    })

    it('non-windows with executablePath passes the platform check', async function() {
        let fpDummy = path.join(fdTest, 'dummy-browser.exe')
        fs.writeFileSync(fpDummy, 'not a browser')
        let r = await runChild(fpChild, { preload: [fpFakePlatform], env: { FAKE_PLATFORM: 'linux', CHILD_CFG: JSON.stringify({ mod: fpSrc, opt: { executablePath: fpDummy, retry: 1 } }) } })
        assert.ok(r.result, r.out.slice(-500))
        assert.strict.equal(r.result.ok, false) //假執行檔必然啟動失敗
        assert.ok(!/operating system is not windows/.test(r.result.err), r.result.err)
        assert.ok(/strategy\.acquire/.test(r.result.err), r.result.err)
    })

})
