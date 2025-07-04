import path from 'path'
import downloadFiles from '../src/downloadFiles.mjs'


async function init() {

    //fdSrv
    let fdSrv = path.resolve()

    //fdBase,
    // let fdBase = `${fdSrv}/node_modules/w-html2png/chrome/`
    let fdBase = `${fdSrv}/chrome/` //npm i後觸發安裝時, 工作路徑是位於套件w-html2png內
    // console.log('fdBase', fdBase)

    //downloadFiles
    await downloadFiles(fdBase)

}
init()
    .catch((err) => {
        console.log(err)
    })

//node scripts/install.mjs
