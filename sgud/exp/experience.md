# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

## 2026-10-14/16 審計 run01

### 不要下載真 Chrome(約 200MB)
- 預設 Chrome 依 cwd 定位(現況),cwd=repo 根時用 `chrome/portable/…/138.0.7204.97/chrome.exe`,不觸發下載;**cwd 改到別處就會開始自 GitHub 下載**。
- 凡可能觸發下載之探測/測試,一律於子行程以 `node --import <fetch 替身>` 預載全域 fetch 替身:wsemi `fsDownloadFile` 用全域 `fetch`,src 與 dist(內嵌 wsemi)皆可被攔截,不需改產品碼。審計用之替身與假分片產生器:`tmp/probe/stub/fetch-stub.mjs`、`tmp/probe/stub/make-fake-shards.mjs`(zip 頂層須為 `portable/`,與真檔一致)。
- 跨行程競態要重現,假分片須節流(每片約 400ms);不節流時視窗太窄。

### 擷取實際組出之 html 而不開瀏覽器
- 給 `opt.funGetUrl`,於回呼中讀出暫存 html 後拋錯、`retry:1` → 可逐字取得 `g`,一格只需數毫秒(`tmp/probe/p01-template.mjs`)。

### 頁面端結果之語意斷言
- 頁內自檢後把整頁塗綠/紅,未塗(白)代表腳本壞掉;自檢碼本身以 `String.fromCharCode` 組期望字串,避免自身含 `$` 或 `<`。PNG 以 zlib 自解碼(`tmp/probe/lib/png.mjs`)取中心色/非白像素,不逐位元。

### Git Bash 與 node 之路徑
- `$(pwd)` 得 `/c/...`,交給 node 之 `--import file:///…` 會 ERR_INVALID_FILE_URL_PATH;用相對路徑或 `pwd -W`(Windows 形式)。

### 下游
- 依賴本套件者(C:\opensrc 內)只有 w-hc2png:引 main(dist,外部化),測試深層引用 `w-html2png/src/autoDownloadFiles.mjs`;其繪圖碼依賴模板之 `_`(lodash)。改 `exports`、模板函式庫、autoDownloadFiles 之回傳形狀前須評估。
- 兄弟套件 8 個(w-kriging、w-html2docx、w-docx2pdf、w-ffmpeg、w-docx2html、w-docx-split、w-process-status、w-dwload-dlp)沿用相同 autoDownloadFiles 樣式,不是本套件之下游。

### 建置驗證
- `toolg/gDistRollup.mjs` 寫死 `./src`、`./dist`(相對 cwd):驗證時把 src 與該腳本複製到 `tmp/build/<變體>/`,以 spawn 明定 cwd 執行,絕不在 repo 根跑(會清空 repo 之 dist)。(2026-11-02 依 dspec〈自有套件之發布與建置腳本〉撤,改回標準寫法)

## 2026-10-16 實作 run03

### 測試注入與安全網
- 下載核心以依賴注入測試:`ensureChrome({ manifest, fdChromeRoot, legacy:false, ... })`,清單指本機分片伺服器(埠 9040)之假分片;**一定要 `legacy:false`**,否則在 repo 內會命中 repo 自身之 `chrome/portable`(舊版面唯讀查找)而不下載,測試看似通過其實沒驗到。
- 會觸及公開 `autoDownloadFiles` 之子行程一律 `--import test/tools/fetchBlock.mjs`(只放行 127.0.0.1/localhost);在行程內開真 Chrome 之測試檔頂部 `import ./tools/fetchBlock.mjs`。
- 求「修前紅」時以 HEAD 之 src 加墊片(tmp/before-shims/,行為等價於 HEAD)逐檔跑 mocha(一檔載入失敗會中止整批),全程 `NODE_OPTIONS=--import=<fetchBlock>`;HEAD 依 cwd 定位,`tmp/before/chrome` 以 junction 指向 repo/chrome,事前事後比對受版控分片雜湊。

### junction 之刪除
- 刪 junction 一律 `fs.rmdirSync(link)`(或 `cmd //c rmdir`),不跟隨刪除目標;含 junction 之資料夾先逐一移除 junction 再遞迴刪除。

### 下游驗證(w-hc2png)
- 不改其 repo:複製(不含 node_modules/.git/tmp)至 tmp/hc2png,node_modules 逐項 junction 指回原處,唯 w-html2png 指向 tmp/stage/w-html2png(由新 src 建出 dist);stage/chrome 以 junction 指向 repo/chrome(新版之舊版面唯讀查找即可找到)。

