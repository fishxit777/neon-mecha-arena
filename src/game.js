import crypto from "node:crypto";
import {
  applyShieldedDamage,
  createBattleEventState,
  evaluateBattleEvents,
  getProjectileDamageWithEvents,
  scheduleDefaultBattleEvents,
  serializeBattleEvents,
  triggerBattleEvent as triggerBattleEventCue
} from "./battleEvents.js";
import {
  createDirectorState,
  evaluateDirector,
  resetDirectorForRound,
  serializeDirector,
  triggerDirectorSignal as triggerDirectorCue
} from "./director.js";
import { createFoundationState, recordTimelineEvent, serializeTimeline } from "./foundation.js";
import {
  createAdminAnalytics,
  createAnalyticsState,
  createMetricsSnapshot,
  createRoomMetrics,
  createSessionExport,
  recordActivity,
  recordAnalyticsError,
  recordControl,
  recordFunnel,
  recordLatency,
  recordRoundAnalytics,
  recordSpectatorSeen
} from "./metrics.js";
import {
  createLeaderboard,
  createRoundStats,
  finalizeRoundPilots,
  normalizePilotId,
  recordSortie,
  upsertPilot
} from "./pilots.js";
import { MemoryProjectStore } from "./storage.js";

export const GAME = {
  arenaWidth: 1280,
  arenaHeight: 720,
  maxPlayers: 8,
  tickRate: 20,
  tickMs: 50,
  playerRadius: 22,
  moveSpeed: 280,
  playerHp: 100,
  playerLives: 2,
  projectileRadius: 7,
  projectileSpeed: 720,
  projectileDamage: 18,
  projectileTtlMs: 850,
  attackCooldownMs: 520,
  roundDurationMs: 90_000,
  inputMinIntervalMs: 45,
  maxNicknameLength: 16
};

export const ENTRY_MODES = {
  spotlight_duel: {
    id: "spotlight_duel",
    label: "試玩雙席",
    seatLimit: 2,
    scarcityLabel: "2 席限量",
    description: "快節奏試玩場，主播可用最少人數快速展示玩法。"
  },
  standard_squad: {
    id: "standard_squad",
    label: "標準限量場",
    seatLimit: 4,
    scarcityLabel: "4 席搶位",
    description: "直播預設模式，保留明顯搶位壓力與穩定對戰節奏。"
  },
  elite_gate: {
    id: "elite_gate",
    label: "菁英候補場",
    seatLimit: 6,
    scarcityLabel: "6 席候補",
    description: "中型場次，適合觀眾較多時維持候補熱度。"
  },
  full_arena: {
    id: "full_arena",
    label: "滿房開戰場",
    seatLimit: 8,
    scarcityLabel: "8 席滿房",
    description: "最大對戰席位，適合壓軸或測試高人數場。"
  }
};

const DEFAULT_ENTRY_MODE = "standard_squad";

export const AUDIENCE_INTERVENTIONS = {
  shield_boost: {
    eventType: "shield_boost",
    label: "弱隊護盾",
    description: "替落後方補一段臨時護盾，讓戰局有翻盤窗口。"
  },
  supply_drop: {
    eventType: "supply_drop",
    label: "補給投放",
    description: "替低血量玩家投放維修補給。"
  },
  orbital_strike: {
    eventType: "orbital_strike",
    label: "軌道砲",
    description: "短暫打擊中央航道，迫使場上玩家走位。"
  }
};

const AUDIENCE_INTERVENTION_RULES = {
  roundLimit: 6,
  actorCooldownMs: 20_000,
  eventCooldownMs: 10_000
};

const TEAM_COLORS = {
  red: "#ef4444",
  blue: "#38bdf8"
};

const BANNED_WORDS = ["admin", "moderator", "tiktok", "system"];
const DAMAGE_EVENT_TTL_MS = 1_800;
const BOT_SOCKET_PREFIX = "bot:";
const BOT_NAMES = ["NPC Mecha", "Training Drone", "Auto Pilot", "Mecha Ghost"];

export function getEntryMode(modeId) {
  return ENTRY_MODES[modeId] || ENTRY_MODES[DEFAULT_ENTRY_MODE];
}

function activeSeatLimit(room) {
  const mode = getEntryMode(room?.entryMode);
  const configured = Number.isFinite(room?.seatLimit) ? room.seatLimit : mode.seatLimit;
  return Math.max(2, Math.min(GAME.maxPlayers, Math.round(configured)));
}

function activeGameConfig(room) {
  return {
    ...GAME,
    maxPlayers: activeSeatLimit(room),
    hardMaxPlayers: GAME.maxPlayers
  };
}

function buildScarcityMessage({ openSlots, queuedPlayers, seatLimit, pressure }) {
  if (queuedPlayers > 0) return `候補中 ${queuedPlayers} 人，下一個空位會自動補上。`;
  if (openSlots <= 0) return `本局 ${seatLimit} 席已滿，現在加入會進入候補。`;
  if (pressure === "last_call") return "最後 1 席，下一位進場後即將滿席。";
  if (pressure === "warming") return `剩 ${openSlots} 席，席位正在升溫。`;
  return `限量 ${seatLimit} 席開放中，先加入先卡位。`;
}

function updateScarcityState(room, now = Date.now()) {
  if (!room) return null;
  const mode = getEntryMode(room.entryMode);
  const seatLimit = activeSeatLimit(room);
  const openSlots = Math.max(0, seatLimit - room.players.size);
  const queuedPlayers = room.queue.length;
  const pressure =
    queuedPlayers > 0 || openSlots <= 0
      ? "sold_out"
      : openSlots === 1
        ? "last_call"
        : openSlots <= Math.ceil(seatLimit / 2)
          ? "warming"
          : "open";

  room.entryMode = mode.id;
  room.seatLimit = seatLimit;
  room.hardMaxPlayers = GAME.maxPlayers;
  room.scarcity = {
    modeId: mode.id,
    modeLabel: mode.label,
    scarcityLabel: mode.scarcityLabel,
    description: mode.description,
    seatLimit,
    hardMaxPlayers: GAME.maxPlayers,
    openSlots,
    activePlayers: room.players.size,
    queuedPlayers,
    fillRate: seatLimit > 0 ? Math.round((room.players.size / seatLimit) * 100) : 0,
    pressure,
    message: buildScarcityMessage({ openSlots, queuedPlayers, seatLimit, pressure }),
    updatedAt: now
  };
  return room.scarcity;
}

