# NEON MECHA ARENA 公開 HTTPS 部署筆記

## 目的

正式直播不要再依賴 `192.168.x.x`、`172.x.x.x`、手機熱點、星巴克 Wi-Fi 或 Cloudflare quick tunnel。正式直播要使用固定公開 HTTPS 網址，手機、TikTok LIVE Studio、OBS、觀眾端都連同一個公開網域。

## 目前建議方案

使用 Render Web Service 部署 Node.js + Express + Socket.IO。

原因：

- 支援長連線與 WebSocket，比 Vercel 這類 serverless 平台更適合即時遊戲。
- 可取得固定 HTTPS 網址，例如 `https://neon-mecha-arena.onrender.com`。
- 可用 `render.yaml` 記錄部署設定，之後換電腦或重開機不會失效。

## 目前專案已準備好的項目

- `render.yaml` 已建立。
- `/healthz` 健康檢查已存在。
- Server 已綁定 `0.0.0.0`，可被雲端平台接入。
- `ADMIN_TOKEN` 會由 Render 環境變數提供。
- 測試階段後台仍保留預填 Admin Token；正式交付前再改回清空與隱藏模式。
- Production 同網域 Socket 連線已放行，避免正式 Render 網址與 `PUBLIC_ORIGIN` 短暫不同時造成連線被擋。

## 必要環境變數

Render 建立服務後請設定：

- `NODE_ENV=production`
- `PUBLIC_ORIGIN=https://你的Render服務網址`
- `SESSION_SECRET=由Render自動產生或自行填入長亂數`
- `ADMIN_TOKEN=正式後台密碼`

測試階段可先用：

```text
ADMIN_TOKEN=change-me-to-a-32-character-random-token
```

正式對外前必須換成新的長亂數，不要把正式 token 放在直播畫面、文件截圖或公開 repo。

## Render 部署流程

1. 在 GitHub 建立一個空 repo，例如 `neon-mecha-arena`。
2. 將本機專案推上 GitHub。
3. 到 Render 建立 Blueprint 或 Web Service。
4. 選擇該 GitHub repo。
5. 確認 Build Command：

```powershell
npm ci --omit=dev
```

6. 確認 Start Command：

```powershell
node src/server.js
```

7. 設定環境變數。
8. Deploy 完成後先測：

```text
https://你的Render服務網址/healthz
https://你的Render服務網址/admin
```

9. 後台建立場次後，只使用 Render HTTPS 產出的三種連結：

- 玩家連結 `/join/<sessionId>`
- 觀戰連結 `/watch/<sessionId>`
- TikTok 直式來源 `/watch/<sessionId>?studio=1`

## 直播前檢查

- 手機用 4G/5G 打開玩家連結，不依賴同一個 Wi-Fi。
- TikTok LIVE Studio 使用 `?studio=1` 的直式來源。
- 後台只放在操作者電腦，不加入直播來源。
- 開播前先用兩個玩家或 NPC 模式跑一局。
- 確認 QR code 顯示於觀戰畫面右下角。

## 重要限制

Render Free 方案可能會休眠，第一次打開會有冷啟動延遲。正式直播、付費展示或客戶 Demo 建議升級付費方案，避免開播時等待。

Cloudflare quick tunnel 只適合臨時彩排。它的網址會變、可能 DNS 失效、也可能出現 522 timeout，不適合正式直播。
