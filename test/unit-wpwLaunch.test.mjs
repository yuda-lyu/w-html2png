import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import wpw from 'w-playwright'
import WHtml2png from '../src/WHtml2png.mjs'
import { installFake } from './tools/fakeChromium.mjs'
import runChild from './tools/child.mjs'


//規則R19(sgud/rule/rulebook.md)、w-playwright之R-PW-ONLY與R-PW-WIRING: 本套件之瀏覽器一律經w-playwright啟動, 每個啟動點(single、alive)送出之選項含守門(恰一個--disable-features, 為args最後一個元素, 含Playwright預設清單與AutofillAiWalletPrivatePasses)
//本檔只用替身(setBrowserTypeForTest, 不呼叫next()), 不啟動任何瀏覽器; 接縫不用替身之真路徑(next()真啟動自帶chrome)見api-ensureBins〈WHtml2png gets chrome through ensureBins〉


let fdRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let exe = fileURLToPath(import.meta.url) //executablePath只需為存在之檔案(替身不啟動); 取非執行檔, 使未經替身之啟動於建立行程即失敗, 不起任何程式
let html = '<div>x</div>'

//ownArgs, 本套件之啟動參數(src/WHtml2png.mjs之getLaunchOpt): 遷移不得改變, 守門之串加在其後
let ownArgs = [
    '--lang=en-US',
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
]


//assertGuarded, 斷言替身收到之選項為w-playwright合併後者且含守門
let assertGuarded = (o, headless) => {
    let info = wpw.getPlaywrightInfo()
    let args = o.args

    //恰一個--disable-features(大小寫與單一連字號之變體皆計), 為args最後一個元素(Chromium只取最後一串)
    let nDis = args.filter((a) => /^--?disable-features(=|$)/i.test(a)).length
    assert.strict.equal(nDis, 1, JSON.stringify(args))
    let last = args[args.length - 1]
    assert.strict.equal(last.startsWith('--disable-features='), true, last)

    //其內含Playwright預設清單與守門功能
    let items = last.slice('--disable-features='.length).split(',')
    assert.strict.equal(info.guardFeatures.includes('AutofillAiWalletPrivatePasses'), true)
    for (let f of [...info.defaultDisableFeatures, ...info.guardFeatures]) {
        assert.strict.equal(items.includes(f), true, f)
    }

    //Playwright預設之那一串以ignoreDefaultArgs去掉(命令列上只剩本串)
    let ig = (o.ignoreDefaultArgs || []).filter((a) => typeof a === 'string' && a.startsWith('--disable-features='))
    assert.strict.equal(ig.length, 1, JSON.stringify(o.ignoreDefaultArgs))
    assert.strict.deepStrictEqual(ig[0].slice('--disable-features='.length).split(',').sort(), [...info.defaultDisableFeatures].sort())

    //本套件之其餘選項不變: 自身參數依原序在前、執行檔、無頭、啟動時限
    assert.strict.deepStrictEqual(args.slice(0, -1), ownArgs)
    assert.strict.equal(o.executablePath, exe)
    assert.strict.equal(o.headless, headless)
    assert.strict.equal(o.timeout, 60 * 1000)
}