function createAudienceInterventionState(now = Date.now(), round = 0) {
  return {
    round,
    roundLimit: AUDIENCE_INTERVENTION_RULES.roundLimit,
    actorCooldownMs: AUDIENCE_INTERVENTION_RULES.actorCooldownMs,
    eventCooldownMs: AUDIENCE_INTERVENTION_RULES.eventCooldownMs,
    usedThisRound: 0,
    lastByActor: {},
    lastByType: {},
    history: [],
    updatedAt: now
  };
}

function ensureAudienceInterventionState(room, now = Date.now()) {
  if (!room.audienceInterventions || room.audienceInterventions.round !== room.round) {
    room.audienceInterventions = createAudienceInterventionState(now, room.round);
  }
  return room.audienceInterventions;
}

function serializeAudienceInterventions(state, now = Date.now()) {
  if (!state) return null;
  const remaining = Math.max(0, state.roundLimit - state.usedThisRound);
  return {
    round: state.round,
    roundLimit: state.roundLimit,
    usedThisRound: state.usedThisRound,
    remaining,
    actorCooldownMs: state.actorCooldownMs,
    eventCooldownMs: state.eventCooldownMs,
    options: Object.values(AUDIENCE_INTERVENTIONS).map((option) => {
      const lastUsedAt = state.lastByType[option.eventType] || null;
      const readyAt = lastUsedAt ? lastUsedAt + state.eventCooldownMs : 0;
      return {
        ...option,
        readyAt,
        remainingMs: Math.max(0, readyAt - now)
      };
    }),
    history: state.history.slice(-12),
    updatedAt: state.updatedAt
  };
}

function preparePlayerForSeat(player, now) {
  player.connected = true;
  player.hp = GAME.playerHp;
  player.shieldHp = 0;
  player.maxLives = GAME.playerLives;
  player.lives = GAME.playerLives;
  player.broken = false;
  player.breakAnim = 0;
  player.alive = true;
  player.input = createEmptyInput();
  player.roundStats = createRoundStats(now);
}

function shortId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function cleanNickname(value) {
  const raw = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>"'`&/\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, GAME.maxNicknameLength);

  const lower = raw.toLowerCase();
  if (!raw || BANNED_WORDS.some((word) => lower.includes(word))) {
    return `Player-${crypto.randomUUID().slice(0, 4)}`;
  }
  return raw;
}

function emptyRoom(id, now) {
  const room = {
    id,
    status: "waiting",
    locked: false,
    entryMode: DEFAULT_ENTRY_MODE,
    seatLimit: ENTRY_MODES[DEFAULT_ENTRY_MODE].seatLimit,
    hardMaxPlayers: GAME.maxPlayers,
    scarcity: null,
    pilotIds: new Set(),
    players: new Map(),
    queue: [],
    spectators: new Set(),
    projectiles: new Map(),
    damageEvents: [],
    damageSequence: 0,
    tick: 0,
    round: 0,
    roundStartedAt: null,
    roundEndsAt: null,
    winnerTeam: null,
    notice: "Waiting for players",
    auditLog: [],
    director: createDirectorState(now),
    battleEvents: createBattleEventState(now),
    audienceInterventions: createAudienceInterventionState(now, 0),
    analytics: createAnalyticsState(now),
    foundation: createFoundationState(now)
  };
  updateScarcityState(room, now);
  return room;
}

function spawnPoint(team, index) {
  const lane = (index % 4) + 1;
  const y = (GAME.arenaHeight / 5) * lane;
  return team === "red"
    ? { x: 160, y, facingX: 1, facingY: 0 }
    : { x: GAME.arenaWidth - 160, y, facingX: -1, facingY: 0 };
}

function serializePlayer(player) {
  return {
    id: player.id,
    pilotId: player.pilotId,
    socketId: player.socketId,
    name: player.name,
    team: player.team,
    x: Math.round(player.x),
    y: Math.round(player.y),
    facingX: Math.round((player.facingX || 0) * 100) / 100,
    facingY: Math.round((player.facingY || 0) * 100) / 100,
    hp: Math.max(0, Math.round(player.hp)),
    shieldHp: Math.max(0, Math.round(player.shieldHp || 0)),
    maxLives: player.maxLives || GAME.playerLives,
    lives: Math.max(0, Math.round(player.lives ?? GAME.playerLives)),
    broken: player.broken === true,
    breakAnim: Math.max(0, Math.round(player.breakAnim || 0)),
    alive: player.alive,
    connected: player.connected,
    isBot: player.isBot === true,
    botMode: player.isBot ? player.botMode || "manual" : null,
    lastInputAt: player.lastInputAt,
    returningPilot: player.returningPilot === true,
    titles: player.titles || ["Rookie"],
    badges: player.badges || [],
    appearance: player.appearance || null,
    roundStats: player.roundStats
      ? {
          shots: player.roundStats.shots,
          hits: player.roundStats.hits,
          damageDealt: player.roundStats.damageDealt,
          eliminations: player.roundStats.eliminations,
          survivalMs: player.roundStats.survivalMs
        }
      : null,
    color: player.appearance?.core || TEAM_COLORS[player.team] || "#f8fafc"
  };
}

function serializeProjectile(projectile) {
  return {
    id: projectile.id,
    ownerId: projectile.ownerId,
    team: projectile.team,
    x: Math.round(projectile.x),
    y: Math.round(projectile.y)
  };
}

