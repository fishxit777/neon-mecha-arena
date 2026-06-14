export const BATTLE_EVENT_TYPES = Object.freeze({
  energy_storm: {
    title: "能量風暴",
    body: "戰場外圈開始灼燒，駕駛員必須往安全區靠攏。",
    tone: "danger",
    durationMs: 18_000,
    priority: 55
  },
  overload: {
    title: "武器過載",
    body: "所有武器輸出提升，命中風險同步升高。",
    tone: "warning",
    durationMs: 14_000,
    priority: 60
  },
  orbital_strike: {
    title: "軌道砲鎖定",
    body: "中央航道遭到高能砲束掃射，請立即脫離中線。",
    tone: "climax",
    durationMs: 9_000,
    priority: 78
  },
  shield_boost: {
    title: "弱隊護盾",
    body: "落後隊伍獲得臨時護盾，翻盤窗口已開啟。",
    tone: "assist",
    durationMs: 16_000,
    priority: 52
  },
  supply_drop: {
    title: "補給投放",
    body: "低血量駕駛員獲得維修補給。",
    tone: "supply",
    durationMs: 8_000,
    priority: 48
  },
  final_showdown: {
    title: "最終決戰",
    body: "倒數尾聲火力解放，最後命中可能改寫勝負。",
    tone: "climax",
    durationMs: 12_000,
    priority: 80
  }
});

export function createBattleEventState(now = Date.now()) {
  return {
    active: [],
    history: [],
    schedule: [],
    lastStormDamageAt: 0,
    lastOrbitalStrikeAt: 0,
    lastShowdownDamageAt: 0,
    sequence: 0,
    updatedAt: now
  };
}

export function scheduleDefaultBattleEvents(room, now, game) {
  room.battleEvents = createBattleEventState(now);
  room.battleEvents.schedule = [
    { type: "overload", triggerAt: now + Math.round(game.roundDurationMs * 0.48) },
    { type: "orbital_strike", triggerAt: now + Math.round(game.roundDurationMs * 0.7) },
    { type: "final_showdown", triggerAt: now + Math.round(game.roundDurationMs * 0.88) }
  ];
  return room.battleEvents;
}

export function triggerBattleEvent(room, type, now, details = {}) {
  if (!Object.hasOwn(BATTLE_EVENT_TYPES, type)) {
    return { ok: false, code: "UNKNOWN_BATTLE_EVENT", message: "Unknown battle event" };
  }
  const state = ensureBattleEvents(room, now);
  const preset = BATTLE_EVENT_TYPES[type];
  state.sequence += 1;
  const event = {
    id: `battle_${String(state.sequence).padStart(5, "0")}`,
    type,
    title: preset.title,
    body: preset.body,
    tone: preset.tone,
    priority: preset.priority,
    startedAt: now,
    expiresAt: now + preset.durationMs,
    details
  };
  state.active = state.active.filter((item) => item.type !== type && item.expiresAt > now);
  state.active.push(event);
  state.history.push(event);
  state.history = state.history.slice(-80);
  state.updatedAt = now;
  applyInstantEventEffect(room, event);
  return { ok: true, event };
}

export function evaluateBattleEvents(room, game, now, applyDamage = applyDirectDamage) {
  const state = ensureBattleEvents(room, now);
  const emitted = [];
  state.active = state.active.filter((event) => event.expiresAt > now);
  const due = state.schedule.filter((item) => item.triggerAt <= now);
  state.schedule = state.schedule.filter((item) => item.triggerAt > now);
  for (const item of due) {
    const result = triggerBattleEvent(room, item.type, now, { source: "schedule" });
    if (result.ok) emitted.push(result.event);
  }
  applySustainedEventEffects(room, game, now, applyDamage);
  state.updatedAt = now;
  return emitted;
}

export function hasBattleEvent(room, type, now = Date.now()) {
  return Boolean(room.battleEvents?.active?.some((event) => event.type === type && event.expiresAt > now));
}

export function getProjectileDamageWithEvents(room, baseDamage, now) {
  let damage = baseDamage;
  if (hasBattleEvent(room, "overload", now)) damage += 8;
  if (hasBattleEvent(room, "final_showdown", now)) damage += 12;
  return damage;
}

export function applyShieldedDamage(player, damage) {
  const shield = Math.max(0, player.shieldHp || 0);
  const absorbed = Math.min(shield, damage);
  player.shieldHp = shield - absorbed;
  return damage - absorbed;
}

