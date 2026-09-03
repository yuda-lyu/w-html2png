import path from 'path'
import { fileURLToPath } from 'url'
import downloadFiles from '../src/downloadFiles.mjs'


async function init() {

    //check
    let __dirname = path.dirname(fileURLToPath(import.meta.url))
    if (!__dirname.includes('node_modules')) {
        return //非位於node_modules, 代表套件本身
    }

    //fdSrv, postinstall時cwd=套件自身在node_modules內的目錄
    let fdSrv = path.resolve()

    //fdBase, npm i後觸發安裝時, 工作路徑是位於套件/專案內
    let fdBase = `${fdSrv}/chrome/`

    //downloadFiles
    await downloadFiles(fdBase)

}
init()
    .catch((err) => {
        console.log(err)
    })

//node scripts/install.mjs
