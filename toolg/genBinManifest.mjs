//產生bin/manifest.json(規格M1、M6: 依repo內實檔計算sha256與大小, 不手寫)
//用法: node toolg/genBinManifest.mjs --commit <含bin/實檔之提交(40碼)>
//      主幹模式(mode為floating, 須於主控帳本G10登記)可不給--commit, 自有檔取自master
//流程(規格U1): 替換bin/內檔 → 提交並推GitHub(得提交雜湊) → 本工具 --commit <該提交> → 跑測試(M4) → 發布新版
//壓縮檔之成員以Windows內建tar.exe(System32, bsdtar)解至./tmp/genBinManifest/計算(Git Bash之tar為GNU tar, 不支援zip), 結束時刪除
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import fsGetBinManifestEntry from 'wsemi/src/fsGetBinManifestEntry.mjs'


//---- 各套件之設定(只改這段) ----

//mode, 'pinned'(預設)或'floating'
let mode = 'pinned'

//archives, 自有壓縮檔或分割檔之單一成員(單一執行檔), 鍵為清單之name(解出後之檔名):
//  { archive: 'bin/x.zip' } 或 { parts: ['bin/x.zip.001', 'bin/x.zip.002'] }, 另給member(壓縮檔內之路徑)
let archives = {
}

//bundles, 檔案組(規格M6: 執行檔須與其dll或資料檔相鄰, 或整棵目錄), 鍵為組名(結果物件之鍵):
//  { dir: 'bin/<資料夾>' }: repo之該資料夾內全部檔(遞迴)為組內檔, 組內路徑為相對於該資料夾之路徑
//  { archive: 'bin/x.zip' } 或 { parts: [...] }: 自有壓縮檔解出之成員為組內檔(組內路徑即壓縮檔內之路徑), include(選填)只列入合者
//  { url, fp, note, include }: 廠商壓縮檔(url為版本標籤之資產網址, fp為本機已下載之該檔), 其成員為組內檔
let bundles = {
    //chrome, 免安裝chrome(portable.zip之8個分割): 只取portable/App/Chrome-bin/(WHtml2png直接啟動Chrome-bin/<版本>/chrome.exe, 不經portable之啟動器與其設定),
    //其內中文名之網頁捷徑(.url)不合組內路徑之白名單且與執行無關, 排除
    'chrome': {
        parts: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `bin/chrome/portable.zip.00${i}`),
        include: (rel) => rel.startsWith('portable/App/Chrome-bin/') && !rel.endsWith('.url'),
    },
}

//vendors, 廠商檔(規格S3: 不鏡像, 網址須為版本標籤之資產網址, 規格M2):
//  { name, url, fp(本機已下載之檔), note(規格M3: 已以廠商公告之checksums核對, 或「首次下載自算」與下載日), extract: { member }(壓縮檔時) }
let vendors = [
]

//---- 以下不需修改 ----

let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
let i = process.argv.indexOf('--commit')
let commit = i >= 0 ? String(process.argv[i + 1] || '') : ''
if (mode === 'pinned' && !/^[0-9a-f]{40}$/.test(commit)) {
    console.log('usage: node toolg/genBinManifest.mjs --commit <40 lowercase hexadecimal characters>')
    process.exit(1)
}

//git, 釘選之提交內之bin/須與工作樹相同(不含manifest.json), 否則清單會指到不同內容
let git = (args) => {
    return execFileSync('git', args, { encoding: 'utf8', windowsHide: true })
}
if (commit !== '') {
    git(['cat-file', '-e', `${commit}^{commit}`])
    let diff = git(['diff', '--name-only', commit, '--', 'bin', ':(exclude)bin/manifest.json']).trim()
    if (diff !== '') {
        console.log(`bin/ differs from commit ${commit}:\n${diff}`)
        process.exit(1)
    }
}

