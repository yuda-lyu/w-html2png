import each from 'lodash-es/each.js'


//tpl, 頁面模板, 佔位字樣{cXxx}由buildHtml單次掃描填入
let tpl = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>highcharts to png</title>

  {cStylesHead}

  <script src="https://cdn.jsdelivr.net/npm/lodash/lodash.min.js"></script>

  <script src="https://cdn.jsdelivr.net/npm/wsemi/dist/wsemi.umd.js"></script>
  <script>
      let w = wsemi
  </script>

  {cScriptsHead}

  {cExecJsHead}

</head>
<body style="padding:0; margin:0;">

    <div id="pl">
        {cHtml}
    </div>

    {cExecJsPost}

</body>
</html>
`


/**
 * 組合繪圖頁面之html
 *
 * 模板只掃描一次，替換值以函式回傳，故內容中之`$&`、`$'`、`` $` ``、`$$`不會被當成特殊樣式，已填入之內容亦不會再被掃描(內容含`{cExecJsPost}`等字樣時逐字保留)
 *
 * 限制：execJsHead與execJsPost以inline之script插入，內容不得含字面`</script>`(或`<!--`接`<script`)；stylesHead與scriptsHead之網址置於屬性內，不得含`"`
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.html=''] 輸入html字串，置於div#pl內
 * @param {Array} [opt.stylesHead=[]] 輸入css網址陣列
 * @param {Array} [opt.scriptsHead=[]] 輸入js網址陣列
 * @param {Array} [opt.execJsHead=[]] 輸入插入head內執行之js程式碼陣列
 * @param {Array} [opt.execJsPost=[]] 輸入於dom末插入執行之js程式碼陣列
 * @returns {String} 回傳html字串
 */
function buildHtml({ html = '', stylesHead = [], scriptsHead = [], execJsHead = [], execJsPost = [] } = {}) {

    //cStylesHead
    let cStylesHead = ''
    each(stylesHead, (v) => {
        cStylesHead += `<link href="${v}" rel="stylesheet" />`
    })

    //cScriptsHead
    let cScriptsHead = ''
    each(scriptsHead, (v) => {
        cScriptsHead += `<script src="${v}"></script>\n`
    })

    //cExecJsHead
    let cExecJsHead = ''
    each(execJsHead, (v) => {
        cExecJsHead += `<script>${v}</script>\n\n`
    })

    //cExecJsPost
    let cExecJsPost = ''
    each(execJsPost, (v) => {
        cExecJsPost += `<script>${v}</script>\n\n`
    })

    //slots
    let slots = {
        cHtml: html,
        cStylesHead,
        cScriptsHead,
        cExecJsHead,
        cExecJsPost,
    }

    //單次掃描模板, 替換值以函式回傳: 不解讀$樣式, 且不再掃描已填入之內容
    return tpl.replace(/\{(cHtml|cStylesHead|cScriptsHead|cExecJsHead|cExecJsPost)\}/g, (m, k) => slots[k])
}


export default buildHtml
