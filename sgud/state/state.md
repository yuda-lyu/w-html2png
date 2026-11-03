# 狀態

本檔記當前已開發功能之最新狀態(只記現況;過程見 `sgud/exp/experience.md`)。規則見 `sgud/rule/rulebook.md`。

- 最近一次更新:2026-11-03(h2p236:頁面完成之判定,修 `networkidle` 早於頁尾腳本之競態,規則 R18;與 h2p60 之 `opt.timeout`、`opt.onTrace`〔R17,Gitea #60〕一起待主控複審發布;`package.json`、`dist/`、`script.txt` 未動)。前次:2026-11-02(h2p267:`toolg/` 改回 dspec〈自有套件之發布與建置腳本〉標準寫法)。
- 最近一次驗證(h2p236,2026-11-03):`npm test` 連跑 5 次 5/5 全綠(284 案,同時段 `w-web-perm`、`w-web-sso` 佔另兩鎖位);`unit-pageSettleFake` 36、`unit-pageSettle` 21;22 個變異全數被擊殺;7 個壓力行程之負載試驗各 4 輪,有競態失敗之輪數:修前 HEAD 4、h2p60 3、修後 0(輪數偏少,獨佔鎖排隊所致,報告 `C:\opensrcOper\dnow\20261103132311\agent-out\h2p236-修正報告.md`);PNG sha256 七項與假瀏覽器呼叫序列 14 情境與修前相同;alive 每次出圖中位 622 → 708ms。
- 前次驗證(h2p60,2026-11-03):`unit-timeoutFake` 71 案同檔連跑 10 次 10/10 通過、`unit-timeout`(真 chrome)8/8、全套 `mocha --parallel "test/*.test.mjs"` 227 案(6 次中 4 次全綠;2 次僅 `unit-pageError`「page errors are retried according to retry」偶發紅,單檔重跑 10/10 綠,該競態已由 h2p236 修正);22 個變異全數被擊殺;未給 `timeout` 時假瀏覽器呼叫序列 14 情境與修前逐字相同、真 chrome 出圖 PNG sha256 7 項與修前相同;暫停真 chrome(renderer/主程序)實測見報告。前次驗證:2026-11-02 於套件根依 `script.txt` 實跑 `cleanFolder` → jsdoc → `gDistRollup`:`dist/` 兩檔與改前逐位元組相同(`w-html2png.umd.js` 113,784 位元組、`.map` 148,588 位元組),`docs/` 37 檔僅 8 個頁面之產生時間行不同;全套 `npm test`(mocha --parallel,11 檔)結果見報告 `C:\opensrcOper\dnow\20261102075126\agent-out\h2p267-修正報告.md`。前次:2026-10-29 全套綠,報告 `C:\opensrcOper\dnow\20261028054319\agent-out\bin-html2png-修正報告.md`。

## 功能現況

| 功能 | 狀態 | 規則 | 測試檔 |
|---|---|---|---|
| HTML 轉 PNG(single/alive 兩模式、重試、錯誤字串) | 完成 | R1、R6、R7、R12 | `unit-WHtml2png`、`unit-render`、`unit-alive`、`unit-pageError`、`unit-errors`、`unit-localRes` |
| 單次出圖允許時長 `opt.timeout`(每次嘗試;逾時分頁面層/瀏覽器層,限時關閉,確認歸屬後樹狀強制結束;未給或非預期輸入視為未給,流程與修前相同)與觀察回調 `opt.onTrace` | 完成(2026-11-03,待主控複審發布) | R17、R12 | `unit-timeoutFake`(假瀏覽器＋假時鐘)、`unit-timeout`(真 chrome) |
| 頁面完成之判定(載入返回後等 `load` 與靜止窗,才檢查頁面錯誤、`funPageWait`、截圖;不依機器負載) | 完成(2026-11-03,待主控複審發布) | R18、R7 | `unit-pageSettleFake`(假瀏覽器＋假時鐘)、`unit-pageSettle`(真 chrome,頁內同步阻塞)、`unit-dist` |
| 頁面函式庫(lodash、wsemi)本機供應 | 完成 | R11 | `unit-cdnLibs` |
| 套件自帶 chrome 經 `ensureBins`(wsemi `fsEnsureBins`,檔案組 `chrome`,釘選提交 `bf41fac5…`)取得;`opt.executablePath` 優先 | 完成(2026-10-29) | R2、R10、R14、R16 | `api-ensureBins`、`unit-binManifest`、`unit-dist` |
| UMD 建置(dist;`toolg/gDistRollup.mjs` 以 `'./src'`、`'./dist'` 相對 cwd,依 dspec〈自有套件之發布與建置腳本〉) | 完成(2026-11-02 改回標準寫法) | R4、R8 | `unit-dist`(副本＋指定 cwd 執行 toolg)、`unit-binManifest`(globals/external 文字檢查) |
| 平台限制(未給 executablePath 時限 Windows) | 完成 | R15 | `unit-errors` |

- 外部執行檔:`bin/chrome/portable.zip.001`~`008`(入 git、不入 npm 包)、`bin/manifest.json`(1 組 107 檔,421,065,985 位元組;組識別 `732088aa8aeb2be51a145a68b27b0fa247c111141a08f5437fef9af02977e797`)。主幹已無 `chrome/`。
- 對外入口:`WHtml2png`(default)、`WHtml2png.close`、`WHtml2png.ensureBins`;深層匯入 `src/ensureBins.mjs`。已移除:`src/autoDownloadFiles.mjs`、`src/downloadFiles.mjs`、`src/chromeManifest.mjs`、`src/fileLock.mjs`、`scripts/install.mjs`、`W_HTML2PNG_CHROME_DIR`、`W_HTML2PNG_SKIP_DOWNLOAD`。

## 已知缺口與待辦

- 下游 w-hc2png 之測試深層匯入 `w-html2png/src/autoDownloadFiles.mjs`(已移除),須於連動時改用 `ensureBins`(主控通報;本套件不改他套件)。
- 1.0.53 以前之版本自主幹 `chrome/` 下載,主幹移除後新環境首次使用得 HTTP 404(待主控／使用者裁示;比照 dspec S2 之 w-dwload-dlp)。
- `unit-render`「execJsPost string literal with plain is verbatim」於修前 HEAD 副本懸置 180 秒 1 次(2026-11-03,無壓力全套 5 次中 1 次),根因未定位,推測為 Chrome 卡住;修後 5 次全套與 4 輪壓力未見。
- 頁面完成之判定(R18)已知限制見帳本:窗外非同步須 `funPageWait`;`setTimeout` 被頁面換掉者每次多等 60 秒。
- `opt.timeout`(R17)已知限制:歸屬確認為「pid 出自本瀏覽器自身 CDP 連線 + 仍連線」,不含作業系統層行程身分(Node 無法持有行程控制代碼);尚無頁面即關閉本呼叫所用瀏覽器(`timeout` 須涵蓋最壞啟動與開頁時間,否則牽連 alive 並發呼叫);`WHtml2png.close()`/閒置關閉對曾給 `timeout` 之世代限時並可強制結束,其結果不回傳不通知;計時不含 `ensureBins`。暫停真 chrome 之實測證據(renderer/主程序,Python ctypes 暫停)見報告 `C:\opensrcOper\dnow\20261103132311\agent-out\h2p60-修正報告.md`,不入套件測試(須作業系統層行程暫停,Node 無跨平台 API)。w-hc2png 連動(#61)由主控另派,本套件不動。
- `dist/`、`docs/`:2026-11-02 已依 `script.txt` 重產(`dist/` 與提交版逐位元組相同,`docs/` 僅 8 頁之產生時間行異動);repo 內產物與現行 `src/` 一致,正式重產由發布流程執行。
- `test/unit-binManifest.test.mjs` 「should not pack external executables…」不再要求 `sgud/` 不入 npm 包(專案 `CLAUDE.md`:2026-11-01 起隨 npm 包發布;工作樹中 `.npmignore` 已不列 `sgud`〔主控未提交之批次改動〕)。