describe('unit-wpwLaunch: every launch point of WHtml2png goes through w-playwright (R19, R-PW-WIRING)', function() {

    let env = null

    beforeEach(function() {
        env = installFake()
    })

    afterEach(async function() {
        await env.releaseAll()
        await WHtml2png.close()
        env.restore()
    })

    for (let mode of ['single', 'alive']) {

        it(`${mode}: the launch reaches the seam of w-playwright with the merged options holding the guard`, async function() {
            let b64 = await WHtml2png(100, 50, 1, html, { mode, executablePath: exe, retry: 1 })
            assert.strict.equal(b64, Buffer.from('fake-png').toString('base64')) //出圖經替身之瀏覽器
            assert.strict.equal(env.launchOpts.length, 1) //替身確被呼叫(依賴樹有兩份w-playwright時可能空過, 故須斷言)
            assertGuarded(env.launchOpts[0], true)
        })

        it(`${mode}: modeHeadless false is passed as headless false, still with the guard`, async function() {
            await WHtml2png(100, 50, 1, html, { mode, executablePath: exe, retry: 1, modeHeadless: false })
            assert.strict.equal(env.launchOpts.length, 1)
            assertGuarded(env.launchOpts[0], false)
        })

        it(`${mode}: a failed launch rejects with the string "[E_LAUNCH] browser launch failed" (code of w-playwright kept)`, async function() {
            env.cfg.launch = 'throw'
            let err = await WHtml2png(100, 50, 1, html, { mode, executablePath: exe, retry: 1 }).then(() => null, (e) => e)
            assert.strict.equal(typeof err, 'string') //既有之reject型態為字串(規則R6)
            assert.strict.equal(err.includes('[E_LAUNCH] browser launch failed'), true, err)
            assert.strict.equal(err.includes('fake launch failure'), false, err) //原錯誤不附於對外訊息(w-playwright錯誤契約)
            assert.strict.equal(env.launchOpts.length, 1)
        })

    }

    it(`alive: concurrent calls share one launch through w-playwright`, async function() {
        let rs = await Promise.all([1, 2, 3].map(() => WHtml2png(100, 50, 1, html, { mode: 'alive', executablePath: exe, retry: 1 })))
        assert.strict.equal(rs.length, 3)
        assert.strict.equal(env.launchOpts.length, 1)
        assertGuarded(env.launchOpts[0], true)
    })

})


describe('unit-wpwLaunch: logon guard refuses before the browser starts (R19)', function() {
    this.timeout(60000)

    //子行程: 登入守門開啟且使錯誤次數讀不到(USERDOMAIN不等於COMPUTERNAME即不視為本機帳號, w-playwright README〈執行期登入守門〉), 守門於啟動前拒絕
    //守門之環境變數: 本行程已開啟者原樣繼承(不覆寫), 未開啟者才於子行程設為'1'(只開不關)
    let fpChild = fileURLToPath(new URL('./tools/childGuard.mjs', import.meta.url))
    let domain = 'whtml2png-test-not-local'
    let guardOn = !['', '0', 'false'].includes(String(process.env.W_PLAYWRIGHT_LOGON_GUARD ?? ''))

    for (let mode of ['single', 'alive']) {
        it(`${mode}: rejects with "[E_LOGON_GUARD] ..." and the BrowserType is never called`, async function() {
            assert.notStrictEqual(String(process.env.COMPUTERNAME || '').toLowerCase(), domain)
            let envChild = { USERDOMAIN: domain, CHILD_MODE: mode }
            if (!guardOn) {
                envChild.W_PLAYWRIGHT_LOGON_GUARD = '1'
            }
            let r = await runChild(fpChild, { cwd: fdRepo, env: envChild })
            assert.ok(r.result, r.out.slice(-2000))
            assert.strict.equal(r.result.ok, false)
            assert.strict.equal(r.result.errType, 'string')
            assert.strict.equal(r.result.err.includes('[E_LOGON_GUARD] logon guard:'), true, r.result.err)
            assert.strict.equal(r.result.nLaunch, 0)
        })
    }

})


