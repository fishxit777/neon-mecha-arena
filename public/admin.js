const socket = io();

const TEST_ADMIN_TOKEN = "change-me-to-a-32-character-random-token";

const state = {
  authed: false,
  token: TEST_ADMIN_TOKEN,
  selectedSessionId: localStorage.getItem("tiktokPvpSessionId") || "",
  sessions: [],
  entryModes: [],
  entryModeDrafts: {},
  battleEventTypes: []
};

const els = {
  socketStatus: document.querySelector("#socketStatus"),
  tokenInput: document.querySelector("#tokenInput"),
  labelInput: document.querySelector("#labelInput"),
  authBtn: document.querySelector("#authBtn"),
  createBtn: document.querySelector("#createBtn"),
  message: document.querySelector("#message"),
  networkHint: document.querySelector("#networkHint"),
  selectedId: document.querySelector("#selectedId"),
  playerUrl: document.querySelector("#playerUrl"),
  spectatorUrl: document.querySelector("#spectatorUrl"),
  tiktokStudioUrl: document.querySelector("#tiktokStudioUrl"),
  copyPlayerBtn: document.querySelector("#copyPlayerBtn"),
  copySpectatorBtn: document.querySelector("#copySpectatorBtn"),
  copyStudioBtn: document.querySelector("#copyStudioBtn"),
  copyStudioGuideBtn: document.querySelector("#copyStudioGuideBtn"),
  openStudioPreviewBtn: document.querySelector("#openStudioPreviewBtn"),
  studioGuide: document.querySelector("#studioGuide"),
  studioNotice: document.querySelector("#studioNotice"),
  sessionList: document.querySelector("#sessionList"),
  playersBody: document.querySelector("#playersBody"),
  queueStatus: document.querySelector("#queueStatus"),
  roomStatus: document.querySelector("#roomStatus"),
  metrics: document.querySelector("#metrics"),
  qrPreview: document.querySelector("#qrPreview"),
  qrImage: document.querySelector("#qrImage"),
  clearSelection: document.querySelector("#clearSelection"),
  addBotBtn: document.querySelector("#addBotBtn"),
  botAutoBtn: document.querySelector("#botAutoBtn"),
  botManualBtn: document.querySelector("#botManualBtn"),
  removeBotBtn: document.querySelector("#removeBotBtn"),
  botStatus: document.querySelector("#botStatus"),
  entryModeSelect: document.querySelector("#entryModeSelect"),
  entryModeApplyBtn: document.querySelector("#entryModeApplyBtn"),
  scarcityMeter: document.querySelector("#scarcityMeter"),
  scarcityStatus: document.querySelector("#scarcityStatus"),
  directorStatus: document.querySelector("#directorStatus"),
  directorSignal: document.querySelector("#directorSignal"),
  directorTimeline: document.querySelector("#directorTimeline"),
  mvpSummary: document.querySelector("#mvpSummary"),
  leaderboardBody: document.querySelector("#leaderboardBody"),
  battleEventStatus: document.querySelector("#battleEventStatus"),
  battleEventActive: document.querySelector("#battleEventActive"),
  battleEventTimeline: document.querySelector("#battleEventTimeline"),
  analyticsCards: document.querySelector("#analyticsCards"),
  funnelStats: document.querySelector("#funnelStats"),
  controlStats: document.querySelector("#controlStats"),
  latencyBody: document.querySelector("#latencyBody"),
  roundHistoryBody: document.querySelector("#roundHistoryBody"),
  errorLogBody: document.querySelector("#errorLogBody"),
  exportJsonBtn: document.querySelector("#exportJsonBtn"),
  exportCsvBtn: document.querySelector("#exportCsvBtn"),
  assetJsonBtn: document.querySelector("#assetJsonBtn"),
  assetReportBtn: document.querySelector("#assetReportBtn"),
  assetVictoryBtn: document.querySelector("#assetVictoryBtn"),
  assetSocialBtn: document.querySelector("#assetSocialBtn"),
  assetSummary: document.querySelector("#assetSummary"),
  assetScript: document.querySelector("#assetScript"),
  assetMvpList: document.querySelector("#assetMvpList"),
  assetSocialCopy: document.querySelector("#assetSocialCopy"),
  copySummaryBtn: document.querySelector("#copySummaryBtn"),
  copyScriptBtn: document.querySelector("#copyScriptBtn"),
  copySocialBtn: document.querySelector("#copySocialBtn"),
  hypeMomentBtn: document.querySelector("#hypeMomentBtn")
};

localStorage.setItem("tiktokPvpAdminToken", TEST_ADMIN_TOKEN);
els.tokenInput.value = state.token;
els.message.textContent = `測試階段 Admin Token 已預填：${TEST_ADMIN_TOKEN}`;
renderNetworkHint();
render();

socket.on("connect", () => {
  setStatus("online", true);
  if (state.token) auth();
});

socket.on("disconnect", () => setStatus("offline", false));

socket.on("latency_probe", (payload = {}) => {
  socket.emit("latency_pong", { sentAt: payload.sentAt });
});

socket.on("admin_state", (adminState) => {
  state.sessions = adminState.sessions || [];
  state.entryModes = adminState.entryModes || state.entryModes;
  state.battleEventTypes = adminState.battleEvents || state.battleEventTypes;
  syncEntryModeDrafts();
  render();
});

