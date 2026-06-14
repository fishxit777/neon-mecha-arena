import { renderGame } from "./render.js";
import {
  bindAudioUnlock,
  resumeAudio,
  sfxArmourBreak,
  sfxExplosion,
  sfxHit,
  sfxShoot,
  sfxVictory,
  startBGM,
  stopBGM
} from "./audio.js";

const sessionId = location.pathname.split("/").filter(Boolean).pop();
const socket = io();
const pilotId = getOrCreatePilotId();
const INPUT_SEND_INTERVAL_MS = 70;
const JOYSTICK_DEAD_ZONE = 0.22;
const CONTROL_LAYOUT_KEY = "tiktokPvpControlLayout";
const CONTROL_POSITION_KEY = "tiktokPvpControlPositionsV3";
const CONTROL_SIZE_KEY = "tiktokPvpControlSize";
const CONTROL_PARTS = ["move", "fire"];
const CONTROL_SIZE_SCALE = {
  compact: 0.88,
  standard: 1,
  large: 1.12
};
const state = {
  joined: false,
  playerId: null,
  pilotId,
  role: null,
  controlLayout: getSavedControlLayout(),
  controlSize: getSavedControlSize(),
  controlPositions: getSavedControlPositions(),
  customizingControls: false,
  controllerSettingsOpen: false,
  controlDrag: null,
  joystickActive: false,
  lastInputSentAt: 0,
  inputTimer: null,
  audioSnapshot: null,
  game: null,
  input: {
    up: false,
    down: false,
    left: false,
    right: false,
    attack: false,
    moveX: 0,
    moveY: 0,
    aimX: 1,
    aimY: 0
  }
};

const els = {
  socketStatus: document.querySelector("#socketStatus"),
  joinPanel: document.querySelector("#joinPanel"),
  gamePanel: document.querySelector("#gamePanel"),
  nameInput: document.querySelector("#nameInput"),
  joinBtn: document.querySelector("#joinBtn"),
  joinNotice: document.querySelector("#joinNotice"),
  sessionLabel: document.querySelector("#sessionLabel"),
  playerTitle: document.querySelector("#playerTitle"),
  rolePill: document.querySelector("#rolePill span:last-child"),
  teamStat: document.querySelector("#teamStat"),
  hpStat: document.querySelector("#hpStat"),
  stateStat: document.querySelector("#stateStat"),
  titleStat: document.querySelector("#titleStat"),
  teamBadge: document.querySelector("#teamBadge"),
  energyValue: document.querySelector("#energyValue"),
  energyBars: document.querySelector("#energyBars"),
  pilotHpMini: document.querySelector("#pilotHpMini"),
  pilotTitleMini: document.querySelector("#pilotTitleMini"),
  settingsToggle: document.querySelector("#settingsToggle"),
  quickLayoutToggle: document.querySelector("#quickLayoutToggle"),
  controlDeck: document.querySelector("#controlDeck"),
  layoutButtons: document.querySelectorAll("[data-layout]"),
  sizeButtons: document.querySelectorAll("[data-control-size]"),
  customizeControlsBtn: document.querySelector("#customizeControlsBtn"),
  resetControlsBtn: document.querySelector("#resetControlsBtn"),
  joystick: document.querySelector("#moveJoystick"),
  joystickThumb: document.querySelector("#joystickThumb"),
  canvas: document.querySelector("#gameCanvas")
};

document.title = "NEON MECHA ARENA";
document.querySelector(".brand h1").textContent = "NEON MECHA ARENA";

applyControlLayout(state.controlLayout);
applyControlSize(state.controlSize);
applyControlPositions();
bindAudioUnlock();

socket.on("connect", () => {
  setStatus("online", true);
  socket.emit("join_page_view", { sessionId });
});
socket.on("disconnect", () => setStatus("離線", false));

socket.on("latency_probe", (payload = {}) => {
  socket.emit("latency_pong", { sentAt: payload.sentAt });
});

socket.on("lobby_state", (session) => {
  els.sessionLabel.textContent = session?.label || sessionId;
});

socket.on("game_state", (gameState) => {
  processAudioCues(state.audioSnapshot, gameState);
  state.audioSnapshot = createAudioSnapshot(gameState);
  state.game = gameState;
  updateStats();
  render();
});

els.joinBtn.addEventListener("click", join);
els.nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") join();
});

