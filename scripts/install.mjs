import path from 'path'
import { fileURLToPath } from 'url'
import autoDownloadFiles from '../src/autoDownloadFiles.mjs'


async function init() {

    //check, 套件自帶之免安裝chrome只有Windows版, 其他作業系統不下載
    if (process.platform !== 'win32') {
        return
    }

    //check, 環境變數W_HTML2PNG_SKIP_DOWNLOAD為真則不下載(首次調用時才下載, 或由呼叫端給executablePath)
    let skip = String(process.env.W_HTML2PNG_SKIP_DOWNLOAD || '').toLowerCase()
    if (skip !== '' && skip !== '0' && skip !== 'false') {
        return
    }

    //check, 以路徑段判斷是否位於node_modules內, 非位於node_modules代表套件本身(開發用repo)
    let fdScript = path.dirname(fileURLToPath(import.meta.url))
    if (!fdScript.split(path.sep).includes('node_modules')) {
        return
    }

    //autoDownloadFiles, 與執行期同一定位與下載(安裝於本套件根/chrome/<chrome版本>/, 與當前工作路徑無關)
    await autoDownloadFiles()

}
init()
    .catch((err) => {
        //安裝階段下載失敗不使npm安裝失敗, 首次調用時會再下載
        console.log(err)
    })

//node scripts/install.mjs
