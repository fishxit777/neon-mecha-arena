import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "node:http";
import QRCode from "qrcode";
import { Server } from "socket.io";
import { assetBundleToText, buildAssetBundle } from "./assets.js";
import { BATTLE_EVENT_TYPES } from "./battleEvents.js";
import { DIRECTOR_SIGNAL_TYPES } from "./director.js";
import { GAME, GameWorld } from "./game.js";
import { sessionExportToCsv } from "./metrics.js";
import { isLoopbackHost, isOriginAllowed, isOriginAllowedForHost, loadConfig, requireAdminToken } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

const config = loadConfig();
const app = express();
const httpServer = http.createServer(app);
const world = new GameWorld();
let lastPublicOrigin = config.publicOrigins.find((origin) => isUsablePublicOrigin(origin)) || "";

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isOriginAllowedForHost(origin, requestHostFrom(req), config)) {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});
app.get("/favicon.ico", (_req, res) => {
  res.status(204).end();
});
app.use(express.static(publicDir, { extensions: ["html"] }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

app.get("/join/:sessionId", (_req, res) => {
  res.sendFile(path.join(publicDir, "player.html"));
});

app.get("/watch/:sessionId", (_req, res) => {
  res.sendFile(path.join(publicDir, "spectator.html"));
});

app.get("/qr.svg", async (req, res) => {
  const text = String(req.query.text || "").slice(0, 500);
  if (!text) return res.status(400).type("text/plain").send("missing text");
  const svg = await QRCode.toString(text, {
    type: "svg",
    margin: 1,
    color: {
      dark: "#111827",
      light: "#ffffff"
    }
  });
  return res.type("image/svg+xml").send(svg);
});

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    sessions: world.listSessions().length,
    activeSockets: io.engine.clientsCount,
    tickRate: GAME.tickRate,
    lastTickDurationMs: world.lastTickDurationMs,
    version: "0.1.0"
  });
});

app.get("/metrics", (_req, res) => {
  res.json({
    sessions: world.listSessions().map((session) => ({
      id: session.id,
      status: session.room.status,
      activePlayers: session.metrics.activePlayers,
      queuedPlayers: session.metrics.queuedPlayers,
      spectators: session.metrics.spectators,
      tick: session.room.tick
    })),
    lastTickDurationMs: world.lastTickDurationMs
  });
});

app.get("/admin/export/:sessionId.json", (req, res) => {
  if (!requireAdminToken(readRequestToken(req), config)) {
    return res.status(401).json({ ok: false, code: "BAD_TOKEN" });
  }
  const exportData = world.getSessionExport(req.params.sessionId);
  if (!exportData) return res.status(404).json({ ok: false, code: "SESSION_NOT_FOUND" });
  return res.json(exportData);
});

app.get("/admin/export/:sessionId.csv", (req, res) => {
  if (!requireAdminToken(readRequestToken(req), config)) {
    return res.status(401).type("text/plain").send("BAD_TOKEN");
  }
  const exportData = world.getSessionExport(req.params.sessionId);
  if (!exportData) return res.status(404).type("text/plain").send("SESSION_NOT_FOUND");
  const filename = `${exportData.session.id}-metrics.csv`;
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
  return res.type("text/csv; charset=utf-8").send(sessionExportToCsv(exportData));
});

app.get("/admin/assets/:sessionId.json", (req, res) => {
  const bundle = readAssetBundle(req, res);
  if (!bundle) return;
  return res.json(bundle);
});

app.get("/admin/assets/:sessionId/report.html", (req, res) => {
  const bundle = readAssetBundle(req, res);
  if (!bundle) return;
  res.setHeader("Content-Disposition", `attachment; filename=\"${bundle.session.id}-report.html\"`);
  return res.type("text/html; charset=utf-8").send(bundle.clientReportHtml);
});

app.get("/admin/assets/:sessionId/victory-card.svg", (req, res) => {
  const bundle = readAssetBundle(req, res);
  if (!bundle) return;
  res.setHeader("Content-Disposition", `attachment; filename=\"${bundle.victoryCard.filename}\"`);
  return res.type("image/svg+xml; charset=utf-8").send(bundle.victoryCard.svg);
});

