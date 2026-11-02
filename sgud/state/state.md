# 狀態

本檔記當前已開發功能之最新狀態(只記現況;過程見 `sgud/exp/experience.md`)。規則見 `sgud/rule/rulebook.md`。

- 最近一次更新:2026-11-02(h2p267:`toolg/` 改回 dspec〈自有套件之發布與建置腳本〉標準寫法;`package.json` version 1.0.59 未變,待主控發布)。
- 最近一次驗證:2026-11-02 於套件根依 `script.txt` 實跑 `cleanFolder` → jsdoc → `gDistRollup`:`dist/` 兩檔與改前逐位元組相同(`w-html2png.umd.js` 113,784 位元組、`.map` 148,588 位元組),`docs/` 37 檔僅 8 個頁面之產生時間行不同;全套 `npm test`(mocha --parallel,11 檔)結果見報告 `C:\opensrcOper\dnow\20261102075126\agent-out\h2p267-修正報告.md`。前次:2026-10-29 全套綠,報告 `C:\opensrcOper\dnow\20261028054319\agent-out\bin-html2png-修正報告.md`。

## 功能現況

| 功能 | 狀態 | 規則 | 測試檔 |
|---|---|---|---|
| HTML 轉 PNG(single/alive 兩模式、重試、錯誤字串) | 完成 | R1、R6、R7、R12 | `unit-WHtml2png`、`unit-render`、`unit-alive`、`unit-pageError`、`unit-errors`、`unit-localRes` |
| 頁面函式庫(lodash、wsemi)本機供應 | 完成 | R11 | `unit-cdnLibs` |
| 套件自帶 chrome 經 `ensureBins`(wsemi `fsEnsureBins`,檔案組 `chrome`,釘選提交 `bf41fac5…`)取得;`opt.executablePath` 優先 | 完成(2026-10-29) | R2、R10、R14、R16 | `api-ensureBins`、`unit-binManifest`、`unit-dist` |
| UMD 建置(dist;`toolg/gDistRollup.mjs` 以 `'./src'`、`'./dist'` 相對 cwd,依 dspec〈自有套件之發布與建置腳本〉) | 完成(2026-11-02 改回標準寫法) | R4、R8 | `unit-dist`(副本＋指定 cwd 執行 toolg)、`unit-binManifest`(globals/external 文字檢查) |
| 平台限制(未給 executablePath 時限 Windows) | 完成 | R15 | `unit-errors` |

- 外部執行檔:`bin/chrome/portable.zip.001`~`008`(入 git、不入 npm 包)、`bin/manifest.json`(1 組 107 檔,421,065,985 位元組;組識別 `732088aa8aeb2be51a145a68b27b0fa247c111141a08f5437fef9af02977e797`)。主幹已無 `chrome/`。
- 對外入口:`WHtml2png`(default)、`WHtml2png.close`、`WHtml2png.ensureBins`;深層匯入 `src/ensureBins.mjs`。已移除:`src/autoDownloadFiles.mjs`、`src/downloadFiles.mjs`、`src/chromeManifest.mjs`、`src/fileLock.mjs`、`scripts/install.mjs`、`W_HTML2PNG_CHROME_DIR`、`W_HTML2PNG_SKIP_DOWNLOAD`。

## 已知缺口與待辦

- 下游 w-hc2png 之測試深層匯入 `w-html2png/src/autoDownloadFiles.mjs`(已移除),須於連動時改用 `ensureBins`(主控通報;本套件不改他套件)。
- 1.0.53 以前之版本自主幹 `chrome/` 下載,主幹移除後新環境首次使用得 HTTP 404(待主控／使用者裁示;比照 dspec S2 之 w-dwload-dlp)。
- 高負載下之頁面事件競態(產品既有,未修;R16 已知限制;待主控裁示是否另案修 R7):`unit-pageError`「page errors are retried according to retry」(第一次嘗試之 `pageerror` 未於截圖前檢查到達)、`unit-localRes` 首案(white)。2026-10-29 測得:平行全套於預先校驗後 17 次中 3 次該 pageError 案失敗(他套件重負載同時段 12 次中 9 次);7 個負載行程下單跑兩檔 10 次:舊碼 8 次、新碼 8 次該案失敗(舊碼同樣發生,非本輪引入);純 playwright 仿單次流程 20/20 未重現(根因在 WHtml2png 流程內,未定位)。
- `dist/`、`docs/`:2026-11-02 已依 `script.txt` 重產(`dist/` 與提交版逐位元組相同,`docs/` 僅 8 頁之產生時間行異動);repo 內產物與現行 `src/` 一致,正式重產由發布流程執行。
- `test/unit-binManifest.test.mjs` 「should not pack external executables…」不再要求 `sgud/` 不入 npm 包(專案 `CLAUDE.md`:2026-11-01 起隨 npm 包發布;工作樹中 `.npmignore` 已不列 `sgud`〔主控未提交之批次改動〕)。
