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

### R2 Chrome 定位:永不寫入 cwd;新位置與 cwd 無關
- 順序:`opt.executablePath` > 環境變數 `W_HTML2PNG_CHROME_DIR`(須為絕對路徑,否則 reject)> 本套件根(模組位置推導 `src/`、`dist/` 之上一層並以 `package.json` 之 name 驗證;被打包進他套件時以 `createRequire(import.meta.url).resolve('w-html2png/package.json')`)之 `chrome/` → 主位置 `<chromeRoot>/<verChrome>/portable/App/Chrome-bin/<verChrome>/chrome.exe`(以完成標記判定)。
- 舊位置(D-12,**唯讀查找、deprecated、下一主版移除**,以「exe 存在」判定):`<pkg>/chrome/portable/…`、`<cwd>/chrome/portable/…`、`<cwd>/node_modules/w-html2png/chrome/portable/…`。只找已存在者,永不寫入。
- 皆無則下載安裝至主位置;套件根不可得且無環境變數 → reject 並提示 `W_HTML2PNG_CHROME_DIR` 與 `opt.executablePath`。
- 套件根之推導只在 `src/pkgRoot.mjs`(單一擁有者),定位(`autoDownloadFiles.mjs`)與函式庫供應(`libRoutes.mjs`)共用。
- 頂層不得宣告 `__filename`/`__dirname`(R4)。
- 盤點:Grep `path\.resolve\(\s*['"]|process\.cwd\(` 於 `src/`,只允許在 `getChromeLayout` 之舊位置查找(唯讀)與 `WHtml2png.mjs` 之 fdHtml/fdErr 預設(使用者工作輸出,§11.1 場景 A);其餘新增站點一律違規。
- 測試:`test/unit-chromeLocate.test.mjs`。

### R3 首次下載跨行程安全
- 程式須長成:鎖檔 `<chromeRoot>/.lock-<ver>`(`wx` 建立;內容 pid、本機識別〔主機名+開機時間之雜湊,12 碼〕、非空 token;寫入失敗即刪除自建之空鎖再拋錯;持有期間計時器心跳更新 mtime,另於每片下載後、合併後、解壓後主動 touch)。等待者每一輪(含接手失敗、歸還後)都檢查逾時並等待 pollMs,不得同步空轉;過期=本機識別相同且 PID 已死,或鎖檔身分(dev/ino/size/mtime)於本機觀察連續 staleMs 未變(與兩機時鐘差無關);只接手一般檔案,以改名取得並比對改名前後身分,非同一物件則盡量歸還、不刪除;資料夾等其他項目一律不動,等到逾時並以含持有者資訊之訊息 reject。下載於本次建立之隔離夾 `<chromeRoot>/.dl-<ver>-<pid>-<ts>-<rand>-<host>`(非遞迴建立,已存在即失敗;只有確由本次建立者才於結束時刪除);驗證 SHA-256 → 合併 → 解壓(目標在隔離夾內)→ 驗證 exe → 寫入擁有標記與完成標記(含 chrome.exe/chrome.dll 大小)→ 一次改名安裝;改名失敗時重查主位置是否已完整,是則視為成功。同行程同模組實例另以 Promise 合併;下載失敗以 failCooldownMs(預設 60 秒)負快取,避免每次呼叫重下。
- 不得使用 `chrome/` 下之固定分片檔名或固定暫存名(`temp`、`portable.zip`)。
- 測試:`test/unit-chromeDownload.test.mjs`(同實例 3 次併發、2/3 行程、雙模組實例、心跳〔第 1 片費時 3 秒、staleMs 1.5 秒,分辨力:心跳失效則 16 次請求〕、被終止後重跑〔確認已建隔離夾與鎖後才終止〕、死者鎖接手、空鎖接手且不空轉、存活持有者逾時、鎖路徑為資料夾不動、雜湊不符、懸置逾時)。

### R4 打包相容
- 頂層不得宣告 `__filename`/`__dirname`;`import.meta` 只用 `url`(rollup UMD 墊片)。
- 盤點:Grep `^\s*(export\s+)?(let|const|var)\s+__(filename|dirname)` 與 `import\.meta\.(dirname|filename|resolve)` 於 `src/` 須 0 筆。
- 測試:`test/unit-dist.test.mjs`。

### R5 回傳結果物件之 fs 函式一律檢查回傳
- wsemi `fsRenameFolder`/`fsDeleteFolder`/`fsDeleteFile`/`fsCreateFolder` 回傳 `{error}` 不拋錯;本套件呼叫處須檢查,或改用會拋錯之 `fs` API 並處理。
- 盤點:Grep `fsRenameFolder\(|fsDeleteFolder\(|fsDeleteFile\(|fsCreateFolder\(` 於 `src/`,逐站點判定。
- 測試:`test/unit-chromeDownload.test.mjs`、`test/unit-errors.test.mjs`。

