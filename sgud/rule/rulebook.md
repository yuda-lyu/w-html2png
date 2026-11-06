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
- `opt.rejectOnPageError`(預設 false):監聽 `pageerror`,截圖前有錯即視為該次失敗(訊息含全部頁內錯誤),依 `retry` 重試。預設行為不變。檢查之時點須於頁面完成之後(R18),否則晚於 `networkidle` 之頁面錯誤會漏判。
- 測試:`test/unit-pageError.test.mjs`、`test/unit-pageSettle.test.mjs`、`test/unit-pageSettleFake.test.mjs`。

### R8 建置
- `toolg/` 之發布與建置腳本(`gDistRollup.mjs`、`cleanFolder.mjs` 等)依 `C:\opensrcOper\dspec\自有套件之發布與建置腳本.md`,本套件不另立寫法(2026-11-02 起;原「以腳本位置推導 `src`/`dist`」已依該文件撤,改回 `'./src'`、`'./dist'`)。
- `toolg/gDistRollup.mjs` 之選項:`runin:'nodejs'`;external/globals 涵蓋所有用到之 Node 內建模組與 `playwright-core`(含 wsemi `fsEnsureBins` 所需之 `url`、`crypto`、`stream`、`stream/promises`、`child_process`、`os`);失敗時印出並 `process.exitCode = 1`(不得只 `console.log`)。
- 盤點:Grep `catch` 於 `toolg/gDistRollup.mjs`。
- 測試:`test/unit-dist.test.mjs`(依 dspec 規則 4:把 `src/`、`toolg/gDistRollup.mjs`、`package.json` 複製到 `test/_tmp/dist/<名>/`,以 `spawn` 指定 cwd 執行 toolg 腳本;離開碼 0、0 筆 could not be resolved、無 invalid runin、產物存在、外部模組 ⊆ Node 內建 ∪ dependencies、可載入並匯出 `close`;語法錯 → 離開碼 1)。`test/unit-binManifest.test.mjs` 另以文字檢查 `globals` 與 `external` 同一份且涵蓋上列模組。

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
- 模板網址:lodash 為 `https://cdn.jsdelivr.net/npm/lodash/lodash.min.js`;自有套件 wsemi 為 `https://yuda-lyu.github.io/wsemi/dist/wsemi.umd.js`(2026-11-02 依 dspec〈自有套件之瀏覽器端取用與gh-pages〉規則 2 自 jsDelivr `/npm/` 改指 gh-pages),以 `context.route` 由本機 `lodash/lodash.min.js`(相依 `lodash`)與 `wsemi/dist/wsemi.umd.js` 供應;每行程讀檔一次快取。
- 本機檔案先自本套件根解析(`src/pkgRoot.mjs`,被打包進他套件時仍可得),再自模組位置解析;皆不可得時不攔截該網址(維持自 CDN 載入之舊行為)並於 stderr 提示一次,不得使出圖失敗。
- 測試:`test/unit-cdnLibs.test.mjs`(頁內 `_.VERSION` 等於已安裝之 lodash 版本、`w` 可用)。

### R12 alive:只有瀏覽器層錯誤才重啟,且以世代比對(D-11:H1)
- 常駐狀態為「世代」物件(瀏覽器 Promise+其 context 快取);重試前只有瀏覽器層錯誤(瀏覽器已啟動但 newContext/routeLibs 失敗〔錯誤附世代〕、newPage 失敗、或出圖後瀏覽器已斷線)才關閉,且只關本呼叫所用且仍為現行之世代(啟動失敗者世代已自動歸零,不需關閉);`getContext` 寫快取前比對世代;`WHtml2png.close()` 後,其前開始之呼叫於每次取得 context 前(含等待 funGetUrl 之後)檢查而不再啟動或重試,其後之呼叫正常啟動新世代。
- 測試:`test/unit-alive.test.mjs`(頁面層錯誤不連累並發呼叫;close 時有進行中呼叫不重啟;close 發生於等待 funGetUrl 期間不啟動瀏覽器)。

