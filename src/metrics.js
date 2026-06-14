export function createAnalyticsState(now = Date.now()) {
  return {
    createdAt: now,
    funnel: {
      joinPageViews: 0,
      successfulJoins: 0,
      queuedJoins: 0,
      disconnects: 0
    },
    controls: {
      resets: 0,
      nextRounds: 0,
      kicks: 0,
      locks: 0,
      unlocks: 0,
      manualDirectorSignals: 0,
      manualBattleEvents: 0
    },
    latency: {
      clients: {},
      averageMs: null,
      lastProbeAt: null
    },
    spectators: {
      lastSeenAt: null
    },
    activityBuckets: [],
    rounds: [],
    errors: []
  };
}

export function createRoomMetrics(room, options = {}) {
  const players = [...room.players.values()];
  const alivePlayers = players.filter((player) => player.alive);
  const teamCounts = countByTeam(players);
  const aliveByTeam = countByTeam(alivePlayers);
  const maxPlayers = Number.isFinite(options.maxPlayers) ? options.maxPlayers : players.length;
  const analytics = ensureAnalytics(room, finiteNumber(options.now, Date.now()));

  return {
    status: room.status,
    round: room.round,
    tick: room.tick,
    locked: room.locked,
    winnerTeam: room.winnerTeam,
    activePlayers: players.length,
    alivePlayers: alivePlayers.length,
    queuedPlayers: room.queue.length,
    spectators: room.spectators.size,
    projectiles: room.projectiles.size,
    maxPlayers,
    openSlots: Math.max(0, maxPlayers - players.length),
    teamCounts,
    aliveByTeam,
    teamBalance: calculateTeamBalance(teamCounts),
    averageLatencyMs: analytics.latency.averageMs,
    lastTickDurationMs: finiteNumber(options.lastTickDurationMs, 0),
    sampledAt: finiteNumber(options.now, Date.now())
  };
}

export function createMetricsSnapshot(session, roomMetrics) {
  return {
    id: `${session.id}:${roomMetrics.round}:${roomMetrics.tick}`,
    sessionId: session.id,
    label: session.label,
    createdAt: roomMetrics.sampledAt,
    metrics: roomMetrics
  };
}

export function createAdminAnalytics(room, options = {}) {
  const now = finiteNumber(options.now, Date.now());
  const analytics = ensureAnalytics(room, now);
  const latencyClients = Object.values(analytics.latency.clients)
    .filter((client) => now - client.lastSeenAt <= 30_000)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, 12);
  const peak = getPeakActivity(analytics.activityBuckets);
  const totalJoinAttempts = analytics.funnel.successfulJoins + analytics.funnel.queuedJoins;
  const conversionBase = Math.max(analytics.funnel.joinPageViews, totalJoinAttempts);
  const joinConversionRate =
    conversionBase > 0 ? Math.round((analytics.funnel.successfulJoins / conversionBase) * 100) : null;

  return {
    funnel: {
      ...analytics.funnel,
      totalJoinAttempts,
      joinConversionRate
    },
    spectators: {
      count: room.spectators.size,
      online: room.spectators.size > 0,
      lastSeenAt: analytics.spectators.lastSeenAt
    },
    teams: {
      players: countByTeam([...room.players.values()]),
      alive: countByTeam([...room.players.values()].filter((player) => player.alive))
    },
    latency: {
      averageMs: analytics.latency.averageMs,
      lastProbeAt: analytics.latency.lastProbeAt,
      clients: latencyClients
    },
    rounds: analytics.rounds.slice(-10),
    activityPeak: peak,
    controls: { ...analytics.controls },
    errors: analytics.errors.slice(-10),
    mvp: summarizeMvp(analytics.rounds)
  };
}

export function recordFunnel(room, key, now = Date.now()) {
  const analytics = ensureAnalytics(room, now);
  if (Object.hasOwn(analytics.funnel, key)) {
    analytics.funnel[key] += 1;
  }
  return analytics.funnel;
}