### R6 錯誤:reject 一律為字串,保留原因,去除 ANSI(D-5)
- 對外 reject 一律字串;非 Error 之拋出以 `String()` 轉;訊息去除 ANSI 色碼;寫錯誤檔失敗不得覆蓋原因;重試迴圈不得因 exec 例外而讀 undefined。
- 單一擁有者:`src/errToMsg.mjs`。
- 盤點:Grep `throw new Error|Promise\.reject\(` 於 `src/WHtml2png.mjs`,對外路徑皆經 `errToMsg`。
- 測試:`test/unit-errors.test.mjs`。

### R7 頁面端失敗可被呼叫端得知(D-1:P1)
- `opt.rejectOnPageError`(預設 false):監聽 `pageerror`,截圖前有錯即視為該次失敗(訊息含全部頁內錯誤),依 `retry` 重試。預設行為不變。
- 測試:`test/unit-pageError.test.mjs`。

### R8 建置
- `toolg/gDistRollup.mjs`:`runin:'nodejs'`;external/globals 涵蓋所有用到之 Node 內建模組與 `playwright-core`;失敗時印出並 `process.exitCode = 1`(不得只 `console.log`)。
- 盤點:Grep `catch` 於 `toolg/gDistRollup.mjs`。
- 測試:`test/unit-dist.test.mjs`(由 src 建至 `test/_tmp`:離開碼 0、0 筆 could not be resolved、無 invalid runin;語法錯 → 離開碼 1)。

### R9 測試寫法
- 出圖斷言以語意(PNG、尺寸、非白像素、頁內自檢色)為主,對基準圖用容差比對(通道差>16 之像素數 ≤ 門檻),不逐位元;超容差三聯組落 `./testPending/`。
- 下載類測試永不連外:本機 HTTP(埠 9040–9059)供應假分片,搭配注入之清單(manifest);會觸及公開定位函式之子行程一律預載 `test/tools/fetchBlock.mjs`(任何 fetch 即拋錯)。
- 臨時檔只放 `test/_tmp/<案名>/`,`after` 刪除;不得用 `./tmp/`。
- 盤點:Grep `deepStrictEqual\(rr, rt\)` 於 `test/` 之出圖案須 0 筆。

### R10 受版控之 Chrome 分片為所有版本之下載來源(D-4)
- `chrome/portable.zip.001`~`008`、`chrome/ver.txt` 永不刪改(master 上亦然;舊版之下載網址指 master)。
- 下載網址釘選 commit `5ebfb11fa2bb99a275cb5f511dd1712171978572`(其 `chrome/` 樹與 2026-10-16 之 HEAD 逐 blob 相同),程式內附各片 SHA-256 與大小,下載後核對;不新增分片檔進 repo。
- 換 Chrome 版本時:新分片以新 commit 提交後,清單改指該 commit 並更新雜湊;既有分片仍不刪改。
- `.gitignore` 排除 `chrome/*/`、`chrome/.*`(安裝產物、隔離夾、鎖)。
- 盤點:`git ls-files chrome` 恆為 9 檔;`git status --short chrome/` 恆空。
- 測試:`test/unit-manifest.test.mjs`(清單雜湊=受版控檔;釘選 commit 之樹=HEAD)、`test/unit-chromeDownload.test.mjs`(新 clone 版面之分片不被動到)。

### R11 頁面注入之函式庫以本機供應(D-3:C3)
- 模板網址不變(`https://cdn.jsdelivr.net/npm/lodash/lodash.min.js`、`…/wsemi/dist/wsemi.umd.js`),以 `context.route` 由本機 `lodash/lodash.min.js`(相依 `lodash`)與 `wsemi/dist/wsemi.umd.js` 供應;每行程讀檔一次快取。
- 本機檔案先自本套件根解析(`src/pkgRoot.mjs`,被打包進他套件時仍可得),再自模組位置解析;皆不可得時不攔截該網址(維持自 CDN 載入之舊行為)並於 stderr 提示一次,不得使出圖失敗。
- 測試:`test/unit-cdnLibs.test.mjs`(頁內 `_.VERSION` 等於已安裝之 lodash 版本、`w` 可用)。

### R12 alive:只有瀏覽器層錯誤才重啟,且以世代比對(D-11:H1)
- 常駐狀態為「世代」物件(瀏覽器 Promise+其 context 快取);重試前只有瀏覽器層錯誤(瀏覽器已啟動但 newContext/routeLibs 失敗〔錯誤附世代〕、newPage 失敗、或出圖後瀏覽器已斷線)才關閉,且只關本呼叫所用且仍為現行之世代(啟動失敗者世代已自動歸零,不需關閉);`getContext` 寫快取前比對世代;`WHtml2png.close()` 後,其前開始之呼叫於每次取得 context 前(含等待 funGetUrl 之後)檢查而不再啟動或重試,其後之呼叫正常啟動新世代。
- 測試:`test/unit-alive.test.mjs`(頁面層錯誤不連累並發呼叫;close 時有進行中呼叫不重啟;close 發生於等待 funGetUrl 期間不啟動瀏覽器)。