els.authBtn.addEventListener("click", auth);
els.createBtn.addEventListener("click", createSession);
els.exportJsonBtn.addEventListener("click", () => openExport("json"));
els.exportCsvBtn.addEventListener("click", () => openExport("csv"));
els.assetJsonBtn.addEventListener("click", () => openAsset("json"));
els.assetReportBtn.addEventListener("click", () => openAsset("report.html"));
els.assetVictoryBtn.addEventListener("click", () => openAsset("victory-card.svg"));
els.assetSocialBtn.addEventListener("click", () => openAsset("social.txt"));
els.copySummaryBtn.addEventListener("click", () => copyText(els.assetSummary.innerText, "摘要"));
els.copyScriptBtn.addEventListener("click", () => copyText(els.assetScript.innerText, "口播"));
els.copySocialBtn.addEventListener("click", () => copyText(els.assetSocialCopy.innerText, "社群文案"));
els.copyPlayerBtn.addEventListener("click", () => copySelectedUrl("player"));
els.copySpectatorBtn.addEventListener("click", () => copySelectedUrl("spectator"));
els.copyStudioBtn.addEventListener("click", () => copySelectedUrl("studio"));
els.copyStudioGuideBtn.addEventListener("click", () => copyText(buildStudioGuideText(selectedSession()), "開播步驟"));
els.entryModeApplyBtn?.addEventListener("click", applyEntryMode);
els.entryModeSelect?.addEventListener("change", () => {
  const session = selectedSession();
  if (session) state.entryModeDrafts[session.id] = els.entryModeSelect.value;
});
for (const field of [els.playerUrl, els.spectatorUrl, els.tiktokStudioUrl]) {
  field.addEventListener("focus", () => selectUrlField(field));
  field.addEventListener("click", () => selectUrlField(field));
}
els.hypeMomentBtn?.addEventListener("click", triggerHypeMoment);
els.openStudioPreviewBtn.addEventListener("click", () => {
  const url = getStudioUrl(selectedSession());
  if (!url) {
    show("請先建立或選擇場次");
    return;
  }
  window.open(url, "neon-mecha-arena-studio-preview", "width=430,height=930,noopener,noreferrer");
});
els.clearSelection.addEventListener("click", () => {
  state.selectedSessionId = "";
  localStorage.removeItem("tiktokPvpSessionId");
  render();
});
els.addBotBtn?.addEventListener("click", () => runBotCommand("add_bot_player", { mode: "auto" }));
els.botAutoBtn?.addEventListener("click", () => runBotCommand("set_bot_mode", { mode: "auto" }));
els.botManualBtn?.addEventListener("click", () => runBotCommand("set_bot_mode", { mode: "manual" }));
els.removeBotBtn?.addEventListener("click", () => runBotCommand("remove_bot_players"));

for (const button of document.querySelectorAll("[data-action]")) {
  button.addEventListener("click", () => {
    const session = selectedSession();
    if (!session) {
      show("請先選擇 session");
      return;
    }
    command(button.dataset.action, { sessionId: session.id });
  });
}

for (const button of document.querySelectorAll("[data-director-signal]")) {
  button.addEventListener("click", () => {
    const session = selectedSession();
    if (!session) {
      show("請先選擇 session");
      return;
    }
    command("director_signal", {
      sessionId: session.id,
      signalType: button.dataset.directorSignal,
      label: button.textContent.trim()
    });
  });
}

for (const button of document.querySelectorAll("[data-battle-event]")) {
  button.addEventListener("click", () => {
    const session = selectedSession();
    if (!session) {
      show("請先選擇 session");
      return;
    }
    command("battle_event", {
      sessionId: session.id,
      eventType: button.dataset.battleEvent,
      label: button.textContent.trim()
    });
  });
}

function triggerHypeMoment() {
  const session = selectedSession();
  if (!session) {
    show("請先選擇 session");
    return;
  }
  const sequence = [
    ["director_signal", { signalType: "hype_moment", label: "高潮時刻" }],
    ["battle_event", { eventType: "final_showdown", label: "高潮時刻：最終對決" }],
    ["battle_event", { eventType: "orbital_strike", label: "高潮時刻：軌道砲" }]
  ];
  runCommandSequence(session.id, sequence, () => show("高潮時刻已觸發"));
}

function runCommandSequence(sessionId, sequence, done, index = 0) {
  const item = sequence[index];
  if (!item) {
    done?.();
    render();
    return;
  }
  const [action, payload] = item;
  command(action, { sessionId, ...payload }, () => runCommandSequence(sessionId, sequence, done, index + 1));
}

function runBotCommand(action, payload = {}) {
  const session = selectedSession();
  if (!session) {
    show("請先選擇 session");
    return;
  }
  command(action, { sessionId: session.id, ...payload });
}

function auth() {
  state.token = els.tokenInput.value.trim();
  socket.emit("admin_auth", { token: state.token }, (result) => {
    if (!result?.ok) {
      state.authed = false;
      els.createBtn.disabled = true;
      show(result?.message || "登入失敗");
      return;
    }
    state.authed = true;
    localStorage.setItem("tiktokPvpAdminToken", state.token);
    els.createBtn.disabled = false;
    state.sessions = result.state?.sessions || [];
    state.entryModes = result.state?.entryModes || state.entryModes;
    state.battleEventTypes = result.state?.battleEvents || [];
    show("已登入");
    render();
  });
}