for (const button of document.querySelectorAll("[data-key]")) {
  const key = button.dataset.key;
  const on = (event) => {
    if (state.customizingControls) return;
    event.preventDefault();
    capturePointer(button, event.pointerId);
    const changed = state.input[key] !== true;
    state.input[key] = true;
    button.classList.add("active");
    vibrate(key === "attack" ? 18 : 8);
    if (key === "attack") {
      resumeAudio();
      sfxShoot(getCurrentTeam());
    } else {
      updateKeyboardVector();
    }
    if (changed) sendInput();
  };
  const off = (event) => {
    if (state.customizingControls) return;
    event.preventDefault();
    releasePointer(button, event.pointerId);
    const changed = state.input[key] !== false;
    state.input[key] = false;
    button.classList.remove("active");
    if (key !== "attack") updateKeyboardVector();
    if (changed) sendInput();
  };
  button.addEventListener("pointerdown", on);
  button.addEventListener("pointerup", off);
  button.addEventListener("pointercancel", off);
  button.addEventListener("pointerleave", off);
}

if (els.joystick) {
  els.joystick.addEventListener("pointerdown", startJoystick);
  els.joystick.addEventListener("pointermove", moveJoystick);
  els.joystick.addEventListener("pointerup", stopJoystick);
  els.joystick.addEventListener("pointercancel", stopJoystick);
  els.joystick.addEventListener("lostpointercapture", stopJoystick);
}

for (const button of els.layoutButtons) {
  button.addEventListener("click", () => applyControlLayout(button.dataset.layout));
}

for (const button of els.sizeButtons) {
  button.addEventListener("click", () => applyControlSize(button.dataset.controlSize));
}

els.customizeControlsBtn?.addEventListener("click", () => {
  setControlCustomization(!state.customizingControls);
});

els.resetControlsBtn?.addEventListener("click", resetControlTuning);

els.settingsToggle?.addEventListener("click", () => {
  setControllerSettingsOpen(!state.controllerSettingsOpen);
});

els.quickLayoutToggle?.addEventListener("click", () => {
  applyControlLayout(state.controlLayout === "left" ? "right" : "left");
});
window.addEventListener("resize", updateQuickLayoutToggle);

els.controlDeck?.addEventListener("pointerdown", startControlDrag, true);
els.controlDeck?.addEventListener("mousedown", startControlDrag, true);
els.controlDeck?.addEventListener("touchstart", startControlDrag, { capture: true, passive: false });
window.addEventListener("pointermove", moveControlDrag);
window.addEventListener("mousemove", moveControlDrag);
window.addEventListener("touchmove", moveControlDrag, { passive: false });
window.addEventListener("pointerup", stopControlDrag);
window.addEventListener("pointercancel", stopControlDrag);
window.addEventListener("mouseup", stopControlDrag);
window.addEventListener("touchend", stopControlDrag);
window.addEventListener("touchcancel", stopControlDrag);
window.addEventListener("resize", scheduleControlBoundsCheck);

window.addEventListener("keydown", (event) => {
  if (state.customizingControls) return;
  const key = mapKey(event.key);
  if (!key) return;
  event.preventDefault();
  if (state.input[key] === true) return;
  state.input[key] = true;
  markButton(key, true);
  if (key === "attack") {
    resumeAudio();
    sfxShoot(getCurrentTeam());
  } else {
    updateKeyboardVector();
  }
  sendInput();
});

window.addEventListener("keyup", (event) => {
  if (state.customizingControls) return;
  const key = mapKey(event.key);
  if (!key) return;
  event.preventDefault();
  if (state.input[key] === false) return;
  state.input[key] = false;
  markButton(key, false);
  if (key !== "attack") updateKeyboardVector();
  sendInput();
});

setInterval(() => {
  if (state.joined) sendInput();
}, 110);

