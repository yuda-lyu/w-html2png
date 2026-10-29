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
- `toolg/gDistRollup.mjs` 寫死 `./src`、`./dist`(相對 cwd):驗證時把 src 與該腳本複製到 `tmp/build/<變體>/`,以 spawn 明定 cwd 執行,絕不在 repo 根跑(會清空 repo 之 dist)。

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