app.get("/admin/assets/:sessionId/social.txt", (req, res) => {
  const bundle = readAssetBundle(req, res);
  if (!bundle) return;
  res.setHeader("Content-Disposition", `attachment; filename=\"${bundle.session.id}-social-copy.txt\"`);
  return res.type("text/plain; charset=utf-8").send(assetBundleToText(bundle));
});

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      callback(null, isOriginAllowed(origin, config));
    },
    credentials: false
  },
  allowRequest(req, callback) {
    callback(null, isOriginAllowedForHost(req.headers.origin, requestHostFrom(req), config));
  }
});

function publicUrl(reqOrigin, route) {
  rememberPublicOrigin(reqOrigin);
  const preferredOrigin =
    (isUsablePublicOrigin(reqOrigin) ? reqOrigin : "") ||
    (isUsablePublicOrigin(lastPublicOrigin) ? lastPublicOrigin : "") ||
    config.publicOrigins.find((origin) => {
      return isUsablePublicOrigin(origin);
    }) ||
    reqOrigin ||
    config.publicOrigins[0] ||
    `http://localhost:${config.port}`;
  const origin = preferredOrigin;
  return `${origin}${route}`;
}

function rememberPublicOrigin(origin) {
  if (isUsablePublicOrigin(origin)) lastPublicOrigin = origin;
}

function isUsablePublicOrigin(origin) {
  try {
    const hostname = new URL(origin).hostname;
    return !isLoopbackHost(hostname);
  } catch {
    return false;
  }
}

function readRequestToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return String(req.query.token || "");
}

function requestHostFrom(req) {
  return req.headers["x-forwarded-host"] || req.headers.host || "";
}

function readAssetBundle(req, res) {
  if (!requireAdminToken(readRequestToken(req), config)) {
    res.status(401).json({ ok: false, code: "BAD_TOKEN" });
    return null;
  }
  const exportData = world.getSessionExport(req.params.sessionId);
  if (!exportData) {
    res.status(404).json({ ok: false, code: "SESSION_NOT_FOUND" });
    return null;
  }
  return buildAssetBundle(exportData);
}

function enrichSession(session, reqOrigin) {
  if (!session) return null;
  return {
    ...session,
    urls: {
      player: publicUrl(reqOrigin, `/join/${session.id}`),
      spectator: publicUrl(reqOrigin, `/watch/${session.id}`),
      qr: publicUrl(reqOrigin, `/qr.svg?text=${encodeURIComponent(publicUrl(reqOrigin, `/join/${session.id}`))}`)
    }
  };
}

function adminState(reqOrigin) {
  return {
    sessions: world.listSessions().map((session) => enrichSession(session, reqOrigin)),
    game: GAME,
    directorSignals: Object.keys(DIRECTOR_SIGNAL_TYPES),
    battleEvents: Object.keys(BATTLE_EVENT_TYPES)
  };
}

function emitSession(sessionId, reqOrigin) {
  const session = enrichSession(world.getPublicSession(sessionId), reqOrigin);
  if (!session) return;
  io.to(`session:${sessionId}`).emit("lobby_state", session);
  io.to(`session:${sessionId}`).emit("game_state", {
    sessionId,
    arena: { width: GAME.arenaWidth, height: GAME.arenaHeight },
    room: session.room,
    game: GAME
  });
  emitAdmin(reqOrigin);
}

function emitAdmin(reqOrigin) {
  io.to("admin").emit("admin_state", adminState(reqOrigin));
}

function adminError(ack, code, message) {
  const result = { ok: false, code, message: message || code };
  if (typeof ack === "function") ack(result);
  return result;
}