function createSession() {
  command("create_session", { label: els.labelInput.value.trim() || "NEON MECHA ARENA" }, (result) => {
    if (result?.ok && result.session?.id) {
      state.selectedSessionId = result.session.id;
      localStorage.setItem("tiktokPvpSessionId", state.selectedSessionId);
      show("Session 已建立，請複製 TikTok 直式來源到 LIVE Studio。");
      render();
    }
  });
}

function command(action, payload = {}, callback) {
  if (!state.authed) {
    show("請先登入");
    return;
  }
  socket.emit("admin_command", { action, token: state.token, ...payload }, (result) => {
    if (!result?.ok) {
      show(friendlyCommandError(result));
      return;
    }
    if (result.session?.id) {
      upsertSession(result.session);
    }
    if (result.state?.sessions) {
      state.sessions = result.state.sessions;
    }
    show("操作完成");
    callback?.(result);
    render();
  });
}

function friendlyCommandError(result) {
  const errors = {
    NEED_TWO_PLAYERS: "至少需要 2 位玩家在線，才能開始對戰。請先複製玩家連結，加入第 2 位玩家。",
    SESSION_NOT_FOUND: "找不到這個場次，請重新建立 Session。",
    ROOM_LOCKED: "房間已鎖定，請先解鎖或重置。",
    ROOM_NOT_WAITING: "請先按「重置」回到等待狀態，再加入 NPC。",
    ROOM_FULL: "房間已滿，請先踢人或移除 NPC。",
    BOT_NOT_FOUND: "目前沒有 NPC 可以操作。",
    INVALID_ENTRY_MODE: "找不到這個席位模式，請重新整理後再試。"
  };
  return errors[result?.code] || result?.message || result?.code || "操作失敗";
}

function render() {
  const selected = selectedSession();
  const urls = normalizedSessionUrls(selected);
  els.selectedId.textContent = selected?.id || "未選擇";
  setUrlField(els.playerUrl, urls.player);
  setUrlField(els.spectatorUrl, urls.spectator);
  setUrlField(els.tiktokStudioUrl, urls.studio);
  renderStudioGuide(selected);
  renderBotControls(selected);
  renderEntryModeControls(selected);

  if (urls.qr) {
    els.qrPreview.hidden = false;
    els.qrImage.src = urls.qr;
  } else {
    els.qrPreview.hidden = true;
    els.qrImage.removeAttribute("src");
  }

  els.roomStatus.textContent = selected ? `${selected.room.status} · round ${selected.room.round}` : "-";
  els.metrics.textContent = selected
    ? `${selected.metrics.activePlayers}/${selected.metrics.maxPlayers} 席 · queue ${selected.metrics.queuedPlayers} · spectator ${selected.metrics.spectators}`
    : "-";

  renderSessions();
  renderPlayers(selected);
  renderQueue(selected);
  renderPilots(selected);
  renderAnalytics(selected);
  renderAssets(selected);
  renderDirector(selected);
  renderBattleEvents(selected);
}

function getStudioUrl(session) {
  return normalizedSessionUrls(session).studio;
}

function normalizedSessionUrls(session) {
  const player = normalizeUrlToCurrentOrigin(session?.urls?.player || "");
  const spectator = normalizeUrlToCurrentOrigin(session?.urls?.spectator || "");
  const studio = session ? normalizeUrlToCurrentOrigin(session?.urls?.studio || `${window.location.origin}/studio`) : "";
  const qr = player ? `${window.location.origin}/qr.svg?text=${encodeURIComponent(player)}` : "";
  return { player, spectator, studio, qr };
}

function applyEntryMode() {
  const session = selectedSession();
  if (!session) {
    show("請先選擇 session");
    return;
  }
  const modeId = state.entryModeDrafts[session.id] || els.entryModeSelect?.value;
  if (!modeId) {
    show("請先選擇席位模式");
    return;
  }
  command("set_entry_mode", { sessionId: session.id, modeId }, () => {
    const mode = entryModes().find((item) => item.id === modeId);
    show(`席位模式已套用：${mode?.label || modeId}`);
  });
}