### R13 安裝完成與清掃(2026-10-29 廢止)
- 完成標記、擁有標記、`.dl-*`/`.old-*`/`.lock-*` 之清掃隨自寫下載一併移除;快取之完整性改為每行程首次逐檔校驗(R16、dspec D4)。`src/` 寫檔站點全集見 R5。`toolg/gDistRollup.mjs` 依 dspec〈自有套件之發布與建置腳本〉(見 R8;原「清空 `dist/` 之路徑以腳本位置推導」於 2026-11-02 撤)。

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

### R17 單次出圖之允許時長 `opt.timeout`:未給即與現行完全相同;瀏覽器卡死時限時處置,強制結束須確認歸屬(2026-11-03 h2p60,Gitea #60)
- 來源:Gitea #60(使用端):以真 chrome 暫停行程實測,`context.newPage()`、`page.close()`、`browser.close()` 無時限,卡住時 `opt.retry` 不起作用,呼叫端無從判斷。
- 規則:
  1. **輸入**:`opt.timeout` 以 wsemi `isenum(v, { use: 'positive', max: 2147483647 })` 判定,有效(數字或數字字串)取 `Number(v)`,其餘(含超過計時器上限)一律視為未給(null,不限時)——dspec〈輸入參數之檢測機制〉K3、N2 範圍子型。未實作 `opt.debug`(該規格草案;本函數其他 opt 鍵亦無)。
  2. **未給時不變(P3)**:`timeout === null` 時 `execLimited` 直接 `exec`;不取 pid(不查 CDP)、不建 `raceLimit` 計時器、`WHtml2png.close()` 與閒置關閉對未曾給過 `timeout` 之世代維持不限時 `await browser.close()`(`closeGen` 之 `g.guarded !== true` 分支);single 之 `release` 為單次 `browser.close()`。
  3. **每次嘗試**各有此時長(`raceLimit(exec, timeout)`),逾時視為該次失敗依 `retry` 重試;訊息 `timeout[Nms] in <步驟>` 加註處置結果(`notes`);步驟名由 `setStep` 記錄(與 `onTrace` 之 `step` 事件同源)。重試前等待 5 秒不變,不計入 `timeout`。
  4. **頁面層**:逾時時已有頁面且 `timeProbe`(5 秒)內關得掉 → 瀏覽器可回應,不重啟,不牽連並發呼叫(R12);single 之瀏覽器為本呼叫專屬,照常釋放。
  5. **瀏覽器層**:已開始取用瀏覽器(`c.useBrowser`)且無頁面或頁面關不掉 → alive 關閉**本呼叫所用**之世代(`onToken` 於 `getGen` 後立即回報,非逾時當下之現行世代;`closeGen` 先歸零 `gen`,下次呼叫即啟動新世代,不論是否再重試)、single 釋放專屬瀏覽器。尚未取用瀏覽器(`funGetUrl` 卡住等)不動瀏覽器,只刪暫存 html。啟動中(`g.browser === undefined`)不等待啟動,完成後於背景關閉。
  6. **強制結束**(全域設定 §8.6):`closeBrowser` 於 `timeClose`(10 秒)內關不掉(或 `browser.close()` 拋錯而仍連線),才經 `killBrowser` 以 wsemi `execProcessKillPid`(樹狀;不用 `child.kill()`;結束指令本身限 `timeProbe`)結束;**結束前須確認歸屬**:pid 取自本瀏覽器自身 CDP 連線(`getBrowserPid`,`timeProbe` 限時;給了 `timeout` 者 alive 每世代共用、取不到最多再試一次〔`ensurePid`〕,single 每次啟動查一次)且瀏覽器仍連線(`isConnected()`)——已斷線(`gone`)、pid 未取得(`no-pid`)、連線狀態不明(`unverified`)皆**不殺**並於訊息寫明;pid 於結束當下才取值(關閉等待期間才查得者可用);結束後以 `disconnected` 事件回驗(`killed`/`unconfirmed`)。同一世代之關閉共用同一次處置(`g.pmClose`),不重複關閉或結束。判準為歸屬與健康,不用年齡。
  7. **被放棄之嘗試**不被等待:`c.cancelled` 使其於 `strategy.acquire`、`context.newPage()`、等待 `funGetUrl` 之後不再往下取用瀏覽器(`cancelled` 事件),取得者立即釋放,頁面步驟返回後不再往下(`checkCancelled`);single 於瀏覽器啟動完成即登記釋放函數(`onRelease`),其後取 pid 或建 context 卡住而逾時仍可關閉;其錯誤檔不覆寫逾時處置所寫者。計時器先於 `exec` 建立,使 `funGetUrl` 等同步前置耗時亦計入。
  8. **觀察回調** `opt.onTrace`(dspec〈計時器相關函數之觀察回調與測試〉):沿用 wsemi `getTrace`;事件 `attempt`、`step`、`timeout`、`page-close`、`browser-close`、`browser-kill`、`cancelled`、`retry`;未傳時不組事件物件。
