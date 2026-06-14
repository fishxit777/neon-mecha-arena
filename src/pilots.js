import crypto from "node:crypto";

export const PILOT_ID_PREFIX = "pilot";

export function createPilotId() {
  return `${PILOT_ID_PREFIX}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function normalizePilotId(value) {
  const id = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 40);
  return id.startsWith(`${PILOT_ID_PREFIX}_`) && id.length >= 14 ? id : createPilotId();
}

export function createRoundStats(now = Date.now()) {
  return {
    shots: 0,
    hits: 0,
    damageDealt: 0,
    eliminations: 0,
    survivalMs: 0,
    roundStartedAt: now,
    knockedOutAt: null,
    aliveAtEnd: true
  };
}

export function upsertPilot(store, { pilotId, name, now }) {
  const normalizedName = String(name || "Pilot").slice(0, 32);
  const existing = store.get("pilots", pilotId);
  const returningByName = !existing && store.list("pilots").some((pilot) => pilot.name === normalizedName);
  const returning = Boolean(existing || returningByName);
  const profile =
    existing ||
    {
      id: pilotId,
      name: normalizedName,
      firstSeenAt: now,
      lastSeenAt: now,
      sortieCount: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      hits: 0,
      damageDealt: 0,
      eliminations: 0,
      survivalSeconds: 0,
      mvpCount: 0,
      winStreak: 0,
      bestWinStreak: 0,
      badges: [],
      titles: ["Rookie"],
      appearance: createAppearance(["Rookie"])
    };

  profile.name = normalizedName;
  profile.lastSeenAt = now;
  profile.returning = returning;
  profile.titles = derivePilotTitles(profile);
  profile.badges = derivePilotBadges(profile);
  profile.appearance = createAppearance(profile.titles);
  store.put("pilots", profile.id, profile);
  return { profile, returning };
}

export function recordSortie(store, pilotId, now = Date.now()) {
  const profile = store.get("pilots", pilotId);
  if (!profile) return null;
  profile.sortieCount += 1;
  profile.lastSeenAt = now;
  profile.titles = derivePilotTitles(profile);
  profile.badges = derivePilotBadges(profile);
  profile.appearance = createAppearance(profile.titles);
  store.put("pilots", profile.id, profile);
  return profile;
}

export function finalizeRoundPilots(store, { players, winnerTeam, roundStartedAt, finishedAt }) {
  const scoreboard = players.map((player) => {
    const stats = finalizePlayerRoundStats(player, roundStartedAt, finishedAt);
    const won = winnerTeam !== "draw" && player.team === winnerTeam;
    const mvpScore = calculateMvpScore(stats, won);
    return {
      playerId: player.id,
      pilotId: player.pilotId,
      name: player.name,
      team: player.team,
      won,
      alive: player.alive,
      hp: Math.max(0, Math.round(player.hp)),
      stats,
      mvpScore
    };
  });

  const mvp = scoreboard
    .slice()
    .sort((a, b) => b.mvpScore - a.mvpScore || b.stats.damageDealt - a.stats.damageDealt || b.stats.survivalMs - a.stats.survivalMs)[0];

  for (const row of scoreboard) {
    const profile = store.get("pilots", row.pilotId);
    if (!profile) continue;
    if (winnerTeam === "draw") profile.draws += 1;
    else if (row.won) profile.wins += 1;
    else profile.losses += 1;
    profile.hits += row.stats.hits;
    profile.damageDealt += row.stats.damageDealt;
    profile.eliminations += row.stats.eliminations;
    profile.survivalSeconds += Math.round(row.stats.survivalMs / 1000);
    if (row.won) profile.winStreak += 1;
    else profile.winStreak = 0;
    profile.bestWinStreak = Math.max(profile.bestWinStreak, profile.winStreak);
    if (mvp && row.pilotId === mvp.pilotId) profile.mvpCount += 1;
    profile.titles = derivePilotTitles(profile);
    profile.badges = derivePilotBadges(profile);
    profile.appearance = createAppearance(profile.titles);
    store.put("pilots", profile.id, profile);
  }

  return {
    mvp: mvp
      ? {
          pilotId: mvp.pilotId,
          playerId: mvp.playerId,
          name: mvp.name,
          team: mvp.team,
          score: Math.round(mvp.mvpScore),
          stats: mvp.stats
        }
      : null,
    scoreboard
  };
}

export function createLeaderboard(store, limit = 10, pilotIds = null) {
  const allowed = pilotIds ? new Set([...pilotIds].filter(Boolean)) : null;
  return store
    .list("pilots")
    .filter((pilot) => !allowed || allowed.has(pilot.id))
    .sort((a, b) => pilotRankScore(b) - pilotRankScore(a) || b.wins - a.wins || b.mvpCount - a.mvpCount)
    .slice(0, limit)
    .map((pilot, index) => ({
      rank: index + 1,
      id: pilot.id,
      name: pilot.name,
      title: pilot.titles[0] || "Rookie",
      sortieCount: pilot.sortieCount,
      wins: pilot.wins,
      mvpCount: pilot.mvpCount,
      hits: pilot.hits,
      damageDealt: pilot.damageDealt,
      winStreak: pilot.winStreak,
      bestWinStreak: pilot.bestWinStreak,
      badges: pilot.badges,
      appearance: pilot.appearance,
      score: Math.round(pilotRankScore(pilot))
    }));
}

export function derivePilotTitles(profile) {
  const titles = [];
  if (profile.mvpCount >= 1) titles.push("MVP Core");
  if (profile.bestWinStreak >= 2) titles.push("Ace Pilot");
  if (profile.hits >= 5) titles.push("Sharpshooter");
  if (profile.survivalSeconds >= 90) titles.push("Survivor");
  if (!titles.length) titles.push("Rookie");
  return titles;
}

export function derivePilotBadges(profile) {
  const badges = [];
  if (profile.sortieCount >= 3) badges.push("Veteran");
  if (profile.wins >= 3) badges.push("Winner");
  if (profile.mvpCount >= 1) badges.push("MVP");
  if (profile.eliminations >= 3) badges.push("Breaker");
  return badges;
}

export function createAppearance(titles = []) {
  if (titles.includes("MVP Core")) {
    return { core: "#f472b6", frame: "#be185d", trail: "#f9a8d4", variant: "mvp" };
  }
  if (titles.includes("Ace Pilot")) {
    return { core: "#facc15", frame: "#ca8a04", trail: "#fde68a", variant: "ace" };
  }
  if (titles.includes("Sharpshooter")) {
    return { core: "#38bdf8", frame: "#0369a1", trail: "#bae6fd", variant: "sharpshooter" };
  }
  if (titles.includes("Survivor")) {
    return { core: "#22c55e", frame: "#15803d", trail: "#bbf7d0", variant: "survivor" };
  }
  return { core: "#cbd5e1", frame: "#64748b", trail: "#e2e8f0", variant: "rookie" };
}

function finalizePlayerRoundStats(player, roundStartedAt, finishedAt) {
  const stats = { ...player.roundStats };
  const endAt = stats.knockedOutAt || finishedAt;
  stats.survivalMs = Math.max(0, endAt - roundStartedAt);
  stats.aliveAtEnd = player.alive;
  return stats;
}

function calculateMvpScore(stats, won) {
  return (
    stats.damageDealt +
    stats.hits * 12 +
    stats.eliminations * 60 +
    Math.round(stats.survivalMs / 1000) * 0.4 +
    (stats.aliveAtEnd ? 15 : 0) +
    (won ? 50 : 0)
  );
}

function pilotRankScore(profile) {
  return profile.wins * 100 + profile.mvpCount * 80 + profile.hits * 8 + profile.eliminations * 25 + profile.sortieCount * 6;
}