function renderEntryModeControls(selected) {
  const modes = entryModes();
  if (els.entryModeSelect) {
    const optionsHtml = modes
      .map((mode) => `<option value="${escapeHtml(mode.id)}">${escapeHtml(mode.label)} · ${mode.seatLimit} 席</option>`)
      .join("");
    if (els.entryModeSelect.dataset.optionsHtml !== optionsHtml) {
      els.entryModeSelect.innerHTML = optionsHtml;
      els.entryModeSelect.dataset.optionsHtml = optionsHtml;
    }
    const draftMode = selected?.id ? state.entryModeDrafts[selected.id] : "";
    const targetMode = draftMode || selected?.room?.entryMode || modes[0]?.id || "";
    if (document.activeElement !== els.entryModeSelect) {
      els.entryModeSelect.value = targetMode;
    }
    els.entryModeSelect.disabled = !selected || !state.authed;
  }
  if (els.entryModeApplyBtn) els.entryModeApplyBtn.disabled = !selected || !state.authed;

  const scarcity = selected?.room?.scarcity || selected?.metrics?.scarcity || null;
  const fillRate = Math.max(0, Math.min(100, scarcity?.fillRate ?? selected?.metrics?.seatFillRate ?? 0));
  if (els.scarcityMeter) els.scarcityMeter.style.width = `${fillRate}%`;
  if (!els.scarcityStatus) return;
  if (!selected) {
    els.scarcityStatus.textContent = "建立場次後可切換 2 / 4 / 6 / 8 席限量模式。";
    return;
  }

  const mode = modes.find((item) => item.id === selected.room.entryMode);
  const openSlots = scarcity?.openSlots ?? selected.metrics.openSlots;
  const queued = scarcity?.queuedPlayers ?? selected.metrics.queuedPlayers;
  els.scarcityStatus.innerHTML = `
    <strong>${escapeHtml(mode?.label || scarcity?.modeLabel || "席位模式")}</strong>
    <div>${escapeHtml(scarcity?.message || "限量席位開放中。")}</div>
    <div class="muted">上場 ${selected.metrics.activePlayers}/${selected.metrics.maxPlayers} · 剩 ${openSlots} 席 · 候補 ${queued} 人 · 滿席率 ${fillRate}%</div>
  `;
}

function syncEntryModeDrafts() {
  for (const session of state.sessions) {
    if (state.entryModeDrafts[session.id] && state.entryModeDrafts[session.id] === session.room.entryMode) {
      delete state.entryModeDrafts[session.id];
    }
  }
}

function entryModes() {
  return state.entryModes.length
    ? state.entryModes
    : [
        { id: "spotlight_duel", label: "試玩雙席", seatLimit: 2 },
        { id: "standard_squad", label: "標準限量場", seatLimit: 4 },
        { id: "elite_gate", label: "菁英候補場", seatLimit: 6 },
        { id: "full_arena", label: "滿房開戰場", seatLimit: 8 }
      ];
}

function normalizeUrlToCurrentOrigin(value) {
  if (!value) return "";
  try {
    const url = new URL(value, window.location.origin);
    const current = new URL(window.location.origin);
    if (shouldRebaseToCurrentOrigin(url, current)) {
      url.protocol = current.protocol;
      url.hostname = current.hostname;
      url.port = current.port;
    }
    return url.toString();
  } catch {
    return value;
  }
}

function shouldRebaseToCurrentOrigin(url, current) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const appPath =
    url.pathname.startsWith("/join/") ||
    url.pathname.startsWith("/watch/") ||
    url.pathname.startsWith("/qr.svg") ||
    url.pathname === "/studio";
  if (!appPath) return false;
  return url.port === current.port || isPrivateOrLocalHost(url.hostname) || isPrivateOrLocalHost(current.hostname);
}

function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return true;
  return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function setUrlField(field, value) {
  const text = value || "";
  field.value = text;
  field.title = text || "尚無連結";
  field.placeholder = text ? "" : "-";
}

function selectUrlField(field) {
  if (!field?.value) return;
  field.focus({ preventScroll: true });
  field.select();
  field.setSelectionRange(0, field.value.length);
}

function copySelectedUrl(type) {
  const selected = selectedSession();
  const urls = normalizedSessionUrls(selected);
  const map = {
    player: {
      label: "玩家連結",
      text: urls.player,
      target: els.playerUrl
    },
    spectator: {
      label: "觀戰連結",
      text: urls.spectator,
      target: els.spectatorUrl
    },
    studio: {
      label: "TikTok 直式來源",
      text: getStudioUrl(selected),
      target: els.tiktokStudioUrl
    }
  };
  const item = map[type];
  if (!item?.text) {
    show("請先建立或選擇場次");
    return;
  }
  copyText(item.text, item.label, item.target);
}

function renderStudioGuide(selected) {
  const studioUrl = getStudioUrl(selected);
  const roomText = selected ? `目前場次：${selected.id}` : "尚未選擇場次";
  const steps = [
    ["1. 建立場次", selected ? roomText : "登入後按建立 Session。"],
    ["2. 複製來源", studioUrl ? "按「複製直式來源」。" : "建立場次後會出現 TikTok 直式來源。"],
    ["3. 加入 Studio", "TikTok LIVE Studio 先試「連結」來源；若不接受本機網址，改用「視窗擷取」。"],
    ["4. 檢查畫面", "直播前確認只看到 NEON MECHA ARENA 戰場，不要看到 admin、Chrome 分頁或網址列。"]
  ];
  els.studioGuide.innerHTML = steps
    .map(
      ([title, body]) => `
        <div class="studio-step">
          <strong>${escapeHtml(title)}</strong>
          <span class="muted">${escapeHtml(body)}</span>
        </div>
      `
    )
    .join("");
  els.studioNotice.textContent = studioUrl
    ? `目前建議來源：${studioUrl}。若 TikTok LIVE Studio 的「連結」來源不接受本機網址，請按「開啟直式預覽」，再用視窗擷取只抓戰場區域。`
    : "建議 TikTok LIVE Studio 使用直式版面。建立場次後，這裡會顯示可複製的直式直播來源。";
}

