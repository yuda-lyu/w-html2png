import path from 'path'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import downloadFiles from './downloadFiles.mjs'


//verChrome, 套件自帶免安裝chrome之版本資料夾名稱, 須與chrome/portable內實際版本一致
let verChrome = '138.0.7204.97'


//fpRel, chrome.exe相對於chrome資料夾之路徑
let fpRel = `portable/App/Chrome-bin/${verChrome}/chrome.exe`


//pmDownload, 下載中之Promise, 供併發呼叫共用同一次下載, 避免同時多次下載寫入同一批檔案
let pmDownload = null


/**
 * 自動定位chrome.exe，若無檔案則自動下載，回傳chrome.exe的絕對路徑
 *
 * 依序偵測當前工作路徑的chrome/與node_modules/w-html2png/chrome/，皆無chrome.exe時，
 * 代表安裝時npm封鎖scripts致postinstall未執行，故自動調用downloadFiles重新下載
 *
 * 供w-html2png自身與其他依賴w-html2png的套件調用，無須各自實作偵測與下載邏輯
 *
 * 因免安裝chrome只能用於Windows作業系統，故調用前須自行檢核作業系統
 *
 * @returns {Promise} 回傳Promise，resolve回傳執行檔路徑物件，內含fpExe為chrome.exe的絕對路徑字串，reject回傳錯誤訊息
 * @example
 * import autoDownloadFiles from 'w-html2png/src/autoDownloadFiles.mjs'
 *
 * async function test() {
 *
 *     //autoDownloadFiles, 無chrome.exe時自動下載, 下載失敗則reject
 *     let { fpExe } = await autoDownloadFiles()
 *
 *     console.log('fpExe', fpExe)
 *     // fpExe D:\xxx\node_modules\w-html2png\chrome\portable\App\Chrome-bin\138.0.7204.97\chrome.exe
 * }
 * test()
 *     .catch((err) => {
 *         console.log('catch', err)
 *     })
 *
 */
async function autoDownloadFiles() {

    //fdSrv, 於調用時取當前工作路徑
    let fdSrv = path.resolve()

    //fdBaseSelf, fdBaseNM, chrome可能所在資料夾(開發套件本身時於cwd的chrome/, 被安裝為相依套件時於node_modules/w-html2png/chrome/)
    let fdBaseSelf = `${fdSrv}/chrome/`
    let fdBaseNM = `${fdSrv}/node_modules/w-html2png/chrome/`

    //fdBase
    let fdBase = ''
    if (fsIsFile(`${fdBaseSelf}${fpRel}`)) {
        fdBase = fdBaseSelf
    }
    else if (fsIsFile(`${fdBaseNM}${fpRel}`)) {
        fdBase = fdBaseNM
    }
    else {

        //fdBaseDL, 下載落點, 有node_modules/w-html2png/代表為被安裝之相依套件, 否則為套件自身
        let fdBaseDL = fsIsFolder(`${fdSrv}/node_modules/w-html2png/`) ? fdBaseNM : fdBaseSelf

        //downloadFiles, 無chrome.exe代表安裝時npm封鎖scripts致postinstall未執行, 故於此重新執行下載,
        //併發呼叫共用同一個下載Promise, 避免重複下載
        if (pmDownload === null) {
            pmDownload = downloadFiles(fdBaseDL)
                .catch((err) => {

                    //下載失敗歸零, 使下次呼叫可重試下載
                    pmDownload = null

                    return Promise.reject(err)
                })
        }
        await pmDownload

        //check
        if (fsIsFile(`${fdBaseDL}${fpRel}`)) {
            fdBase = fdBaseDL
        }

    }

    //check
    if (fdBase === '') {
        return Promise.reject('can not find chrome.exe')
    }

    //fpExe
    let fpExe = path.resolve(fdBase, fpRel)

    return {
        fpExe,
    }
}


export default autoDownloadFiles
