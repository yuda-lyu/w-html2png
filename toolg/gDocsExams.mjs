import fs from 'fs'
import _ from 'lodash-es'
import getFiles from 'w-package-tools/src/getFiles.mjs'
import getPks from 'w-package-tools/src/getPks.mjs'


let fdSrc = './examples/'
let fdTar = './docs/examples/'


function main() {
    //把example裡面cdn更換, 再複製到docs的example內, 作為日後發佈為靜態網站

    //pks
    let pks = getPks()

    //url
    let url = `https://cdn.jsdelivr.net/npm/w-html2png@${pks.version}/dist/w-html2png.umd.js`

    //mkdirSync
    if (!fs.existsSync(fdTar)) {
        fs.mkdirSync(fdTar)
    }

    //getFiles
    let ltfs = getFiles(fdSrc)

    _.each(ltfs, function(v) {

        //fn
        let fn = fdSrc + v

        //c
        let c = fs.readFileSync(fn, 'utf8')

        //replace
        let r
        r = `../dist/w-html2png.umd.js`
        c = c.replace(r, url)

        //write
        //console.log(c)
        fs.writeFileSync(fdTar + v, c, 'utf8')

    })

}
main()