function renderBotControls(selected) {
  if (!els.botStatus) return;
  const bots = (selected?.room?.players || []).filter((player) => player.isBot);
  const autoCount = bots.filter((player) => player.botMode === "auto").length;
  const manualCount = bots.filter((player) => player.botMode === "manual").length;
  const disabled = !selected || !state.authed;
  for (const button of [els.addBotBtn, els.botAutoBtn, els.botManualBtn, els.removeBotBtn]) {
    if (button) button.disabled = disabled;
  }
  if (!selected) {
    els.botStatus.textContent = "請先選擇場次。手機暫時連不上時，可加入 NPC 補第二位玩家測試。";
    return;
  }
  els.botStatus.textContent = bots.length
    ? `目前 NPC：${bots.length} 位，自動 ${autoCount} / 手動 ${manualCount}。手機可連線後，正式測試前請按「移除 NPC」。`
    : "目前沒有 NPC。手機暫時連不上時，可按「加入 NPC」補第二位玩家測完整對戰。";
}

function buildStudioGuideText(session) {
  const studioUrl = getStudioUrl(session);
  if (!studioUrl) {
    return "NEON MECHA ARENA 開播流程：先到後台建立 Session，再複製 TikTok 直式來源加入 TikTok LIVE Studio。";
  }
  return [
    "NEON MECHA ARENA TikTok LIVE Studio 開播流程",
    `1. 直式來源：${studioUrl}`,
    "2. TikTok LIVE Studio 選直式版面。",
    "3. 優先新增「連結」來源；若不接受本機網址，改用「視窗擷取」抓直式預覽視窗。",
    "4. 直播前確認畫面只看到戰場，不要顯示 admin、Chrome 分頁或網址列。",
    "5. 玩家用右下角 QR code 加入，主播在後台按開始。"
  ].join("\n");
}

function renderSessions() {
  els.sessionList.innerHTML = "";
  for (const session of state.sessions) {
    const item = document.createElement("button");
    item.className = `session-item ${session.id === selectedSession()?.id ? "active" : ""}`;
    item.innerHTML = `
      <div class="row" style="justify-content: space-between;">
        <strong>${escapeHtml(session.label)}</strong>
        <span class="muted mono">${escapeHtml(session.room.status)}</span>
      </div>
      <div class="muted mono">${escapeHtml(session.id)}</div>
      <div class="muted">${session.metrics.activePlayers}/${session.metrics.maxPlayers} 席 · queue ${session.metrics.queuedPlayers} · ${session.metrics.spectators} spectators</div>
    `;
    item.addEventListener("click", () => {
      state.selectedSessionId = session.id;
      localStorage.setItem("tiktokPvpSessionId", session.id);
      render();
    });
    els.sessionList.append(item);
  }
  if (!state.sessions.length) {
    els.sessionList.innerHTML = '<div class="notice">尚未建立 session</div>';
  }
}

function renderPlayers(selected) {
  els.playersBody.innerHTML = "";
  const players = selected?.room?.players || [];
  for (const player of players) {
    const shield = player.shieldHp ? ` / +${player.shieldHp}` : "";
    const title = player.titles?.[0] || "Rookie";
    const lives = `${player.lives ?? 1}/${player.maxLives ?? 2}`;
    const armour = player.broken ? " · ARMOUR BREAK" : "";
    const botLabel = player.isBot ? `NPC ${player.botMode === "auto" ? "自動" : "手動"}` : "";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(player.name)}${botLabel ? `<br><span class="muted">${escapeHtml(botLabel)}</span>` : ""}<br><span class="muted mono">${escapeHtml(player.id)}</span></td>
      <td class="${player.team === "red" ? "team-red" : "team-blue"}">${escapeHtml(player.team)}<br><span class="muted mono">${escapeHtml(player.pilotId || "")}</span></td>
      <td>${player.hp}${shield}${player.alive ? "" : " · down"}<br><span class="muted">${escapeHtml(title)} · lives ${escapeHtml(lives)}${armour}${player.returningPilot ? " · 回歸" : ""}</span></td>
      <td><button class="red" data-kick="${escapeHtml(player.id)}">踢人</button></td>
    `;
    row.querySelector("[data-kick]").addEventListener("click", () => {
      command("kick_player", { sessionId: selected.id, playerId: player.id });
    });
    els.playersBody.append(row);
  }
  if (!players.length) {
    els.playersBody.innerHTML = '<tr><td colspan="4" class="muted">尚無玩家</td></tr>';
  }
}

function renderQueue(selected) {
  if (!els.queueStatus) return;
  const queue = selected?.room?.queue || [];
  const scarcity = selected?.room?.scarcity;
  if (!selected) {
    els.queueStatus.textContent = "請先選擇 session";
    return;
  }
  if (!queue.length) {
    els.queueStatus.innerHTML = `<strong>候補隊列</strong><br><span class="muted">${escapeHtml(scarcity?.message || "目前沒有候補，觀眾可掃 QR code 搶位。")}</span>`;
    return;
  }
  els.queueStatus.innerHTML = `
    <strong>候補隊列 · ${queue.length} 人</strong><br>
    ${queue.slice(0, 8).map((player, index) => `<span>#${index + 1} ${escapeHtml(player.name)}</span>`).join("<br>")}
  `;
}

function renderPilots(selected) {
  const mvp = selected?.room?.roundSummary?.mvp;
  if (mvp) {
    els.mvpSummary.innerHTML = `<strong>本局 MVP：${escapeHtml(mvp.name)}</strong><br><span class="muted mono">${escapeHtml(mvp.pilotId)} · ${escapeHtml(mvp.team)} · score ${mvp.score}</span>`;
  } else {
    els.mvpSummary.textContent = selected ? "本局 MVP 尚未產生" : "請先選擇 session";
  }

  const leaderboard = selected?.pilots?.leaderboard || [];
  els.leaderboardBody.innerHTML = "";
  for (const pilot of leaderboard) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${pilot.rank}</td>
      <td>${escapeHtml(pilot.name)}<br><span class="muted mono">${escapeHtml(pilot.id)}</span></td>
      <td>${pilot.wins} / ${pilot.mvpCount}<br><span class="muted">hit ${pilot.hits}</span></td>
      <td>${escapeHtml(pilot.title)}<br><span class="muted">${escapeHtml(pilot.badges?.join(", ") || "-")}</span></td>
    `;
    els.leaderboardBody.append(row);
  }
  if (!leaderboard.length) {
    els.leaderboardBody.innerHTML = '<tr><td colspan="4" class="muted">尚無本場駕駛員排行</td></tr>';
  }
}

