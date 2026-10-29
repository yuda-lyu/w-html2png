import fs from 'fs'
import path from 'path'
import ensureBins from '../../src/ensureBins.mjs'


//測試用: 以repo內bin/chrome之8個分割建本機鏡像(<鏡像>/<pkg>/<sha256>/<name>, 規格O1; 硬連結, 不支援時複製), 設W_BIN_MIRROR與W_BIN_OFFLINE=1並移除W_BIN_CACHE,
//使需要真chrome之出圖測試不連外網即可取得; 檔案組放在本套件之預設快取<套件根>/bin-cache/<組識別>/(與使用者首次使用時相同之位置),
//各出圖測試檔共用: 首次由鏡像組合解出(約421MB, 數秒), 之後快取命中(每行程首次校驗); 鏡像在test/_tmp/<tag>/, restore時還原環境變數並刪除該資料夾(硬連結只刪連結本身)
//回傳前先以ensureBins取得並校驗一次(本行程之首次校驗須雜湊421MB), 使該負載落在before而不與各案之出圖重疊(平行時各行程同時雜湊會拖慢頁面事件, 見sgud/exp)
let keys = ['W_BIN_MIRROR', 'W_BIN_CACHE', 'W_BIN_OFFLINE']


async function setBinEnv(tag) {
    let fdt = path.resolve(`./test/_tmp/${tag}`)
    let manifest = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))

    //鏡像: 內容定址之分割檔
    fs.rmSync(fdt, { recursive: true, force: true })
    for (let b of manifest.bundles) {
        for (let a of b.archives) {
            for (let p of a.parts) {
                let fd = path.join(fdt, 'mirror', manifest.pkg, p.sha256)
                fs.mkdirSync(fd, { recursive: true })
                let fp = path.join(fd, path.posix.basename(p.path))
                try {
                    fs.linkSync(path.resolve(p.path), fp)
                }
                catch (err) {
                    fs.copyFileSync(path.resolve(p.path), fp)
                }
            }
        }
    }

    //env
    let bk = {}
    for (let k of keys) {
        bk[k] = process.env[k]
    }
    process.env.W_BIN_MIRROR = path.join(fdt, 'mirror')
    process.env.W_BIN_OFFLINE = '1'
    delete process.env.W_BIN_CACHE

    let restore = () => {
        for (let k of keys) {
            if (bk[k] === undefined) {
                delete process.env[k]
            }
            else {
                process.env[k] = bk[k]
            }
        }
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
        try {
            fs.rmdirSync(path.resolve('./test/_tmp')) //尚有其他測試之暫存時非空, 略過
        }
        catch (err) {}
    }

    //預先取得並校驗, 失敗時還原後拋出
    try {
        await ensureBins()
    }
    catch (err) {
        restore()
        throw err
    }

    return restore
}


//getChromeExe, 經ensureBins取得檔案組chrome之chrome.exe(依setBinEnv之環境變數)
async function getChromeExe() {
    let r = await ensureBins()
    let files = r.bundles.chrome.files
    let k = Object.keys(files).find((v) => /^portable\/App\/Chrome-bin\/[^/]+\/chrome\.exe$/.test(v))
    return files[k]
}


export { setBinEnv, getChromeExe }