- 站點全集與盤點:
  - Grep `setTimeout\(` 於 `src/WHtml2png.mjs`:`raceLimit`(逾時與限時探測之唯一擁有者)、`scheduleIdleClose`(閒置關閉,既有);另 `delay(5000)`(重試等待,既有)。
  - Grep `execProcessKillPid` 於 `src/`:只在 `killBrowser`(唯一強制結束出口);Grep `\.kill\(` 於 `src/` 須 0 筆。
  - Grep `browser\.close\(\)` 於 `src/WHtml2png.mjs`:`closeBrowser`(限時,guarded)、`closeGen` 之 `g.guarded !== true` 分支與 single 之 unguarded `release`/建 context 失敗(不限時,維持原行為,刻意不套)。
  - Grep `getBrowserPid\(` 於 `src/`:`ensurePid`(alive,guarded 才呼叫)與 single `acquire`(`guard` 才呼叫)。
- 已知限制:①歸屬確認依「pid 出自本瀏覽器自身 CDP 連線 + 仍連線」,不另以作業系統查詢父行程/建立時間(Windows 上行程仍在時 pid 不會被重用;playwright 於行程結束時才發 `disconnected`,結束到事件到達及 `taskkill` 啟動間之極短窗口無從排除;Node 無法持有行程控制代碼,Job Object 須原生整合,不採);②alive 世代若在任何給 `timeout` 之呼叫碰到它之前就卡死,pid 未取得而不殺(`no-pid`);③逾時前啟動中之 Chrome 於啟動完成後才關閉(背景),啟動本身(playwright 內 60 秒 launch 時限)不被中斷;④頁面層判定為「關得掉頁面」,renderer 全被暫停時頁面仍可能關得掉,下一次嘗試才在 `context.newPage()` 卡住而重啟瀏覽器(故救回同一張圖需 `retry` ≥ 3,預設值足夠);⑤依 issue 設計,尚無頁面(啟動/開頁/建 context)逾時即關閉本呼叫所用瀏覽器,`timeout` 過短(小於最壞啟動與開頁時間)會牽連 alive 並發呼叫,JSDoc/README 已寫明;⑥計時不含 `ensureBins`(其有自身逾時)與重試前等待;⑦單次出圖成功後釋放失敗(pid 不明等)僅經該次呼叫之 `onTrace` 可見;`WHtml2png.close()`/閒置關閉之處置結果不回傳亦不通知;結束指令限時 `timeProbe` 只停止等待,不取消已啟動之 `taskkill`;同步阻塞之 JS(如同步耗時之 `funGetUrl`)不可中斷,逾時以其返回後為準;⑧被放棄之嘗試其後的 `step`/`cancelled` 事件可能在呼叫已 reject 之後才通知。
- 測試:`test/unit-timeoutFake.test.mjs`(71 案;假瀏覽器 `test/tools/fakeChromium.mjs`:輸入檢測 33 格〔有效 7、非預期 25、getter 拋錯 1〕、門檻與重試以 `node:test` 假時鐘、頁面層/瀏覽器層/強制結束/pid 不明/已斷線不殺/啟動中/取消/funGetUrl/`close()` 限時與不限時/共用關閉/pid 延遲取值與重試/`onTrace` 五種回調案;主程序 pid 為測試啟動之真實空轉行程,以其 exit 事件驗證真的被結束或未被結束)、`test/unit-timeout.test.mjs`(8 案;真 chrome:alive/single 逾時訊息、並發不牽連〔以本機 `/ready` 事件放行〕、重試、非預期輸入出圖、時限內完成、啟動中逾時收尾)。暫停真 chrome 行程(renderer/主程序)須作業系統層暫停(Node 無跨平台 API),不入套件測試,實測證據見報告。
- 測試寫法要點:假時鐘於整檔只啟用一次(Node `mock.timers.reset()` 清空佇列時不重設計時器之佇列位置,前案被放棄之嘗試其後才執行的 `clearTimeout(舊計時器)` 會依殘留位置移除新佇列中他人之計時器,造成偶發懸置;查證見 `sgud/exp/experience.md`);須等「計時器已建立」時以 `page-close-start`/`browser-close-start` 事件同步,不以固定 flush 次數。
- 改動範圍 → 測試:改 `WHtml2png.mjs` 之 `core`/逾時處置/世代 → 全套(本套件無 `e2e-` 檔,每輪全跑)。