function renderAnalytics(selected) {
  const analytics = selected?.room?.analytics;
  if (!selected || !analytics) {
    els.analyticsCards.innerHTML = '<div class="notice">請先選擇 session</div>';
    els.funnelStats.textContent = "尚無漏斗資料";
    els.controlStats.textContent = "尚無操作資料";
    els.latencyBody.innerHTML = '<tr><td colspan="3" class="muted">尚無延遲資料</td></tr>';
    els.roundHistoryBody.innerHTML = '<tr><td colspan="3" class="muted">尚無回合紀錄</td></tr>';
    els.errorLogBody.innerHTML = '<tr><td colspan="4" class="muted">尚無錯誤</td></tr>';
    return;
  }

  const peak = analytics.activityPeak || {};
  const mvp = analytics.mvp;
  const cards = [
    ["席位 / 候補", `${selected.metrics.activePlayers}/${selected.metrics.maxPlayers}`, `剩 ${selected.metrics.openSlots} · 候補 ${selected.metrics.queuedPlayers}`],
    ["滿席熱度", `${selected.metrics.seatFillRate}%`, selected.room.scarcity?.message || "限量席位開放中"],
    ["觀戰來源", analytics.spectators.online ? "online" : "offline", analytics.spectators.lastSeenAt ? `最後 ${formatTime(analytics.spectators.lastSeenAt)}` : "尚無心跳"],
    ["紅藍比例", `${analytics.teams.players.red}:${analytics.teams.players.blue}`, `存活 ${analytics.teams.alive.red}:${analytics.teams.alive.blue}`],
    ["平均延遲", analytics.latency.averageMs == null ? "-" : `${analytics.latency.averageMs}ms`, `${analytics.latency.clients.length} clients`],
    ["加入率", analytics.funnel.joinConversionRate == null ? "-" : `${analytics.funnel.joinConversionRate}%`, `${analytics.funnel.successfulJoins}/${analytics.funnel.joinPageViews} 成功`],
    ["互動高峰", peak.total || 0, peak.startAt ? formatTime(peak.startAt) : "尚無高峰"],
    ["操作次數", controlTotal(analytics.controls), `重置 ${analytics.controls.resets} / 踢人 ${analytics.controls.kicks}`],
    ["活動 MVP", mvp ? mvp.name : "-", mvp ? `${mvp.count} 次` : "尚無資料"]
  ];
  els.analyticsCards.innerHTML = cards
    .map(
      ([label, value, detail]) => `
        <div class="data-card">
          <span class="muted">${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <span class="muted">${escapeHtml(detail)}</span>
        </div>
      `
    )
    .join("");

  els.funnelStats.innerHTML = `
    <strong>加入漏斗</strong><br>
    <span>進入頁：${analytics.funnel.joinPageViews}</span><br>
    <span>成功加入：${analytics.funnel.successfulJoins}</span><br>
    <span>排隊：${analytics.funnel.queuedJoins}</span><br>
    <span>候補補位：${analytics.funnel.promotedFromQueue}</span><br>
    <span>總入場率：${analytics.funnel.admissionRate == null ? "-" : `${analytics.funnel.admissionRate}%`}</span><br>
    <span>離線：${analytics.funnel.disconnects}</span>
  `;
  els.controlStats.innerHTML = `
    <strong>營運操作</strong><br>
    <span>重置：${analytics.controls.resets}，下一局：${analytics.controls.nextRounds}</span><br>
    <span>鎖房：${analytics.controls.locks}，解鎖：${analytics.controls.unlocks}，踢人：${analytics.controls.kicks}</span><br>
    <span>席位模式切換：${analytics.controls.entryModeChanges || 0}</span><br>
    <span>導演提示：${analytics.controls.manualDirectorSignals}，主播事件：${analytics.controls.manualBattleEvents}</span><br>
    <span>觀眾事件：${analytics.controls.audienceBattleEvents || 0}</span>
  `;

  els.latencyBody.innerHTML = "";
  for (const client of analytics.latency.clients || []) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(client.name || client.clientType)}<br><span class="muted mono">${escapeHtml(client.clientType)}</span></td>
      <td>${client.latencyMs}ms</td>
      <td>${formatTime(client.lastSeenAt)}</td>
    `;
    els.latencyBody.append(row);
  }
  if (!analytics.latency.clients?.length) {
    els.latencyBody.innerHTML = '<tr><td colspan="3" class="muted">尚無延遲資料</td></tr>';
  }

  els.roundHistoryBody.innerHTML = "";
  for (const round of (analytics.rounds || []).slice().reverse()) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>Round ${round.round}<br><span class="muted">${Math.round(round.durationMs / 1000)}s</span></td>
      <td class="${round.winnerTeam === "red" ? "team-red" : round.winnerTeam === "blue" ? "team-blue" : ""}">${escapeHtml(round.winnerTeam || "-")}</td>
      <td>${round.mvp ? escapeHtml(round.mvp.name) : "-"}<br><span class="muted">${round.totalHits} hits / ${round.totalDamage} dmg</span></td>
    `;
    els.roundHistoryBody.append(row);
  }
  if (!analytics.rounds?.length) {
    els.roundHistoryBody.innerHTML = '<tr><td colspan="3" class="muted">尚無回合紀錄</td></tr>';
  }

  els.errorLogBody.innerHTML = "";
  for (const error of (analytics.errors || []).slice().reverse()) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatTime(error.at)}</td>
      <td class="mono">${escapeHtml(error.code)}</td>
      <td>${escapeHtml(error.source)}</td>
      <td>${escapeHtml(error.message)}</td>
    `;
    els.errorLogBody.append(row);
  }
  if (!analytics.errors?.length) {
    els.errorLogBody.innerHTML = '<tr><td colspan="4" class="muted">尚無錯誤</td></tr>';
  }
}

function renderAssets(selected) {
  const analytics = selected?.room?.analytics;
  const latestRound = analytics?.rounds?.at(-1);
  const mvp = latestRound?.mvp || selected?.room?.roundSummary?.mvp || null;
  if (!selected) {
    els.assetSummary.textContent = "請先選擇 session。";
    els.assetScript.textContent = "請先選擇 session。";
    els.assetMvpList.textContent = "請先選擇 session。";
    els.assetSocialCopy.textContent = "請先選擇 session。";
    return;
  }

  const winner = latestRound?.winnerTeam || selected.room.winnerTeam;
  const winnerText = winner === "draw" ? "平手" : winner ? `${winner === "red" ? "紅隊" : "藍隊"}勝利` : "尚未分出勝負";
  const summary = latestRound
    ? `Round ${latestRound.round} ${winnerText}，${latestRound.players} 位玩家參戰，${latestRound.totalHits} 次命中、${latestRound.totalDamage} 點傷害。${mvp ? `MVP 是 ${mvp.name}，分數 ${mvp.score}。` : "本局尚無 MVP。"}`
    : "目前尚未完成任何回合，完成一局後會自動生成戰報摘要。";
  const queueText = selected.metrics.queuedPlayers > 0
    ? `目前排隊 ${selected.metrics.queuedPlayers} 位，下一局準備補位。`
    : "目前沒有排隊，觀眾可以掃 QR code 搶下一個席位。";
  const script = `下一局準備開始，${selected.room.scarcity?.scarcityLabel || `${selected.metrics.maxPlayers} 席限量`}，${queueText}還有 ${selected.metrics.openSlots} 個名額。紅藍機甲準備開戰。`;
  const mvpList = [
    mvp ? `本局 MVP：${mvp.name} · ${mvp.team || "-"} · ${mvp.score}` : "本局 MVP：尚未產生",
    analytics?.mvp ? `活動 MVP：${analytics.mvp.name} · ${analytics.mvp.count} 次` : "活動 MVP：尚未產生"
  ].join("\n");
  const social = [
    `[TikTok]\n${summary}\n下一局開放觀眾掃 QR code 參戰，誰能打下下一個 MVP？\n#TikTokLIVE #直播互動遊戲 #NEONMECHAARENA`,
    `[Instagram]\n今晚機甲戰場火力全開。本局亮點：${mvp?.name || "神秘駕駛員"} 的操作成為焦點。\n#TikTokLIVE #直播互動遊戲 #NEONMECHAARENA`,
    `[Facebook]\nNEON MECHA ARENA 直播互動戰報：${summary} 下一局歡迎觀眾加入對戰。`
  ].join("\n\n");

  els.assetSummary.textContent = summary;
  els.assetScript.textContent = script;
  els.assetMvpList.textContent = mvpList;
  els.assetSocialCopy.textContent = social;
}

