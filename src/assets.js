import {
  buildClientReport,
  buildMvpList,
  buildNextRoundScript,
  buildRoundSummary,
  buildSocialPosts,
  latestRoundRecord
} from "./copy-generator.js";

export function buildAssetBundle(exportData) {
  const report = buildClientReport(exportData);
  const latestRound = latestRoundRecord(exportData);
  const winnerTeam = latestRound?.winnerTeam || exportData.room.winnerTeam || "pending";
  const victoryCardSvg = buildVictoryCardSvg(exportData, report);

  return {
    id: `${exportData.session.id}:assets:${exportData.room.round}`,
    generatedAt: exportData.exportedAt,
    session: exportData.session,
    round: latestRound?.round || exportData.room.round,
    winnerTeam,
    victoryCard: {
      filename: `${exportData.session.id}-round-${latestRound?.round || exportData.room.round}-victory.svg`,
      mimeType: "image/svg+xml",
      svg: victoryCardSvg
    },
    mvpList: buildMvpList(exportData),
    roundSummary: report.summary,
    nextRoundScript: buildNextRoundScript(exportData),
    socialPosts: buildSocialPosts(exportData),
    clientReport: report,
    clientReportHtml: buildClientReportHtml(report)
  };
}

export function buildVictoryCardSvg(exportData, report) {
  const latestRound = latestRoundRecord(exportData);
  const winner = latestRound?.winnerTeam || exportData.room.winnerTeam || "pending";
  const mvp = latestRound?.mvp;
  const palette = winner === "red"
    ? { bg1: "#3b1018", bg2: "#171923", accent: "#ef4444", line: "#fca5a5" }
    : winner === "blue"
      ? { bg1: "#0f2450", bg2: "#101827", accent: "#38bdf8", line: "#bfdbfe" }
      : { bg1: "#1f2937", bg2: "#111827", accent: "#fbbf24", line: "#fde68a" };
  const title = winner === "pending" ? "戰報生成中" : winner === "draw" ? "平手收場" : `${winner.toUpperCase()} WINS`;
  const mvpText = mvp ? `${mvp.name} · MVP ${mvp.score}` : "MVP 待產生";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="${escapeXml(report.title)}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${palette.bg1}"/>
      <stop offset="1" stop-color="${palette.bg2}"/>
    </linearGradient>
    <linearGradient id="beam" x1="0" x2="1">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${palette.accent}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect x="0" y="0" width="1280" height="720" fill="url(#beam)" opacity="0.35"/>
  <g stroke="${palette.line}" stroke-opacity="0.22" stroke-width="2">
    <path d="M80 110H1200"/>
    <path d="M80 610H1200"/>
    <path d="M180 80L320 640"/>
    <path d="M1100 80L960 640"/>
  </g>
  <rect x="88" y="88" width="1104" height="544" rx="28" fill="rgba(15,23,42,0.62)" stroke="${palette.line}" stroke-width="3"/>
  <text x="640" y="180" text-anchor="middle" font-family="Microsoft JhengHei, Segoe UI, Arial" font-size="42" fill="#e5e7eb">${escapeXml(exportData.session.label)}</text>
  <text x="640" y="318" text-anchor="middle" font-family="Segoe UI, Arial" font-size="104" font-weight="800" fill="${palette.accent}">${escapeXml(title)}</text>
  <text x="640" y="392" text-anchor="middle" font-family="Microsoft JhengHei, Segoe UI, Arial" font-size="34" fill="#f8fafc">Round ${escapeXml(String(latestRound?.round || exportData.room.round))}</text>
  <text x="640" y="462" text-anchor="middle" font-family="Microsoft JhengHei, Segoe UI, Arial" font-size="30" fill="#dbeafe">${escapeXml(mvpText)}</text>
  <text x="640" y="522" text-anchor="middle" font-family="Microsoft JhengHei, Segoe UI, Arial" font-size="24" fill="#cbd5e1">${escapeXml(report.summary)}</text>
  <text x="640" y="586" text-anchor="middle" font-family="Segoe UI, Arial" font-size="20" fill="#94a3b8">NEON MECHA ARENA · TikTok LIVE Interactive PVP</text>
</svg>`;
}

export function buildClientReportHtml(report) {
  const posts = report.socialPosts
    .map((post) => `<h3>${escapeHtml(post.platform)}</h3><p>${escapeHtml(post.text).replaceAll("\n", "<br>")}</p>`)
    .join("");
  const mvps = report.mvpList
    .map((mvp) => `<tr><td>${escapeHtml(mvp.scope)}</td><td>${escapeHtml(mvp.name)}</td><td>${escapeHtml(mvp.team)}</td><td>${escapeHtml(mvp.score)}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(report.title)}</title>
  <style>
    body { font-family: "Microsoft JhengHei", "Segoe UI", Arial, sans-serif; margin: 32px; color: #17201d; }
    h1 { margin-bottom: 4px; }
    section { margin: 24px 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #c8d7cf; padding: 9px 8px; text-align: left; }
    .card { border: 1px solid #c8d7cf; border-radius: 8px; padding: 16px; background: #f7faf9; }
  </style>
</head>
<body>
  <h1>${escapeHtml(report.title)}</h1>
  <p>Session：${escapeHtml(report.sessionId)} · 狀態：${escapeHtml(report.status)}</p>
  <section class="card">
    <h2>本局摘要</h2>
    <p>${escapeHtml(report.summary)}</p>
    <p>${escapeHtml(report.nextRoundScript)}</p>
  </section>
  <section>
    <h2>核心數據</h2>
    <table>
      <tr><th>玩家</th><td>${report.totals.players}</td><th>觀戰</th><td>${report.totals.spectators}</td></tr>
      <tr><th>排隊</th><td>${report.totals.queue}</td><th>平均延遲</th><td>${report.totals.averageLatencyMs ?? "-"}ms</td></tr>
      <tr><th>回合</th><td>${report.totals.rounds}</td><th>事件</th><td>${report.totals.events}</td></tr>
    </table>
  </section>
  <section>
    <h2>MVP 名單</h2>
    <table><tr><th>範圍</th><th>玩家</th><th>隊伍</th><th>分數</th></tr>${mvps || "<tr><td colspan=\"4\">尚無 MVP</td></tr>"}</table>
  </section>
  <section>
    <h2>社群文案</h2>
    ${posts}
  </section>
</body>
</html>`;
}

export function assetBundleToText(bundle) {
  const posts = bundle.socialPosts.map((post) => `[${post.platform}]\n${post.text}`).join("\n\n");
  return [
    `# ${bundle.clientReport.title}`,
    "",
    "## 本局摘要",
    bundle.roundSummary,
    "",
    "## 下一局口播",
    bundle.nextRoundScript,
    "",
    "## MVP 名單",
    bundle.mvpList.map((mvp) => `- ${mvp.scope}: ${mvp.name} (${mvp.team}) ${mvp.score}`).join("\n") || "- 尚無 MVP",
    "",
    "## 社群文案",
    posts
  ].join("\n");
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
