# 規則帳本

本檔為套件設計與開發階段之規則帳本,為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.

- 來源:任務 20261014075905 之審計 run01(`C:\opensrcOper\dnow\20261014075905\agent-out\run01-審計回應.md`)與主控複審裁示(`…\review\run01-複審.md`,2026-10-16)。
- 盤點指令一律以 Grep 工具(或 `git grep`)於 repo 根執行;「站點全集」以該指令之結果為準,新增站點時須逐一判定已套/未套/刻意不套。

## 規則

### R1 組 html:單次掃描模板,填值不得被二次解讀
- 程式須長成:組頁面 html 只在 `src/buildHtml.mjs`(單一擁有者);模板只掃一次,替換值以函式回傳(不解讀 `$&`、`$'`、`` $` ``、`$$`),已填入之內容不再被掃描(內容中出現 `{cExecJsPost}` 等字樣不被當佔位字樣)。
- 盤點:Grep `\.replace\('\{c` 於 `src/` 須 0 筆;Grep `buildHtml` 於 `src/` 只在 `buildHtml.mjs`(定義)與 `WHtml2png.mjs`(唯一呼叫)。
- 已知限制(文件化,D-9):execJsHead/execJsPost 為 inline `<script>`,內容不得含字面 `</script>`(或 `<!--` 接 `<script`);stylesHead/scriptsHead 網址直接置於屬性,不得含 `"`。
- 測試:`test/unit-buildHtml.test.mjs`(5 位置 × 12 字樣 = 60 格逐字)、`test/unit-render.test.mjs`(真 Chrome 頁內自檢)。

### R2 Chrome 取得:`opt.executablePath` 優先,否則經 `ensureBins` 取檔案組 chrome(R16);與 cwd 無關、永不寫入 cwd
- 順序:`opt.executablePath`(給了即不取組)> `src/WHtml2png.mjs` 之 `getBundledChrome` → `ensureBins()` → `r.bundles.chrome.files` 中唯一符合 `portable/App/Chrome-bin/<版本>/chrome.exe` 者(版本由清單決定,不寫死;非恰一個 → `E_MANIFEST`)。取不到時 reject 字串 `[錯誤碼] 說明`。
- 無舊位置查找、無套件專屬環境變數(原則 14,2026-10-29 移除 `W_HTML2PNG_CHROME_DIR`、`W_HTML2PNG_SKIP_DOWNLOAD` 與 `chrome/portable` 三處舊位置)。
- 套件根之推導只在 `src/pkgRoot.mjs`(單一擁有者),`ensureBins.mjs`(清單與預設快取之基準)與函式庫供應(`libRoutes.mjs`)共用。
- 頂層不得宣告 `__filename`/`__dirname`(R4)。
- 盤點:Grep `path\.resolve\(\s*['"]|process\.cwd\(` 於 `src/` 須 0 筆;Grep `W_HTML2PNG_|chrome/portable|autoDownloadFiles|@deprecated` 於 `src/` 須 0 筆。`WHtml2png.mjs` 之 fdHtml/fdErr 預設 `./_convertTemp`(使用者工作輸出,場景 A)為刻意。
- 測試:`test/api-ensureBins.test.mjs`(describe〈WHtml2png gets chrome through ensureBins〉:攔截全域 fetch 與 `chromium.launch`,斷言未給 executablePath 時所啟動者為組內 chrome.exe、給了則不取組、取不到時之字串)、`test/unit-binManifest.test.mjs`(src 不含舊位置／舊環境變數／自寫下載)。

### R3 首次下載跨行程安全(2026-10-29 廢止)
- 自寫之鎖檔、隔離夾、完成標記、負快取已隨 `src/downloadFiles.mjs`、`src/fileLock.mjs` 移除;下載、校驗、併發與跨行程安全由 wsemi `fsEnsureBins`(暫存夾＋逐檔校驗＋整組原子更名)負責,見 R16。舊規則全文見 git 歷史(提交 bf41fac 之本檔)。

### R4 打包相容
- 頂層不得宣告 `__filename`/`__dirname`;`import.meta` 只用 `url`(rollup UMD 墊片)。
- 盤點:Grep `^\s*(export\s+)?(let|const|var)\s+__(filename|dirname)` 與 `import\.meta\.(dirname|filename|resolve)` 於 `src/` 須 0 筆。
- 測試:`test/unit-dist.test.mjs`。

### R5 回傳結果物件之 fs 函式一律檢查回傳
- wsemi `fsRenameFolder`/`fsDeleteFolder`/`fsDeleteFile`/`fsCreateFolder` 回傳 `{error}` 不拋錯;本套件呼叫處須檢查,或改用會拋錯之 `fs` API 並處理。
- 盤點:Grep `fsRenameFolder\(|fsDeleteFolder\(|fsDeleteFile\(|fsCreateFolder\(` 於 `src/`,逐站點判定(2026-10-29:0 筆;`src/` 之寫檔站點只剩 `WHtml2png.mjs` 之 fdHtml 暫存 html〔`wx`、只刪自建者〕與錯誤檔)。
- 測試:`test/unit-errors.test.mjs`。

### R6 錯誤:reject 一律為字串,保留原因,去除 ANSI(D-5)
- 對外 reject 一律字串;非 Error 之拋出以 `String()` 轉;訊息去除 ANSI 色碼;寫錯誤檔失敗不得覆蓋原因;重試迴圈不得因 exec 例外而讀 undefined。
- 單一擁有者:`src/errToMsg.mjs`。
- 盤點:Grep `throw new Error|Promise\.reject\(` 於 `src/WHtml2png.mjs`,對外路徑皆經 `errToMsg`。
- 測試:`test/unit-errors.test.mjs`。

### R7 頁面端失敗可被呼叫端得知(D-1:P1)
- `opt.rejectOnPageError`(預設 false):監聽 `pageerror`,截圖前有錯即視為該次失敗(訊息含全部頁內錯誤),依 `retry` 重試。預設行為不變。
- 測試:`test/unit-pageError.test.mjs`。

### R8 建置
- `toolg/gDistRollup.mjs`:`runin:'nodejs'`;external/globals 涵蓋所有用到之 Node 內建模組與 `playwright-core`(含 wsemi `fsEnsureBins` 所需之 `url`、`crypto`、`stream`、`stream/promises`、`child_process`、`os`);失敗時印出並 `process.exitCode = 1`(不得只 `console.log`)。
- 盤點:Grep `catch` 於 `toolg/gDistRollup.mjs`。
- 測試:`test/unit-dist.test.mjs`(由 src 建至 `test/_tmp`:離開碼 0、0 筆 could not be resolved、無 invalid runin;語法錯 → 離開碼 1)。

### R9 測試寫法
- 出圖斷言以語意(PNG、尺寸、非白像素、頁內自檢色)為主,對基準圖用容差比對(通道差>16 之像素數 ≤ 門檻),不逐位元;超容差三聯組落 `./testPending/`。
- 測試永不連外:需要真 chrome 之出圖測試於 `before` 以 `await setBinEnv('<tag>')`(`test/tools/binEnv.mjs`)取得——以 `bin/chrome` 之分割硬連結建本地鏡像、設 `W_BIN_MIRROR`、`W_BIN_OFFLINE=1`,組放預設快取 `<repo>/bin-cache/`(各測試檔共用,首次解出、之後命中),並先取得校驗一次使 421MB 之雜湊不與出圖重疊;取得邏輯之測試以本機 HTTP(埠 9040 真組、9041 假組)扮 GitHub,竄改／離線等以小型同形假組(`test/tools/fakeBundle.mjs`);在行程內開真 Chrome 之測試檔頂部 `import ./tools/fetchBlock.mjs`,子行程一律預載之。
- 臨時檔只放 `test/_tmp/<案名>/`,`after` 刪除;不得用 `./tmp/`。
- 盤點:Grep `deepStrictEqual\(rr, rt\)` 於 `test/` 之出圖案須 0 筆。

### R10 Chrome 分片之存放(2026-10-29 改寫,原 D-4 之「`chrome/` 永不刪改」依原則 14 廢止)
- 分割只在 `bin/chrome/portable.zip.001`~`008`(入 git、不入 npm 包);主幹之 `chrome/` 已移除。`bin/manifest.json` 釘選含分割之提交(`bf41fac5f3e4698e21f05388aea3ec4dfece93e7`),由 `toolg/genBinManifest.mjs --commit <提交>` 產生,不手寫。
- 舊版之下載來源:1.0.54~1.0.56 釘 `5ebfb11f…`(不受影響);1.0.53 以前自主幹 `chrome/` 下載,主幹移除後新環境得 HTTP 404(已列報告〈待裁示〉,比照 dspec S2 之 w-dwload-dlp 裁定)。
- 換 Chrome 版本時依 dspec U1:替換 `bin/chrome/` 分割 → 提交並推 → `genBinManifest --commit <該提交>` → 測試(M4)→ 發布;`include` 只取 `portable/App/Chrome-bin/`(排除 `.url`)。
- `.gitignore` 列 `/chrome/`(他機 pull 後殘留之未追蹤 `chrome/portable/` 仍被忽略)、`/bin-cache/`;`.npmignore` 仍列 `chrome`(同理,不使殘留入包)。
- 盤點:`git ls-files bin` 恆為 8 個分割＋`bin/manifest.json`;`git ls-files chrome` 恆為 0。
- 測試:`test/unit-binManifest.test.mjs`(清單形狀、分割與組合之雜湊＝實檔、釘選提交之位元組＝工作樹、npm 包無分割)。

### R11 頁面注入之函式庫以本機供應(D-3:C3)
- 模板網址不變(`https://cdn.jsdelivr.net/npm/lodash/lodash.min.js`、`…/wsemi/dist/wsemi.umd.js`),以 `context.route` 由本機 `lodash/lodash.min.js`(相依 `lodash`)與 `wsemi/dist/wsemi.umd.js` 供應;每行程讀檔一次快取。
- 本機檔案先自本套件根解析(`src/pkgRoot.mjs`,被打包進他套件時仍可得),再自模組位置解析;皆不可得時不攔截該網址(維持自 CDN 載入之舊行為)並於 stderr 提示一次,不得使出圖失敗。
- 測試:`test/unit-cdnLibs.test.mjs`(頁內 `_.VERSION` 等於已安裝之 lodash 版本、`w` 可用)。

### R12 alive:只有瀏覽器層錯誤才重啟,且以世代比對(D-11:H1)
- 常駐狀態為「世代」物件(瀏覽器 Promise+其 context 快取);重試前只有瀏覽器層錯誤(瀏覽器已啟動但 newContext/routeLibs 失敗〔錯誤附世代〕、newPage 失敗、或出圖後瀏覽器已斷線)才關閉,且只關本呼叫所用且仍為現行之世代(啟動失敗者世代已自動歸零,不需關閉);`getContext` 寫快取前比對世代;`WHtml2png.close()` 後,其前開始之呼叫於每次取得 context 前(含等待 funGetUrl 之後)檢查而不再啟動或重試,其後之呼叫正常啟動新世代。
- 測試:`test/unit-alive.test.mjs`(頁面層錯誤不連累並發呼叫;close 時有進行中呼叫不重啟;close 發生於等待 funGetUrl 期間不啟動瀏覽器)。

### R13 安裝完成與清掃(2026-10-29 廢止)
- 完成標記、擁有標記、`.dl-*`/`.old-*`/`.lock-*` 之清掃隨自寫下載一併移除;快取之完整性改為每行程首次逐檔校驗(R16、dspec D4)。`src/` 寫檔站點全集見 R5。`toolg/gDistRollup.mjs` 清空 `dist/` 之路徑以腳本位置推導(不變)。

### R14 安裝時不下載(2026-10-29 改寫;原「postinstall 與執行期同一函式」廢止)
- `package.json` 無 `postinstall`/`install`/`preinstall`;`scripts/install.mjs` 已移除(dspec D1)。
- 測試:`test/unit-binManifest.test.mjs`(should not download in postinstall)。

### R15 平台(D-10)
- 未給 `executablePath` 時限 Windows(免安裝 Chrome 只有 Windows 版);給 `executablePath` 時不限平台。
- 測試:`test/unit-errors.test.mjs`(以子行程覆寫 `process.platform`)。

### R16 外部執行檔:制式規格(dspec)之本套件落地(2026-10-29 bin-html2png)
- 依據:`C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md`(§2 存放、§3 M1~M6、§4 下載快取、§5 離線、§6 E2、§8 測試);本節只記本套件之落點,規則本文以 dspec 為準。本套件為 A 類(主控帳本 G10)、釘選模式、單一檔案組 `chrome`。
- 套件端只做三件事(E2):①清單 `bin/manifest.json`(頂層 `bundles:[{ name:'chrome', archives:[{ parts:8, assembled, extract:{ files:107 } }] }]`,由 `toolg/genBinManifest.mjs` 產生);②`src/ensureBins.mjs` 轉呼叫 wsemi(≥1.9.30)`fsEnsureBins('bin/manifest.json', { ...opt, pkgRoot: getFdPkg() })`,丟棄 `floatingManifestUrl`;③以靜態屬性 `WHtml2png.ensureBins` 匯出(主檔只 default 匯出,維持 UMD 形態)。不得自寫下載、快取、鏡像、校驗、組合、解壓(相依已移除 `w-zip`)。
- 組之內容:只取 `portable/App/Chrome-bin/`(排除中文名 `.url`);2026-10-29 實證 portable 之啟動器與 `App/AppInfo`、`App/DefaultData` 用不到(以組內 `Chrome-bin/138.0.7204.97/chrome.exe` 出圖與舊 portable 逐像素相同、對基準圖差 0)。
- 環境變數只有 `W_BIN_CACHE`、`W_BIN_MIRROR`、`W_BIN_OFFLINE`(由 fsEnsureBins 讀取);預設快取 `<套件根>/bin-cache/<組識別>/`。
- 忽略規則:`.npmignore` 列 `/bin/*`、`!/bin/manifest.json`、`/bin-cache/`、`/test/_tmp/`;`.gitignore` 列 `/bin-cache/`;`.gitattributes` 為 `bin/** binary`。
- 盤點指令:`node C:/opensrcOper/tools/scan-bins.mjs --only w-html2png`(應 OK);`npm pack --dry-run --json` 之 `bin/` 只有 `bin/manifest.json`;Grep `fsDownloadFile(?!Verify)|fsMergeFiles|w-zip|raw\.githubusercontent|fetch\(` 於 `src/` 須 0 筆。
- 測試對應(§8):T1、T2、M4、D1、E2 → `test/unit-binManifest.test.mjs`;T3(真組 421MB 一案)、T3~T7(同形假組)、D3 與 cwd 無關、不轉傳 floatingManifestUrl、主函數入口(全域 fetch 攔截、啟動之 chrome 為組內者、給 executablePath 不取組、取不到之字串)→ `test/api-ensureBins.test.mjs`;dist 經 ensureBins 取組並啟動 → `test/unit-dist.test.mjs`。T8(主幹模式)不適用。
- 改動範圍 → 測試:本套件無 `e2e-` 檔;全套 `npm test` 約 30 秒(暖)~40 秒(冷,首次解出),每輪跑全套。

## 已知限制

- 未給 `funGetUrl` 時以 `setContent`(about:blank)載入,html 內本機 `file://` 與相對路徑資源不會載入(審計 p09 實測);須用 data URL 或給 `funGetUrl`。
- 首次取得 chrome:下載約 198MB(8 分割)、解出 421MB;每個行程首次使用時校驗 107 檔(雜湊 421MB,約 0.5 秒,負載高時數秒)。
- Node 被強制終止時 Chrome 行程樹可能成孤兒(playwright 只靠 exit handler)。
- 下載使用 Node 全域 fetch,預設不讀 HTTP(S)_PROXY(Node 24 可設 `NODE_USE_ENV_PROXY=1`)。
- 解壓依賴 Windows 內建 `%SystemRoot%\System32\tar.exe`(bsdtar)。
- alive 之「瀏覽器層錯誤→關閉本世代→重試成功」路徑以讀碼與單元結構保證,未以殺 chrome 行程之方式實測(會干擾平行之其他測試)。
- 高負載下之頁面事件競態(2026-10-29 觀察,產品既有、未修):`rejectOnPageError` 之 `pageerror` 可能晚於截圖前之檢查而漏判(`unit-pageError`「page errors are retried」n=1);`setContent` 後 load 事件內之塗色可能未反映於截圖(`unit-localRes` 首案 white)。測試以 `setBinEnv` 預先校驗使 421MB 之雜湊不與出圖重疊而緩解,失敗率見 `sgud/state/state.md`。

## 破壞性/行為變更紀錄

- (實作 run03,2026-10-16)見 `C:\opensrcOper\dnow\20261014075905\agent-out\run03-修正報告.md` 之行為變更清單。
- (bin-html2png,2026-10-29)見 README〈Breaking changes〉與 `C:\opensrcOper\dnow\20261028054319\agent-out\bin-html2png-修正報告.md`:chrome 改經 `ensureBins`(快取 `bin-cache/`)、移除舊位置查找、`W_HTML2PNG_CHROME_DIR`、`W_HTML2PNG_SKIP_DOWNLOAD`、`postinstall`、`src/autoDownloadFiles.mjs` 等與主幹 `chrome/`;取不到 chrome 之字串改為 `[錯誤碼] 說明`。