function renderDirector(selected) {
  const director = selected?.room?.director;
  const active = director?.activeSignal;
  els.directorStatus.textContent = director ? `${director.phase} · ${director.signalHistory?.length || 0} signals` : "-";
  if (active) {
    els.directorSignal.innerHTML = `
      <strong>${escapeHtml(active.title)}</strong>
      <div>${escapeHtml(active.body)}</div>
      <div class="muted mono">${escapeHtml(active.type)} · ${escapeHtml(active.source)} · ${escapeHtml(active.tone)}</div>
    `;
  } else {
    els.directorSignal.textContent = selected ? "尚無導演提示" : "請先選擇 session";
  }

  const events = selected?.room?.timeline?.filter((event) => event.category === "director") || [];
  renderTimeline(els.directorTimeline, events, "尚無導演紀錄");
}

function renderBattleEvents(selected) {
  const battleEvents = selected?.room?.battleEvents;
  const active = battleEvents?.active || [];
  const scheduled = battleEvents?.schedule || [];
  els.battleEventStatus.textContent = selected ? `${active.length} active · ${scheduled.length} scheduled` : "-";

  if (active.length) {
    els.battleEventActive.innerHTML = active
      .slice()
      .sort((a, b) => b.priority - a.priority)
      .map((event) => {
        const seconds = Math.max(0, Math.ceil((event.expiresAt - Date.now()) / 1000));
        return `<strong>${escapeHtml(event.title)}</strong><div>${escapeHtml(event.body)}</div><div class="muted mono">${escapeHtml(event.type)} · ${seconds}s</div>`;
      })
      .join("<hr>");
  } else {
    els.battleEventActive.textContent = selected ? "尚無戰場事件，可由主播手動觸發或等待系統排程。" : "請先選擇 session";
  }

  const timeline = selected?.room?.timeline?.filter((event) => event.category === "events" || event.action.startsWith("battle_")) || [];
  renderTimeline(els.battleEventTimeline, timeline, "尚無戰場事件紀錄");
}

