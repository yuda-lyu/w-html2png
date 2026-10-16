//PNG 解碼(8-bit, color type 2/6, 非交錯)與語意/容差比對工具, 供出圖測試以語意斷言為主、容差比對為補強, 不逐位元比對
import zlib from 'zlib'


function paeth(a, b, c) {
    let p = a + b - c
    let pa = Math.abs(p - a)
    let pb = Math.abs(p - b)
    let pc = Math.abs(p - c)
    if (pa <= pb && pa <= pc) return a
    if (pb <= pc) return b
    return c
}


export function decodePng(buf) {
    if (typeof buf === 'string') {
        buf = Buffer.from(buf, 'base64')
    }
    let sig = buf.subarray(0, 8).toString('hex')
    if (sig !== '89504e470d0a1a0a') {
        throw new Error('not png')
    }
    let pos = 8
    let width = 0
    let height = 0
    let bitDepth = 0
    let colorType = 0
    let interlace = 0
    let idats = []
    while (pos < buf.length) {
        let len = buf.readUInt32BE(pos)
        let type = buf.subarray(pos + 4, pos + 8).toString('ascii')
        let data = buf.subarray(pos + 8, pos + 8 + len)
        if (type === 'IHDR') {
            width = data.readUInt32BE(0)
            height = data.readUInt32BE(4)
            bitDepth = data[8]
            colorType = data[9]
            interlace = data[12]
        }
        else if (type === 'IDAT') {
            idats.push(data)
        }
        else if (type === 'IEND') {
            break
        }
        pos += 12 + len
    }
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(`unsupported png bitDepth[${bitDepth}] colorType[${colorType}] interlace[${interlace}]`)
    }
    let bpp = colorType === 6 ? 4 : 3
    let raw = zlib.inflateSync(Buffer.concat(idats))
    let stride = width * bpp
    let out = Buffer.alloc(width * height * 4)
    let prev = Buffer.alloc(stride)
    let cur = Buffer.alloc(stride)
    let p = 0
    for (let y = 0; y < height; y++) {
        let ft = raw[p++]
        raw.copy(cur, 0, p, p + stride)
        p += stride
        for (let x = 0; x < stride; x++) {
            let a = x >= bpp ? cur[x - bpp] : 0
            let b = prev[x]
            let c = x >= bpp ? prev[x - bpp] : 0
            let v = cur[x]
            if (ft === 1) v = (v + a) & 255
            else if (ft === 2) v = (v + b) & 255
            else if (ft === 3) v = (v + ((a + b) >> 1)) & 255
            else if (ft === 4) v = (v + paeth(a, b, c)) & 255
            cur[x] = v
        }
        for (let x = 0; x < width; x++) {
            let o = (y * width + x) * 4
            out[o] = cur[x * bpp]
            out[o + 1] = cur[x * bpp + 1]
            out[o + 2] = cur[x * bpp + 2]
            out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255
        }
        let t = prev
        prev = cur
        cur = t
    }
    return { width, height, data: out }
}


export function pixelAt(img, x, y) {
    let o = (y * img.width + x) * 4
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]
}


//countNonWhite, 任一通道<thr即視為非白
export function countNonWhite(img, thr = 250) {
    let n = 0
    for (let i = 0; i < img.width * img.height; i++) {
        let o = i * 4
        if (img.data[o] < thr || img.data[o + 1] < thr || img.data[o + 2] < thr) {
            n++
        }
    }
    return n
}


//classifyColor, 取中心點顏色分類(探針以整頁底色回報結果)
export function classifyCenter(img) {
    let [r, g, b] = pixelAt(img, Math.floor(img.width / 2), Math.floor(img.height / 2))
    if (g > 200 && r < 60 && b < 60) return 'green'
    if (r > 200 && g < 60 && b < 60) return 'red'
    if (b > 200 && r < 60 && g < 60) return 'blue'
    if (r > 245 && g > 245 && b > 245) return 'white'
    return `other(${r},${g},${b})`
}


//diffCount, 兩圖同尺寸時逐像素比較, 通道差>tol之像素數(容差比對用, 非逐位元)
export function diffCount(a, b, tol = 16) {
    if (a.width !== b.width || a.height !== b.height) {
        return { sameSize: false, diff: -1 }
    }
    let n = 0
    for (let i = 0; i < a.width * a.height; i++) {
        let o = i * 4
        if (Math.abs(a.data[o] - b.data[o]) > tol || Math.abs(a.data[o + 1] - b.data[o + 1]) > tol || Math.abs(a.data[o + 2] - b.data[o + 2]) > tol) {
            n++
        }
    }
    return { sameSize: true, diff: n }
}
