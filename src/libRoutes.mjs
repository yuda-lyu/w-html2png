import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import getFdPkg from './pkgRoot.mjs'


//libs, 頁面模板引用之函式庫網址(維持不變)與本機檔案(相依lodash、wsemi)
let libs = [
    { url: 'https://cdn.jsdelivr.net/npm/lodash/lodash.min.js', mod: 'lodash/lodash.min.js' },
    { url: 'https://cdn.jsdelivr.net/npm/wsemi/dist/wsemi.umd.js', mod: 'wsemi/dist/wsemi.umd.js' },
]


//bodies, 每行程讀檔一次快取
let bodies = null


//resolveLibFile, 解析本機檔案: 先自本套件根解析(本套件之相依, 含被打包進他套件之情形), 再自模組位置解析; 皆不可得回傳null
let resolveLibFile = (mod) => {
    let bases = []
    let fdPkg = getFdPkg()
    if (fdPkg) {
        bases.push(path.join(fdPkg, 'package.json'))
    }
    bases.push(import.meta.url)
    for (let b of bases) {
        try {
            return createRequire(b).resolve(mod)
        }
        catch (err) {}
    }
    return null
}


let getBodies = () => {
    if (bodies === null) {
        bodies = libs.map((lib) => {
            let body = null
            let fp = resolveLibFile(lib.mod)
            try {
                body = fp ? fs.readFileSync(fp) : null
            }
            catch (err) {}
            if (body === null) {
                //本機檔案不可得時不攔截該網址, 維持自CDN載入(舊版行為), 只提示一次
                console.error(`w-html2png: can not resolve local ${lib.mod}, the page loads it from CDN`)
            }
            return {
                url: lib.url,
                body,
            }
        })
    }
    return bodies
}


/**
 * 於context攔截模板之函式庫網址, 改由本機檔案供應(離線可用、版本固定為已安裝之相依); 本機檔案不可得者維持自CDN載入
 *
 * @param {Object} context 輸入playwright之BrowserContext
 * @returns {Promise} 回傳Promise
 */
async function routeLibs(context) {
    let bs = getBodies()
    for (let b of bs) {
        if (b.body === null) {
            continue
        }
        await context.route(b.url, (route) => {
            return route.fulfill({
                status: 200,
                contentType: 'application/javascript; charset=utf-8',
                body: b.body,
            })
        })
    }
}


export { resolveLibFile }
export default routeLibs
