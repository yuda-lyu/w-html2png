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
- **Platform**: the bundled portable Chrome is Windows only. On other platforms give `opt.executablePath` (a local Chrome or a Playwright-managed Chromium).
- **Where Chrome lives**: without `opt.executablePath`, Chrome is obtained by `WHtml2png.ensureBins()` (see [外部執行檔](#外部執行檔)) and cached in `<w-html2png package>/bin-cache/`, independent of the current working directory; obtaining Chrome never writes to the working directory (only `opt.fdHtml`/`opt.fdErr`, used with `opt.funGetUrl`/`opt.writeError`, default to `./_convertTemp`). With `opt.executablePath` the bundled Chrome is not obtained at all.
- **Page globals**: the page preloads lodash (`_`) and wsemi (`w`) from the installed packages, so no network is needed for them.
- **Content is inserted verbatim** (including `$&`, `$'`, `$$`). `execJsHead`/`execJsPost` are inline scripts and must not contain a literal `</script>` (write `<\/script>`). URLs in `stylesHead`/`scriptsHead` must not contain double quotes.
- **Local files**: without `opt.funGetUrl` the page is loaded by `setContent` (about:blank), so `file://` and relative paths in the html are not loaded. Use data URLs or give `opt.funGetUrl`.
- **Errors**: rejections are always message strings. Set `opt.rejectOnPageError: true` to reject when the page throws (default keeps returning the image).
- **alive mode**: call `WHtml2png.close()` before a batch script ends so Node can exit.

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

- 套件自帶之 Chrome 改經 `WHtml2png.ensureBins()`(wsemi `fsEnsureBins`)取得,快取位置由 `<套件根>/chrome/<chrome版本>/portable/` 改為 `<套件根>/bin-cache/<組識別>/portable/App/Chrome-bin/`(或 `W_BIN_CACHE`);只取 `Chrome-bin/`,不再含 portable 之啟動器 `GoogleChromePortable.exe` 與 `App/AppInfo`、`App/DefaultData`.舊位置之 Chrome 不再使用,可自行刪除.
- 移除舊位置之唯讀查找:`<套件根>/chrome/portable/`、`<cwd>/chrome/portable/`、`<cwd>/node_modules/w-html2png/chrome/portable/`.
- 移除環境變數 `W_HTML2PNG_CHROME_DIR`(改用 `W_BIN_CACHE`)與 `W_HTML2PNG_SKIP_DOWNLOAD`(安裝時已不下載,無需略過).
- 移除 `postinstall`(`scripts/install.mjs`):安裝時不下載,首次調用時才取得.
- 移除深層匯入點 `w-html2png/src/autoDownloadFiles.mjs`(原回傳 `{ fpExe }`)及其 `getChromeLayout`、`ensureChrome`,與 `src/downloadFiles.mjs`、`src/chromeManifest.mjs`、`src/fileLock.mjs`.改用 `ensureBins()`,chrome.exe 之路徑見上節之 `bins.bundles.chrome.files[...]`.
- repo 主幹移除 `chrome/portable.zip.001`~`008` 與 `chrome/ver.txt`(分割改在 `bin/chrome/`).1.0.53 以前之版本於執行時自主幹之 `chrome/` 下載,新環境首次使用時會得到 HTTP 404 而無法取得 Chrome(已有 Chrome 之安裝不受影響),請升版;1.0.54~1.0.56 釘在舊提交,不受影響.
- 取不到套件自帶之 Chrome 時,reject 之字串改為 `[錯誤碼] 說明`(如 `[E_OFFLINE_MISSING] ...`).
- 相依移除 `w-zip`(解壓改由 `fsEnsureBins` 以系統 `tar.exe` 進行).