export function serializeBattleEvents(state, now = Date.now()) {
  if (!state) return null;
  return {
    active: state.active.filter((event) => event.expiresAt > now),
    history: state.history.slice(-12),
    schedule: state.schedule.slice(0, 5),
    updatedAt: state.updatedAt
  };
}

function applyInstantEventEffect(room, event) {
  if (event.type === "shield_boost") {
    const team = event.details?.team || weakerTeam(room);
    for (const player of room.players.values()) {
      if (player.team === team && player.alive) {
        player.shieldHp = Math.min(60, (player.shieldHp || 0) + 30);
      }
    }
  }
  if (event.type === "supply_drop") {
    const targets = [...room.players.values()].filter((player) => player.alive).sort((a, b) => a.hp - b.hp).slice(0, 2);
    for (const player of targets) {
      player.hp = Math.min(100, player.hp + 25);
    }
  }
}

function applySustainedEventEffects(room, game, now, applyDamage) {
  if (hasBattleEvent(room, "energy_storm", now)) {
    applyEnergyStorm(room, game, now, applyDamage);
  }
  if (hasBattleEvent(room, "orbital_strike", now)) {
    applyOrbitalStrike(room, game, now, applyDamage);
  }
  if (hasBattleEvent(room, "final_showdown", now)) {
    applyFinalShowdownStorm(room, game, now, applyDamage);
  }
}

function applyEnergyStorm(room, game, now, applyDamage) {
  if (now - room.battleEvents.lastStormDamageAt < 1_000) return;
  room.battleEvents.lastStormDamageAt = now;
  const center = { x: game.arenaWidth / 2, y: game.arenaHeight / 2 };
  const safeRadius = Math.min(game.arenaWidth, game.arenaHeight) * 0.38;
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const distance = Math.hypot(player.x - center.x, player.y - center.y);
    if (distance > safeRadius) {
      applyDamage(player, 2, { source: "energy_storm", now, ignoreShield: true });
    }
  }
}

function applyOrbitalStrike(room, game, now, applyDamage) {
  if (now - room.battleEvents.lastOrbitalStrikeAt < 1_400) return;
  room.battleEvents.lastOrbitalStrikeAt = now;
  const beamX = game.arenaWidth / 2;
  const beamHalfWidth = Math.max(70, game.arenaWidth * 0.07);
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    if (Math.abs(player.x - beamX) <= beamHalfWidth) {
      applyDamage(player, 12, {
        source: "orbital_strike",
        now,
        forceX: player.x < beamX ? -1 : 1,
        forceY: 0
      });
    }
  }
}

export function getFinalShowdownSafeRadius(event, game, now = Date.now()) {
  const duration = Math.max(1, event.expiresAt - event.startedAt);
  const progress = Math.max(0, Math.min(1, (now - event.startedAt) / duration));
  const base = Math.min(game.arenaWidth, game.arenaHeight);
  return base * (0.44 - progress * 0.2);
}

function activeEvent(room, type, now) {
  return room.battleEvents?.active?.find((event) => event.type === type && event.expiresAt > now) || null;
}

function applyFinalShowdownStorm(room, game, now, applyDamage) {
  const event = activeEvent(room, "final_showdown", now);
  if (!event) return;
  if (now - room.battleEvents.lastShowdownDamageAt < 1_000) return;
  room.battleEvents.lastShowdownDamageAt = now;
  const center = { x: game.arenaWidth / 2, y: game.arenaHeight / 2 };
  const safeRadius = getFinalShowdownSafeRadius(event, game, now);
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dx = player.x - center.x;
    const dy = player.y - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance > safeRadius) {
      const vectorLength = distance || 1;
      applyDamage(player, 5, {
        source: "final_showdown",
        now,
        ignoreShield: true,
        forceX: dx / vectorLength,
        forceY: dy / vectorLength
      });
    }
  }
}

function applyDirectDamage(player, damage, context = {}) {
  player.hp = Math.max(0, player.hp - damage);
  if (player.hp <= 0) {
    player.alive = false;
    player.roundStats.knockedOutAt = context.now || Date.now();
  }
  return { actualDamage: damage, armourBroken: false, eliminated: player.hp <= 0 };
}

function weakerTeam(room) {
  const teams = { red: 0, blue: 0 };
  for (const player of room.players.values()) {
    if (player.alive) teams[player.team] += player.hp;
  }
  return teams.red <= teams.blue ? "red" : "blue";
}

function ensureBattleEvents(room, now) {
  if (!room.battleEvents) room.battleEvents = createBattleEventState(now);
  return room.battleEvents;
}