function join() {
  resumeAudio();
  const name = els.nameInput.value.trim() || `玩家${Math.floor(Math.random() * 999)}`;
  els.joinNotice.hidden = true;
  els.joinNotice.textContent = "";
  socket.emit(
    "join_session",
    {
      sessionId,
      clientType: "player",
      name,
      pilotId: state.pilotId
    },
    (result) => {
      if (!result?.ok) {
        els.joinNotice.textContent = result?.message || "加入失敗";
        els.joinNotice.hidden = false;
        return;
      }
      state.joined = true;
      state.playerId = result.playerId;
      state.pilotId = result.session?.room?.players?.find((player) => player.id === result.playerId)?.pilotId || state.pilotId;
      localStorage.setItem("tiktokPvpPilotId", state.pilotId);
      state.role = result.role;
      els.joinPanel.hidden = true;
      els.joinNotice.hidden = true;
      els.gamePanel.hidden = false;
      document.body.classList.add("is-player-active");
      setControllerSettingsOpen(false);
      scheduleControlBoundsCheck();
      els.playerTitle.textContent = name;
      els.rolePill.textContent = result.role;
      els.sessionLabel.textContent = result.session?.label || sessionId;
      if (result.session?.room?.status === "playing") startBGM();
    }
  );
}

function sendInput() {
  if (!state.joined || state.role !== "player") return;
  const now = performance.now();
  const remaining = INPUT_SEND_INTERVAL_MS - (now - state.lastInputSentAt);
  if (remaining > 0) {
    if (!state.inputTimer) {
      state.inputTimer = setTimeout(() => {
        state.inputTimer = null;
        sendInput();
      }, remaining);
    }
    return;
  }
  state.lastInputSentAt = now;
  socket.emit("player_input", state.input);
}

function updateStats() {
  const room = state.game?.room;
  const player = room?.players?.find((item) => item.id === state.playerId);
  if (!player) {
    els.teamStat.textContent = state.role === "queued" ? "排隊" : "-";
    els.hpStat.textContent = "-";
    els.stateStat.textContent = room?.status || "-";
    els.titleStat.textContent = "-";
    syncCockpitStrip(null, room);
    return;
  }
  els.teamStat.textContent = player.team === "red" ? "紅隊" : "藍隊";
  els.teamStat.className = player.team === "red" ? "team-red" : "team-blue";
  els.hpStat.textContent = `${player.hp} / ${player.lives ?? 1}`;
  els.stateStat.textContent = player.returningPilot ? `${player.alive ? room.status : "倒下"} · 回歸` : player.alive ? room.status : "倒下";
  els.titleStat.textContent = player.titles?.[0] || "Rookie";
  syncCockpitStrip(player, room);
}

function render() {
  requestAnimationFrame(() => {
    renderGame(els.canvas, state.game, { title: "NEON MECHA ARENA", padding: 0, fit: "cover", focusPlayerId: state.playerId });
  });
}

function syncCockpitStrip(player, room) {
  const team = player?.team || "blue";
  const teamText = team === "red" ? "RED" : "BLUE";
  const hp = Math.max(0, Math.round(player?.hp ?? 100));
  const title = player?.titles?.[0] || "ROOKIE";

  if (els.teamBadge) {
    els.teamBadge.textContent = teamText;
    els.teamBadge.classList.toggle("is-red", team === "red");
  }
  if (els.energyValue) {
    els.energyValue.textContent = player?.alive === false ? "0" : String(hp);
  }
  if (els.pilotHpMini) {
    els.pilotHpMini.textContent = player?.alive === false ? "0" : String(hp);
  }
  if (els.pilotTitleMini) {
    els.pilotTitleMini.textContent = title.toUpperCase();
  }

  const bars = Array.from(els.energyBars?.querySelectorAll("span") || []);
  const filled = player?.alive === false ? 0 : Math.max(0, Math.min(10, Math.ceil(hp / 10)));
  bars.forEach((bar, index) => {
    bar.classList.toggle("is-filled", index < filled);
  });

  document.body.classList.toggle("is-round-finished", room?.status === "finished");
}

function processAudioCues(previous, gameState) {
  const room = gameState?.room;
  const player = room?.players?.find((item) => item.id === state.playerId);
  if (!room || !player) return;

  if (previous?.status !== "playing" && room.status === "playing") {
    resumeAudio().then((ok) => {
      if (ok) setTimeout(startBGM, 800);
    });
  }
  if (previous?.status === "playing" && room.status === "finished") {
    sfxVictory(room.winnerTeam);
  }
  if (previous?.status !== "finished" && room.status === "finished") {
    stopBGM();
  }

  const before = previous?.player;
  if (!before) return;
  if (before.alive && !player.alive) {
    sfxExplosion();
  } else if (before.lives > (player.lives ?? 1) && player.alive) {
    sfxArmourBreak();
  } else if (player.hp < before.hp || (player.shieldHp || 0) < before.shieldHp) {
    sfxHit();
  }
}

