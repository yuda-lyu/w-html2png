//以 --import 預載: 依環境變數FAKE_PLATFORM覆寫process.platform(模擬非Windows), 供平台檢查之測試
if (process.env.FAKE_PLATFORM) {
    Object.defineProperty(process, 'platform', { value: process.env.FAKE_PLATFORM })
}
