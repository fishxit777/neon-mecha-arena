export const DIRECTOR_SIGNAL_TYPES = Object.freeze({
  waiting: {
    title: "等待加入",
    body: "玩家正在掃碼進場，主播可以先暖場。",
    tone: "neutral",
    priority: 10,
    durationMs: 4_000
  },
  opening_countdown: {
    title: "開場倒數",
    body: "戰場啟動，所有駕駛員準備出擊。",
    tone: "charge",
    priority: 60,
    durationMs: 4_800
  },
  full_house: {
    title: "滿房警報",
    body: "隊伍人數已滿，觀眾排隊等待下一輪。",
    tone: "warning",
    priority: 45,
    durationMs: 5_200
  },
  queue_pressure: {
    title: "排隊壓力上升",
    body: "候補玩家增加，主播可提醒下一局即將開放。",
    tone: "warning",
    priority: 38,
    durationMs: 4_600
  },
  weak_team: {
    title: "弱隊逆風補正",
    body: "系統偵測落後隊伍，提醒主播帶動翻盤氣氛。",
    tone: "assist",
    priority: 52,
    durationMs: 5_000
  },
  overdrive: {
    title: "火力過載",
    body: "全場傷害提升，戰局進入高壓節奏。",
    tone: "danger",
    priority: 70,
    durationMs: 5_400
  },
  final_duel: {
    title: "最終單挑",
    body: "倒數進入尾聲，最後一次交鋒決定勝負。",
    tone: "climax",
    priority: 90,
    durationMs: 6_500
  },
  manual_hype: {
    title: "主播喊話",
    body: "主播手動觸發戰場喊話，集中觀眾注意力。",
    tone: "hype",
    priority: 64,
    durationMs: 5_000
  },
  hype_moment: {
    title: "高潮時刻",
    body: "全場聚焦，軌道砲與最終對決同步啟動。",
    tone: "climax",
    priority: 96,
    durationMs: 7_000
  }
});

const SIGNAL_COOLDOWNS = Object.freeze({
  waiting: 12_000,
  full_house: 12_000,
  queue_pressure: 12_000,
  weak_team: 10_000,
  overdrive: 999_999,
  final_duel: 999_999
});

export function createDirectorState(now = Date.now()) {
  return {
    phase: "waiting",
    activeSignal: null,
    signalHistory: [],
    lastSignalAt: {},
    roundMarkers: {},
    createdAt: now,
    updatedAt: now
  };
}

export function resetDirectorForRound(director, round, now) {
  director.phase = "opening";
  director.roundMarkers = {
    round,
    overdrive: false,
    finalDuel: false,
    weakTeam: false
  };
  director.updatedAt = now;
  return pushDirectorSignal(director, {
    type: "opening_countdown",
    source: "auto",
    now,
    round,
    details: { stage: "round_start" }
  });
}

export function evaluateDirector(room, game, now) {
  const signals = [];
  const director = ensureDirector(room, now);
  director.phase = room.status;
  director.updatedAt = now;

  if (room.status === "waiting") {
    if (room.players.size < 2) {
      const signal = maybeSignal(room, "waiting", now, { players: room.players.size });
      if (signal) signals.push(signal);
    }
    signals.push(...evaluateCapacity(room, game, now));
    return signals;
  }

  if (room.status !== "playing") {
    director.phase = room.status;
    return signals;
  }

  const secondsLeft = room.roundEndsAt ? Math.max(0, Math.ceil((room.roundEndsAt - now) / 1000)) : null;
  signals.push(...evaluateCapacity(room, game, now));

  const balance = computeTeamBalance(room);
  if (balance.weakerTeam && (balance.aliveGap >= 2 || balance.hpGap >= 55)) {
    const signal = maybeSignal(room, "weak_team", now, {
      weakerTeam: balance.weakerTeam,
      hpGap: balance.hpGap,
      aliveGap: balance.aliveGap
    });
    if (signal) {
      director.roundMarkers.weakTeam = true;
      signals.push(signal);
    }
  }

  if (secondsLeft !== null && secondsLeft <= 20 && !director.roundMarkers.overdrive) {
    director.roundMarkers.overdrive = true;
    const signal = pushDirectorSignal(director, {
      type: "overdrive",
      source: "auto",
      now,
      round: room.round,
      details: { secondsLeft }
    });
    signals.push(signal);
  }

  if ((secondsLeft !== null && secondsLeft <= 10) || isFinalDuel(room)) {
    if (!director.roundMarkers.finalDuel) {
      director.roundMarkers.finalDuel = true;
      const signal = pushDirectorSignal(director, {
        type: "final_duel",
        source: "auto",
        now,
        round: room.round,
        details: { secondsLeft, duel: isFinalDuel(room) }
      });
      signals.push(signal);
    }
  }

  director.phase = director.roundMarkers.finalDuel ? "final_duel" : director.roundMarkers.overdrive ? "overdrive" : "playing";
  return signals;
}