describe('unit-wpwLaunch: dependencies and build go through w-playwright only (R19, R-PW-ONLY)', function() {

    let pkg = JSON.parse(fs.readFileSync(path.join(fdRepo, 'package.json'), 'utf8'))

    it('package.json declares w-playwright ^1.0.1 and neither playwright nor playwright-core', function() {
        assert.strict.equal(pkg.dependencies['w-playwright'], '^1.0.1')
        for (let k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            let o = pkg[k] || {}
            assert.strict.equal(Object.prototype.hasOwnProperty.call(o, 'playwright'), false, k)
            assert.strict.equal(Object.prototype.hasOwnProperty.call(o, 'playwright-core'), false, k)
        }
    })

    it('the installed w-playwright is 1.0.1 or later and its playwright-core matches its bundled defaults table', function() {
        let v = JSON.parse(fs.readFileSync(path.join(fdRepo, 'node_modules', 'w-playwright', 'package.json'), 'utf8')).version
        let [a, b, c] = v.split('.').map((s) => parseInt(s, 10))
        assert.strict.equal(a > 1 || (a === 1 && (b > 0 || c >= 1)), true, v)
        assert.strict.equal(wpw.getPlaywrightInfo().tableMatch, true)
    })

    it('own source files (src, test, toolg and the root) import neither playwright nor playwright-core (static, side-effect, dynamic or require, across lines)', function() {
        //R-PW-ONLY(w-playwright sgud/rule/rulebook.md)之正則, 另補其未涵蓋之寫法: 副作用匯入(import 'x')、import與require與括號間之空白、跨行(\s含換行, 以整檔比對)
        let re = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"`]playwright(-core)?['"`/]/g
        //防空集合: 正則對已知正例須命中(以字串串接組成, 使本檔不命中自己)
        let q = '\''
        let samples = [
            'import { chromium } from ' + q + 'playwright-core' + q,
            'export { chromium } from ' + q + 'playwright' + q,
            'import ' + q + 'playwright-core' + q,
            'await import(' + q + 'playwright' + q + ')',
            'await import (\n    ' + q + 'playwright-core' + q + '\n)',
            'require(' + q + 'playwright-core/lib/x' + q + ')',
            'require (\n' + q + 'playwright' + q + ')',
        ]
        for (let s of samples) {
            re.lastIndex = 0
            assert.strict.equal(re.test(s), true, s)
        }
        //範圍: 本套件根之全部自有檔(.mjs/.js/.cjs), 排除相依、產物與暫存(node_modules、dist、docs、bin-cache、tmp、test/_tmp、.git)
        let skip = new Set(['node_modules', 'dist', 'docs', 'bin-cache', 'tmp', '_tmp', '.git'])
        let fps = []
        let walk = (fd) => {
            for (let d of fs.readdirSync(fd, { withFileTypes: true })) {
                let fp = path.join(fd, d.name)
                if (d.isDirectory()) {
                    if (!skip.has(d.name)) {
                        walk(fp)
                    }
                }
                else if (/\.(mjs|js|cjs)$/.test(d.name)) {
                    fps.push(fp)
                }
            }
        }
        walk(fdRepo)
        let rel = fps.map((fp) => path.relative(fdRepo, fp).split(path.sep).join('/'))
        for (let must of ['src/WHtml2png.mjs', 'toolg/gDistRollup.mjs', 'test/tools/fakeChromium.mjs', 'scla.mjs']) {
            assert.strict.equal(rel.includes(must), true, `scan scope lacks ${must}`) //掃描範圍有效
        }
        let hits = []
        for (let fp of fps) {
            let c = fs.readFileSync(fp, 'utf8')
            re.lastIndex = 0
            let m = null
            while ((m = re.exec(c)) !== null) {
                hits.push(`${path.relative(fdRepo, fp)}:${c.slice(0, m.index).split('\n').length}`)
            }
        }
        assert.strict.deepStrictEqual(hits, [])
    })

    it('toolg/gDistRollup.mjs keeps w-playwright external (not bundled into dist) and lists no playwright', function() {
        let c = fs.readFileSync(path.join(fdRepo, 'toolg', 'gDistRollup.mjs'), 'utf8')
        let glb = c.slice(c.indexOf('let globals = {'), c.indexOf('}', c.indexOf('let globals = {')))
        assert.strict.equal(/external:\s*Object\.keys\(globals\)/.test(c), true)
        assert.strict.equal(glb.includes(`'w-playwright': 'w-playwright'`), true, glb)
        assert.strict.equal(/'playwright(-core)?'\s*:/.test(glb), false, glb)
    })

})