io.on("connection", (socket) => {
  const reqOrigin = socket.handshake.headers.origin || `http://localhost:${config.port}`;
  rememberPublicOrigin(reqOrigin);

  socket.on("admin_auth", (payload = {}, ack) => {
    if (!requireAdminToken(payload.token, config)) {
      return adminError(ack, "BAD_TOKEN", "Admin token is invalid");
    }
    socket.data.isAdmin = true;
    socket.data.adminOrigin = reqOrigin;
    socket.join("admin");
    const result = { ok: true, state: adminState(reqOrigin) };
    if (typeof ack === "function") ack(result);
    emitAdmin(reqOrigin);
  });

  socket.on("join_session", (payload = {}, ack) => {
    const result = world.joinSession({
      sessionId: payload.sessionId,
      socketId: socket.id,
      clientType: payload.clientType,
      name: payload.name,
      pilotId: payload.pilotId
    });
    if (result.ok) {
      socket.data.sessionId = payload.sessionId;
      socket.join(`session:${payload.sessionId}`);
      emitSession(payload.sessionId, reqOrigin);
    }
    if (typeof ack === "function") {
      ack(result.ok ? { ...result, session: enrichSession(result.session, reqOrigin) } : result);
    }
  });

  socket.on("player_input", (payload = {}) => {
    world.applyInput(socket.id, payload);
  });

  socket.on("join_page_view", (payload = {}) => {
    if (payload.sessionId) {
      socket.data.sessionId = payload.sessionId;
      world.recordJoinPageView(payload.sessionId, socket.id);
      emitSession(payload.sessionId, reqOrigin);
    }
  });

  socket.on("latency_pong", (payload = {}) => {
    const sentAt = Number(payload.sentAt);
    if (Number.isFinite(sentAt)) {
      const result = world.recordClientLatency(socket.id, Date.now() - sentAt);
      if (result.ok && socket.data.sessionId) emitSession(socket.data.sessionId, reqOrigin);
    }
  });

  socket.on("admin_command", (payload = {}, ack) => {
    if (!socket.data.isAdmin || !requireAdminToken(payload.token, config)) {
      return adminError(ack, "BAD_TOKEN", "Admin token is invalid");
    }

    let result;
    switch (payload.action) {
      case "create_session":
        result = { ok: true, session: world.createSession(payload.label) };
        break;
      case "start_round":
        result = world.startRound(payload.sessionId);
        break;
      case "reset_room":
        result = world.resetRoom(payload.sessionId, payload.keepLocked === true, "resets");
        break;
      case "next_round":
        result = world.resetRoom(payload.sessionId, false, "nextRounds");
        break;
      case "lock_room":
        result = world.setLocked(payload.sessionId, true);
        break;
      case "unlock_room":
        result = world.setLocked(payload.sessionId, false);
        break;
      case "kick_player":
        result = world.kickPlayer(payload.sessionId, payload.playerId);
        break;
      case "add_bot_player":
        result = world.addBotPlayer(payload.sessionId, payload.mode);
        break;
      case "set_bot_mode":
        result = world.setBotMode(payload.sessionId, payload.mode);
        break;
      case "remove_bot_players":
        result = world.removeBotPlayers(payload.sessionId);
        break;
      case "director_signal":
        result = world.triggerDirectorSignal(payload.sessionId, payload.signalType, {
          requestedBy: "admin",
          label: payload.label
        });
        break;
      case "battle_event":
        result = world.triggerBattleEvent(payload.sessionId, payload.eventType, {
          requestedBy: "admin",
          label: payload.label,
          team: payload.team
        });
        break;
      case "list_sessions":
        result = { ok: true, state: adminState(reqOrigin) };
        break;
      default:
        result = { ok: false, code: "UNKNOWN_ACTION", message: "Unknown admin action" };
    }

    if (result.session) result.session = enrichSession(result.session, reqOrigin);
    if (payload.sessionId && !result.ok) {
      world.recordSessionError(payload.sessionId, {
        code: result.code || "ADMIN_COMMAND_FAILED",
        message: result.message || result.code,
        source: payload.action,
        socketId: socket.id
      });
    }
    if (typeof ack === "function") ack(result);
    if (payload.sessionId) emitSession(payload.sessionId, reqOrigin);
    emitAdmin(reqOrigin);
  });

  socket.on("disconnect", () => {
    const sessionId = world.disconnect(socket.id);
    if (sessionId) emitSession(sessionId, reqOrigin);
    emitAdmin(reqOrigin);
  });
});

setInterval(() => {
  world.tick(Date.now());
  for (const session of world.listSessions()) {
    emitSession(session.id);
  }
}, GAME.tickMs);

setInterval(() => {
  io.emit("latency_probe", {
    sentAt: Date.now()
  });
}, 2_500);

httpServer.listen(config.port, "0.0.0.0", () => {
  console.log(`NEON MECHA ARENA running on http://localhost:${config.port}`);
});

export { app, httpServer, io, world };
