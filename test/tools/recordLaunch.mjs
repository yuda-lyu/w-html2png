//以 --import 預載: 於子行程內以w-playwright之setBrowserTypeForTest記錄被測程式所啟動之選項, 每次啟動輸出一行 LAUNCHED {executablePath, args}; 不啟動任何程式(替身以錯誤結束, w-playwright依真啟動之規則轉為E_LAUNCH)
//RECORD_LAUNCH_FROM: 解析w-playwright之起點檔(給被測之dist檔, 使預載與dist解析到同一個w-playwright而共用同一模組實例)
import { createRequire } from 'module'


let from = process.env.RECORD_LAUNCH_FROM
if (from) {
    let wpw = createRequire(from)('w-playwright')
    wpw.setBrowserTypeForTest({
        launch: async (o) => {
            console.log('LAUNCHED ' + JSON.stringify({ executablePath: o.executablePath, args: o.args }))
            throw new Error('launch recorded, not started')
        },
    })
}