### R13 安裝完成與清掃
- 主位置以完成標記 `<chromeRoot>/<ver>/.installed`(安裝前寫入隔離夾、隨改名一併就位;記錄 chrome.exe/chrome.dll 大小,定位時核對)判定;標記缺、或檔案大小不符(被截斷/隔離)→ 視為殘缺。殘缺之 `<ver>` 只有在為一般資料夾(非 junction)且有擁有標記 `.w-html2png-owner` 時才移開(改名為 `.old-*`;若移開者其實完整則還原並視為完成)後刪除;**無擁有標記者一律不刪,reject 並提示改用專用資料夾**。舊位置沿用「exe 存在」。
- 只刪除本套件自建之項目:`.dl-*`/`.old-*`(須為一般資料夾)、`.lock-<ver>.stale-*`(一般檔案)、以及每行程首次定位成功時之 `.lock-<ver>`(合法內容且本機持有者已死);名稱內之本機識別須等於本機且 PID 已死(PID 存活或他機者一律保留;他機殘留不清,屬已知限制)。清掃時機:取得鎖後、每行程首次定位成功時(主位置或舊位置)。不得刪除其他任何檔案(使用者之 `chrome/temp`、`portable.zip*`、同名但非本套件所建之 `<ver>` 等)。
- 站點全集(2026-10-16 盤點;Grep `rmSync|rmForce|unlinkSync|renameSync|renameRetry|writeFileSync|mkdirSync` 於 `src/`,另含被呼叫之 `w-zip/src/replaceTarget.mjs`、`wsemi/src/fsMergeFilesCore.mjs`):
  - `fileLock.mjs`:建立鎖(`wx`)、寫入失敗刪自建空鎖、心跳 `utimesSync`(只更新自己之鎖)、釋放(token 相符才刪)、接手改名/歸還(身分比對,不刪他方鎖)——已套。
  - `downloadFiles.mjs`:`mkdirSync(root)`(只建立)、`mkdirSync(fdWork)`(非遞迴)、隔離夾內分片/zip/標記之寫入與刪除、`sweep`(上條規則)、殘缺 `<ver>` 移開(擁有標記)、改名安裝、finally 刪隔離夾(createdWork)——已套。
  - `w-zip` `replaceTarget`:暫存與目標皆在隔離夾內(目標不存在,不產生備份)——已套。`wsemi` `fsMergeFiles`:輸出與切片皆在隔離夾內——已套。
  - `WHtml2png.mjs`:fdHtml 暫存 html(`wx` 排他建立,只刪自建者)、錯誤檔(writeError,寫入失敗只附記)——已套(屬使用者工作輸出,cwd 相對為刻意)。
  - `toolg/gDistRollup.mjs`:清空 `dist/`(rollupFiles),路徑以腳本位置推導,不隨 cwd——已套。
- 測試:`test/unit-chromeDownload.test.mjs`、`test/unit-chromeLocate.test.mjs`。

### R14 postinstall 與執行期同一函式
- `scripts/install.mjs` 呼叫 `src/autoDownloadFiles.mjs`(同一定位/下載);非 win32 直接返回;環境變數 `W_HTML2PNG_SKIP_DOWNLOAD` 為真則返回;是否位於 node_modules 以路徑段判斷;失敗只印出、離開碼 0(刻意,不使安裝失敗)。
- 測試:`test/unit-install.test.mjs`。

### R15 平台(D-10)
- 未給 `executablePath` 時限 Windows(免安裝 Chrome 只有 Windows 版);給 `executablePath` 時不限平台。
- 測試:`test/unit-errors.test.mjs`(以子行程覆寫 `process.platform`)。

## 已知限制

- 未給 `funGetUrl` 時以 `setContent`(about:blank)載入,html 內本機 `file://` 與相對路徑資源不會載入(審計 p09 實測);須用 data URL 或給 `funGetUrl`。
- 首次下載資源峰值:記憶體推估 450MB 以上、磁碟約 600MB。
- Node 被強制終止時 Chrome 行程樹可能成孤兒(playwright 只靠 exit handler)。
- 下載使用 Node 全域 fetch,預設不讀 HTTP(S)_PROXY(Node 24 可設 `NODE_USE_ENV_PROXY=1`)。
- 他機崩潰留在網路共用 chrome 根之 `.dl-*` 不會被清掃(不以本機 PID 判他機);心跳計時器在呼叫端長時間同步阻塞事件迴圈時會停頓(各步驟另有主動 touch,且安裝步驟對雙安裝者安全)。
- `W_HTML2PNG_CHROME_DIR` 應指向專用資料夾;其中已有同名但非本套件所建之 `<ver>` 時會 reject(不刪除)。
- alive 之「瀏覽器層錯誤→關閉本世代→重試成功」路徑以讀碼與單元結構保證,未以殺 chrome 行程之方式實測(會干擾平行之其他測試)。

## 破壞性/行為變更紀錄

- (實作 run03,2026-10-16)見 `C:\opensrcOper\dnow\20261014075905\agent-out\run03-修正報告.md` 之行為變更清單。