### 外審派工
- opencode(deepseek)之 `bash:"ask"` 在非互動下被拒後,模型即結束、無產出;`bash` 改為指令樣式物件(`{"git *":"allow",...}`)實測無效。可行作法:維持 ask,並在提示詞文首明示「不要嘗試任何 shell 指令,改讀預先產出之 diff 檔」。
- opencode 讀 repo 以外之路徑會觸發 external_directory 詢問而被拒、模型即結束:派工前把背景文件複製進 repo 之 ./tmp 並改提示詞路徑;glob 工具看不到 node_modules(.gitignore),要在提示詞給明確路徑以讀檔工具直接讀。
- codex 以 `sandbox:read-only` + `--output-last-message <報告路徑>` 讓報告由 CLI 落檔,不需給寫入權。

### 其他
- `npm i lodash@^4.17.21` 實際裝入 4.18.1 並寫成 `^4.18.1`(與 CDN 現版相同),使「頁內 _.VERSION 等於本機版本」之斷言無法分辨本機或 CDN;改以 `context.setOffline(true)` 斷言才有分辨力。
- H3(alive 每次新 context)實測中位數 694ms vs 重用 634ms(+約 10%),依裁示未採。

## 2026-10-29 bin-html2png(改用 wsemi fsEnsureBins 之檔案組)

上兩節中「chrome 依 cwd/套件根之 `chrome/` 定位」「`ensureChrome`/`legacy:false`」「w-hc2png 測試以 junction 指 repo/chrome」等已隨自寫下載移除而不適用;現況見 `sgud/state/state.md`。

### 組之內容
- 舊碼直接啟動 `portable/App/Chrome-bin/<版本>/chrome.exe`(playwright 自給 user-data-dir),不經 `GoogleChromePortable.exe`;只含 `Chrome-bin/` 之組出圖與舊 portable 逐像素相同(testa、testb 對基準圖差 0)。查證腳本作法:以 `bin/chrome` 分割硬連結建本地鏡像 → `ensureBins({ cacheDir, mirror, offline:true })` → 兩個 chrome 各出圖比對。

### 測試供檔
- 出圖測試以 `test/tools/binEnv.mjs` 之 `await setBinEnv(tag)`:鏡像為 `bin/chrome` 分割之硬連結(不佔空間;只刪連結不動原檔;**不可對硬連結檔做竄改類測試**,竄改一律用假組或複本),組放預設快取 `<repo>/bin-cache/`(各測試檔共用)。冷跑(無 bin-cache)時 8 個 worker 各自解出再發布('exists'),約 +10 秒。
- 取得邏輯之測試用 `test/tools/fakeBundle.mjs`(同形小組:3 分割、5 成員＋1 個不列入之檔),假套件根為 `src/ensureBins.mjs`、`src/pkgRoot.mjs` 之副本＋假清單(`getFdPkg` 須 package.json 之 name 為 w-html2png),故變異 src 仍會被測到。
- fsEnsureBins 之同程序併發共用以「來源設定相同」判定,`fetch` 為每次新建之閉包時不共用('solo');併發測試須傳同一 fetch 參照。WHtml2png 不傳 fetch,故併發首呼叫共用同一次取得。
- 平行全套下各 worker 之首次校驗(雜湊 421MB)同時發生,會放大產品既有之頁面事件競態(`pageerror` 晚到、load 內塗色未入截圖);`setBinEnv` 於 before 先取得校驗一次使其不與出圖重疊。舊碼(定位只看完成標記)無此負載。

