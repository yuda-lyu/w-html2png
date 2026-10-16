# w-html2png
A package for html to png by chromium.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-html2png.svg?style=flat)](https://npmjs.org/package/w-html2png) 
[![license](https://img.shields.io/npm/l/w-html2png.svg?style=flat)](https://npmjs.org/package/w-html2png) 
[![npm download](https://img.shields.io/npm/dt/w-html2png.svg)](https://npmjs.org/package/w-html2png) 
[![npm download](https://img.shields.io/npm/dm/w-html2png.svg)](https://npmjs.org/package/w-html2png) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-html2png.svg)](https://www.jsdelivr.com/package/npm/w-html2png)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-html2png/WHtml2png.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-html2png
```

#### Example for function:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-html2png/blob/master/scla.mjs)]
```alias
import fs from 'fs'
import WHtml2png from 'w-html2png'

async function testa() {

    let html = `
<div style="padding:10px; display:inline-block;">
    <div style="background-color: rgb(255, 255, 255); border-radius: 5px; width: 600px; box-shadow:0 3px 1px -2px rgba(0,0,0,.2), 0 2px 2px 0 rgba(0,0,0,.14), 0 1px 5px 0 rgba(0,0,0,.12);">
        <div style="padding: 20px; border-bottom: 1px solid rgb(221, 221, 221); background-color: rgb(250, 250, 250); border-radius: 5px 5px 0px 0px; display: flex; justify-content: flex-start; align-items: center;">
            <div>
                <div style="font-size: 2rem;">Panel Title</div>
            </div>
        </div>
        <div style="border-radius: 0px;">
            <div style="padding: 20px;">
                Here is a panel content, Morbi mattis ullamcorper velit. Donec orci lectus, aliquam ut, faucibus non, euismod id, nulla. In ut quam vitae odio lacinia tincidunt.
            </div>
        </div>
        <div style="padding: 20px; border-top: 1px solid rgb(221, 221, 221); background-color: rgb(250, 250, 250); border-radius: 0px 0px 5px 5px;">
            Here is a panel footer
        </div>
    </div>
</div>
    `
    let width = 620
    let height = 235
    let scale = 3

    let b64 = await WHtml2png(width, height, scale, html)
    // console.log('b64', b64)

    fs.writeFileSync('./test-scla.png', b64, { encoding: 'base64' })

    console.log('finish')
}
testa()
    .catch((err) => {
        console.log(err)
    })

```

### Notes
- **Platform**: the bundled portable Chrome is Windows only. On other platforms give `opt.executablePath` (a local Chrome or a Playwright-managed Chromium).
- **Where Chrome lives**: without `opt.executablePath`, Chrome is located in `<w-html2png package>/chrome/<chrome version>/portable/`, independent of the current working directory; locating and installing Chrome never writes to the working directory (only `opt.fdHtml`/`opt.fdErr`, used with `opt.funGetUrl`/`opt.writeError`, default to `./_convertTemp`). Set the env `W_HTML2PNG_CHROME_DIR` (absolute path to a dedicated folder) to use another folder, e.g. when the package folder is read-only; an existing `<chrome version>` folder there that was not created by w-html2png is never deleted (the call rejects instead).
- **First use downloads about 200MB**: npm 12 blocks dependency install scripts by default, so the first call usually downloads Chrome. Downloads come from a pinned commit and every part is checked by SHA-256. Several processes starting at the same time download only once. Set `W_HTML2PNG_SKIP_DOWNLOAD=1` to skip the download during `npm install`.
- **Deprecated locations**: Chrome already present in the old locations (`<package>/chrome/portable`, `<cwd>/chrome/portable`, `<cwd>/node_modules/w-html2png/chrome/portable`) is still found (read only). These lookups will be removed in the next major version.
- **Page globals**: the page preloads lodash (`_`) and wsemi (`w`) from the installed packages, so no network is needed for them.
- **Content is inserted verbatim** (including `$&`, `$'`, `$$`). `execJsHead`/`execJsPost` are inline scripts and must not contain a literal `</script>` (write `<\/script>`). URLs in `stylesHead`/`scriptsHead` must not contain double quotes.
- **Local files**: without `opt.funGetUrl` the page is loaded by `setContent` (about:blank), so `file://` and relative paths in the html are not loaded. Use data URLs or give `opt.funGetUrl`.
- **Errors**: rejections are always message strings. Set `opt.rejectOnPageError: true` to reject when the page throws (default keeps returning the image).
- **alive mode**: call `WHtml2png.close()` before a batch script ends so Node can exit.