function createAudioSnapshot(gameState) {
  const room = gameState?.room;
  const player = room?.players?.find((item) => item.id === state.playerId);
  return {
    status: room?.status || null,
    player: player
      ? {
          hp: player.hp,
          shieldHp: player.shieldHp || 0,
          lives: player.lives ?? 1,
          alive: player.alive === true
        }
      : null
  };
}

function getCurrentTeam() {
  const room = state.game?.room;
  const player = room?.players?.find((item) => item.id === state.playerId);
  return player?.team || "blue";
}

function setStatus(text, ok) {
  const dot = els.socketStatus.querySelector(".dot");
  dot.className = ok ? "dot ok" : "dot bad";
  els.socketStatus.querySelector("span:last-child").textContent = text;
}

function mapKey(key) {
  const normalized = key.toLowerCase();
  if (normalized === "arrowup" || normalized === "w") return "up";
  if (normalized === "arrowdown" || normalized === "s") return "down";
  if (normalized === "arrowleft" || normalized === "a") return "left";
  if (normalized === "arrowright" || normalized === "d") return "right";
  if (normalized === " " || normalized === "enter") return "attack";
  return null;
}

function markButton(key, active) {
  const button = document.querySelector(`[data-key="${key}"]`);
  if (button) button.classList.toggle("active", active);
  syncJoystickFromInput();
}

function vibrate(duration) {
  if (!navigator.vibrate) return;
  navigator.vibrate(duration);
}

function capturePointer(button, pointerId) {
  try {
    button.setPointerCapture?.(pointerId);
  } catch {
    // Some mobile browsers reject capture after a canceled pointer event.
  }
}

function releasePointer(button, pointerId) {
  try {
    button.releasePointerCapture?.(pointerId);
  } catch {
    // Pointer may already be released by the browser.
  }
}

function startJoystick(event) {
  if (state.customizingControls) return;
  event.preventDefault();
  state.joystickActive = true;
  els.joystick.classList.add("active");
  capturePointer(els.joystick, event.pointerId);
  vibrate(8);
  updateJoystickFromPointer(event);
}

function moveJoystick(event) {
  if (!state.joystickActive) return;
  event.preventDefault();
  updateJoystickFromPointer(event);
}

function stopJoystick(event) {
  if (!state.joystickActive) return;
  event.preventDefault();
  state.joystickActive = false;
  els.joystick.classList.remove("active");
  releasePointer(els.joystick, event.pointerId);
  setMoveVector(0, 0);
  setJoystickThumb(0, 0);
  sendInput();
}

function updateJoystickFromPointer(event) {
  const rect = els.joystick.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const maxTravel = Math.min(rect.width, rect.height) * 0.27;
  const rawX = event.clientX - centerX;
  const rawY = event.clientY - centerY;
  const distance = Math.hypot(rawX, rawY);
  const ratio = distance > maxTravel ? maxTravel / distance : 1;
  const stickX = rawX * ratio;
  const stickY = rawY * ratio;
  setJoystickThumb(stickX, stickY);
  setMoveVector(stickX / maxTravel, stickY / maxTravel);
}

function normalizeInputVector(x, y) {
  const length = Math.hypot(x, y);
  if (length < 0.001) return { x: 0, y: 0, length: 0 };
  return {
    x: x / length,
    y: y / length,
    length: Math.min(1, length)
  };
}

function updateKeyboardVector() {
  if (state.joystickActive) return;
  const rawX = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
  const rawY = (state.input.down ? 1 : 0) - (state.input.up ? 1 : 0);
  const vector = normalizeInputVector(rawX, rawY);
  state.input.moveX = vector.x * vector.length;
  state.input.moveY = vector.y * vector.length;
  if (vector.length > 0) {
    state.input.aimX = vector.x;
    state.input.aimY = vector.y;
  }
}

