import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


//globals, 外部模組: Node內建模組與playwright-core(本套件為Node專用, runin為nodejs); child_process為wsemi之fsEnsureBins解壓所用
let globals = {
    'fs': 'fs',
    'path': 'path',
    'os': 'os',
    'url': 'url',
    'module': 'module',
    'crypto': 'crypto',
    'stream': 'stream',
    'stream/promises': 'stream/promises',
    'child_process': 'child_process',
    'events': 'events',
    'playwright-core': 'playwright-core',
}


async function rp() {

    await rollupFiles({ //rollupFiles預設會clean folder
        fns: 'WHtml2png.mjs',
        fdSrc,
        fdTar,
        hookNameDist: () => 'w-html2png',
        runin: 'nodejs',
        // nameDistType: 'kebabCase', //直接由hookNameDist給予
        // bNodePolyfill: true,
        // bMinify: false,
        globals,
        external: Object.keys(globals),
    })

}
rp()
    .catch((err) => {
        //建置失敗須以非0結束, 使發布流程得知
        console.log(err)
        process.exitCode = 1
    })
