import each from 'lodash-es/each.js'
import range from 'lodash-es/range.js'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import fsDownloadFile from 'wsemi/src/fsDownloadFile.mjs'
import fsMergeFiles from 'wsemi/src/fsMergeFiles.mjs'
import fsRenameFolder from 'wsemi/src/fsRenameFolder.mjs'
import fsDeleteFile from 'wsemi/src/fsDeleteFile.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import mZip from 'w-zip/src/mZip.mjs'


async function downloadFiles(fdBase) {

    //fpZip
    let fpZip = `${fdBase}portable.zip`
    // console.log('fpZip', fpZip)

    //fns, fps
    let fns = []
    let fps = []
    each(range(1, 8 + 1), (i) => {
        let fn = `portable.zip.00${i}`
        let fp = `${fdBase}${fn}`
        fns.push(fn)
        fps.push(fp)
    })
    // console.log('fns',fns)
    // console.log('fps', fps)

    //downloadFile
    await pmSeries(fns, async(fn, k) => {

        //fp
        let fp = fps[k]

        //url
        let url = `https://github.com/yuda-lyu/w-html2png/raw/refs/heads/master/chrome/${fn}`
        // console.log('url',url)

        //fsDownloadFile
        console.log(`downloading url[${url}]...`, `to fp[${fp}]`)
        await fsDownloadFile(url, fp)

    })

    //fsMergeFiles, 完成後會刪除fps
    await fsMergeFiles(fps, fpZip)
    // console.log('fpZip', fpZip)

    //fdChrome
    let fdChrome = `${fdBase}temp` //不能直接解壓縮至fdBase, 會導致裡面zip先被清空而無法解壓縮, 此外解壓縮後內會有portable, 須先創建temp去解再把portable移出
    // console.log('fdChrome', fdChrome)

    //unzip
    if (true) {
        await mZip.unzip(fpZip, fdChrome)
        // console.log('mZip.unzip', r)
    }

    //fsRenameFolder
    if (true) {
        let fdSrc = `${fdBase}temp/portable`
        let fdTar = `${fdBase}portable`
        // console.log('fdSrc',fdSrc)
        // console.log('fdTar',fdTar)
        fsRenameFolder(fdSrc, fdTar)
        // console.log('fsRenameFolder',r)
    }

    //fsDeleteFolder temp
    fsDeleteFolder(fdChrome)

    //fsDeleteFile portable.zip
    fsDeleteFile(fpZip)

}


export default downloadFiles
