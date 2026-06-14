let audioCtx = null;
let masterGain = null;
let bgmTimer = null;
let bgmRunning = false;
let bgmNextTime = 0;
let bgmStep = 0;

const STORAGE_SFX = "neonMechaSfxEnabled";
const STORAGE_BGM = "neonMechaBgmEnabled";
const BGM_BPM = 128;
const BGM_BEAT = 60 / BGM_BPM;
const BGM_STEP = BGM_BEAT / 2;
const BGM_LOOK_AHEAD = 0.25;
const BGM_TIMER_MS = 100;
const KICK_PAT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const BASS_PAT = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
const HAT_PAT = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1];
const SYNTH_PAT = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0];
const BASS_NOTES = [55, 55, 41, 55, 55, 41, 49, 55];

let sfxEnabled = readFlag(STORAGE_SFX, true);
let bgmEnabled = readFlag(STORAGE_BGM, true);

export function initAudio() {
  if (audioCtx) return audioCtx;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  audioCtx = new AudioContextCtor();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.72;
  masterGain.connect(audioCtx.destination);
  return audioCtx;
}

export async function resumeAudio() {
  const ctx = initAudio();
  if (!ctx) return false;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }
  return ctx.state === "running";
}

export function bindAudioUnlock(target = document) {
  const unlock = () => {
    resumeAudio();
  };
  target.addEventListener("pointerdown", unlock, { passive: true });
  target.addEventListener("touchstart", unlock, { passive: true });
  target.addEventListener("keydown", unlock);
}

export function getAudioSettings() {
  return {
    sfxEnabled,
    bgmEnabled,
    canAudio: Boolean(window.AudioContext || window.webkitAudioContext),
    running: audioCtx?.state === "running",
    bgmRunning
  };
}

export function setSfxEnabled(enabled) {
  sfxEnabled = enabled === true;
  writeFlag(STORAGE_SFX, sfxEnabled);
  return getAudioSettings();
}

export function setBgmEnabled(enabled) {
  bgmEnabled = enabled === true;
  writeFlag(STORAGE_BGM, bgmEnabled);
  if (!bgmEnabled) stopBGM();
  return getAudioSettings();
}

export function toggleSFX() {
  return setSfxEnabled(!sfxEnabled);
}

export function toggleBGM() {
  const next = setBgmEnabled(!bgmEnabled);
  if (next.bgmEnabled) startBGM();
  return getAudioSettings();
}

export function startBGM() {
  if (!bgmEnabled || bgmRunning) return;
  const ctx = initAudio();
  if (!ctx) return;
  bgmRunning = true;
  bgmStep = 0;
  bgmNextTime = ctx.currentTime + 0.08;
  scheduleBGM();
}

export function stopBGM() {
  bgmRunning = false;
  if (bgmTimer) clearTimeout(bgmTimer);
  bgmTimer = null;
}

export function sfxShoot(team = "blue") {
  if (!canPlaySfx()) return;
  const ctx = audioCtx;
  const t = ctx.currentTime;
  const base = team === "red" ? 520 : 680;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(base * 1.2, t);
  osc.frequency.exponentialRampToValueAtTime(base * 0.42, t + 0.16);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(gain).connect(getMaster());
  osc.start(t);
  osc.stop(t + 0.18);
}

export function sfxHit() {
  if (!canPlaySfx()) return;
  const ctx = audioCtx;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.22);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1400, t);
  filter.frequency.exponentialRampToValueAtTime(180, t + 0.22);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.26, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  osc.connect(filter).connect(gain).connect(getMaster());
  osc.start(t);
  osc.stop(t + 0.24);
  playNoise(t, 0.09, "bandpass", 1200, 0.11);
}

export function sfxArmourBreak() {
  if (!canPlaySfx()) return;
  const ctx = audioCtx;
  const t = ctx.currentTime;
  playNoise(t, 0.5, "bandpass", 2600, 0.24);
  playSweep("sine", 420, 90, t, 0.48, 0.20);
  for (let index = 0; index < 3; index += 1) {
    playPulse("square", 150 + index * 110, t + index * 0.08, 0.07, 0.11);
  }
}

export function sfxExplosion() {
  if (!canPlaySfx()) return;
  const ctx = audioCtx;
  const t = ctx.currentTime;
  playSweep("sine", 80, 28, t, 1.2, 0.34);
  playSweep("triangle", 210, 60, t + 0.03, 0.72, 0.18);
  playNoise(t, 1.0, "lowpass", 720, 0.28);
  for (let index = 0; index < 6; index += 1) {
    playPulse("square", 600 + index * 80, t + 0.08 + index * 0.055, 0.045, 0.08);
  }
}

