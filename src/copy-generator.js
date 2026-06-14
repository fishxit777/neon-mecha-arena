export function buildRoundSummary(exportData) {
  const latestRound = latestRoundRecord(exportData);
  if (!latestRound) {
    return "目前尚未完成任何回合，完成一局後會自動生成戰報摘要。";
  }
  const winner = latestRound.winnerTeam === "draw" ? "平手" : `${teamName(latestRound.winnerTeam)}勝利`;
  const mvp = latestRound.mvp ? `MVP 是 ${latestRound.mvp.name}，分數 ${latestRound.mvp.score}。` : "本局尚無 MVP。";
  return `Round ${latestRound.round} ${winner}，共 ${latestRound.players} 位玩家參戰，${latestRound.totalHits} 次命中、${latestRound.totalDamage} 點傷害。${mvp}`;
}

export function buildNextRoundScript(exportData) {
  const metrics = exportData.metrics;
  const queue = metrics.queuedPlayers > 0 ? `目前排隊 ${metrics.queuedPlayers} 位，下一局準備補位。` : "目前沒有排隊，觀眾可以掃 QR code 加入下一局。";
  const slots = metrics.openSlots > 0 ? `還有 ${metrics.openSlots} 個名額。` : "本局名額已滿。";
  return `下一局準備開始，${queue}${slots} 看到 QR code 的觀眾可以直接加入，紅藍機甲準備開戰。`;
}

export function buildMvpList(exportData) {
  const latestRound = latestRoundRecord(exportData);
  const roundMvp = latestRound?.mvp
    ? [{ scope: "本局 MVP", name: latestRound.mvp.name, pilotId: latestRound.mvp.pilotId, team: latestRound.mvp.team, score: latestRound.mvp.score }]
    : [];
  const activityMvp = exportData.analytics.mvp
    ? [{ scope: "活動 MVP", name: exportData.analytics.mvp.name, pilotId: exportData.analytics.mvp.pilotId, team: "-", score: `${exportData.analytics.mvp.count} 次 MVP` }]
    : [];
  return [...roundMvp, ...activityMvp];
}

export function buildSocialPosts(exportData) {
  const summary = buildRoundSummary(exportData);
  const mvp = latestRoundRecord(exportData)?.mvp?.name || "神秘駕駛員";
  const hashtags = ["#TikTokLIVE", "#直播互動遊戲", "#NEONMECHAARENA"];
  return [
    {
      platform: "TikTok",
      text: `${summary}\n下一局開放觀眾掃 QR code 參戰，誰能打下下一個 MVP？\n${hashtags.join(" ")}`
    },
    {
      platform: "Instagram",
      text: `今晚機甲戰場火力全開。本局亮點：${mvp} 拿下 MVP，紅藍對決持續升溫。\n${hashtags.join(" ")}`
    },
    {
      platform: "Facebook",
      text: `NEON MECHA ARENA 直播互動戰報：${summary} 下一局歡迎觀眾加入對戰，一起把直播變成即時戰場。`
    }
  ];
}

export function buildClientReport(exportData) {
  const latestRound = latestRoundRecord(exportData);
  return {
    title: `${exportData.session.label} 活動報告`,
    generatedAt: exportData.exportedAt,
    sessionId: exportData.session.id,
    status: exportData.room.status,
    totals: {
      players: exportData.metrics.activePlayers,
      spectators: exportData.metrics.spectators,
      queue: exportData.metrics.queuedPlayers,
      averageLatencyMs: exportData.metrics.averageLatencyMs,
      rounds: exportData.analytics.rounds.length,
      events: exportData.events.length
    },
    latestRound: latestRound || null,
    mvpList: buildMvpList(exportData),
    summary: buildRoundSummary(exportData),
    nextRoundScript: buildNextRoundScript(exportData),
    socialPosts: buildSocialPosts(exportData)
  };
}

export function latestRoundRecord(exportData) {
  return exportData.analytics?.rounds?.at(-1) || null;
}

function teamName(team) {
  if (team === "red") return "紅隊";
  if (team === "blue") return "藍隊";
  return "雙方";
}
