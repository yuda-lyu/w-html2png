import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'


//isOwnRoot, 資料夾是否為本套件根(package.json之name為w-html2png)
let isOwnRoot = (fd) => {
    try {
        let pk = JSON.parse(fs.readFileSync(path.join(fd, 'package.json'), 'utf8'))
        return pk.name === 'w-html2png'
    }
    catch (err) {
        return false
    }
}


/**
 * 取得本套件根目錄(內部使用)
 *
 * 先以模組位置推導(src/與dist/皆位於根下一層)並以package.json之name驗證, 被打包進他套件時改以套件名解析, 皆不可得回傳''
 * 注意: 不得於頂層宣告__filename/__dirname(rollup umd墊片自我參照TDZ), import.meta只用url
 *
 * @returns {String} 回傳本套件根目錄之絕對路徑, 不可得為''
 */
function getFdPkg() {
    try {
        let fd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
        if (isOwnRoot(fd)) {
            return fd
        }
    }
    catch (err) {}
    try {
        let req = createRequire(import.meta.url)
        let fd = path.dirname(req.resolve('w-html2png/package.json'))
        if (isOwnRoot(fd)) {
            return fd
        }
    }
    catch (err) {}
    return ''
}


export default getFdPkg
