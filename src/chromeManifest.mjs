//chromeManifest, 套件自帶免安裝chrome之下載清單
//下載網址釘選於含分片之特定commit(非master), 各片附大小與SHA-256, 下載後核對; repo內chrome/portable.zip.00N與ver.txt為所有已發布版本之下載來源, 永不刪改


//verChrome, chrome版本, 亦為安裝資料夾名與portable/App/Chrome-bin/下之版本資料夾名
let verChrome = '138.0.7204.97'


//commit, 含chrome/portable.zip.001~008之commit(其chrome/樹與2026-10-16之HEAD逐blob相同)
let commit = '5ebfb11fa2bb99a275cb5f511dd1712171978572'


//urlBase
let urlBase = `https://github.com/yuda-lyu/w-html2png/raw/${commit}/chrome/`


//shards
let shards = [
    { fn: 'portable.zip.001', size: 26214400, sha256: 'f45e943a39cba5a1bc2dcef87d84642943b20c945d119537fd1d53798816abbf' },
    { fn: 'portable.zip.002', size: 26214400, sha256: 'a6cf398c69518bc7371f47351915c33b64c947ef30f94865688794751b9cb32e' },
    { fn: 'portable.zip.003', size: 26214400, sha256: 'dd751936d924df54fe4999b940d0e05ac46c83c043abcc28ad0e26e1c27356f3' },
    { fn: 'portable.zip.004', size: 26214400, sha256: 'fc4f36d9a4a0d0fc4203f6b67adfcdd9f13ab746bf98839e135deabebcd7dba0' },
    { fn: 'portable.zip.005', size: 26214400, sha256: '3f6604cd84789b9e990dc43323c317c7890af2965018b0feaecaf3f51f567591' },
    { fn: 'portable.zip.006', size: 26214400, sha256: '4e8cdf6b76a71bf473f33e656e5611628e74f0aa194911ff4274861325f7037a' },
    { fn: 'portable.zip.007', size: 26214400, sha256: '3b3b4efaf2f896b44882954c6256cb404dacadec8ee28c1551767fa198d33a97' },
    { fn: 'portable.zip.008', size: 14844997, sha256: 'cd5aa1dbd28fe098e5b077d66d96c1d35a6b9c75571c9d3380f7a11fc271e814' },
]


let chromeManifest = {
    verChrome,
    commit,
    urlBase,
    shards,
}


export default chromeManifest