let pick = (e) => {
    return { sha256: e.sha256, size: e.size }
}
let hashFiles = async (fps) => {
    let h = crypto.createHash('sha256')
    let size = 0
    for (let fp of fps) {
        for await (let chunk of fs.createReadStream(fp)) {
            size += chunk.length
            h.update(chunk)
        }
    }
    return { sha256: h.digest('hex'), size }
}
//walk, 資料夾內全部一般檔之相對路徑(/分隔, 排序)
let walk = (fd) => {
    let r = []
    let f = (d, rel) => {
        for (let n of fs.readdirSync(d).sort()) {
            let p = path.join(d, n)
            let q = rel ? `${rel}/${n}` : n
            let st = fs.lstatSync(p)
            if (st.isDirectory()) {
                f(p, q)
            }
            else if (st.isFile()) {
                r.push(q)
            }
            else {
                throw new Error(`not a regular file: ${p}`)
            }
        }
    }
    f(fd, '')
    return r
}
//fdWork, 解壓之暫存夾(cwd相對, 結束時刪除)
let fdWork = path.resolve('./tmp/genBinManifest')
//unzip, 以System32之tar.exe把壓縮檔(或依序組合之分割)解至暫存夾, 回傳{ fd }(成員在<fd>/x); 用完以rmSync刪除
//tar之參數一律為暫存夾內之相對路徑(工作目錄設為暫存夾), 不經命令列傳遞非ASCII之絕對路徑
let tarExe = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar'
let nUnzip = 0
let unzip = async (fps) => {
    let fd = path.join(fdWork, String(++nUnzip))
    fs.rmSync(fd, { recursive: true, force: true })
    fs.mkdirSync(fd, { recursive: true })
    let fpZip = path.join(fd, 'assembled.zip')
    fs.writeFileSync(fpZip, Buffer.alloc(0))
    for (let fp of fps) {
        fs.appendFileSync(fpZip, fs.readFileSync(fp))
    }
    fs.mkdirSync(path.join(fd, 'x'))
    execFileSync(tarExe, ['-x', '-f', 'assembled.zip', '-C', 'x'], { cwd: fd, windowsHide: true })
    return { fd }
}
//members, 壓縮檔之成員(include過濾)為清單之{ path, sha256, size }; 成員之檔名可含空白(如chrome之'First Run'), 故不取name(name: null)
let members = async (fdX, include) => {
    let r = []
    for (let rel of walk(fdX)) {
        if (include && !include(rel)) {
            continue
        }
        let e = await fsGetBinManifestEntry(path.join(fdX, ...rel.split('/')), { name: null, path: rel })
        r.push({ path: e.path, ...pick(e) })
    }
    if (r.length === 0) {
        throw new Error('no member is listed')
    }
    return r
}
//srcOfArchive, 壓縮檔之來源欄位(單一壓縮檔或分割＋組合)
let srcOfArchive = async (a, used) => {
    if (a.parts) {
        let parts = []
        for (let p of a.parts) {
            used.add(p)
            let e = await fsGetBinManifestEntry(p, { path: p })
            parts.push({ path: e.path, ...pick(e) })
        }
        return { parts, assembled: { type: 'zip', ...(await hashFiles(a.parts)) } }
    }
    used.add(a.archive)
    let e = await fsGetBinManifestEntry(a.archive, { path: a.archive })
    return { path: e.path, ...pick(e) }
}

let files = []
let bundleList = []
let used = new Set(['bin/manifest.json'])

try {

    //自有壓縮檔與分割檔(單一成員)
    for (let [name, a] of Object.entries(archives)) {
        let src = await srcOfArchive(a, used)
        let z = await unzip(a.parts || [a.archive])
        let x = await fsGetBinManifestEntry(path.join(z.fd, 'x', ...a.member.split('/')), { name: null })
        files.push({ name, ...src, extract: { type: 'zip', member: a.member, ...pick(x) } })
        fs.rmSync(z.fd, { recursive: true, force: true })
    }

    //檔案組
    for (let [name, b] of Object.entries(bundles)) {
        if (b.dir) {
            let rels = walk(b.dir)
            let bf = []
            for (let rel of rels) {
                used.add(`${b.dir}/${rel}`)
                let e = await fsGetBinManifestEntry(path.join(b.dir, ...rel.split('/')), { name: null, path: rel })
                bf.push({ path: e.path, ...pick(e) })
            }
            bundleList.push({ name, dir: b.dir, files: bf })
            continue
        }
        let src = null
        let fps = null
        if (b.url) {
            let e = await fsGetBinManifestEntry(b.fp, { url: b.url })
            src = { url: e.url, ...pick(e) }
            fps = [b.fp]
        }
        else {
            src = await srcOfArchive(b, used)
            fps = b.parts || [b.archive]
        }
        let z = await unzip(fps)
        let archive = { ...src, extract: { type: 'zip', files: await members(path.join(z.fd, 'x'), b.include) } }
        if (b.note) {
            archive.note = b.note
        }
        bundleList.push({ name, archives: [archive] })
        fs.rmSync(z.fd, { recursive: true, force: true })
    }

    //廠商檔
    for (let v of vendors) {
        let e = await fsGetBinManifestEntry(v.fp, { name: v.name, url: v.url })
        let f = { ...e }
        if (v.extract) {
            let z = await unzip([v.fp])
            let x = await fsGetBinManifestEntry(path.join(z.fd, 'x', ...v.extract.member.split('/')), { name: null })
            f.extract = { type: 'zip', member: v.extract.member, ...pick(x) }
            fs.rmSync(z.fd, { recursive: true, force: true })
        }
        if (v.note) {
            f.note = v.note
        }
        files.push(f)
    }

}
finally {
    fs.rmSync(fdWork, { recursive: true, force: true })
}

//自有檔: bin/內其餘之檔(以讀取資料夾列舉, 含尚未git add之新換檔)
for (let p of walk('bin').map((rel) => `bin/${rel}`)) {
    if (!used.has(p)) {
        files.push(await fsGetBinManifestEntry(p, { name: path.posix.basename(p), path: p }))
    }
}

let manifest = { schema: 1, pkg: pkg.name, mode, repo: `yuda-lyu/${pkg.name}` }
if (commit !== '') {
    manifest.commit = commit
}
if (files.length > 0) {
    manifest.files = files
}
if (bundleList.length > 0) {
    manifest.bundles = bundleList
}
fs.writeFileSync('bin/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`bin/manifest.json: ${files.length} file(s), ${bundleList.length} bundle(s)`)