function renderTimeline(container, events, emptyText) {
  container.innerHTML = "";
  for (const event of events.slice(-8).reverse()) {
    const item = document.createElement("div");
    item.className = "timeline-item";
    const nestedDetails = event.details?.details || {};
    const detail = nestedDetails.label || event.details?.title || event.details?.signalId || event.details?.eventId || "";
    const actor = nestedDetails.requestedBy === "audience"
      ? `${nestedDetails.actorRole === "queued" ? "候補" : "觀眾"} · ${nestedDetails.actorName || ""}`
      : nestedDetails.requestedBy === "admin"
        ? "主播/Admin"
        : "";
    item.innerHTML = `
      <strong>${escapeHtml(event.action.replace("director_", "").replace("battle_", ""))}</strong>
      <div class="muted mono">${formatTime(event.at)} · round ${event.round} · tick ${event.tick}</div>
      <div class="muted">${escapeHtml(detail)}${actor ? ` · ${escapeHtml(actor)}` : ""}</div>
    `;
    container.append(item);
  }
  if (!events.length) {
    container.innerHTML = `<div class="notice">${emptyText}</div>`;
  }
}

function selectedSession() {
  return state.sessions.find((session) => session.id === state.selectedSessionId) || state.sessions[0] || null;
}

function openExport(format) {
  const session = selectedSession();
  if (!session) {
    show("請先選擇 session");
    return;
  }
  const url = `/admin/export/${encodeURIComponent(session.id)}.${format}?token=${encodeURIComponent(state.token)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function openAsset(path) {
  const session = selectedSession();
  if (!session) {
    show("請先選擇 session");
    return;
  }
  const encodedId = encodeURIComponent(session.id);
  const url =
    path === "json"
      ? `/admin/assets/${encodedId}.json?token=${encodeURIComponent(state.token)}`
      : `/admin/assets/${encodedId}/${path}?token=${encodeURIComponent(state.token)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

async function copyText(text, label = "內容", selectTarget = null) {
  const value = `${text || ""}`.trim();
  if (!value) {
    show("目前沒有可複製內容");
    return false;
  }

  let copied = false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      copied = false;
    }
  }

  if (!copied) {
    copied = fallbackCopyText(value);
  }

  if (copied) {
    show(`${label}已複製：${value}`);
    return true;
  }

  if (selectTarget) {
    selectUrlField(selectTarget);
  }
  show(`${label}自動複製被瀏覽器擋下，已選取欄位，請按 Ctrl+C：${value}`);
  return false;
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

function upsertSession(session) {
  const index = state.sessions.findIndex((item) => item.id === session.id);
  if (index >= 0) state.sessions[index] = session;
  else state.sessions.unshift(session);
}

function controlTotal(controls = {}) {
  return Object.values(controls).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function setStatus(text, ok) {
  const dot = els.socketStatus.querySelector(".dot");
  dot.className = ok ? "dot ok" : "dot bad";
  els.socketStatus.querySelector("span:last-child").textContent = text;
}

function show(message) {
  els.message.textContent = message;
}

function renderNetworkHint() {
  const isLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (isLocalhost) {
    els.networkHint.textContent =
      `目前控制台來源是 ${location.origin}。本機測試可以用；手機掃 QR 時不能用 localhost，請改用當下可連的電腦 IP 或雲端 HTTPS。`;
    return;
  }
  els.networkHint.textContent =
    `目前控制台來源是 ${location.origin}。建立 session 後，玩家連結、spectator 連結與 QR code 會跟著這個來源走；戶外公共 Wi-Fi 若擋同網段，請用雲端 HTTPS。`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("zh-TW", { hour12: false });
}
