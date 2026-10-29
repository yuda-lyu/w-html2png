import fsEnsureBins from 'wsemi/src/fsEnsureBins.mjs'
import getFdPkg from './pkgRoot.mjs'


/**
 * 取得本套件之外部執行檔: 檔案組chrome(免安裝chrome之portable/App/Chrome-bin/, 107檔)
 *
 * 首次使用時下載(或自鏡像取得)portable.zip之8個分割, 組合、解出後逐檔以bin/manifest.json之SHA-256與大小校驗, 整組原子放入快取, 之後自快取取得(亦校驗, 一檔不符即整組重取)
 * 規格: 外部執行檔之存放下載校驗與離線(制式規格)§6、M6; 實作為wsemi之fsEnsureBins, 本套件不另寫下載、快取、鏡像、校驗、組合與解壓
 * 快取預設於本套件根目錄之bin-cache/(與當前工作路徑無關), 環境變數: W_BIN_CACHE、W_BIN_MIRROR、W_BIN_OFFLINE, 見README〈外部執行檔〉
 *
 * @param {Object} [opt={}] 輸入設定物件, 交wsemi之fsEnsureBins(names、cacheDir、mirror、offline、onProgress等), pkgRoot固定為本套件根
 * @returns {Promise} 回傳Promise, resolve回傳{ chrome: 組資料夾之絕對路徑 }, 另有不可列舉之bundles.chrome.files[組內路徑]為各檔之絕對路徑, reject回傳帶code之Error(E_OFFLINE_MISSING、E_HASH_MISMATCH、E_EXTRACT等)
 * @example
 * import ensureBins from 'w-html2png/src/ensureBins.mjs' //或WHtml2png.ensureBins
 *
 * async function test() {
 *
 *     //部署前預先取得(連網機器設W_BIN_CACHE=<資料夾>後執行, 該資料夾即可作為離線鏡像W_BIN_MIRROR)
 *     let bins = await ensureBins()
 *
 *     console.log('bins', bins)
 *     // bins { chrome: 'D:\\xxx\\node_modules\\w-html2png\\bin-cache\\<組識別>' }
 *     console.log(bins.bundles.chrome.files['portable/App/Chrome-bin/138.0.7204.97/chrome.exe'])
 *     // D:\xxx\node_modules\w-html2png\bin-cache\<組識別>\portable\App\Chrome-bin\138.0.7204.97\chrome.exe
 * }
 * test()
 *     .catch((err) => {
 *         console.log('catch', err)
 *     })
 *
 */
function ensureBins(opt = {}) {

    //floatingManifestUrl會改變清單之信任錨, 不轉傳使用者之值(釘選模式不使用)
    let { floatingManifestUrl, ...o } = opt || {} // eslint-disable-line no-unused-vars

    //pkgRoot, 以模組位置推得並以package.json之name驗證(被打包進他套件時改以套件名解析), 與當前工作路徑無關
    return fsEnsureBins('bin/manifest.json', { ...o, pkgRoot: getFdPkg() })
}


export default ensureBins