export function recordControl(room, key, now = Date.now()) {
  const analytics = ensureAnalytics(room, now);
  if (Object.hasOwn(analytics.controls, key)) {
    analytics.controls[key] += 1;
  }
  recordActivity(room, "controls", now);
  return analytics.controls;
}

export function recordActivity(room, type, now = Date.now(), amount = 1) {
  const analytics = ensureAnalytics(room, now);
  const bucketStart = Math.floor(now / 60_000) * 60_000;
  let bucket = analytics.activityBuckets.find((item) => item.startAt === bucketStart);
  if (!bucket) {
    bucket = { startAt: bucketStart, joins: 0, attacks: 0, events: 0, controls: 0, errors: 0 };
    analytics.activityBuckets.push(bucket);
    analytics.activityBuckets = analytics.activityBuckets.slice(-120);
  }
  if (Object.hasOwn(bucket, type)) bucket[type] += amount;
  return bucket;
}

export function recordSpectatorSeen(room, now = Date.now()) {
  const analytics = ensureAnalytics(room, now);
  analytics.spectators.lastSeenAt = now;
  return analytics.spectators;
}

export function recordLatency(room, client, now = Date.now()) {
  const analytics = ensureAnalytics(room, now);
  const latencyMs = Math.max(0, Math.round(finiteNumber(client.latencyMs, 0)));
  analytics.latency.clients[client.socketId] = {
    socketId: client.socketId,
    clientType: client.clientType || "unknown",
    playerId: client.playerId || null,
    name: client.name || null,
    latencyMs,
    lastSeenAt: now
  };
  const recent = Object.values(analytics.latency.clients).filter((item) => now - item.lastSeenAt <= 30_000);
  analytics.latency.averageMs = recent.length
    ? Math.round(recent.reduce((sum, item) => sum + item.latencyMs, 0) / recent.length)
    : null;
  analytics.latency.lastProbeAt = now;
  if (client.clientType === "spectator") recordSpectatorSeen(room, now);
  return analytics.latency;
}

export function recordRoundAnalytics(room, session, now = Date.now()) {
  const analytics = ensureAnalytics(room, now);
  const players = [...room.players.values()];
  const mvp = room.roundSummary?.mvp || null;
  const round = {
    id: `${session.id}:round:${room.round}`,
    sessionId: session.id,
    label: session.label,
    round: room.round,
    winnerTeam: room.winnerTeam,
    durationMs: Math.max(0, now - finiteNumber(room.roundStartedAt, now)),
    players: players.length,
    redAlive: players.filter((player) => player.team === "red" && player.alive).length,
    blueAlive: players.filter((player) => player.team === "blue" && player.alive).length,
    mvp: mvp
      ? {
          pilotId: mvp.pilotId,
          name: mvp.name,
          team: mvp.team,
          score: mvp.score
        }
      : null,
    totalHits: players.reduce((sum, player) => sum + (player.roundStats?.hits || 0), 0),
    totalDamage: players.reduce((sum, player) => sum + (player.roundStats?.damageDealt || 0), 0),
    battleEvents: room.battleEvents?.history?.length || 0,
    finishedAt: now
  };
  analytics.rounds.push(round);
  analytics.rounds = analytics.rounds.slice(-80);
  return round;
}

export function recordAnalyticsError(room, error, now = Date.now()) {
  const analytics = ensureAnalytics(room, now);
  const entry = {
    id: `err_${String(analytics.errors.length + 1).padStart(5, "0")}`,
    at: now,
    code: safeText(error.code || "UNKNOWN_ERROR", 60),
    message: safeText(error.message || error.code || "Unknown error", 180),
    source: safeText(error.source || "system", 40),
    socketId: error.socketId || null
  };
  analytics.errors.push(entry);
  analytics.errors = analytics.errors.slice(-80);
  recordActivity(room, "errors", now);
  return entry;
}

