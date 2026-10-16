import assert from 'assert'
import buildHtml from '../src/buildHtml.mjs'


//規則R1: 頁面html由模板單次掃描填入, 5個填值位置 × 12種字樣 = 60格皆逐字; 模板結構與修正前相同(既有基準圖之前提)

//tplSpec, 頁面模板(規格: 與1.0.53之模板逐字相同)
let tplSpec = `
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

//expectHtml, 以切割(非replace)組出期望值: 佔位字樣只出現在模板本身
function expectHtml({ html = '', stylesHead = [], scriptsHead = [], execJsHead = [], execJsPost = [] }) {
    let vals = {
        '{cHtml}': html,
        '{cStylesHead}': stylesHead.map((v) => `<link href="${v}" rel="stylesheet" />`).join(''),
        '{cScriptsHead}': scriptsHead.map((v) => `<script src="${v}"></script>\n`).join(''),
        '{cExecJsHead}': execJsHead.map((v) => `<script>${v}</script>\n\n`).join(''),
        '{cExecJsPost}': execJsPost.map((v) => `<script>${v}</script>\n\n`).join(''),
    }
    return tplSpec.split(/(\{c(?:Html|StylesHead|ScriptsHead|ExecJsHead|ExecJsPost)\})/).map((s) => (vals[s] !== undefined ? vals[s] : s)).join('')
}


let tokens = ['plain', '$&', '$\'', '$`', '$$', '$1', '$<a>', '{cExecJsPost}', '{cExecJsHead}', '{cScriptsHead}', '{cStylesHead}', '{cHtml}']
let slots = ['html', 'stylesHead', 'scriptsHead', 'execJsHead', 'execJsPost']


describe('unit-buildHtml', function() {

    it('plain content equals the template spec', function() {
        let o = { html: '<p>X</p>' }
        assert.strict.equal(buildHtml(o), expectHtml(o))
    })

    for (let slot of slots) {
        for (let tok of tokens) {
            it(`slot ${slot} with ${tok} is filled verbatim`, function() {
                let payload = slot === 'html'
                    ? `<p>A${tok}B</p>`
                    : slot === 'stylesHead'
                        ? `https://e.x/a${tok}b.css`
                        : slot === 'scriptsHead'
                            ? `https://e.x/a${tok}b.js`
                            : `var s = "A${tok}B";`
                let o = { html: slot === 'html' ? payload : '<p>X</p>' }
                if (slot !== 'html') {
                    o[slot] = [payload]
                }
                let r = buildHtml(o)
                assert.strict.equal(r, expectHtml(o))
                assert.ok(r.includes(payload))
            })
        }
    }

    it('multiple scripts keep order and content', function() {
        let o = { html: '<p>$&</p>', execJsHead: ['a$$1', 'b$\''], execJsPost: ['c$`', 'd{cHtml}'], scriptsHead: ['u1', 'u2'], stylesHead: ['s1', 's2'] }
        assert.strict.equal(buildHtml(o), expectHtml(o))
    })

})
