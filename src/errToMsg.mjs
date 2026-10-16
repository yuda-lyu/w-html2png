//errToMsg, 將任意錯誤轉為訊息字串: Error或帶message之物件取message(非字串者轉字串), 其餘以String轉換, 去除ANSI色碼(playwright呼叫紀錄含色碼); 本函數對任何輸入皆不拋錯
function errToMsg(err) {
    let msg = ''
    try {
        let m = null
        if (err instanceof Error || (err !== null && typeof err === 'object' && 'message' in err)) {
            m = err.message
        }
        else {
            m = err
        }
        msg = typeof m === 'string' ? m : String(m)
    }
    catch (e) {
        msg = 'unknown error'
    }
    try {
        // eslint-disable-next-line no-control-regex
        return msg.replace(/\u001b\[[0-9;]*m/g, '')
    }
    catch (e) {
        return 'unknown error'
    }
}


export default errToMsg
