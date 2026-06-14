# NEON MECHA ARENA 戶外固定網址使用流程

## 為什麼不能靠隨機 Wi-Fi

戶外咖啡廳、商場、飯店、共享網路常會啟用裝置隔離。筆電可以上網、手機也可以上網，但手機不一定能連到筆電的 `192.168.x.x` 或 `172.x.x.x` 區網網址。

因此正式外出直播不要使用區網網址。區網網址只適合家中或同一台熱點測試。

## 正式建議架構

使用雲端固定 HTTPS 網址：

- 後台：`https://你的網域/admin`
- 玩家加入：`https://你的網域/join/live_xxxxxxxx`
- 觀戰畫面：`https://你的網域/watch/live_xxxxxxxx`
- TikTok LIVE Studio 來源：`https://你的網域/watch/live_xxxxxxxx?studio=1`

這樣筆電、手機、觀眾、TikTok LIVE Studio 都連到同一個公開網址，不受現場 Wi-Fi 是否允許區網互連影響。

## Render 部署設定

本專案已加入 `render.yaml`。預設服務名稱：

`neon-mecha-arena`

預設正式網址：

`https://neon-mecha-arena.onrender.com`

如果 Render 建立時改了服務名稱，請同步修改環境變數：

`PUBLIC_ORIGIN=https://實際服務名稱.onrender.com`

## 必填環境變數

- `NODE_ENV=production`
- `PUBLIC_ORIGIN=https://你的正式網址`
- `ADMIN_TOKEN=請換成自己的長密碼`
- `SESSION_SECRET=由 Render 自動生成即可`

## 外出直播流程

1. 開啟正式後台：`https://你的正式網址/admin`
2. 輸入 `ADMIN_TOKEN`
3. 建立 Session
4. 複製 TikTok 直式來源給 TikTok LIVE Studio
5. 手機或玩家掃後台 QR code 加入
6. 滿 2 位玩家後按開始

## 手機暫時連不上時的 NPC 測試流程

如果人在戶外、現場 Wi-Fi 擋區網連線，手機無法打開筆電的 `192.168.x.x` 或 `172.x.x.x`，但你仍想先測遊戲流程：

1. 在後台建立 Session。
2. 用筆電瀏覽器打開玩家連結，加入真人玩家。
3. 在「目前場次」按「加入 NPC」。
4. NPC 預設為「自動」，會自動跑位、360 度瞄準與攻擊。
5. 按「開始」測試開局、損血、勝負、MVP、戰報與直播畫面。
6. 等手機或正式玩家可連線後，按「移除 NPC」，再讓真人玩家加入。

NPC 是測試補位工具，不是正式直播玩家；正式公開場建議移除 NPC，以免觀眾誤會人數。

## 不綁固定 Wi-Fi 的原則

後台複製出來的玩家連結、觀戰連結、QR code 會跟著你「目前開後台的網址」走：

- 在家用 `http://192.168.x.x:3000/admin`，連結會改用當下家用 IP。
- 用手機熱點 `http://172.x.x.x:3000/admin`，連結會改用當下熱點 IP。
- 正式外出用 `https://你的正式網址/admin`，連結會改用雲端 HTTPS。

不要把某一次 Wi-Fi 的 IP 當成永久連結。每次換場地、換網路、重開機後，都以後台目前顯示的連結為準。

## 注意事項

- Render Free 方案可能會休眠，正式直播前要先喚醒並測試。
- 正式商用直播建議使用不休眠方案，避免直播中斷或冷啟動。
- 本機網址、家用 Wi-Fi IP、手機熱點 IP 都只適合測試，不適合作為對外直播入口。