export function sfxVictory(team = "blue") {
  if (!sfxEnabled) return;
  resumeAudio();
  stopBGM();
  if (!canPlaySfx()) return;
  const t = audioCtx.currentTime;
  const root = team === "red" ? 261.63 : 329.63;
  const notes = [0, 4, 7, 12, 16, 19, 24].map((semi) => root * 2 ** (semi / 12));
  notes.forEach((freq, index) => {
    playPulse("square", freq, t + index * 0.12, 0.18, 0.12);
  });
  [root, root * 1.25, root * 1.5, root * 2].forEach((freq) => {
    playPulse("sine", freq, t + 0.08, 2.65, 0.045);
  });
}

export function sfxStorm() {
  if (!canPlaySfx()) return;
  const t = audioCtx.currentTime;
  [55, 58, 62].forEach((freq, index) => {
    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    filter.type = "lowpass";
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(95, t + 1.8);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.07, t + 0.08 + index * 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    osc.connect(filter).connect(gain).connect(getMaster());
    osc.start(t);
    osc.stop(t + 1.85);
  });
}

function scheduleBGM() {
  if (!bgmRunning || !audioCtx) return;
  while (bgmNextTime < audioCtx.currentTime + BGM_LOOK_AHEAD) {
    scheduleStep(bgmStep, bgmNextTime);
    bgmNextTime += BGM_STEP;
    bgmStep = (bgmStep + 1) % 16;
  }
  bgmTimer = setTimeout(scheduleBGM, BGM_TIMER_MS);
}

function scheduleStep(step, time) {
  if (KICK_PAT[step]) playKick(time);
  if (BASS_PAT[step]) playBass(BASS_NOTES[Math.floor(step / 2) % BASS_NOTES.length], time);
  if (HAT_PAT[step]) playHat(time);
  if (SYNTH_PAT[step]) playSynth(220 * 2 ** ((step % 8) / 12), time);
  if (step === 0 || step === 8) playPad(time, step === 0 ? 55 : 49);
}

function playKick(time) {
  playSweep("sine", 160, 40, time, 0.18, 0.24);
}

function playBass(freq, time) {
  const osc = audioCtx.createOscillator();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  osc.type = "sawtooth";
  osc.frequency.value = freq;
  filter.type = "lowpass";
  filter.Q.value = 4;
  filter.frequency.setValueAtTime(800, time);
  filter.frequency.exponentialRampToValueAtTime(200, time + 0.22);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.075, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);
  osc.connect(filter).connect(gain).connect(getMaster());
  osc.start(time);
  osc.stop(time + 0.3);
}

function playHat(time) {
  playNoise(time, 0.06, "highpass", 8000, 0.075);
}

function playSynth(freq, time) {
  const osc = audioCtx.createOscillator();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  filter.type = "bandpass";
  filter.Q.value = 2;
  filter.frequency.value = 1800;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.055, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
  osc.connect(filter).connect(gain).connect(getMaster());
  osc.start(time);
  osc.stop(time + 0.14);
}

function playPad(time, root) {
  [1, 1.25, 1.5, 2].forEach((ratio) => {
    playPulse("sine", root * ratio, time, BGM_STEP * 7, 0.018);
  });
}

function playSweep(type, startFreq, endFreq, time, duration, peakGain) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), time + duration);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peakGain, time + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain).connect(getMaster());
  osc.start(time);
  osc.stop(time + duration + 0.03);
}

function playPulse(type, freq, time, duration, peakGain) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peakGain, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain).connect(getMaster());
  osc.start(time);
  osc.stop(time + duration + 0.02);
}

function playNoise(time, duration, filterType, freq, peakGain) {
  const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < bufferSize; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  const source = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  source.buffer = buffer;
  filter.type = filterType;
  filter.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peakGain, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  source.connect(filter).connect(gain).connect(getMaster());
  source.start(time);
  source.stop(time + duration + 0.02);
}

function canPlaySfx() {
  if (!sfxEnabled) return false;
  return Boolean(initAudio() && audioCtx?.state === "running");
}

function getMaster() {
  initAudio();
  return masterGain;
}

function readFlag(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function writeFlag(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage may be blocked in embedded browser sources.
  }
}
