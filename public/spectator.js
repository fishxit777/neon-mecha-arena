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
const qrImage = new Image();
const state = {
  game: null,
  session: null,
  audioSnapshot: null
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
  if (session?.urls?.qr) {
    qrImage.src = session.urls.qr;
  }
});

socket.on("game_state", (gameState) => {
  processAudioCues(state.audioSnapshot, gameState);
  state.audioSnapshot = createAudioSnapshot(gameState);
  state.game = gameState;
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

window.addEventListener("resize", render);

setInterval(render, 250);
updateAudioButtons();

function render() {
  requestAnimationFrame(() => {
    const portrait = frame.dataset.layout === "9-16";
    renderGame(canvas, state.game, {
      title: state.session?.label || "NEON MECHA ARENA",
      showQr: true,
      qrImage,
      playerUrl: state.session?.urls?.player,
      padding: portrait ? (studioMode ? 0 : 22) : 34,
      fit: portrait ? "cover" : "contain"
    });
  });
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
