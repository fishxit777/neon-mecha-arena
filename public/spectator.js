import { renderGame } from "./render.js";
import {
  bindAudioUnlock,
  getAudioSettings,
  resumeAudio,
  sfxArmourBreak,
  sfxExplosion,
  sfxHit,
  sfxShoot,
  sfxStorm,
  sfxVictory,
  startBGM,
  stopBGM,
  toggleBGM,
  toggleSFX
} from "./audio.js";

const sessionId = location.pathname.split("/").filter(Boolean).pop();
const params = new URLSearchParams(location.search);
const studioMode = params.get("studio") === "1";
const socket = io();
const frame = document.querySelector("#frame");
const spectatorShell = document.querySelector("#spectatorShell");
const canvas = document.querySelector("#gameCanvas");
const audienceStatus = document.querySelector("#audienceStatus");
const audienceButtons = Array.from(document.querySelectorAll("[data-audience-event]"));
const qrImage = new Image();
const state = {
  game: null,
  session: null,
  urls: {},
  audioSnapshot: null,
  intervention: {
    actorReadyAt: 0,
    message: ""
  }
};

bindAudioUnlock();

if (studioMode) {
  document.body.classList.add("studio-capture");
  spectatorShell?.setAttribute("data-mode", "studio");
  frame.dataset.layout = "9-16";
}

socket.on("connect", () => {
  socket.emit("join_session", {
    sessionId,
    clientType: "spectator"
  });
});

socket.on("latency_probe", (payload = {}) => {
  socket.emit("latency_pong", { sentAt: payload.sentAt });
});

socket.on("lobby_state", (session) => {
  state.session = session;
  state.urls = normalizedSessionUrls(session);
  if (state.urls.qr) {
    qrImage.src = state.urls.qr;
  }
});

socket.on("game_state", (gameState) => {
  processAudioCues(state.audioSnapshot, gameState);
  state.audioSnapshot = createAudioSnapshot(gameState);
  state.game = gameState;
  renderAudienceInterventions();
  render();
});

document.querySelector("#audioEnable")?.addEventListener("click", async () => {
  await resumeAudio();
  if (state.game?.room?.status === "playing") startBGM();
  updateAudioButtons();
});

document.querySelector("#toggleBgm")?.addEventListener("click", () => {
  toggleBGM();
  updateAudioButtons();
});

document.querySelector("#toggleSfx")?.addEventListener("click", () => {
  toggleSFX();
  updateAudioButtons();
});

document.querySelector("#layout169").addEventListener("click", () => {
  frame.dataset.layout = "16-9";
  render();
});

document.querySelector("#layout916").addEventListener("click", () => {
  frame.dataset.layout = "9-16";
  render();
});

document.querySelector("#fullscreen").addEventListener("click", () => {
  document.documentElement.requestFullscreen?.();
});

for (const button of audienceButtons) {
  button.addEventListener("click", () => triggerAudienceIntervention(button.dataset.audienceEvent));
}

window.addEventListener("resize", render);

setInterval(() => {
  renderAudienceInterventions();
  render();
}, 250);
updateAudioButtons();

function render() {
  requestAnimationFrame(() => {
    const portrait = frame.dataset.layout === "9-16";
    renderGame(canvas, state.game, {
      title: state.session?.label || "NEON MECHA ARENA",
      showQr: true,
      qrImage,
      playerUrl: state.urls.player,
      padding: portrait ? (studioMode ? 0 : 22) : 34,
      fit: portrait ? "cover" : "contain"
    });
  });
}

function triggerAudienceIntervention(eventType) {
  if (!eventType || studioMode) return;
  socket.emit("audience_intervention", { sessionId, eventType }, (result) => {
    if (result?.session) {
      state.session = result.session;
    }
    if (result?.ok) {
      state.intervention.actorReadyAt = result.actorReadyAt || Date.now() + (result.intervention?.actorCooldownMs || 20_000);
      state.intervention.message = `${result.event?.title || "場外事件"} 已送出`;
    } else {
      if (result?.actorReadyAt) state.intervention.actorReadyAt = result.actorReadyAt;
      state.intervention.message = result?.message || "場外干預暫時無法送出";
    }
    renderAudienceInterventions();
  });
}