### R18 頁面完成之判定:載入返回不代表頁面完成,檢查頁面錯誤與截圖前須等 `load` 與靜止窗(2026-11-03 h2p236)
- 根因:playwright 之 `networkidle` 是 Node 端 500ms 計時器(`node_modules/playwright-core/lib/coreBundle.js` `_startNetworkIdleTimer`:無進行中請求即起算),與 `load` 及頁面執行進度無關;模板之 `wsemi.umd.js`(1.37MB)下載完成後,解析與執行期間沒有網路活動,此後才輪到 body 與頁尾腳本,耗時超過 500ms(負載高、腳本大、同步運算)時 `goto`/`setContent` 早於頁尾腳本返回。
- 規則(單一擁有者 `src/WHtml2png.mjs` 之 `waitPageSettled`、`trackPage`;於 `exec` 之載入步驟與 `funPageWait` 之間呼叫):
  1. **load**:`page.waitForLoadState('load')`。解析完成,同步腳本與 `load` 事件處理已執行。順序保證:`Runtime.exceptionThrown` 與 `Page.lifecycleEvent` 同屬主框架之 CDP session,依序送達;playwright 依序轉發(server `addPageError` → 同一 dispatcher 連線之 `pageError`、`loadstate`),故 `load` 送達用戶端時,其前之頁面錯誤必已收到。
  2. **靜止窗**:進行中之請求清空後,以 `page.evaluate` 內 `setTimeout` 等到「自 `load` 與最後一次網路活動起 `timeSettle`(500ms)」;窗內有新活動則再開一窗。保證:頁面計時器依到期時間排序,本計時器到期時刻 ≥ `tActive` + 500ms,故 `load` 前所設、延遲 ≤ 500ms 之計時器必先執行,不受主執行緒壅塞影響;已過窗長亦往返頁面一次(1ms),使已排入之回報(未處理之 rejection 於下一個工作才回報)先處理;`evaluate` 之回應與頁面錯誤同 session 依序送達。追蹤以公開事件 `request`、`requestfinished`、`requestfailed`。
  3. **不因等待本身失敗**:上限 `timeSettleMax`(60 秒);限時內未 load、持續有請求、頁內計時器不回應、頁內等待反覆失敗(5 次,涵蓋頁面持續導覽)皆續往下,結果經 `onTrace` 之 `page-settled` 事件可見(`settled`、`no-load`、`busy`、`no-timer`、`error`)。保留 `waitUntil: 'networkidle'`(既有之「持續有請求」於 60 秒失敗之行為不變)。
  4. **導覽**:`evaluate` 因執行環境銷毀而失敗時重新等待新文件之 `load` 與窗。
  5. **與 R17**:新步驟名 `waitPageSettled`;等待期間逾時之處置同其他頁面步驟;頁面關閉即結束等待(`page.on('close')`),不留 60 秒計時器。