function setMoveVector(x, y) {
  const vector = normalizeInputVector(x, y);
  const active = vector.length > JOYSTICK_DEAD_ZONE;
  const moveX = active ? vector.x * vector.length : 0;
  const moveY = active ? vector.y * vector.length : 0;
  const next = {
    up: moveY < -JOYSTICK_DEAD_ZONE,
    down: moveY > JOYSTICK_DEAD_ZONE,
    left: moveX < -JOYSTICK_DEAD_ZONE,
    right: moveX > JOYSTICK_DEAD_ZONE
  };
  const changed =
    ["up", "down", "left", "right"].some((key) => state.input[key] !== next[key]) ||
    Math.abs(state.input.moveX - moveX) > 0.01 ||
    Math.abs(state.input.moveY - moveY) > 0.01 ||
    (active && (Math.abs(state.input.aimX - vector.x) > 0.01 || Math.abs(state.input.aimY - vector.y) > 0.01));
  state.input.up = next.up;
  state.input.down = next.down;
  state.input.left = next.left;
  state.input.right = next.right;
  state.input.moveX = moveX;
  state.input.moveY = moveY;
  if (active) {
    state.input.aimX = vector.x;
    state.input.aimY = vector.y;
  }
  updateJoystickClasses();
  if (changed) sendInput();
}

function syncJoystickFromInput() {
  if (state.joystickActive || !els.joystick) return;
  const rect = els.joystick.getBoundingClientRect();
  const travel = Math.min(rect.width || 180, rect.height || 180) * 0.18;
  let x = 0;
  let y = 0;
  if (state.input.left) x -= travel;
  if (state.input.right) x += travel;
  if (state.input.up) y -= travel;
  if (state.input.down) y += travel;
  if (x && y) {
    x *= 0.72;
    y *= 0.72;
  }
  setJoystickThumb(x, y);
  updateJoystickClasses();
}

function updateJoystickClasses() {
  if (!els.joystick) return;
  els.joystick.classList.toggle("move-up", state.input.up);
  els.joystick.classList.toggle("move-down", state.input.down);
  els.joystick.classList.toggle("move-left", state.input.left);
  els.joystick.classList.toggle("move-right", state.input.right);
}

function setJoystickThumb(x, y) {
  if (!els.joystickThumb) return;
  els.joystickThumb.style.setProperty("--stick-x", `${Math.round(x)}px`);
  els.joystickThumb.style.setProperty("--stick-y", `${Math.round(y)}px`);
}