function renderAudienceInterventions() {
  if (!audienceStatus) return;
  const room = state.game?.room || state.session?.room;
  const interventions = room?.audienceInterventions;
  const now = Date.now();
  const actorRemaining = Math.max(0, (state.intervention.actorReadyAt || 0) - now);
  const remaining = interventions?.remaining ?? 0;
  const isPlaying = room?.status === "playing";

  for (const button of audienceButtons) {
    const option = interventions?.options?.find((item) => item.eventType === button.dataset.audienceEvent);
    const typeRemaining = Math.max(0, (option?.readyAt || 0) - now);
    button.disabled = !isPlaying || remaining <= 0 || actorRemaining > 0 || typeRemaining > 0;
    button.textContent = option?.label || button.textContent;
    if (typeRemaining > 0) button.textContent = `${option?.label || "事件"} ${Math.ceil(typeRemaining / 1000)}s`;
  }

  if (!isPlaying) {
    audienceStatus.textContent = "對戰開始後，觀眾可免費觸發有限次中性事件。";
    return;
  }
  if (remaining <= 0) {
    audienceStatus.textContent = "本局觀眾事件權已用完，下一局重置。";
    return;
  }
  if (actorRemaining > 0) {
    audienceStatus.textContent = `個人冷卻 ${Math.ceil(actorRemaining / 1000)}s · 本局剩 ${remaining}/${interventions.roundLimit}`;
    return;
  }
  audienceStatus.textContent = `${state.intervention.message || "可觸發場外事件"} · 本局剩 ${remaining}/${interventions?.roundLimit || 0}`;
}

function normalizedSessionUrls(session) {
  const player = normalizeUrlToCurrentOrigin(session?.urls?.player || "");
  const qr = player ? `${window.location.origin}/qr.svg?text=${encodeURIComponent(player)}` : normalizeUrlToCurrentOrigin(session?.urls?.qr || "");
  return { player, qr };
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
  const appPath = url.pathname.startsWith("/join/") || url.pathname.startsWith("/watch/") || url.pathname.startsWith("/qr.svg") || url.pathname === "/studio";
  if (!appPath) return false;
  return url.port === current.port || isPrivateOrLocalHost(url.hostname) || isPrivateOrLocalHost(current.hostname);
}

function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return true;
  return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function processAudioCues(previous, gameState) {
  const room = gameState?.room;
  if (!room) return;

  if (previous?.status !== "playing" && room.status === "playing") {
    resumeAudio().then((ok) => {
      if (ok) setTimeout(startBGM, 800);
      updateAudioButtons();
    });
  }

  if (previous?.status === "playing" && room.status === "finished") {
    sfxVictory(room.winnerTeam);
  }

  if (previous?.status !== "finished" && room.status === "finished") {
    stopBGM();
  }

  const previousPlayers = previous?.players || new Map();
  for (const player of room.players || []) {
    const before = previousPlayers.get(player.id);
    if (!before) continue;
    if (before.alive && !player.alive) {
      sfxExplosion();
      continue;
    }
    if (before.lives > player.lives && player.alive) {
      sfxArmourBreak();
      continue;
    }
    if (player.hp < before.hp || player.shieldHp < before.shieldHp) {
      sfxHit();
    }
  }

  const previousProjectiles = previous?.projectiles || new Set();
  for (const projectile of room.projectiles || []) {
    if (!previousProjectiles.has(projectile.id)) sfxShoot(projectile.team);
  }

  const previousEvents = previous?.activeEvents || new Set();
  for (const event of room.battleEvents?.active || []) {
    if (!previousEvents.has(event.id) && ["energy_storm", "orbital_strike"].includes(event.type)) sfxStorm();
  }
}

function createAudioSnapshot(gameState) {
  const room = gameState?.room;
  if (!room) {
    return {
      status: null,
      players: new Map(),
      projectiles: new Set(),
      activeEvents: new Set()
    };
  }
  return {
    status: room.status,
    players: new Map((room.players || []).map((player) => [
      player.id,
      {
        hp: player.hp,
        shieldHp: player.shieldHp || 0,
        lives: player.lives ?? 1,
        broken: player.broken === true,
        alive: player.alive === true
      }
    ])),
    projectiles: new Set((room.projectiles || []).map((projectile) => projectile.id)),
    activeEvents: new Set((room.battleEvents?.active || []).map((event) => event.id))
  };
}

function updateAudioButtons() {
  const settings = getAudioSettings();
  const audioBtn = document.querySelector("#audioEnable");
  const bgmBtn = document.querySelector("#toggleBgm");
  const sfxBtn = document.querySelector("#toggleSfx");
  if (audioBtn) audioBtn.textContent = settings.running ? "Audio On" : "Audio";
  if (bgmBtn) {
    bgmBtn.textContent = settings.bgmEnabled ? "BGM On" : "BGM Off";
    bgmBtn.classList.toggle("active", settings.bgmEnabled);
  }
  if (sfxBtn) {
    sfxBtn.textContent = settings.sfxEnabled ? "SFX On" : "SFX Off";
    sfxBtn.classList.toggle("active", settings.sfxEnabled);
  }
}