function serializeDamageEvent(event) {
  return {
    id: event.id,
    targetId: event.targetId,
    team: event.team,
    x: Math.round(event.x),
    y: Math.round(event.y),
    amount: Math.max(0, Math.round(event.amount || 0)),
    source: event.source || "damage",
    createdAt: event.createdAt
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeAxis(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return clamp(number, -1, 1);
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function normalizeVector(x, y, fallbackX = 1, fallbackY = 0) {
  const length = Math.hypot(x, y);
  if (length < 0.001) return { x: fallbackX, y: fallbackY };
  return { x: x / length, y: y / length };
}

function createEmptyInput() {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    attack: false,
    moveX: 0,
    moveY: 0,
    aimX: 1,
    aimY: 0
  };
}

function normalizeBotMode(mode) {
  return mode === "manual" ? "manual" : "auto";
}

export class GameWorld {
  constructor(now = () => Date.now(), store = new MemoryProjectStore()) {
    this.now = now;
    this.store = store;
    this.sessions = new Map();
    this.socketIndex = new Map();
    this.lastTickDurationMs = 0;
  }

  createSession(label = "Live Session") {
    const id = shortId("live");
    const session = {
      id,
      label: String(label || "Live Session").slice(0, 36),
      createdAt: this.now(),
      room: emptyRoom(shortId("room"), this.now()),
      adminSockets: new Set()
    };
    this.sessions.set(id, session);
    this.store.put("sessions", session.id, {
      id: session.id,
      label: session.label,
      createdAt: session.createdAt,
      roomId: session.room.id
    });
    this.audit(session, "session_created", { label: session.label });
    return this.getPublicSession(id);
  }

  getSession(id) {
    return this.sessions.get(id) || null;
  }

  latestSession() {
    return [...this.sessions.values()].at(-1) || null;
  }

  latestPublicSession() {
    const session = this.latestSession();
    return session ? this.getPublicSession(session.id) : null;
  }

  listSessions() {
    return [...this.sessions.keys()].map((id) => this.getPublicSession(id));
  }

  joinSession({ sessionId, socketId, clientType = "player", name = "", pilotId = "" }) {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND", message: "Session not found" };

    const room = session.room;
    const publicClientType = clientType === "spectator" ? "spectator" : clientType === "player" ? "player" : null;
    if (!publicClientType) {
      return {
        ok: false,
        code: "INVALID_CLIENT_TYPE",
        message: "公開入口只允許玩家或觀眾身份。"
      };
    }

    if (publicClientType === "spectator") {
      room.spectators.add(socketId);
      this.socketIndex.set(socketId, { sessionId, clientType: "spectator" });
      recordSpectatorSeen(room, this.now());
      recordActivity(room, "joins", this.now());
      this.runDirector(session);
      return { ok: true, role: "spectator", session: this.getPublicSession(sessionId) };
    }

    const playerName = cleanNickname(name);
    const pilot = upsertPilot(this.store, {
      pilotId: normalizePilotId(pilotId),
      name: playerName,
      now: this.now()
    });

    const player = {
      id: shortId("p"),
      pilotId: pilot.profile.id,
      socketId,
      name: playerName,
      team: "red",
      x: GAME.arenaWidth / 2,
      y: GAME.arenaHeight / 2,
      hp: GAME.playerHp,
      shieldHp: 0,
      maxLives: GAME.playerLives,
      lives: GAME.playerLives,
      broken: false,
      breakAnim: 0,
      alive: true,
      connected: true,
      input: createEmptyInput(),
      facingX: 1,
      facingY: 0,
      lastInputAt: -GAME.inputMinIntervalMs,
      lastAttackAt: 0,
      joinedAt: this.now(),
      returningPilot: pilot.returning,
      titles: pilot.profile.titles,
      badges: pilot.profile.badges,
      appearance: pilot.profile.appearance,
      roundStats: createRoundStats(this.now())
    };
    room.pilotIds.add(player.pilotId);

    if (!room.locked && room.status === "waiting" && room.players.size < activeSeatLimit(room)) {
      room.players.set(player.id, player);
      this.socketIndex.set(socketId, { sessionId, playerId: player.id, clientType: "player" });
      this.assignTeams(room);
      recordFunnel(room, "successfulJoins", this.now());
      recordActivity(room, "joins", this.now());
      this.audit(session, "player_joined", { playerId: player.id, pilotId: player.pilotId, name: player.name, returning: player.returningPilot });
      updateScarcityState(room, this.now());
      this.runDirector(session);
      return { ok: true, role: "player", playerId: player.id, session: this.getPublicSession(sessionId) };
    }

    const queueReason = room.locked ? "locked" : room.status !== "waiting" ? room.status : "seat_limit";
    room.queue.push(player);
    this.socketIndex.set(socketId, { sessionId, playerId: player.id, clientType: "queued" });
    recordFunnel(room, "queuedJoins", this.now());
    recordActivity(room, "joins", this.now());
    this.audit(session, "player_queued", {
      playerId: player.id,
      pilotId: player.pilotId,
      name: player.name,
      returning: player.returningPilot,
      reason: queueReason
    });
    updateScarcityState(room, this.now());
    this.runDirector(session);
    return {
      ok: true,
      role: "queued",
      playerId: player.id,
      message: room.scarcity?.message || "已進入候補，請保持頁面開啟。",
      session: this.getPublicSession(sessionId)
    };
  }

  addBotPlayer(sessionId, mode = "auto") {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND", message: "Session not found" };
    const room = session.room;
    if (room.status !== "waiting") {
      return {
        ok: false,
        code: "ROOM_NOT_WAITING",
        message: "請先重置到等待狀態，再加入 NPC。"
      };
    }
    if (room.locked) {
      return { ok: false, code: "ROOM_LOCKED", message: "Room is locked" };
    }
    if (room.players.size + room.queue.length >= GAME.maxPlayers) {
      return { ok: false, code: "ROOM_FULL", message: "NPC 測試席已滿，請先踢人、移除 NPC 或重置。" };
    }

    const now = this.now();
    const botCount = [...room.players.values()].filter((player) => player.isBot).length + room.queue.filter((player) => player.isBot).length;
    const botIndex = botCount + 1;
    const name = `${BOT_NAMES[botCount % BOT_NAMES.length]} ${botIndex}`;
    const pilot = upsertPilot(this.store, {
      pilotId: normalizePilotId(`pilot_npc_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`),
      name,
      now
    });
    const player = {
      id: shortId("p"),
      pilotId: pilot.profile.id,
      socketId: `${BOT_SOCKET_PREFIX}${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
      name,
      team: "red",
      x: GAME.arenaWidth / 2,
      y: GAME.arenaHeight / 2,
      hp: GAME.playerHp,
      shieldHp: 0,
      maxLives: GAME.playerLives,
      lives: GAME.playerLives,
      broken: false,
      breakAnim: 0,
      alive: true,
      connected: true,
      isBot: true,
      botMode: normalizeBotMode(mode),
      input: createEmptyInput(),
      facingX: -1,
      facingY: 0,
      lastInputAt: -GAME.inputMinIntervalMs,
      lastAttackAt: 0,
      joinedAt: now + botIndex / 1000,
      returningPilot: pilot.returning,
      titles: pilot.profile.titles,
      badges: pilot.profile.badges,
      appearance: pilot.profile.appearance,
      roundStats: createRoundStats(now)
    };

    room.pilotIds.add(player.pilotId);
    if (room.players.size < activeSeatLimit(room)) {
      room.players.set(player.id, player);
      this.socketIndex.set(player.socketId, { sessionId, playerId: player.id, clientType: "player" });
      this.assignTeams(room);
      recordFunnel(room, "successfulJoins", now);
      recordActivity(room, "joins", now);
      this.audit(session, "bot_player_added", { playerId: player.id, pilotId: player.pilotId, name: player.name, mode: player.botMode }, "admin");
      updateScarcityState(room, now);
      this.runDirector(session);
      return { ok: true, role: "player", playerId: player.id, session: this.getPublicSession(sessionId) };
    }

    room.queue.push(player);
    this.socketIndex.set(player.socketId, { sessionId, playerId: player.id, clientType: "queued" });
    recordFunnel(room, "queuedJoins", now);
    recordActivity(room, "joins", now);
    this.audit(session, "bot_player_queued", { playerId: player.id, pilotId: player.pilotId, name: player.name, mode: player.botMode }, "admin");
    updateScarcityState(room, now);
    this.runDirector(session);
    return { ok: true, role: "queued", playerId: player.id, session: this.getPublicSession(sessionId) };
  }

  setBotMode(sessionId, mode = "auto") {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND", message: "Session not found" };
    const room = session.room;
    const botMode = normalizeBotMode(mode);
    let changed = 0;
    for (const player of room.players.values()) {
      if (!player.isBot) continue;
      player.botMode = botMode;
      if (botMode === "manual") player.input = createEmptyInput();
      changed += 1;
    }
    for (const player of room.queue) {
      if (!player.isBot) continue;
      player.botMode = botMode;
      if (botMode === "manual") player.input = createEmptyInput();
      changed += 1;
    }
    if (!changed) return { ok: false, code: "BOT_NOT_FOUND", message: "目前沒有 NPC 可切換。" };
    this.audit(session, "bot_mode_changed", { mode: botMode, count: changed }, "admin");
    updateScarcityState(room, this.now());
    this.runDirector(session);
    return { ok: true, session: this.getPublicSession(sessionId) };
  }

  removeBotPlayers(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND", message: "Session not found" };
    const room = session.room;
    let removed = 0;
    for (const [playerId, player] of room.players.entries()) {
      if (!player.isBot) continue;
      room.players.delete(playerId);
      removed += 1;
    }
    const queueBefore = room.queue.length;
    room.queue = room.queue.filter((player) => !player.isBot);
    removed += queueBefore - room.queue.length;
    if (!removed) return { ok: false, code: "BOT_NOT_FOUND", message: "目前沒有 NPC 可移除。" };
    if (room.status === "waiting") this.rebalanceWaitingRoom(session, { resetPositions: true });
    else {
      this.assignTeams(room, false);
      updateScarcityState(room, this.now());
    }
    recordControl(room, "kicks", this.now());
    this.audit(session, "bot_players_removed", { count: removed }, "admin");
    if (room.status === "playing") this.checkWinCondition(session, this.now());
    this.runDirector(session);
    return { ok: true, session: this.getPublicSession(sessionId) };
  }

  disconnect(socketId) {
    const info = this.socketIndex.get(socketId);
    if (!info) return null;
    const session = this.getSession(info.sessionId);
    if (!session) {
      this.socketIndex.delete(socketId);
      return null;
    }

    const room = session.room;
    recordFunnel(room, "disconnects", this.now());
    if (info.clientType === "spectator") room.spectators.delete(socketId);
    if (info.clientType === "admin") session.adminSockets.delete(socketId);
    if (info.clientType === "queued") {
      room.queue = room.queue.filter((player) => player.socketId !== socketId);
    }
    if (info.clientType === "player") {
      const player = room.players.get(info.playerId);
      if (player) {
        if (room.status === "playing") {
          player.connected = false;
          player.alive = false;
          player.roundStats.knockedOutAt = this.now();
          player.hp = 0;
          player.lives = 0;
          player.broken = true;
          this.audit(session, "player_disconnected_mid_round", { playerId: player.id });
        } else {
          room.players.delete(player.id);
          this.rebalanceWaitingRoom(session);
          this.audit(session, "player_left", { playerId: player.id });
        }
      }
    }
    this.socketIndex.delete(socketId);
    updateScarcityState(room, this.now());
    this.runDirector(session);
    return info.sessionId;
  }

  applyInput(socketId, payload = {}) {
    const info = this.socketIndex.get(socketId);
    if (!info || info.clientType !== "player") return { ok: false, code: "NOT_PLAYER" };
    const session = this.getSession(info.sessionId);
    const player = session?.room.players.get(info.playerId);
    if (!player || !player.alive) return { ok: false, code: "PLAYER_INACTIVE" };

    const now = this.now();
    if (now - player.lastInputAt < GAME.inputMinIntervalMs) {
      return { ok: false, code: "RATE_LIMITED" };
    }

    player.lastInputAt = now;
    const moveX = sanitizeAxis(payload.moveX);
    const moveY = sanitizeAxis(payload.moveY);
    const fallbackMoveX = (payload.right === true ? 1 : 0) - (payload.left === true ? 1 : 0);
    const fallbackMoveY = (payload.down === true ? 1 : 0) - (payload.up === true ? 1 : 0);
    const moveLength = Math.hypot(moveX, moveY);
    let aimX = sanitizeAxis(payload.aimX);
    let aimY = sanitizeAxis(payload.aimY);
    if (Math.hypot(aimX, aimY) < 0.001) {
      aimX = moveLength > 0.001 ? moveX : fallbackMoveX || player.facingX;
      aimY = moveLength > 0.001 ? moveY : fallbackMoveY || player.facingY;
    }
    const aimVector = normalizeVector(aimX, aimY, player.facingX, player.facingY);
    player.input = {
      up: payload.up === true,
      down: payload.down === true,
      left: payload.left === true,
      right: payload.right === true,
      attack: payload.attack === true,
      moveX,
      moveY,
      aimX: aimVector.x,
      aimY: aimVector.y
    };
    if (Math.hypot(aimX, aimY) > 0.15) {
      player.facingX = aimVector.x;
      player.facingY = aimVector.y;
    }
    if (player.input.attack) recordActivity(session.room, "attacks", now);
    return { ok: true };
  }

  startRound(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
    const room = session.room;
    if (room.players.size < 2) {
      const message = "至少需要 2 位玩家在線，才能開始對戰。請先複製玩家連結，加入第 2 位玩家。";
      recordAnalyticsError(room, { code: "NEED_TWO_PLAYERS", message, source: "start_round" }, this.now());
      return { ok: false, code: "NEED_TWO_PLAYERS", message };
    }

    room.status = "playing";
    room.locked = true;
    room.projectiles.clear();
    room.damageEvents = [];
    room.damageSequence = 0;
    room.round += 1;
    room.tick = 0;
    const startedAt = this.now();
    room.roundStartedAt = startedAt;
    room.roundEndsAt = room.roundStartedAt + GAME.roundDurationMs;
    room.winnerTeam = null;
    room.notice = "Round started";
    this.assignTeams(room, true);
    scheduleDefaultBattleEvents(room, startedAt, activeGameConfig(room));
    room.audienceInterventions = createAudienceInterventionState(startedAt, room.round);
    for (const player of room.players.values()) {
      preparePlayerForSeat(player, startedAt);
      this.activatePilot(player);
    }
    updateScarcityState(room, startedAt);
    this.recordDirectorSignal(session, resetDirectorForRound(room.director, room.round, startedAt));
    this.audit(session, "round_started", { round: room.round });
    return { ok: true, session: this.getPublicSession(sessionId) };
  }

  resetRoom(sessionId, keepLocked = false, controlKey = "resets") {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
    const room = session.room;
    recordControl(room, controlKey, this.now());
    for (const player of room.players.values()) {
      if (!player.connected) room.players.delete(player.id);
    }
    room.status = "waiting";
    room.locked = keepLocked;
    room.projectiles.clear();
    room.damageEvents = [];
    room.damageSequence = 0;
    room.roundEndsAt = null;
    room.winnerTeam = null;
    room.notice = "Room reset";
    for (const player of room.players.values()) {
      preparePlayerForSeat(player, this.now());
    }
    const rebalance = this.rebalanceWaitingRoom(session, { resetPositions: true });
    this.audit(session, "room_reset", { keepLocked, ...rebalance });
    this.runDirector(session);
    return { ok: true, session: this.getPublicSession(sessionId) };
  }

  setEntryMode(sessionId, modeId) {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
    const mode = ENTRY_MODES[modeId];
    if (!mode) {
      return { ok: false, code: "INVALID_ENTRY_MODE", message: "Unknown entry mode" };
    }

    const room = session.room;
    const previousMode = getEntryMode(room.entryMode);
    room.entryMode = mode.id;
    room.seatLimit = mode.seatLimit;
    recordControl(room, "entryModeChanges", this.now());
    const rebalance = this.rebalanceWaitingRoom(session);
    updateScarcityState(room, this.now());
    this.audit(session, "entry_mode_changed", {
      from: previousMode.id,
      to: mode.id,
      seatLimit: mode.seatLimit,
      ...rebalance
    }, "admin");
    this.runDirector(session);
    return { ok: true, session: this.getPublicSession(sessionId) };
  }

  setLocked(sessionId, locked) {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
    session.room.locked = locked === true;
    recordControl(session.room, locked ? "locks" : "unlocks", this.now());
    const rebalance = this.rebalanceWaitingRoom(session);
    this.audit(session, locked ? "room_locked" : "room_unlocked", {});
    if (rebalance.promoted || rebalance.demoted) {
      this.audit(session, "queue_rebalanced", rebalance, "admin");
    }
    updateScarcityState(session.room, this.now());
    this.runDirector(session);
    return { ok: true, session: this.getPublicSession(sessionId) };
  }

  kickPlayer(sessionId, playerId) {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
    const room = session.room;
    const removed = room.players.delete(playerId);
    room.queue = room.queue.filter((player) => player.id !== playerId);
    recordControl(room, "kicks", this.now());
    const rebalance = this.rebalanceWaitingRoom(session);
    this.audit(session, "player_kicked", { playerId, removed, ...rebalance });
    this.runDirector(session);
    return { ok: removed, session: this.getPublicSession(sessionId) };
  }

  triggerDirectorSignal(sessionId, type, details = {}) {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
    const result = triggerDirectorCue(session.room, type, this.now(), details);
    if (!result.ok) return result;
    if (details?.requestedBy === "admin") recordControl(session.room, "manualDirectorSignals", this.now());
    this.recordDirectorSignal(session, result.signal);
    return { ok: true, signal: result.signal, session: this.getPublicSession(sessionId) };
  }

  triggerBattleEvent(sessionId, type, details = {}) {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
    const result = triggerBattleEventCue(session.room, type, this.now(), details);
    if (!result.ok) return result;
    if (details?.requestedBy === "admin") recordControl(session.room, "manualBattleEvents", this.now());
    this.recordBattleEvent(session, result.event);
    return { ok: true, event: result.event, session: this.getPublicSession(sessionId) };
  }

  triggerAudienceIntervention(socketId, { sessionId, eventType } = {}) {
    const info = this.socketIndex.get(socketId);
    const resolvedSessionId = sessionId || info?.sessionId;
    if (!info || !resolvedSessionId || info.sessionId !== resolvedSessionId) {
      return { ok: false, code: "AUDIENCE_NOT_JOINED", message: "請先用觀戰或候補身份進入場次。" };
    }
    const session = this.getSession(resolvedSessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
    const room = session.room;
    const audienceRoles = new Set(["spectator", "queued"]);
    if (!audienceRoles.has(info.clientType)) {
      return { ok: false, code: "AUDIENCE_ONLY", message: "只有觀眾或候補玩家可以觸發場外干預。" };
    }
    if (room.status !== "playing") {
      return {
        ok: false,
        code: "INTERVENTION_NOT_OPEN",
        message: "對戰開始後才能觸發場外干預。",
        intervention: serializeAudienceInterventions(ensureAudienceInterventionState(room, this.now()), this.now())
      };
    }
    const option = AUDIENCE_INTERVENTIONS[eventType];
    if (!option) {
      return { ok: false, code: "UNKNOWN_AUDIENCE_INTERVENTION", message: "找不到這個觀眾事件。" };
    }

    const now = this.now();
    const state = ensureAudienceInterventionState(room, now);
    const actor = this.resolveAudienceActor(room, info, socketId);
    const lastActorUsedAt = state.lastByActor[actor.id] || null;
    const actorReadyAt = lastActorUsedAt ? lastActorUsedAt + state.actorCooldownMs : 0;
    if (actorReadyAt > now) {
      return {
        ok: false,
        code: "AUDIENCE_COOLDOWN",
        message: `個人冷卻中，${Math.ceil((actorReadyAt - now) / 1000)} 秒後可再觸發。`,
        retryAfterMs: actorReadyAt - now,
        actorReadyAt,
        intervention: serializeAudienceInterventions(state, now)
      };
    }
    const lastTypeUsedAt = state.lastByType[eventType] || null;
    const typeReadyAt = lastTypeUsedAt ? lastTypeUsedAt + state.eventCooldownMs : 0;
    if (typeReadyAt > now) {
      return {
        ok: false,
        code: "AUDIENCE_EVENT_COOLDOWN",
        message: `${option.label} 冷卻中，${Math.ceil((typeReadyAt - now) / 1000)} 秒後可再觸發。`,
        retryAfterMs: typeReadyAt - now,
        typeReadyAt,
        intervention: serializeAudienceInterventions(state, now)
      };
    }
    if (state.usedThisRound >= state.roundLimit) {
      return {
        ok: false,
        code: "AUDIENCE_ROUND_LIMIT",
        message: "本局觀眾事件權已用完，下一局重置。",
        intervention: serializeAudienceInterventions(state, now)
      };
    }

    const result = triggerBattleEventCue(room, eventType, now, {
      requestedBy: "audience",
      source: "audience_intervention",
      actorRole: actor.role,
      actorName: actor.name,
      label: `觀眾觸發：${option.label}`
    });
    if (!result.ok) return result;

    state.usedThisRound += 1;
    state.lastByActor[actor.id] = now;
    state.lastByType[eventType] = now;
    state.updatedAt = now;
    state.history.push({
      eventType,
      label: option.label,
      actorRole: actor.role,
      actorName: actor.name,
      at: now,
      round: room.round
    });
    state.history = state.history.slice(-40);

    recordControl(room, "audienceBattleEvents", now);
    this.recordBattleEvent(session, result.event);
    return {
      ok: true,
      event: result.event,
      actorReadyAt: now + state.actorCooldownMs,
      typeReadyAt: now + state.eventCooldownMs,
      intervention: serializeAudienceInterventions(state, now),
      session: this.getPublicSession(resolvedSessionId)
    };
  }

  recordJoinPageView(sessionId, socketId) {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
    recordFunnel(session.room, "joinPageViews", this.now());
    recordActivity(session.room, "joins", this.now());
    this.socketIndex.set(socketId, { sessionId, clientType: "visitor" });
    return { ok: true };
  }

  recordClientLatency(socketId, latencyMs) {
    const info = this.socketIndex.get(socketId);
    if (!info?.sessionId) return { ok: false, code: "SOCKET_NOT_TRACKED" };
    const session = this.getSession(info.sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
    const player = info.playerId ? session.room.players.get(info.playerId) : null;
    recordLatency(
      session.room,
      {
        socketId,
        clientType: info.clientType,
        playerId: info.playerId,
        name: player?.name || info.clientType,
        latencyMs
      },
      this.now()
    );
    return { ok: true };
  }

  recordSessionError(sessionId, error = {}) {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
    recordAnalyticsError(session.room, error, this.now());
    return { ok: true };
  }

  getSessionExport(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    updateScarcityState(session.room, this.now());
    const gameConfig = activeGameConfig(session.room);
    return createSessionExport(session, {
      maxPlayers: gameConfig.maxPlayers,
      lastTickDurationMs: this.lastTickDurationMs,
      now: this.now()
    });
  }

  tick(now = this.now()) {
    const started = performance.now();
    for (const session of this.sessions.values()) {
      const room = session.room;
      if (room.status !== "playing") continue;
      const dt = GAME.tickMs / 1000;
      const gameConfig = activeGameConfig(room);
      room.tick += 1;
      for (const event of evaluateBattleEvents(room, gameConfig, now, (player, damage, context = {}) =>
        this.applyCombatDamage(room, player, damage, { ...context, now })
      )) {
        this.recordBattleEvent(session, event);
      }
      this.updateBotInputs(room, now);
      this.updatePlayers(room, now, dt);
      this.updateProjectiles(room, now, dt);
      this.checkWinCondition(session, now);
      this.runDirector(session, now);
    }
    this.lastTickDurationMs = Math.round((performance.now() - started) * 100) / 100;
  }

  updateBotInputs(room, now) {
    for (const player of room.players.values()) {
      if (!player.isBot) continue;
      if (!player.alive || player.botMode !== "auto") {
        player.input = createEmptyInput();
        continue;
      }

      const enemies = [...room.players.values()].filter((target) => target.alive && target.team !== player.team);
      if (!enemies.length) {
        player.input = createEmptyInput();
        continue;
      }

      const target = enemies.reduce((nearest, candidate) => {
        if (!nearest) return candidate;
        return distanceSquared(player, candidate) < distanceSquared(player, nearest) ? candidate : nearest;
      }, null);
      const aim = normalizeVector(target.x - player.x, target.y - player.y, player.facingX, player.facingY);
      const distance = Math.hypot(target.x - player.x, target.y - player.y);
      const desiredDistance = 260;
      const approach = distance > desiredDistance ? 0.72 : distance < 150 ? -0.5 : 0.08;
      const phase = now / 620 + player.joinedAt / 1000;
      const strafe = Math.sin(phase) * 0.42;
      const moveX = clamp(aim.x * approach - aim.y * strafe, -1, 1);
      const moveY = clamp(aim.y * approach + aim.x * strafe, -1, 1);
      const canShoot = distance <= 1_050 && now - player.lastAttackAt >= GAME.attackCooldownMs;

      player.input = {
        ...createEmptyInput(),
        attack: distance <= 1_050,
        moveX,
        moveY,
        aimX: aim.x,
        aimY: aim.y
      };
      player.facingX = aim.x;
      player.facingY = aim.y;
      if (canShoot) recordActivity(room, "attacks", now);
    }
  }

  updatePlayers(room, now, dt) {
    for (const player of room.players.values()) {
      if (player.breakAnim > 0) player.breakAnim = Math.max(0, player.breakAnim - 1);
      if (!player.alive) continue;
      let dx = sanitizeAxis(player.input.moveX);
      let dy = sanitizeAxis(player.input.moveY);
      if (Math.hypot(dx, dy) < 0.001) {
        dx = 0;
        dy = 0;
        if (player.input.left) dx -= 1;
        if (player.input.right) dx += 1;
        if (player.input.up) dy -= 1;
        if (player.input.down) dy += 1;
      }

      const moveIntensity = Math.min(1, Math.hypot(dx, dy));
      if (moveIntensity > 0.001) {
        const vector = normalizeVector(dx, dy, player.facingX, player.facingY);
        player.facingX = vector.x;
        player.facingY = vector.y;
        player.x = clamp(player.x + vector.x * GAME.moveSpeed * dt * moveIntensity, GAME.playerRadius, GAME.arenaWidth - GAME.playerRadius);
        player.y = clamp(player.y + vector.y * GAME.moveSpeed * dt * moveIntensity, GAME.playerRadius, GAME.arenaHeight - GAME.playerRadius);
      }

      if (player.input.attack && now - player.lastAttackAt >= GAME.attackCooldownMs) {
        player.lastAttackAt = now;
        player.roundStats.shots += 1;
        const direction = normalizeVector(player.input.aimX, player.input.aimY, player.facingX, player.facingY);
        player.facingX = direction.x;
        player.facingY = direction.y;
        const projectile = {
          id: shortId("shot"),
          ownerId: player.id,
          team: player.team,
          x: player.x + direction.x * (GAME.playerRadius + 8),
          y: player.y + direction.y * (GAME.playerRadius + 8),
          vx: direction.x * GAME.projectileSpeed,
          vy: direction.y * GAME.projectileSpeed,
          createdAt: now,
          expiresAt: now + GAME.projectileTtlMs
        };
        room.projectiles.set(projectile.id, projectile);
      }
    }
  }

  updateProjectiles(room, now, dt) {
    for (const projectile of room.projectiles.values()) {
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      const outOfBounds =
        projectile.x < -40 ||
        projectile.x > GAME.arenaWidth + 40 ||
        projectile.y < -40 ||
        projectile.y > GAME.arenaHeight + 40;
      if (outOfBounds || now > projectile.expiresAt) {
        room.projectiles.delete(projectile.id);
        continue;
      }

      for (const player of room.players.values()) {
        if (!player.alive || player.team === projectile.team || player.id === projectile.ownerId) continue;
        const radius = GAME.playerRadius + GAME.projectileRadius;
        if (distanceSquared(projectile, player) <= radius * radius) {
          const shooter = room.players.get(projectile.ownerId);
          const damage = getProjectileDamageWithEvents(room, GAME.projectileDamage, now);
          const result = this.applyCombatDamage(room, player, damage, {
            now,
            source: "projectile",
            attacker: shooter,
            forceX: Math.sign(projectile.vx || 0),
            forceY: Math.sign(projectile.vy || 0)
          });
          if (shooter?.roundStats) {
            shooter.roundStats.hits += 1;
            shooter.roundStats.damageDealt += result.actualDamage;
          }
          if (result.eliminated) {
            if (shooter?.roundStats) shooter.roundStats.eliminations += 1;
          }
          room.projectiles.delete(projectile.id);
          break;
        }
      }
    }
  }

  applyCombatDamage(room, player, damage, context = {}) {
    if (!player?.alive) return { actualDamage: 0, armourBroken: false, eliminated: false };
    const now = context.now || this.now();
    const unshieldedDamage = context.ignoreShield ? damage : applyShieldedDamage(player, damage);
    if (unshieldedDamage <= 0) return { actualDamage: 0, armourBroken: false, eliminated: false };

    const beforeHp = player.hp;
    const depletedHp = Math.max(0, player.hp - unshieldedDamage);
    const actualDamage = beforeHp - depletedHp;
    player.hp = depletedHp;
    this.recordDamageEvent(room, player, actualDamage, { ...context, now });

    if (player.hp > 0) return { actualDamage, armourBroken: false, eliminated: false };

    const currentLives = Math.max(1, player.lives ?? GAME.playerLives);
    if (currentLives > 1) {
      player.lives = currentLives - 1;
      player.hp = GAME.playerHp;
      player.broken = true;
      player.breakAnim = 35;
      player.armourBrokenAt = now;
      player.notice = "ARMOUR BREAK";
      room.notice = "ARMOUR BREAK";
      const knockX = Number.isFinite(context.forceX) ? context.forceX : Math.sign(player.x - (context.attacker?.x ?? player.x));
      const knockY = Number.isFinite(context.forceY) ? context.forceY : Math.sign(player.y - (context.attacker?.y ?? player.y));
      player.x = clamp(player.x + knockX * 26, GAME.playerRadius, GAME.arenaWidth - GAME.playerRadius);
      player.y = clamp(player.y + knockY * 18, GAME.playerRadius, GAME.arenaHeight - GAME.playerRadius);
      return { actualDamage, armourBroken: true, eliminated: false };
    }

    player.lives = 0;
    player.broken = true;
    player.alive = false;
    player.breakAnim = 60;
    player.roundStats.knockedOutAt = now;
    return { actualDamage, armourBroken: false, eliminated: true };
  }

  recordDamageEvent(room, player, amount, context = {}) {
    if (!room || !player || amount <= 0) return;
    const now = context.now || this.now();
    room.damageSequence = (room.damageSequence || 0) + 1;
    room.damageEvents = (room.damageEvents || []).filter((event) => now - event.createdAt <= DAMAGE_EVENT_TTL_MS);
    room.damageEvents.push({
      id: `dmg_${room.damageSequence}`,
      targetId: player.id,
      team: player.team,
      x: player.x,
      y: Math.max(GAME.playerRadius, player.y - GAME.playerRadius * 0.8),
      amount,
      source: context.source || "damage",
      createdAt: now
    });
    room.damageEvents = room.damageEvents.slice(-60);
  }

  checkWinCondition(session, now) {
    const room = session.room;
    const red = [...room.players.values()].filter((player) => player.team === "red");
    const blue = [...room.players.values()].filter((player) => player.team === "blue");
    const redAlive = red.filter((player) => player.alive).length;
    const blueAlive = blue.filter((player) => player.alive).length;

    if (red.length && blue.length && (redAlive === 0 || blueAlive === 0)) {
      this.finishRound(session, redAlive > blueAlive ? "red" : "blue");
      return;
    }

    if (room.roundEndsAt && now >= room.roundEndsAt) {
      const redHp = red.reduce((sum, player) => sum + player.hp, 0);
      const blueHp = blue.reduce((sum, player) => sum + player.hp, 0);
      const winner = redHp === blueHp ? "draw" : redHp > blueHp ? "red" : "blue";
      this.finishRound(session, winner);
    }
  }

  finishRound(session, winnerTeam) {
    const room = session.room;
    room.status = "finished";
    room.winnerTeam = winnerTeam;
    room.notice = winnerTeam === "draw" ? "Draw" : `${winnerTeam.toUpperCase()} wins`;
    for (const player of room.players.values()) {
      player.input = createEmptyInput();
    }
    room.roundSummary = finalizeRoundPilots(this.store, {
      players: [...room.players.values()],
      winnerTeam,
      roundStartedAt: room.roundStartedAt,
      finishedAt: this.now()
    });
    for (const player of room.players.values()) {
      this.refreshPlayerPilot(player);
    }
    recordRoundAnalytics(room, session, this.now());
    this.audit(session, "round_finished", { round: room.round, winnerTeam }, "director");
    updateScarcityState(room, this.now());
    this.runDirector(session);
  }

  assignTeams(room, resetPositions = false) {
    const players = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    players.forEach((player, index) => {
      player.team = index % 2 === 0 ? "red" : "blue";
      if (resetPositions || !player.x || !player.y) {
        const point = spawnPoint(player.team, Math.floor(index / 2));
        player.x = point.x;
        player.y = point.y;
        player.facingX = point.facingX;
        player.facingY = point.facingY;
      }
    });
  }

  rebalanceWaitingRoom(session, options = {}) {
    const room = session?.room;
    if (!room) return { demoted: 0, promoted: 0 };
    let demoted = 0;
    let promoted = 0;
    if (room.status === "waiting") {
      demoted = this.demoteOverflowPlayers(room, session.id);
      promoted = this.promoteQueue(room, session.id);
      if (demoted || promoted || options.resetPositions) {
        this.assignTeams(room, options.resetPositions === true);
      }
    }
    updateScarcityState(room, this.now());
    return { demoted, promoted };
  }

  demoteOverflowPlayers(room, sessionId) {
    const seatLimit = activeSeatLimit(room);
    if (room.players.size <= seatLimit) return 0;
    const players = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const overflow = players.slice(seatLimit);
    for (const player of overflow) {
      room.players.delete(player.id);
      player.input = createEmptyInput();
      this.socketIndex.set(player.socketId, { sessionId, playerId: player.id, clientType: "queued" });
    }
    room.queue = [...overflow, ...room.queue];
    return overflow.length;
  }

  promoteQueue(room, sessionId = null) {
    const resolvedSessionId = sessionId || this.findSessionIdByRoom(room);
    let promoted = 0;
    while (room.status === "waiting" && !room.locked && room.players.size < activeSeatLimit(room) && room.queue.length > 0) {
      const next = room.queue.shift();
      preparePlayerForSeat(next, this.now());
      room.players.set(next.id, next);
      this.socketIndex.set(next.socketId, { sessionId: resolvedSessionId, playerId: next.id, clientType: "player" });
      recordFunnel(room, "promotedFromQueue", this.now());
      promoted += 1;
    }
    return promoted;
  }

  findSessionIdByRoom(room) {
    for (const session of this.sessions.values()) {
      if (session.room === room) return session.id;
    }
    return null;
  }

  resolveAudienceActor(room, info, socketId) {
    if (info.clientType === "queued" && info.playerId) {
      const queued = room.queue.find((player) => player.id === info.playerId);
      return {
        id: `queued:${info.playerId}`,
        role: "queued",
        name: queued?.name || "候補玩家"
      };
    }
    return {
      id: `spectator:${socketId}`,
      role: "spectator",
      name: "觀眾"
    };
  }

  audit(session, action, details, category = eventCategory(action)) {
    const room = session.room;
    const entry = recordTimelineEvent(room.foundation, {
      at: this.now(),
      category,
      action,
      sessionId: session.id,
      roomId: room.id,
      round: room.round,
      tick: room.tick,
      details
    });
    this.store.append("events", entry);
    room.auditLog.push({
      id: entry.id,
      sequence: entry.sequence,
      at: entry.at,
      category: entry.category,
      action: entry.action,
      details: entry.details
    });
    room.auditLog = room.auditLog.slice(-80);
  }

  runDirector(session, now = this.now()) {
    const signals = evaluateDirector(session.room, activeGameConfig(session.room), now);
    for (const signal of signals) {
      this.recordDirectorSignal(session, signal);
    }
    return signals;
  }

  recordDirectorSignal(session, signal) {
    if (!signal) return;
    this.audit(
      session,
      `director_${signal.type}`,
      {
        signalId: signal.id,
        title: signal.title,
        tone: signal.tone,
        source: signal.source,
        details: signal.details
      },
      "director"
    );
  }

  recordBattleEvent(session, event) {
    if (!event) return;
    recordActivity(session.room, "events", this.now());
    this.audit(
      session,
      `battle_${event.type}`,
      {
        eventId: event.id,
        title: event.title,
        tone: event.tone,
        details: event.details
      },
      "events"
    );
  }

  activatePilot(player) {
    const profile = recordSortie(this.store, player.pilotId, this.now());
    if (profile) this.applyPilotProfile(player, profile);
  }

  refreshPlayerPilot(player) {
    const profile = this.store.get("pilots", player.pilotId);
    if (profile) this.applyPilotProfile(player, profile);
  }

  applyPilotProfile(player, profile) {
    player.titles = profile.titles;
    player.badges = profile.badges;
    player.appearance = profile.appearance;
  }

  getPublicSession(id) {
    const session = this.getSession(id);
    if (!session) return null;
    const room = session.room;
    updateScarcityState(room, this.now());
    const sessionPilotIds = collectSessionPilotIds(room);
    const gameConfig = activeGameConfig(room);
    const metrics = createRoomMetrics(room, {
      maxPlayers: gameConfig.maxPlayers,
      lastTickDurationMs: this.lastTickDurationMs,
      now: this.now()
    });
    this.store.put("metrics", `${session.id}:latest`, createMetricsSnapshot(session, metrics));
    return {
      id: session.id,
      label: session.label,
      createdAt: session.createdAt,
      game: gameConfig,
      room: {
        id: room.id,
        status: room.status,
        locked: room.locked,
        entryMode: room.entryMode,
        seatLimit: room.seatLimit,
        hardMaxPlayers: room.hardMaxPlayers,
        scarcity: room.scarcity,
        tick: room.tick,
        round: room.round,
        roundEndsAt: room.roundEndsAt,
        winnerTeam: room.winnerTeam,
        notice: room.notice,
        players: [...room.players.values()].map(serializePlayer),
        queue: room.queue.map((player) => ({
          id: player.id,
          name: player.name,
          position: room.queue.findIndex((queued) => queued.id === player.id) + 1
        })),
        spectators: room.spectators.size,
        projectiles: [...room.projectiles.values()].map(serializeProjectile),
        damageEvents: (room.damageEvents || [])
          .filter((event) => this.now() - event.createdAt <= DAMAGE_EVENT_TTL_MS)
          .map(serializeDamageEvent),
        director: serializeDirector(room.director, this.now()),
        battleEvents: serializeBattleEvents(room.battleEvents, this.now()),
        audienceInterventions: serializeAudienceInterventions(ensureAudienceInterventionState(room, this.now()), this.now()),
        analytics: createAdminAnalytics(room, { now: this.now() }),
        roundSummary: room.roundSummary || null,
        auditLog: room.auditLog.slice(-12),
        timeline: serializeTimeline(room.foundation, 12),
        foundation: {
          version: room.foundation.version,
          domains: room.foundation.domains,
          qa: room.foundation.qa
        }
      },
      metrics,
      pilots: {
        leaderboard: createLeaderboard(this.store, 10, sessionPilotIds),
        totalPilots: sessionPilotIds.size,
        globalTotalPilots: this.store.count("pilots")
      }
    };
  }
}

function collectSessionPilotIds(room) {
  const ids = new Set(room.pilotIds || []);
  for (const player of room.players.values()) ids.add(player.pilotId);
  for (const player of room.queue) ids.add(player.pilotId);
  for (const row of room.roundSummary?.scoreboard || []) ids.add(row.pilotId);
  for (const event of room.auditLog || []) {
    if (event.details?.pilotId) ids.add(event.details.pilotId);
  }
  return ids;
}

function eventCategory(action) {
  if (action.startsWith("round_")) return "director";
  if (action.startsWith("player_")) return "pilots";
  if (action.startsWith("room_")) return "admin";
  if (action.startsWith("session_")) return "system";
  return "system";
}