export function createSessionExport(session, options = {}) {
  const now = finiteNumber(options.now, Date.now());
  const room = session.room;
  const metrics = createRoomMetrics(room, {
    maxPlayers: options.maxPlayers,
    lastTickDurationMs: options.lastTickDurationMs,
    now
  });
  const analytics = createAdminAnalytics(room, { now });
  const players = [...room.players.values()].map((player) => ({
    id: player.id,
    pilotId: player.pilotId,
    name: player.name,
    team: player.team,
    hp: Math.round(player.hp),
    shieldHp: Math.round(player.shieldHp || 0),
    alive: player.alive,
    connected: player.connected,
    title: player.titles?.[0] || "Rookie",
    shots: player.roundStats?.shots || 0,
    hits: player.roundStats?.hits || 0,
    damageDealt: player.roundStats?.damageDealt || 0,
    eliminations: player.roundStats?.eliminations || 0
  }));

  return {
    exportedAt: now,
    session: {
      id: session.id,
      label: session.label,
      createdAt: session.createdAt
    },
    room: {
      id: room.id,
      status: room.status,
      round: room.round,
      winnerTeam: room.winnerTeam
    },
    metrics,
    analytics,
    players,
    queue: room.queue.map((player) => ({ id: player.id, pilotId: player.pilotId, name: player.name })),
    events: room.foundation?.timeline?.slice(-120) || []
  };
}

export function sessionExportToCsv(exportData) {
  const rows = [
    ["section", "id", "name", "type", "value", "detail"]
  ];
  rows.push(["session", exportData.session.id, exportData.session.label, "status", exportData.room.status, `round ${exportData.room.round}`]);
  rows.push(["metrics", exportData.session.id, "activePlayers", "count", exportData.metrics.activePlayers, `max ${exportData.metrics.maxPlayers}`]);
  rows.push(["metrics", exportData.session.id, "queue", "count", exportData.metrics.queuedPlayers, ""]);
  rows.push(["metrics", exportData.session.id, "spectators", "count", exportData.metrics.spectators, ""]);
  rows.push(["metrics", exportData.session.id, "averageLatencyMs", "ms", exportData.metrics.averageLatencyMs ?? "", ""]);

  for (const player of exportData.players) {
    rows.push(["player", player.id, player.name, player.team, player.hp, `pilot ${player.pilotId}; hits ${player.hits}; damage ${player.damageDealt}`]);
  }
  for (const round of exportData.analytics.rounds) {
    rows.push(["round", round.id, `round ${round.round}`, round.winnerTeam || "draw", round.players, round.mvp ? `MVP ${round.mvp.name}` : ""]);
  }
  for (const event of exportData.events) {
    rows.push(["event", event.id, event.action, event.category, event.round, event.details?.title || event.details?.code || ""]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function ensureAnalytics(room, now) {
  if (!room.analytics) room.analytics = createAnalyticsState(now);
  return room.analytics;
}

function countByTeam(players) {
  return players.reduce(
    (result, player) => {
      if (player.team === "red") result.red += 1;
      if (player.team === "blue") result.blue += 1;
      return result;
    },
    { red: 0, blue: 0 }
  );
}

function calculateTeamBalance(teamCounts) {
  return Math.abs(teamCounts.red - teamCounts.blue);
}

function getPeakActivity(buckets) {
  if (!buckets.length) {
    return { startAt: null, total: 0, joins: 0, attacks: 0, events: 0, controls: 0, errors: 0 };
  }
  return buckets
    .map((bucket) => ({
      ...bucket,
      total: bucket.joins + bucket.attacks + bucket.events + bucket.controls + bucket.errors
    }))
    .sort((a, b) => b.total - a.total || b.startAt - a.startAt)[0];
}

function summarizeMvp(rounds) {
  const counts = new Map();
  for (const round of rounds) {
    if (!round.mvp?.pilotId) continue;
    const existing = counts.get(round.mvp.pilotId) || { pilotId: round.mvp.pilotId, name: round.mvp.name, count: 0 };
    existing.count += 1;
    counts.set(round.mvp.pilotId, existing);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0] || null;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function safeText(value, limit) {
  return String(value || "").slice(0, limit);
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