- 盤點:Grep `waitUntil` 於 `src/`:只在 `exec` 之 `goto`、`setContent`,其後必經 `waitPageSettled`(站點全集 2 處,皆已套);Grep `page\.screenshot|waitForFunction` 於 `src/`:只在 `exec` 且在 `waitPageSettled` 之後;Grep `page\.on\(` 於 `src/`:`pageerror`(`rejectOnPageError` 才掛)與 `trackPage` 五個事件。
- 已知限制:①窗外之非同步(延遲超過 500ms 之計時器、巢狀計時器、窗後才發之請求)不在保證內,由 `opt.funPageWait` 表達;②請求結束與其回呼(`fetch().then`)之先後由瀏覽器排程,回呼於窗內執行屬實務保證(同為就緒工作,窗計時器至少晚 500ms 到期),非規範保證;③頁面把 `setTimeout` 換成不呼叫回呼者,等滿 60 秒才續往下;④worker、跨行程 iframe 之頁面錯誤走其他 CDP session,與主框架 `load` 無順序保證;⑤每次出圖約多 `load` 與最後一次請求結束之間的時間。
- 測試:`test/unit-pageSettleFake.test.mjs`(假瀏覽器＋假時鐘:事件順序閘門、窗之起算、窗內請求、導覽、五種結果、與 `timeout` 之互動、回調案)、`test/unit-pageSettle.test.mjs`(真 chrome:head 內同步阻塞 1500ms 使 `networkidle` 必早於頁尾腳本,決定性重現,不依賴負載)、`test/unit-dist.test.mjs`(打包後頁內等待函數可於頁面內執行)。
- 測試寫法:要重現本競態不必靠負載,`execJsHead` 同步阻塞 > 500ms 即可;假瀏覽器之 `cfg.load`/`cfg.settle`/`cfg.nav` 與 `page.emit`、`page.waitOrder` 控制順序。
- 改動範圍 → 測試:改 `exec` 之載入至截圖段、`waitPageSettled`、`trackPage` → 全套。

## 已知限制

- 未給 `funGetUrl` 時以 `setContent`(about:blank)載入,html 內本機 `file://` 與相對路徑資源不會載入(審計 p09 實測);須用 data URL 或給 `funGetUrl`。
- 首次取得 chrome:下載約 198MB(8 分割)、解出 421MB;每個行程首次使用時校驗 107 檔(雜湊 421MB,約 0.5 秒,負載高時數秒)。
- Node 被強制終止時 Chrome 行程樹可能成孤兒(playwright 只靠 exit handler)。
- 下載使用 Node 全域 fetch,預設不讀 HTTP(S)_PROXY(Node 24 可設 `NODE_USE_ENV_PROXY=1`)。
- 解壓依賴 Windows 內建 `%SystemRoot%\System32\tar.exe`(bsdtar)。
- alive 之「瀏覽器層錯誤→關閉本世代→重試成功」路徑以讀碼與單元結構保證,未以殺 chrome 行程之方式實測(會干擾平行之其他測試)。

## 破壞性/行為變更紀錄

- (h2p236,2026-11-03)載入後一律等 `load` 與靜止窗(R18):每次出圖約多 `load` 與最後一次請求結束之間的時間;負載下原本會漏判之頁面錯誤改為失敗、原本空白或未完成之圖改為完整;永不 `load` 之頁面最多多等 60 秒(仍出圖);步驟名新增 `waitPageSettled`、`onTrace` 新增 `page-settled`。靜態頁面之 PNG 位元組不變。

- (實作 run03,2026-10-16)見 `C:\opensrcOper\dnow\20261014075905\agent-out\run03-修正報告.md` 之行為變更清單。
- (bin-html2png,2026-10-29)見 README〈Breaking changes〉與 `C:\opensrcOper\dnow\20261028054319\agent-out\bin-html2png-修正報告.md`:chrome 改經 `ensureBins`(快取 `bin-cache/`)、移除舊位置查找、`W_HTML2PNG_CHROME_DIR`、`W_HTML2PNG_SKIP_DOWNLOAD`、`postinstall`、`src/autoDownloadFiles.mjs` 等與主幹 `chrome/`;取不到 chrome 之字串改為 `[錯誤碼] 說明`。
