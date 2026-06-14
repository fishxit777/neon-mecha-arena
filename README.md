# NEON MECHA ARENA

TikTok LIVE 互動機甲對戰遊戲。觀眾掃描 QR code 加入戰場，玩家用手機控制器移動、攻擊，直播畫面顯示機甲戰場、隊伍狀態、MVP、AI 導演提示與戰場事件。

## Scope

- Node.js 24 + Express + Socket.IO.
- Server-authoritative 2D mecha PVP loop at 20Hz.
- Player mobile cockpit controller with joystick, fire button, controller setting mode, and bot/manual testing support.
- Spectator canvas page suitable for OBS Browser Source, TikTok LIVE Studio link source, or window capture.
- Admin page with token-protected commands, data center, AI director signals, battle events, exportable assets, and Studio setup guide.
- `/healthz`, origin checks, nickname cleanup, input rate limiting, lobby queue, room lock, reset, and kick.
- No TikTok Gift API dependency in the current local build.

## Run Locally

```powershell
npm install
copy .env.example .env
npm run dev
```

Open:

- Home: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin`
- Player: created from the admin page.
- Spectator: created from the admin page.
- TikTok Studio vertical source: created from the admin page as `.../watch/<sessionId>?studio=1`.

Current test admin token is intentionally prefilled in the admin page: `change-me-to-a-32-character-random-token`. Hide or rotate it before any public handoff or paid client demo.

## Rehearsal On LAN

Use this only when phones are on the same Wi-Fi:

```powershell
npm run rehearsal
```

Open the LAN Admin URL printed by the script, not `localhost`, before creating a session. Otherwise QR codes will point to `localhost`, which phones cannot open.

## Public HTTPS

Use public HTTPS for real outdoor tests or TikTok LIVE Studio:

- Permanent deployment: Render, documented in `PUBLIC_HTTPS_DEPLOYMENT.md`.
- Temporary rehearsal: `npm run public:https` with Cloudflare quick tunnel.

Do not use quick tunnel for official streams. Quick tunnel URLs can expire or reconnect.

## TikTok LIVE Studio Flow

1. Open Admin from the public HTTPS URL.
2. Create a session.
3. Copy `TikTok 直式來源`.
4. In TikTok LIVE Studio, add it as a link source if accepted.
5. If Studio rejects link sources, open the same URL in a clean browser window and use window capture. Crop so the stream only shows the battlefield, not Chrome tabs, the address bar, or the admin page.

## Production Notes

- Set `PUBLIC_ORIGIN` to the final HTTPS domain. Multiple origins can be comma-separated.
- Use HTTPS/WSS on any public or livestream test.
- Do not expose the admin token in repo or stream overlays.
- Keep gifts, payments, or paid interactions out of winner logic until platform and legal compliance are reviewed.
- Avoid cash-prize wording. Position the game as entertainment, audience interaction, and show effects.

## Tests

```powershell
npm test
```
