# 回饋

本檔記任務中發現之自有套件、全域技能、全域設定之調整與抽提提案;一條一列,只增不改,處置結果另記一列並寫明承接哪一列.回饋是紀錄與提案,實際修改走通報管道.

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-13 | 自有套件 | w-playwright 1.0.1 | 替身層(`setBrowserTypeForTest` 之替身,未呼叫 `next()`)亦於呼叫替身前讀錯誤密碼次數(登入守門開啟時以 cscript 子行程讀取,約 0.1～1 秒之非同步 I/O):替身不起任何瀏覽器,讀取無保護作用,卻使使用端之假時鐘測試在「替身被呼叫」之前多一段真實 I/O——使用端原以「發起啟動即同步呼叫 BrowserType」為前提之 13 案只在守門開啟之環境失敗。提案:替身層把登入守門延至 `next()`(真啟動)才讀;或於 README〈setBrowserTypeForTest〉寫明「替身被呼叫前另有非同步前置(含登入守門之讀取),使用端以替身被呼叫之事件同步」 | `node_modules/w-playwright/src/_launchCore.mjs:185-193`(`prepare` 之 `checkLogonGuard` 先於替身)、`:294-309`;本套件 `test/unit-timeoutFake.test.mjs` 修前 13 紅(quiet-run log `pm-h2p-post-unit`)、加 `env.waitLaunch(n)` 後 5/5 綠 |
| 2026-11-13 | 自有套件 | w-playwright 1.0.1(規則帳本 R-PW-ONLY) | 盤點正則 `(from\s+\|import\(\s*\|require\(\s*)['"\`]playwright(-core)?['"\`/]` 不涵蓋副作用匯入(`import 'playwright-core'`)、`import (`／`require (` 之空白,且以 `rg` 逐行比對時漏跨行之 `import(`／`require(`;盤點範圍文字為「全庫自有套件之 .mjs/.js」,而派工常只寫 `src`、`test`、`toolg`(漏套件根之範例檔)。提案:正則改為 `(\bfrom\s*\|\bimport\s*\(\s*\|\brequire\s*\(\s*\|\bimport\s+)['"\`]playwright(-core)?['"\`/]` 並加 `rg -U`(多行)或整檔比對,範圍明寫含套件根 | 外審 terra#2(本套件 pm-h2p);本套件 `test/unit-wpwLaunch.test.mjs` 之 7 個正例(含副作用、空白、跨行)以補強正則全命中 |
