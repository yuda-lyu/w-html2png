import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'


//測試用: 小型假檔案組chrome(與bin/manifest.json之組chrome同形), 以驗證檔案組之取得、校驗、離線、竄改等邏輯而不必每案處理421MB之真組
//壓縮檔內含portable/App/Chrome-bin/之成員(列入清單)與portable/GoogleChromePortable.exe(不列入, 同真組之include), zip後切成3個分割; chrome.exe內容非瀏覽器(啟動必失敗, 錯誤訊息含其路徑)
let commit = '0123456789abcdef0123456789abcdef01234567'
let verFake = '9.9.9.9'
let relExe = `portable/App/Chrome-bin/${verFake}/chrome.exe`


let sha256Of = (b) => {
    return crypto.createHash('sha256').update(b).digest('hex')
}


//fill, 決定性之內容(前綴＋重複位元組)
let fill = (prefix, n) => {
    let b = Buffer.alloc(n)
    for (let i = 0; i < n; i++) {
        b[i] = (i * 31 + prefix.length) % 251
    }
    Buffer.from(prefix).copy(b)
    return b
}


/**
 * 建立假檔案組
 * @param {String} fd 工作資料夾(建立於其下之zip/)
 * @returns {Object} { manifest(清單物件), parts: [{ name, path, sha256, bytes }], members: [{ path, sha256, size, bytes }], bundleId, relExe, commit }
 */
function makeFakeBundle(fd) {
    let members = [
        { path: 'portable/App/Chrome-bin/First Run', bytes: Buffer.alloc(0) },
        { path: 'portable/App/Chrome-bin/chrome.exe', bytes: fill('MZ-top', 2000) },
        { path: `portable/App/Chrome-bin/${verFake}/Locales/en-US.pak`, bytes: fill('pak', 1000) },
        { path: `portable/App/Chrome-bin/${verFake}/chrome.dll`, bytes: fill('MZ-dll', 5000) },
        { path: relExe, bytes: Buffer.concat([Buffer.from('not a browser\n'), fill('x', 3000)]) },
    ]
    let unlisted = [
        { path: 'portable/GoogleChromePortable.exe', bytes: fill('MZ-launcher', 1500) },
    ]

    //zip, 以System32之tar.exe(bsdtar)建立, 參數皆為工作資料夾內之相對路徑
    let fdZip = path.join(fd, 'zip')
    fs.rmSync(fdZip, { recursive: true, force: true })
    for (let m of [...members, ...unlisted]) {
        let fp = path.join(fdZip, 'src', ...m.path.split('/'))
        fs.mkdirSync(path.dirname(fp), { recursive: true })
        fs.writeFileSync(fp, m.bytes)
    }
    let tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    execFileSync(tarExe, ['-a', '-c', '-f', '../fake.zip', 'portable'], { cwd: path.join(fdZip, 'src'), windowsHide: true })
    let zip = fs.readFileSync(path.join(fdZip, 'fake.zip'))
    fs.rmSync(fdZip, { recursive: true, force: true })

    //parts, 切成3個分割
    let n = Math.ceil(zip.length / 3)
    let parts = [0, 1, 2].map((i) => {
        let bytes = zip.subarray(i * n, Math.min(zip.length, (i + 1) * n))
        let name = `portable.zip.00${i + 1}`
        return { name, path: `bin/chrome/${name}`, sha256: sha256Of(bytes), bytes }
    })

    let ms = members.map((m) => ({ path: m.path, sha256: sha256Of(m.bytes), size: m.bytes.length, bytes: m.bytes }))
    let manifest = {
        schema: 1,
        pkg: 'w-html2png',
        mode: 'pinned',
        repo: 'yuda-lyu/w-html2png',
        commit,
        bundles: [{
            name: 'chrome',
            archives: [{
                parts: parts.map((p) => ({ path: p.path, sha256: p.sha256, size: p.bytes.length })),
                assembled: { type: 'zip', sha256: sha256Of(zip), size: zip.length },
                extract: { type: 'zip', files: ms.map((m) => ({ path: m.path, sha256: m.sha256, size: m.size })) },
            }],
        }],
    }

    //bundleId, 組識別: 組內各檔依path排序後逐行'<sha256>  <path>\n'之SHA-256(規格M6)
    let lines = [...ms].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((m) => `${m.sha256}  ${m.path}\n`).join('')
    let bundleId = sha256Of(Buffer.from(lines))

    return { manifest, parts, members: ms, bundleId, relExe, commit }
}


//makeFakePkg, 建假套件根: package.json(name為w-html2png)、src/ensureBins.mjs與src/pkgRoot.mjs(本套件之原檔副本)、bin/manifest.json(給定之清單)
function makeFakePkg(fdPkg, manifest) {
    fs.mkdirSync(path.join(fdPkg, 'src'), { recursive: true })
    fs.mkdirSync(path.join(fdPkg, 'bin'), { recursive: true })
    fs.writeFileSync(path.join(fdPkg, 'package.json'), JSON.stringify({ name: 'w-html2png', version: '0.0.0' }))
    fs.copyFileSync(path.resolve('src/ensureBins.mjs'), path.join(fdPkg, 'src', 'ensureBins.mjs'))
    fs.copyFileSync(path.resolve('src/pkgRoot.mjs'), path.join(fdPkg, 'src', 'pkgRoot.mjs'))
    fs.writeFileSync(path.join(fdPkg, 'bin', 'manifest.json'), JSON.stringify(manifest, null, 2))
    return path.join(fdPkg, 'src', 'ensureBins.mjs')
}


//putMirrorParts, 把分割放入鏡像<鏡像>/<pkg>/<sha256>/<name>(規格O1), parts可給替換內容
function putMirrorParts(fdMirror, parts, replace = {}) {
    for (let p of parts) {
        let fd = path.join(fdMirror, 'w-html2png', p.sha256)
        fs.mkdirSync(fd, { recursive: true })
        fs.writeFileSync(path.join(fd, p.name), replace[p.name] || p.bytes)
    }
}


export { makeFakeBundle, makeFakePkg, putMirrorParts, sha256Of }