function applyControlLayout(layout) {
  const normalized = layout === "left" ? "left" : "right";
  state.controlLayout = normalized;
  localStorage.setItem(CONTROL_LAYOUT_KEY, normalized);
  els.controlDeck?.classList.toggle("is-lefty", normalized === "left");
  updateQuickLayoutToggle();
  for (const button of els.layoutButtons) {
    const active = button.dataset.layout === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  if (!state.joystickActive) syncJoystickFromInput();
  scheduleControlBoundsCheck();
}

function updateQuickLayoutToggle() {
  if (!els.quickLayoutToggle) return;
  const target = state.controlLayout === "left" ? "right" : "left";
  const compact = window.matchMedia("(max-width: 380px)").matches;
  els.quickLayoutToggle.textContent = target === "right" ? (compact ? "右手" : "→ 切換右手") : (compact ? "左手" : "← 切換左手");
  els.quickLayoutToggle.setAttribute("aria-label", target === "right" ? "切換右手模式" : "切換左手模式");
}

function getSavedControlLayout() {
  return localStorage.getItem(CONTROL_LAYOUT_KEY) === "left" ? "left" : "right";
}

function applyControlSize(size) {
  const normalized = Object.hasOwn(CONTROL_SIZE_SCALE, size) ? size : "standard";
  state.controlSize = normalized;
  localStorage.setItem(CONTROL_SIZE_KEY, normalized);
  els.controlDeck?.style.setProperty("--control-scale", String(CONTROL_SIZE_SCALE[normalized]));
  for (const button of els.sizeButtons) {
    const active = button.dataset.controlSize === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  scheduleControlBoundsCheck();
}

function getSavedControlSize() {
  const saved = localStorage.getItem(CONTROL_SIZE_KEY);
  return Object.hasOwn(CONTROL_SIZE_SCALE, saved) ? saved : "standard";
}

function setControllerSettingsOpen(open) {
  state.controllerSettingsOpen = open;
  document.body.classList.toggle("is-controller-settings-open", open);
  if (els.settingsToggle) {
    els.settingsToggle.classList.toggle("active", open);
    els.settingsToggle.setAttribute("aria-expanded", String(open));
  }
  if (!open && state.customizingControls) {
    setControlCustomization(false);
  }
}

function setControlCustomization(enabled) {
  state.customizingControls = enabled;
  if (enabled) state.controllerSettingsOpen = true;
  document.body.classList.toggle("is-controller-settings-open", state.controllerSettingsOpen);
  if (els.settingsToggle) {
    els.settingsToggle.classList.toggle("active", state.controllerSettingsOpen);
    els.settingsToggle.setAttribute("aria-expanded", String(state.controllerSettingsOpen));
  }
  els.controlDeck?.classList.toggle("is-customizing", enabled);
  document.body.classList.toggle("is-control-customizing", enabled);
  if (els.customizeControlsBtn) {
    els.customizeControlsBtn.classList.toggle("active", enabled);
    els.customizeControlsBtn.setAttribute("aria-pressed", String(enabled));
    els.customizeControlsBtn.textContent = enabled ? "完成" : "位置";
  }
  if (!enabled) {
    stopControlDrag();
    saveControlPositions();
  }
  scheduleControlBoundsCheck();
}

function startControlDrag(event) {
  if (!state.customizingControls) return;
  if (state.controlDrag) return;
  if (event.type === "mousedown" && event.button !== 0) return;
  const point = getControlEventPoint(event);
  if (!point) return;
  const target = event.target instanceof Element ? event.target : null;
  const unit = target?.closest("[data-control-part]");
  if (!unit || !els.controlDeck?.contains(unit)) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  const part = unit.dataset.controlPart;
  const position = getControlPosition(part);
  state.controlDrag = {
    part,
    pointerId: point.id,
    source: getControlEventSource(event),
    startClientX: point.clientX,
    startClientY: point.clientY,
    startX: position.x,
    startY: position.y,
    deckRect: getControlBoundsRect(),
    unitRect: unit.getBoundingClientRect()
  };
  unit.classList.add("is-dragging");
  if (typeof point.id === "number") capturePointer(unit, point.id);
}

function moveControlDrag(event) {
  if (!state.controlDrag) return;
  const point = getControlEventPoint(event);
  if (!point || !isControlDragEventMatch(point, state.controlDrag)) return;
  event.preventDefault();
  const drag = state.controlDrag;
  const nextX = drag.startX + point.clientX - drag.startClientX;
  const nextY = drag.startY + point.clientY - drag.startClientY;
  const clamped = clampControlPosition(nextX, nextY, drag);
  setControlPosition(drag.part, clamped.x, clamped.y);
}

function stopControlDrag(event = null) {
  const drag = state.controlDrag;
  if (!drag) return;
  const point = event ? getControlEventPoint(event) : null;
  if (point && !isControlDragEventMatch(point, drag)) return;
  const unit = getControlUnit(drag.part);
  unit?.classList.remove("is-dragging");
  if (typeof drag.pointerId === "number") releasePointer(unit, drag.pointerId);
  state.controlDrag = null;
  saveControlPositions();
}

function isControlDragEventMatch(point, drag) {
  return point.id === drag.pointerId || (drag.source === "pointer" && point.id === "mouse");
}

function getControlEventSource(event) {
  if (event.type.startsWith("pointer")) return "pointer";
  if (event.type.startsWith("touch")) return "touch";
  return "mouse";
}

function getControlEventPoint(event) {
  if (event.changedTouches?.length) {
    const touch = event.changedTouches[0];
    return {
      id: `touch-${touch.identifier}`,
      clientX: touch.clientX,
      clientY: touch.clientY
    };
  }
  if (event.touches?.length) {
    const touch = event.touches[0];
    return {
      id: `touch-${touch.identifier}`,
      clientX: touch.clientX,
      clientY: touch.clientY
    };
  }
  if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    return {
      id: Number.isFinite(event.pointerId) ? event.pointerId : "mouse",
      clientX: event.clientX,
      clientY: event.clientY
    };
  }
  return null;
}

function clampControlPosition(x, y, drag) {
  const margin = 6;
  const baseLeft = drag.unitRect.left - drag.startX;
  const baseRight = drag.unitRect.right - drag.startX;
  const baseTop = drag.unitRect.top - drag.startY;
  const baseBottom = drag.unitRect.bottom - drag.startY;
  return {
    x: Math.round(clamp(x, drag.deckRect.left + margin - baseLeft, drag.deckRect.right - margin - baseRight)),
    y: Math.round(clamp(y, drag.deckRect.top + margin - baseTop, drag.deckRect.bottom - margin - baseBottom))
  };
}

function keepControlPositionsInBounds() {
  if (!els.controlDeck) return;
  const rawDeckRect = els.controlDeck.getBoundingClientRect();
  if (rawDeckRect.width < 1 || rawDeckRect.height < 1) return;
  const deckRect = getControlBoundsRect();
  let changed = false;
  for (const part of CONTROL_PARTS) {
    const unit = getControlUnit(part);
    if (!unit) continue;
    const position = getControlPosition(part);
    const unitRect = unit.getBoundingClientRect();
    if (unitRect.width < 1 || unitRect.height < 1) continue;
    const clamped = clampControlPosition(position.x, position.y, {
      startX: position.x,
      startY: position.y,
      deckRect,
      unitRect
    });
    if (clamped.x !== position.x || clamped.y !== position.y) {
      setControlPosition(part, clamped.x, clamped.y);
      changed = true;
    }
  }
  if (changed) saveControlPositions();
}

function getControlBoundsRect() {
  const raw = els.controlDeck?.getBoundingClientRect() || {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight
  };
  const margin = getControlViewportMargin();
  const left = Math.max(raw.left, margin);
  const top = Math.max(raw.top, margin);
  const right = Math.min(raw.right, window.innerWidth - margin);
  const bottom = Math.min(raw.bottom, window.innerHeight - margin);
  return {
    left,
    top,
    right: Math.max(left, right),
    bottom: Math.max(top, bottom)
  };
}

function getControlViewportMargin() {
  return window.matchMedia("(max-width: 520px)").matches ? 16 : 14;
}

function scheduleControlBoundsCheck() {
  requestAnimationFrame(keepControlPositionsInBounds);
}

function applyControlPositions() {
  for (const part of CONTROL_PARTS) {
    const position = getControlPosition(part);
    setControlPosition(part, position.x, position.y);
  }
  updateControlOffsetClass();
  scheduleControlBoundsCheck();
}

function setControlPosition(part, x, y) {
  state.controlPositions[part] = {
    x: Math.round(Number.isFinite(x) ? x : 0),
    y: Math.round(Number.isFinite(y) ? y : 0)
  };
  const unit = getControlUnit(part);
  unit?.style.setProperty("--unit-x", `${state.controlPositions[part].x}px`);
  unit?.style.setProperty("--unit-y", `${state.controlPositions[part].y}px`);
  updateControlOffsetClass();
}

function getControlPosition(part) {
  return state.controlPositions[part] || { x: 0, y: 0 };
}

function getControlUnit(part) {
  return els.controlDeck?.querySelector(`[data-control-part="${part}"]`);
}

function saveControlPositions() {
  localStorage.setItem(CONTROL_POSITION_KEY, JSON.stringify(state.controlPositions));
}

function getSavedControlPositions() {
  try {
    return normalizeControlPositions(JSON.parse(localStorage.getItem(CONTROL_POSITION_KEY) || "{}"));
  } catch {
    return normalizeControlPositions({});
  }
}

function normalizeControlPositions(raw) {
  const positions = {};
  for (const part of CONTROL_PARTS) {
    const value = raw?.[part] || {};
    positions[part] = {
      x: Number.isFinite(value.x) ? Math.round(value.x) : 0,
      y: Number.isFinite(value.y) ? Math.round(value.y) : 0
    };
  }
  return positions;
}

function resetControlTuning() {
  state.controlPositions = normalizeControlPositions({});
  applyControlPositions();
  saveControlPositions();
  applyControlSize("standard");
  setControlCustomization(false);
}

function updateControlOffsetClass() {
  const hasOffset = CONTROL_PARTS.some((part) => {
    const position = getControlPosition(part);
    return Math.abs(position.x) > 1 || Math.abs(position.y) > 1;
  });
  els.controlDeck?.classList.toggle("has-custom-offset", hasOffset);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getOrCreatePilotId() {
  const existing = localStorage.getItem("tiktokPvpPilotId");
  if (existing?.startsWith("pilot_")) return existing;
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const id = `pilot_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  localStorage.setItem("tiktokPvpPilotId", id);
  return id;
}
