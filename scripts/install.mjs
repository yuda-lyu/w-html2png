import path from 'path'
import downloadFiles from '../src/downloadFiles.mjs'


async function init() {

    //fdSrv
    let fdSrv = path.resolve()

    //fdBase, 直接給予安裝套件路徑
    let fdBase = `${fdSrv}/node_modules/w-html2png/chrome/`
    // console.log('fdBase', fdBase)

    //downloadFiles
    await downloadFiles(fdBase)

}
init()
    .catch((err) => {
        console.log(err)
    })

//node scripts/install.mjs