export function triggerDirectorSignal(room, type, now, details = {}) {
  const director = ensureDirector(room, now);
  if (!Object.hasOwn(DIRECTOR_SIGNAL_TYPES, type)) {
    return { ok: false, code: "UNKNOWN_DIRECTOR_SIGNAL", message: "Unknown director signal" };
  }
  const signal = pushDirectorSignal(director, {
    type,
    source: "admin",
    now,
    round: room.round,
    details
  });
  return { ok: true, signal };
}

export function getActiveDirectorSignal(director, now) {
  const signal = director?.activeSignal;
  if (!signal || signal.expiresAt <= now) return null;
  return signal;
}

export function serializeDirector(director, now, limit = 12) {
  if (!director) return null;
  return {
    phase: director.phase,
    activeSignal: getActiveDirectorSignal(director, now),
    signalHistory: director.signalHistory.slice(-limit),
    roundMarkers: { ...director.roundMarkers },
    updatedAt: director.updatedAt
  };
}

function evaluateCapacity(room, game, now) {
  const signals = [];
  if (room.players.size >= game.maxPlayers) {
    const full = maybeSignal(room, "full_house", now, { activePlayers: room.players.size, maxPlayers: game.maxPlayers });
    if (full) signals.push(full);
  }
  if (room.queue.length > 0) {
    const queued = maybeSignal(room, "queue_pressure", now, { queuedPlayers: room.queue.length });
    if (queued) signals.push(queued);
  }
  return signals;
}

function maybeSignal(room, type, now, details) {
  const director = ensureDirector(room, now);
  const cooldown = SIGNAL_COOLDOWNS[type] ?? 8_000;
  const last = director.lastSignalAt[type] || 0;
  if (last && now - last < cooldown) return null;
  return pushDirectorSignal(director, {
    type,
    source: "auto",
    now,
    round: room.round,
    details
  });
}

function pushDirectorSignal(director, payload) {
  const preset = DIRECTOR_SIGNAL_TYPES[payload.type];
  const signal = {
    id: `director_${String(director.signalHistory.length + 1).padStart(5, "0")}`,
    type: payload.type,
    title: preset.title,
    body: preset.body,
    tone: preset.tone,
    priority: preset.priority,
    source: payload.source || "auto",
    round: payload.round || 0,
    startedAt: payload.now,
    expiresAt: payload.now + preset.durationMs,
    details: payload.details || {}
  };
  director.activeSignal = chooseActiveSignal(director.activeSignal, signal, payload.now);
  director.signalHistory.push(signal);
  director.signalHistory = director.signalHistory.slice(-60);
  director.lastSignalAt[payload.type] = payload.now;
  director.updatedAt = payload.now;
  return signal;
}

function chooseActiveSignal(current, next, now) {
  if (!current || current.expiresAt <= now) return next;
  if (next.priority >= current.priority) return next;
  return current;
}

function ensureDirector(room, now) {
  if (!room.director) room.director = createDirectorState(now);
  return room.director;
}

function computeTeamBalance(room) {
  const teams = {
    red: [...room.players.values()].filter((player) => player.team === "red"),
    blue: [...room.players.values()].filter((player) => player.team === "blue")
  };
  const redAlive = teams.red.filter((player) => player.alive);
  const blueAlive = teams.blue.filter((player) => player.alive);
  const redHp = redAlive.reduce((sum, player) => sum + player.hp, 0);
  const blueHp = blueAlive.reduce((sum, player) => sum + player.hp, 0);
  const aliveGap = Math.abs(redAlive.length - blueAlive.length);
  const hpGap = Math.abs(redHp - blueHp);
  let weakerTeam = null;
  if (redAlive.length < blueAlive.length || redHp + 55 < blueHp) weakerTeam = "red";
  if (blueAlive.length < redAlive.length || blueHp + 55 < redHp) weakerTeam = "blue";
  return { weakerTeam, aliveGap, hpGap };
}

function isFinalDuel(room) {
  const alive = [...room.players.values()].filter((player) => player.alive);
  const redAlive = alive.filter((player) => player.team === "red").length;
  const blueAlive = alive.filter((player) => player.team === "blue").length;
  return room.players.size > 2 && redAlive === 1 && blueAlive === 1 && alive.length === 2;
}
