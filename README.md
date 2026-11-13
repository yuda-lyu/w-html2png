# w-html2png
A package for html to png by chromium.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-html2png.svg?style=flat)](https://npmjs.org/package/w-html2png) 
[![license](https://img.shields.io/npm/l/w-html2png.svg?style=flat)](https://npmjs.org/package/w-html2png) 
[![npm download](https://img.shields.io/npm/dt/w-html2png.svg)](https://npmjs.org/package/w-html2png) 
[![npm download](https://img.shields.io/npm/dm/w-html2png.svg)](https://npmjs.org/package/w-html2png) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-html2png.svg)](https://www.jsdelivr.com/package/npm/w-html2png)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-html2png/WHtml2png.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-html2png
```

- 安裝即帶入自有套件 `w-playwright`(及其精確釘版之 `playwright-core` 1.64.1);本套件不直接依賴 `playwright`／`playwright-core`,使用端不需另裝.瀏覽器一律經 `w-playwright` 啟動,見 [瀏覽器之啟動](#瀏覽器之啟動w-playwright).
- 預設之瀏覽器為本套件自帶之免安裝 Chrome(Windows),首次調用時經 `WHtml2png.ensureBins()` 取得,見 [外部執行檔](#外部執行檔);不需 `npx playwright install`.

#### Example for function:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-html2png/blob/master/scla.mjs)]
```alias
import fs from 'fs'
import WHtml2png from 'w-html2png'

async function testa() {

    let html = `
<div style="padding:10px; display:inline-block;">
    <div style="background-color: rgb(255, 255, 255); border-radius: 5px; width: 600px; box-shadow:0 3px 1px -2px rgba(0,0,0,.2), 0 2px 2px 0 rgba(0,0,0,.14), 0 1px 5px 0 rgba(0,0,0,.12);">
        <div style="padding: 20px; border-bottom: 1px solid rgb(221, 221, 221); background-color: rgb(250, 250, 250); border-radius: 5px 5px 0px 0px; display: flex; justify-content: flex-start; align-items: center;">
            <div>
                <div style="font-size: 2rem;">Panel Title</div>
            </div>
        </div>
        <div style="border-radius: 0px;">
            <div style="padding: 20px;">
                Here is a panel content, Morbi mattis ullamcorper velit. Donec orci lectus, aliquam ut, faucibus non, euismod id, nulla. In ut quam vitae odio lacinia tincidunt.
            </div>
        </div>
        <div style="padding: 20px; border-top: 1px solid rgb(221, 221, 221); background-color: rgb(250, 250, 250); border-radius: 0px 0px 5px 5px;">
            Here is a panel footer
        </div>
    </div>
</div>
    `
    let width = 620
    let height = 235
    let scale = 3

    let b64 = await WHtml2png(width, height, scale, html)
    // console.log('b64', b64)

    fs.writeFileSync('./test-scla.png', b64, { encoding: 'base64' })

    console.log('finish')
}
testa()
    .catch((err) => {
        console.log(err)
    })

```

### Notes
- **Platform**: the bundled portable Chrome is Windows only. On other platforms give `opt.executablePath` (a local Google Chrome you install yourself, or a Playwright-managed Chromium obtained by `w-playwright`'s `ensureChromium({ kind: 'chromium' })`; see [瀏覽器之啟動](#瀏覽器之啟動w-playwright)).
- **Launch**: every browser is launched through `w-playwright`, which always adds exactly one `--disable-features=<Playwright defaults>,AutofillAiWalletPrivatePasses` to the command line (on Windows, Chromium 153+ otherwise logs on the current user with a wrong password at every launch and locks the account after 10 launches in 10 minutes). Launch failures reject with `[E_LAUNCH] ...`-style strings; see [瀏覽器之啟動](#瀏覽器之啟動w-playwright).
- **Where Chrome lives**: without `opt.executablePath`, Chrome is obtained by `WHtml2png.ensureBins()` (see [外部執行檔](#外部執行檔)) and cached in `<w-html2png package>/bin-cache/`, independent of the current working directory; obtaining Chrome never writes to the working directory (only `opt.fdHtml`/`opt.fdErr`, used with `opt.funGetUrl`/`opt.writeError`, default to `./_convertTemp`). With `opt.executablePath` the bundled Chrome is not obtained at all.
- **Page globals**: the page preloads lodash (`_`) and wsemi (`w`) from the installed packages, so no network is needed for them.
- **Content is inserted verbatim** (including `$&`, `$'`, `$$`). `execJsHead`/`execJsPost` are inline scripts and must not contain a literal `</script>` (write `<\/script>`). URLs in `stylesHead`/`scriptsHead` must not contain double quotes.
- **Local files**: without `opt.funGetUrl` the page is loaded by `setContent` (about:blank), so `file://` and relative paths in the html are not loaded. Use data URLs or give `opt.funGetUrl`.
- **Errors**: rejections are always message strings. Set `opt.rejectOnPageError: true` to reject when the page throws (default keeps returning the image).
- **Page completion**: the page errors check and the screenshot wait for the page to finish, independent of machine load; see [頁面完成之判定](#頁面完成之判定).
- **alive mode**: call `WHtml2png.close()` before a batch script ends so Node can exit.
- **Time limit**: give `opt.timeout` (milliseconds per attempt) to bound a stuck render; see [單次出圖之允許時長](#單次出圖之允許時長optimeout). Without it nothing changes.

## 瀏覽器之啟動(w-playwright)

本套件之 single 與 alive 兩模式皆只有一個啟動點,一律呼叫自有套件 `w-playwright` 之 `launchChromium`(不直接呼叫 `playwright`／`playwright-core`).本套件給之啟動參數不變(`--lang=en-US`、`--no-sandbox`、`--disable-gpu` 等,無頭與否依 `opt.modeHeadless`,啟動時限 60 秒),`w-playwright` 於其後加上守門參數:

| 項目 | 內容 |
|---|---|
| 守門參數 | 每次啟動之命令列**恰一個** `--disable-features`,為傳給 Playwright 之 `args` 之最後一個元素(Playwright 其後只再附加 `--user-data-dir`、`--remote-debugging-pipe` 等非功能開關),內容為 Playwright 預設停用之功能＋`AutofillAiWalletPrivatePasses`;Playwright 自帶之那一串以 `ignoreDefaultArgs` 去掉 |
| 原因 | Windows 上 Chromium 153 起(Google Chrome、Edge、完整 Chromium),每啟動一個新的瀏覽器根行程,即以錯誤密碼替目前之使用者登入一次(錯誤密碼次數 +1),本機原則 10 分鐘內 10 次即鎖住帳號;停用 `AutofillAiWalletPrivatePasses` 即不發生.Chromium 對多個 `--disable-features` 只取最後一個,故須合併為一串 |
| 自帶之 Chrome 138 | 早於 153,實測經本套件啟動錯誤密碼次數不增加;仍一律加入守門參數(`opt.executablePath` 可指向任何 Chromium 系瀏覽器) |
| 不支援之環境變數 | `PWDEBUG`(inspector 模式)、`SELENIUM_REMOTE_URL`:會使守門失效,啟動即失敗(`[E_ENV] ...`) |
| 執行期登入守門(選用) | 環境變數 `W_PLAYWRIGHT_LOGON_GUARD=1` 時,每次啟動前(Windows 本機帳號)讀目前使用者之錯誤密碼次數,≥1、已鎖或讀不到即拒絕啟動(`[E_LOGON_GUARD] ...`);同一行程之啟動依序進行(single 模式之並發呼叫各自排隊啟動),讀取與排隊之時間不在本套件之 60 秒啟動時限內,需要整體時限者給 `opt.timeout`(其計時涵蓋取得瀏覽器;逾時落在排隊或讀取期間時,該瀏覽器於啟動完成後關閉).預設關,細節見 `w-playwright` 之 README |

- **安裝與取得瀏覽器**:
  - 預設(未給 `opt.executablePath`):本套件自帶之免安裝 Chrome,經 `WHtml2png.ensureBins()` 取得(見 [外部執行檔](#外部執行檔);離線以 `W_BIN_MIRROR`、`W_BIN_OFFLINE`).
  - 本機安裝之 Google Chrome:須自行安裝 Google Chrome,以 `opt.executablePath` 指定其 `chrome.exe`(可用 `w-playwright` 之 `findSystemChrome()` 查其位置,只判檔案存在).
  - Playwright 受管之 Chromium:以 `w-playwright` 之 `await wpw.ensureChromium({ kind: 'chromium' })` 取得,**不要用 `npx playwright install`**(依賴樹中他版被提升時會下載到不同版本).`w-playwright` 為本套件之相依,使用端呼叫前須能解析到與本套件相同之那一份(使用端自行 `npm i w-playwright` 時取與本套件 `package.json` 相同之版本範圍,並以 `npm ls w-playwright` 確認全樹只有一份;各版之 `playwright-core` 為精確釘版,版本不同即可能下載到另一個瀏覽器版本);離線時於可連網之機器取得後,把 Playwright 之瀏覽器資料夾(Windows 預設 `%LOCALAPPDATA%\ms-playwright`)複製至目標機,並以環境變數 `PLAYWRIGHT_BROWSERS_PATH` 指向之(須在載入本套件前設定).其執行檔路徑由使用端自行指定於 `opt.executablePath`.
- **啟動失敗之訊息**:reject 之字串含 `[錯誤碼] 說明`,錯誤碼由 `w-playwright` 定義,如 `[E_LAUNCH] browser launch failed`、`[E_LAUNCH_TIMEOUT] browser launch timed out`、`[E_LOGON_GUARD] ...`、`[E_ENV] ...`、`[E_PW_VERSION] ...`;不含 Playwright 之原錯誤(其呼叫紀錄含完整命令列與設定檔路徑).
- 依賴樹之 `playwright-core` 若被換成其他版本(如 overrides),`w-playwright` 拒絕啟動(`[E_PW_VERSION] ...`).

## 頁面完成之判定

載入(`page.goto`/`page.setContent` 之 `networkidle`)返回後,檢查頁面錯誤(`opt.rejectOnPageError`)、`opt.funPageWait` 與截圖之前,一律再等頁面確實完成:

| 順序 | 等待 | 保證 |
|---|---|---|
| 1 | 頁面 `load` | 解析完成,同步腳本(含 `execJsHead`、`execJsPost`)與 `load` 事件處理皆已執行;其間之頁面錯誤已收到,其繪製已反映於截圖 |
| 2 | 靜止窗:自 `load` 與最後一次網路活動起 500 毫秒內無請求,進行中之請求皆已結束;以頁面自身之計時器等待 | `load` 前所設、延遲不超過 500 毫秒之計時器已執行(不論機器多忙);其間或 `load` 事件處理所發之請求已結束;未處理之 Promise rejection 已回報 |

- 為何需要:`networkidle` 只是瀏覽器外之 500 毫秒計時器,與頁面執行進度無關.頁面解析或執行腳本耗時超過 500 毫秒(機器負載高、腳本大、同步運算)時,它會早於頁尾腳本與 `load` 到達;修正前此時即檢查頁面錯誤並截圖,會漏掉頁面錯誤或拿到空白、未完成之圖.
- 耗時:每次出圖約多 `load` 與最後一次請求結束之間的時間(一般數十至數百毫秒);`load` 早於最後一次網路活動者不增加.
- 窗外之非同步工作(延遲超過 500 毫秒之計時器、窗結束後才發之請求)不在此保證內,請用 `opt.funPageWait` 等待其完成訊號;等待期間發生之頁面錯誤同樣於截圖前檢查.
- 等待上限 60 秒.限時內未 `load`(如 `document.open()` 後未 `document.close()`)、請求持續進行中、頁內計時器不回應(主執行緒卡住,或頁面把 `setTimeout` 換掉而不再呼叫回呼)時不視為失敗,續往下檢查與截圖,結果可由 `opt.onTrace` 之 `page-settled` 事件得知;這類頁面每次出圖最多多等 60 秒.

## 單次出圖之允許時長(opt.timeout)

出圖時若 Chrome 卡住(例如 renderer 或主程序被暫停、頁內等待永不完成),預設沒有整體時限:`context.newPage()`、`page.close()`、`browser.close()` 不會逾時,卡住時 `opt.retry` 也不會起作用.給 `opt.timeout` 可限制每次嘗試之時長:

```js
let b64 = await WHtml2png(620, 235, 3, html, { mode: 'alive', retry: 3, timeout: 30000 })
```

| 項目 | 內容 |
|---|---|
| `opt.timeout` | 每次嘗試(含取得瀏覽器、開頁、載入、`funPageWait`、截圖、關閉)之允許時長,毫秒;有效正數(數字或數字字串),不超過 2147483647 |
| 未給或非預期之輸入 | `undefined`、`null`、`'10s'`、`0`、負數、`Infinity`、`NaN`、物件、布林、超過 2147483647 者皆視為未給:不限時,流程與未支援前相同(不多一次 CDP 查詢、`WHtml2png.close()` 與閒置關閉不限時) |
| 逾時 | 該次嘗試失敗,依 `retry` 重試(重試前仍等待 5 秒);訊息開頭為 `timeout[Nms] in <步驟>`,步驟如 `funGetUrl`、`strategy.acquire`、`context.newPage()`、`page.goto()`、`page.setContent()`、`waitPageSettled`、`funPageWait`、`page.screenshot()`、`page.close()`、`release()`,可據以判斷卡在哪一步 |
| 頁面層 | 已開頁面且限時 5 秒內關得掉:瀏覽器仍可回應,不重啟,不牽連 alive 模式並發中之其他呼叫 |
| 瀏覽器層 | 尚無頁面(啟動瀏覽器或開頁卡住)或頁面關不掉:關閉本呼叫所用之瀏覽器(alive 為本呼叫所用之常駐瀏覽器;不論是否還有重試,下次呼叫即啟動新瀏覽器;同用該常駐瀏覽器之並發呼叫會失敗,由其各自之 `retry` 接住;single 為本呼叫專屬之瀏覽器).訊息註記處置結果,如 `(browser closed)`、`(browser disconnected)`(與瀏覽器之連線已斷,不再結束行程) |
| 強制結束 | 關閉限時 10 秒;主程序卡死時 `browser.close()` 不會返回,超過即確認該 pid 仍是本實例啟動之瀏覽器後,以 `wsemi` 之 `execProcessKillPid` 樹狀結束(Windows 為 `taskkill /T /F`).pid 於啟動時經 CDP(`SystemInfo.getProcessInfo`)自該瀏覽器自身之連線取得(卡死後 CDP 已不回應);**無法確認歸屬(pid 未取得、瀏覽器已斷線、連線狀態不明)時不殺**,並於訊息註記,如 `(browser not killed, pid unknown)` |
| 尚未取用瀏覽器 | `funGetUrl` 卡住等逾時不動瀏覽器,只刪除暫存之 html |
| 整次上限 | 每次嘗試最長約 `timeout` + 25 秒(5 秒關頁面、10 秒關瀏覽器、5 秒結束指令、5 秒確認斷線);整次呼叫約此值乘 `retry`,再加 5 秒乘 `retry - 1`.計時不含取得套件自帶 Chrome(`ensureBins` 有其自身逾時)與重試前之等待;小數毫秒向上取整 |

- `opt.retry` 預設 3 次:renderer 全被暫停時,第一次嘗試通常關得掉頁面(不重啟),第二次才卡在 `context.newPage()` 而重啟瀏覽器,故要救回同一張圖至少需 `retry: 3`.
- 給了 `opt.timeout` 之呼叫所用之常駐瀏覽器,其 `WHtml2png.close()` 與閒置(1 小時)自動關閉亦限時 10 秒並可強制結束;從未有呼叫給過 `opt.timeout` 之瀏覽器維持原行為(不限時等待關閉).
- 逾時之嘗試不被等待:其進行中之步驟於頁面或瀏覽器關閉後自行結束,不再取用瀏覽器或出圖.
- 逾時前啟動中之 Chrome(尚無瀏覽器可關)不等待啟動:啟動完成後於背景關閉;`timeout` 應涵蓋最壞之啟動與開頁時間,過短者每次嘗試都會關閉(alive 為重啟)瀏覽器,牽連並發呼叫.
- 單次出圖成功後釋放瀏覽器失敗(如 pid 不明而關不掉)不影響回傳之圖,僅經 `opt.onTrace` 之 `browser-kill` 事件可見;`WHtml2png.close()`/閒置關閉之處置結果不回傳亦不通知(無法確認歸屬而未結束者,行程可能殘留).
- 本套件只處置本實例啟動之瀏覽器;是否回收其他殘留行程(Node 被強制終止後遺留之 Chrome 行程樹等)仍由使用端負責.
- `opt.onTrace`:選用之觀察回調 `(e) => {}`,`e` 為凍結之事件物件 `{ type, ... }`,於內部事件發生當下同步呼叫(拋錯與回傳值皆忽略),供測試與診斷以事件而非等待時間同步;事件 `type` 見 JSDoc.未給時行為與效能不變.

## 外部執行檔

本套件未給 `opt.executablePath` 時使用自帶之免安裝 Chrome(只支援 Windows),不含於 npm 包(npm 包內 `bin/` 只有清單 `manifest.json`):

| 檔案組 | 內容 | 來源 |
|---|---|---|
| `chrome` | Chrome 138.0.7204.97 免安裝版之 `portable/App/Chrome-bin/`(107 檔,約 421 MB;啟動其中之 `portable/App/Chrome-bin/138.0.7204.97/chrome.exe`) | 本套件 GitHub repo 之 `bin/chrome/portable.zip.001`~`008`(釘選提交;組合後約 198 MB 之 zip) |

- 首次調用 `WHtml2png`(未給 `opt.executablePath`)時自動下載(或預先呼叫 `WHtml2png.ensureBins()`):取得 8 個分割,各自校驗後組合、校驗,再解出 `portable/App/Chrome-bin/` 之 107 檔,逐檔以 `bin/manifest.json` 所載之 SHA-256 與大小校驗後,整組放入 `<套件根>/bin-cache/<組識別>/`;之後自快取取得(每個行程首次亦校驗,組內任一檔不符即整組重取).安裝時不下載(無 `postinstall`).
- 下載網址釘在清單所載之 GitHub 提交(`https://raw.githubusercontent.com/yuda-lyu/w-html2png/<提交>/bin/chrome/portable.zip.00N`),不使用分支名;任何來源取得之檔皆以清單校驗,不符即不用.
- 給了 `opt.executablePath`(本機 Chrome 或 Playwright 託管之 Chromium)即不取本檔案組.
- 環境變數:
  - `W_BIN_CACHE=<資料夾>`:快取改放 `<資料夾>/w-html2png/<組識別>/`(套件所在之 `node_modules` 唯讀時使用,多套件可共用同一資料夾).
  - `W_BIN_MIRROR=<資料夾或 http(s) 網址>`:內網鏡像,先找鏡像再連 GitHub;可放整組 `<鏡像>/w-html2png/<組識別>/<組內路徑>`(以 `W_BIN_CACHE` 製成者即是),或各分割 `<鏡像>/w-html2png/<sha256>/portable.zip.00N`.鏡像之檔同樣以清單校驗,不符即不用.
  - `W_BIN_OFFLINE=1`:不連網,只用快取與鏡像;缺檔時錯誤(`E_OFFLINE_MISSING`)會列出全組各檔(路徑、sha256、大小)、組資料夾應放之完整路徑與各分割可放之鏡像路徑.
- 離線部署:
  1. 在可連網之電腦設 `W_BIN_CACHE=<空資料夾>`,呼叫 `WHtml2png.ensureBins()` 一次(或出圖一次).
  2. 把該資料夾整個帶到內網電腦,設 `W_BIN_MIRROR=<該資料夾>`(全離線時另設 `W_BIN_OFFLINE=1`).
- 預先取得(部署前或建置時):

```js
import WHtml2png from 'w-html2png'

let bins = await WHtml2png.ensureBins() // { chrome: '<組資料夾之絕對路徑>' }
let fpExe = bins.bundles.chrome.files['portable/App/Chrome-bin/138.0.7204.97/chrome.exe'] // 組內各檔之絕對路徑
```

- 同一函數亦可深層匯入 `w-html2png/src/ensureBins.mjs`.取不到時 `ensureBins` reject 帶 `code` 之 Error(`E_OFFLINE_MISSING`、`E_HASH_MISMATCH`、`E_SIZE_MISMATCH`、`E_HTTP`、`E_NETWORK`、`E_TIMEOUT`、`E_EXTRACT`、`E_MANIFEST` 等,由 wsemi 之 `fsEnsureBins` 統一);`WHtml2png` 維持 reject 字串,內容為 `[錯誤碼] 說明`.
- 解壓使用 Windows 內建之 `tar.exe`(`%SystemRoot%\System32\tar.exe`).

## Breaking changes

本版不保留舊版相容(程式碼品質優先,破壞性變更由下游連帶修正):

- 瀏覽器改經自有套件 `w-playwright` 啟動:相依移除 `playwright-core`、加入 `w-playwright`(其相依為精確 `playwright-core` 1.64.1;依賴樹之 `playwright-core` 為他版時拒絕啟動).
- 啟動參數於本套件既有參數之後多一串 `--disable-features=<Playwright 預設>,AutofillAiWalletPrivatePasses`(恰一串;原 Playwright 自帶之一串去掉,停用之功能為其超集).自帶之 Chrome 138 出圖不受影響.
- 啟動失敗之訊息改為 `w-playwright` 之固定詞彙並帶錯誤碼(如 `[E_LAUNCH] browser launch failed`),不再含 Playwright 之原錯誤(含執行檔路徑與呼叫紀錄).
- 環境變數 `PWDEBUG`(inspector 模式)或 `SELENIUM_REMOTE_URL` 有值時啟動即失敗(`[E_ENV] ...`);`W_PLAYWRIGHT_LOGON_GUARD=1` 時每次啟動前讀錯誤密碼次數(見 [瀏覽器之啟動](#瀏覽器之啟動w-playwright)).
- 套件自帶之 Chrome 改經 `WHtml2png.ensureBins()`(wsemi `fsEnsureBins`)取得,快取位置由 `<套件根>/chrome/<chrome版本>/portable/` 改為 `<套件根>/bin-cache/<組識別>/portable/App/Chrome-bin/`(或 `W_BIN_CACHE`);只取 `Chrome-bin/`,不再含 portable 之啟動器 `GoogleChromePortable.exe` 與 `App/AppInfo`、`App/DefaultData`.舊位置之 Chrome 不再使用,可自行刪除.
- 移除舊位置之唯讀查找:`<套件根>/chrome/portable/`、`<cwd>/chrome/portable/`、`<cwd>/node_modules/w-html2png/chrome/portable/`.
- 移除環境變數 `W_HTML2PNG_CHROME_DIR`(改用 `W_BIN_CACHE`)與 `W_HTML2PNG_SKIP_DOWNLOAD`(安裝時已不下載,無需略過).
- 移除 `postinstall`(`scripts/install.mjs`):安裝時不下載,首次調用時才取得.
- 移除深層匯入點 `w-html2png/src/autoDownloadFiles.mjs`(原回傳 `{ fpExe }`)及其 `getChromeLayout`、`ensureChrome`,與 `src/downloadFiles.mjs`、`src/chromeManifest.mjs`、`src/fileLock.mjs`.改用 `ensureBins()`,chrome.exe 之路徑見上節之 `bins.bundles.chrome.files[...]`.
- repo 主幹移除 `chrome/portable.zip.001`~`008` 與 `chrome/ver.txt`(分割改在 `bin/chrome/`).1.0.53 以前之版本於執行時自主幹之 `chrome/` 下載,新環境首次使用時會得到 HTTP 404 而無法取得 Chrome(已有 Chrome 之安裝不受影響),請升版;1.0.54~1.0.56 釘在舊提交,不受影響.
- 取不到套件自帶之 Chrome 時,reject 之字串改為 `[錯誤碼] 說明`(如 `[E_OFFLINE_MISSING] ...`).
- 相依移除 `w-zip`(解壓改由 `fsEnsureBins` 以系統 `tar.exe` 進行).
