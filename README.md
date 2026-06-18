# NEON MECHA ARENA

TikTok LIVE interactive mecha arena with scarcity seats, waitlist pressure, spectator viewing, audience interventions, and an owner-only admin console.

## Role Boundaries

- Owner only: `/admin`
- Players and waitlist users: `/join/<sessionId>`
- Spectators and audience interventions: `/watch/<sessionId>`
- TikTok Studio source: `/watch/<sessionId>?studio=1` or `/studio`

Players, spectators, and waitlist users must never receive the admin URL or Admin Token. Waitlist registration happens only from the player link. When seats are full, the player page automatically records the user as queued and shows queue position plus queued-only intervention controls.

## Scope

- Node.js 24 + Express + Socket.IO.
- Server-authoritative 2D mecha PVP loop at 20Hz.
- Scarcity seat modes: 2, 4, 6, and 8 seats.
- Player mobile cockpit controller with joystick, fire button, and controller settings.
- Waitlist queue with automatic promotion on the next waiting round.
- Spectator canvas page for OBS, TikTok LIVE Studio link source, or window capture.
- Audience interventions for spectators and queued players only.
- Token-protected owner admin console with session setup, battle controls, analytics, exports, and Studio setup.
- No TikTok Gift API, no tipping detection, no gambling, no betting.

## Run Locally

```powershell
npm install
copy .env.example .env
npm run dev
```

Open:

- Home: `http://localhost:3000/`
- Owner admin: `http://localhost:3000/admin`
- Player/waitlist link: created by the owner admin page.
- Spectator link: created by the owner admin page.
- TikTok Studio source: created by the owner admin page as `.../watch/<sessionId>?studio=1`.

The test Admin Token can prefill on `localhost` for owner-side development. It is not shown or prefilled on public hosts by default. Rotate the token before any public client demo.

## Public HTTPS Flow

1. Owner opens `/admin` from the public HTTPS URL and authenticates with Admin Token.
2. Owner creates a session and chooses the scarcity seat mode.
3. Owner shares only the player QR/link and spectator link.
4. Players register from `/join/<sessionId>`. Full rooms automatically place them into waitlist.
5. Queued users keep the player page open. They can use queued intervention buttons after the round starts.
6. TikTok LIVE Studio uses `/watch/<sessionId>?studio=1` or `/studio`.

## TikTok Studio Notes

- The Studio source must show only the battlefield, not Chrome tabs, URL bars, or the admin console.
- Use the direct Studio URL when possible. If Studio rejects link sources, open the same URL in a clean browser window and use window capture.
- Do not show the Admin Token on stream.

## Production Notes

- Set `PUBLIC_ORIGIN` to the final HTTPS domain. Multiple origins can be comma-separated.
- Use HTTPS/WSS on any public or livestream test.
- Do not share `/admin` or Admin Token with players, spectators, guests, moderators, or sponsors.
- Keep gifts, payments, or paid interactions out of winner logic.
- Avoid cash-prize wording. Position the game as entertainment, audience interaction, and show effects.

## Tests

```powershell
npm test
```