### 頁面事件競態之查證法
- 負載試驗:7 個行程反覆雜湊 `bin/chrome` 分割(CPU＋磁碟),單鎖內交替跑修前副本與現行碼之同一測試檔,比對失敗次數(`unit-pageError`「page errors are retried」舊 8/10、新 8/10 → 既有競態)。
- 歸因試驗須在他套件未佔另一槽時做;同時段他套件之變異測試會使失敗率劇烈上升(12 次中 9 次),結果不可用於歸因。
- 純 playwright 仿 single 流程(goto file://、頁尾 inline 拋錯、networkidle)20/20 於 goto 完成前收到 `pageerror`,故競態不在 playwright 之基本送達;下一步應在 WHtml2png 流程(`routeLibs` 之 route 攔截、模板)內以觀察回調記錄事件時點。(已查明,見〈2026-11-03 h2p236〉:該次仿製沒有 1.37MB 之 `wsemi.umd.js`,解析時間短,故重現不了。)
- mocha 之 JSON 報告(`--reporter json`)便於重複跑時收集失敗之案;要留失敗訊息時另存 `failures[].err.message`(本輪未存,事後無法回看)。

### 修前副本
- `git archive HEAD -- . ':(exclude)bin' ':(exclude)chrome'` 解到 `./tmp/<任務>/before/`,分割硬連結、`chrome/portable` 由分割解出、`node_modules` 以 junction 指回 repo;舊碼需 `w-zip`,以 `npm i --no-save w-zip@1.0.49` 暫裝(不改 package.json/lock),結束 `npm i` 清除。刪副本前先 `cmd //c rmdir` 拆 junction 並回驗 repo 之 node_modules 完好。

## 2026-11-03 h2p60(opt.timeout:單次出圖允許時長與瀏覽器卡死之處置)

### 測試鎖排隊久時的持鎖工作行程
- 測試鎖三槽被他套件 `npm test` 占用逾 1 小時時,每次迭代都重排隊不可行。作法:`nohup node C:/opensrcOper/tools/quiet-run.mjs --lock --name <名> --timeout 7200 -- node tmp/<名>/worker.mjs &`(detached),排到鎖後 worker 才開始,依序執行 `tmp/<名>/cmd/*.json`(`{id,args,env,cwd,timeoutSec}`),結果寫 `tmp/<名>/out/<id>.log|.done`,收到 `{quit:true}` 或閒置逾時即結束釋放;新指令檔按檔名排序即時被撿。不要在 worker 內再包 `quiet-run --lock`(同套件同時只能持一槽,會自己等自己)。背景指令時限(10 分鐘/2 小時)會殺掉排隊中的 quiet-run,故排鎖本身必須 `nohup`。

### 暫停真 chrome 的實測證據(只動本輪自己啟動者)
- Node 無跨平台暫停行程 API;psutil 未安裝時以 Python 標準庫 `ctypes`:`CreateToolhelp32Snapshot` 取父子關係 + `OpenProcess(PROCESS_SUSPEND_RESUME)` + `ntdll.NtSuspendProcess/NtResumeProcess`(`tmp/h2p60/susp.py`,以 driver 的 node pid 為根,找其子 chrome.exe〔=main〕與後代〔renderer/gpu/utility〕)。暫停前後都列出 main pid,清理只 `taskkill /T /F` 自己的 main。
- 暫停 renderer(main 仍可回應):頁面仍關得掉,下一次嘗試在 `context.newPage()` 才卡住 → 重啟;故救回同一張圖需 `retry` ≥ 3。暫停 main:`browser.close()` 不返回,須強制結束。

### 取得瀏覽器主程序 pid
- playwright 的 `browser.newBrowserCDPSession()` 送 `SystemInfo.getProcessInfo`,`processInfo.find(type==='browser').id` 即 chrome 主程序 pid;卡死後 CDP 不回應,故須在啟動後立即取(每世代一次)。取 pid 本身也要限時(`timeProbe`),否則卡住的瀏覽器會讓取 pid 一起卡住。

### 假 playwright 瀏覽器與假時鐘(unit-timeoutFake)
- 取代 `chromium.launch`(`test/tools/fakeChromium.mjs`),主程序 pid 指向測試啟動的真實空轉 node 行程,強制結束是否生效以該行程 `exit` 事件驗證;「pid 被重用」以「瀏覽器已斷線但 pid 指向仍存活的空轉行程」模擬,斷言該行程未被殺。
- `node:test` 的 `mock.timers.enable({ apis: ['setTimeout'] })` 只換 `setTimeout/clearTimeout`;`setImmediate` 仍真,故 `await new Promise(setImmediate)` 可作「讓 microtask 跑完」之同步點;`tick(ms)` 後必 flush 才可斷言。被測碼註冊計時器發生於 microtask 內,tick 前要先 flush(或等其前一個 trace 事件後再 flush)。
- **不要逐案 `mock.timers.reset()`/`enable()`**(h2p60 查出之偶發懸置,根因為推斷、以修前後失敗率佐證):Node 24 的 `reset()` 原始碼只把執行佇列 `shift` 清空,未重設各計時器的 `priorityQueuePosition`;推斷前一案被放棄之嘗試(orphan)其後才跑到的 `clearTimeout(舊計時器)` 會以殘留位置對新佇列 `removeAt`,把下一案的計時器(如 10 秒關閉限時)移除,該案即永遠等不到(未逐行驗證 `#clearTimer`)。現象:單獨跑過、同組連跑時 8/8 懸置、`--grep` 切換又過;改為整檔啟用一次後同檔連跑 10 次 10/10 通過。作法:整檔 `before` 啟用一次、`after` 才 reset,各案只相對推進;需真計時器的案放最後(案內 `reset()`)。
- 等事件的陷阱:`waitCount('step', n + 1)` 若該事件已全部發生則永遠不來,改用帶謂詞的 `wait('step', e => e.attempt===2 && e.step==='funPageWait')`。
- 真 chrome 的並發測試要「事件放行」另一個呼叫時,頁面端不可持續輪詢網路(`networkidle` 會等不到);改以 `funGetUrl` 回本機同源頁,`funPageWait` 內同步 XHR 讀 `/ready`(在 networkidle 之後才執行)。

### 輸入檢測
- `opt.timeout` 以 wsemi `isenum(v, { use: 'positive', max: 2147483647 })` 判定、`Number(v)` 取值(數字字串有效,`'10s'`、`0`、負數、`Infinity`、超上限皆視為未給);`'positive'` 為 `gt:0`,與 `'timer'`(含 0)不同。

## 2026-11-03 h2p236(頁面完成之判定:networkidle 早於頁尾腳本)

### 查根因的作法
- **不改 src 取事件時點**:探測腳本包裝 `chromium.launch` → `browser.newContext` → `context.newPage`(playwright 物件之實例屬性可覆寫),對頁面掛 `load`、`pageerror`、`console`、`request`、`requestfinished`,並包 `goto`、`setContent`、`waitForLoadState`、`evaluate`、`screenshot`,以同一 `Date.now()` 記時;src 副本與 repo 共用同一個 playwright-core(副本之 `node_modules` junction,Node 解析為實體路徑),故包裝對副本之 src 同樣生效。
- **`networkidle` 不是頁面事件**:`coreBundle.js` 之 `_startNetworkIdleTimer` 是 Node 端 `setTimeout(500)`,無進行中請求即起算,與 `load` 無關。讀 playwright 內部時直接 Grep `lib/coreBundle.js`(1.61 起 server/client 同檔,無 `lib/server/frames.js`)。
- **決定性重現不需負載**:`execJsHead` 同步阻塞 1500ms(解析器停住、無網路活動)→ `setContent` 於 1518ms 返回、`pageerror` 與 `load` 於 2660ms 才到;3/3 漏判。「負載」只是把解析時間拉長到 500ms 以上之一種方式。負載下之實例:wsemi 請求結束 1129ms → 載入返回 1632ms(恰 +503)→ 頁尾腳本 1927ms → `pageerror` 1930ms → `load` 1949ms,而截圖開始於 1632ms。
- **同步阻塞重現不了「白圖」**:主執行緒被 JS 佔住時,截圖要等它放開,放開後頁尾同步塗色已完成,修前也是綠(`unit-pageSettle` 之頁尾塗色、html 內容、`load` 內塗色 6 案修前即綠)。真實之白圖發生在主執行緒閒置而解析器仍停住之時(推測為大型腳本於背景執行緒編譯,未實測);修前會紅之塗色案要用「計時器塗色」,或以假瀏覽器閘門斷言順序。
- **未讀取 body 之 `fetch` 不算結束**:`fetch(url).then(paint)` 未讀 body 時 `requestfinished` 不發生(實測等滿 60 秒,`page-settled` 為 `busy`),playwright 之 `networkidle` 同樣視為進行中;測試要 `res.text()`。

### 測試
- 假瀏覽器之 `page.waitOrder(name, n)`、`page.emit(ev, arg)`、`cfg.nav`/`cfg.load`/`cfg.settle` 閘門可排出「`networkidle` → 頁面錯誤 → `load`」等順序。`mock.timers.setTime()` 只推進 `Date` 不觸發計時器,可驗「頁內計時器先於上限返回」之分支。
- 「失敗不報錯而只是不等」之設計(如頁內等待函數打包後失效)須以 `page-settled` 之結果斷言,否則整段保證無聲失效(`unit-dist` 已加)。

### 排鎖
- `quiet-run --lock-exclusive -- node batch.mjs <批次json>`:批次檔於取得鎖後才讀,排隊期間可持續補項目,取得一次獨佔就把要獨佔做的事做完,不重排。
- 負載試驗須於凍結碼,獨佔排隊可達 1～3 小時(本輪 17:45 排、撤回後 19:30 再排、21:04 才取得;他套件 `npm test` 單次近 2 小時):**先以一般鎖跑完決定性測試、變異與 5 次全套,再排獨佔**,批次依優先序排,時限到可中止而以完整輪計次。
- 壓力下單輪(8 檔子集)約 35 秒;全套約 65 秒。

### 修前副本之鏈結
- Git Bash 以 `cmd //c mklink //J` 建 junction 時,雙引號內 `\\$d` 之 `$` 被跳脫而字面化,建出 `h2p236$d$sub` 之連結;改以 `.mjs` 之 `fs.symlinkSync(target, link, 'junction')`。刪除前以 `lstatSync().isSymbolicLink()` 不跟進列出,`fs.rmdirSync` 只拆連結本身。

### 工具
- ESLint 8 以非 ASCII 絕對路徑為參數時回「No files matching」;以 `quiet-run --cwd <repo> -- npx eslint --ext .mjs src test` 之相對路徑執行。
- 1.0.53 以前之 `downloadFiles` 自 `github.com/yuda-lyu/w-html2png/raw/refs/heads/master/chrome/` 下載;1.0.54 起釘 `5ebfb11f…`。查舊版下載來源用 `git grep -n "github" <提交>^ -- src`。
