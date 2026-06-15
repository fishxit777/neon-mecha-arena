import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { io as createClient } from "socket.io-client";

const PORT = 3999;
const BASE_URL = `http://localhost:${PORT}`;
const ADMIN_TOKEN = "test-admin-token-32-characters-long";

test("admin creates a session, players join, spectator receives game state", { timeout: 12_000 }, async () => {
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(PORT),
      ADMIN_TOKEN,
      PUBLIC_ORIGIN: BASE_URL
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth();

    const admin = connectClient();
    await onceConnect(admin);
    const auth = await emitAck(admin, "admin_auth", { token: ADMIN_TOKEN });
    assert.equal(auth.ok, true);

    const created = await emitAck(admin, "admin_command", {
      action: "create_session",
      token: ADMIN_TOKEN,
      label: "E2E Live"
    });
    assert.equal(created.ok, true);
    assert.equal(created.session.urls.player.includes(`/join/${created.session.id}`), true);
    assert.equal(created.session.urls.studio.includes(`/watch/${created.session.id}?studio=1`), true);
    assert.equal(created.session.urls.latestStudio.endsWith("/studio"), true);

    const modeChanged = await emitAck(admin, "admin_command", {
      action: "set_entry_mode",
      token: ADMIN_TOKEN,
      sessionId: created.session.id,
      modeId: "spotlight_duel"
    });
    assert.equal(modeChanged.ok, true);
    assert.equal(modeChanged.session.room.scarcity.seatLimit, 2);

    const spectator = connectClient();
    await onceConnect(spectator);
    const spectatorJoin = await emitAck(spectator, "join_session", {
      sessionId: created.session.id,
      clientType: "spectator"
    });
    assert.equal(spectatorJoin.ok, true);

    const p1 = connectClient();
    const p2 = connectClient();
    const p3 = connectClient();
    await Promise.all([onceConnect(p1), onceConnect(p2), onceConnect(p3)]);
    const join1 = await emitAck(p1, "join_session", {
      sessionId: created.session.id,
      clientType: "player",
      name: "Alpha",
      pilotId: "pilot_socket_alpha"
    });
    const join2 = await emitAck(p2, "join_session", {
      sessionId: created.session.id,
      clientType: "player",
      name: "Beta",
      pilotId: "pilot_socket_beta"
    });
    const join3 = await emitAck(p3, "join_session", {
      sessionId: created.session.id,
      clientType: "player",
      name: "Gamma",
      pilotId: "pilot_socket_gamma"
    });
    assert.equal(join1.ok, true);
    assert.equal(join2.ok, true);
    assert.equal(join3.ok, true);
    assert.equal(join3.role, "queued");

    const started = await emitAck(admin, "admin_command", {
      action: "start_round",
      token: ADMIN_TOKEN,
      sessionId: created.session.id
    });
    assert.equal(started.ok, true);

    const spectatorIntervention = await emitAck(spectator, "audience_intervention", {
      sessionId: created.session.id,
      eventType: "shield_boost"
    });
    assert.equal(spectatorIntervention.ok, true);
    assert.equal(spectatorIntervention.event.details.actorRole, "spectator");

    const queuedIntervention = await emitAck(p3, "audience_intervention", {
      sessionId: created.session.id,
      eventType: "supply_drop"
    });
    assert.equal(queuedIntervention.ok, true);
    assert.equal(queuedIntervention.event.details.actorRole, "queued");

    const activeRejected = await emitAck(p1, "audience_intervention", {
      sessionId: created.session.id,
      eventType: "orbital_strike"
    });
    assert.equal(activeRejected.ok, false);
    assert.equal(activeRejected.code, "AUDIENCE_ONLY");

    p1.emit("player_input", { right: true, attack: true });
    const gameState = await waitForEvent(spectator, "game_state");
    assert.equal(gameState.sessionId, created.session.id);
    assert.equal(gameState.room.players.length, 2);
    assert.equal(gameState.room.status, "playing");
    assert.equal(gameState.room.players.some((player) => player.pilotId === "pilot_socket_alpha"), true);
    assert.equal(gameState.room.audienceInterventions.roundLimit, 6);

    const director = await emitAck(admin, "admin_command", {
      action: "director_signal",
      token: ADMIN_TOKEN,
      sessionId: created.session.id,
      signalType: "manual_hype",
      label: "主播加壓"
    });
    assert.equal(director.ok, true);
    assert.equal(director.signal.type, "manual_hype");

    const directedState = await waitForEvent(spectator, "game_state");
    assert.equal(directedState.room.director.activeSignal.type, "manual_hype");

    const battleEvent = await emitAck(admin, "admin_command", {
      action: "battle_event",
      token: ADMIN_TOKEN,
      sessionId: created.session.id,
      eventType: "energy_storm",
      label: "Energy Storm"
    });
    assert.equal(battleEvent.ok, true);
    assert.equal(battleEvent.event.type, "energy_storm");

    const eventState = await waitForEvent(spectator, "game_state");
    assert.equal(eventState.room.battleEvents.active.some((event) => event.type === "energy_storm"), true);

    const metrics = await fetch(`${BASE_URL}/metrics`).then((res) => res.json());
    assert.equal(metrics.sessions[0].activePlayers, 2);
    assert.equal(metrics.sessions[0].queuedPlayers, 1);

    const jsonExport = await fetch(`${BASE_URL}/admin/export/${created.session.id}.json?token=${ADMIN_TOKEN}`).then((res) => res.json());
    assert.equal(jsonExport.session.id, created.session.id);
    assert.equal(jsonExport.players.length, 2);

    const csvExport = await fetch(`${BASE_URL}/admin/export/${created.session.id}.csv?token=${ADMIN_TOKEN}`).then((res) => res.text());
    assert.match(csvExport, /section,id,name,type,value,detail/);
    assert.match(csvExport, /player/);

    const assets = await fetch(`${BASE_URL}/admin/assets/${created.session.id}.json?token=${ADMIN_TOKEN}`).then((res) => res.json());
    assert.equal(assets.session.id, created.session.id);
    assert.match(assets.roundSummary, /Round|尚未完成/);

    const victoryCard = await fetch(`${BASE_URL}/admin/assets/${created.session.id}/victory-card.svg?token=${ADMIN_TOKEN}`).then((res) => res.text());
    assert.match(victoryCard, /<svg/);

    const socialCopy = await fetch(`${BASE_URL}/admin/assets/${created.session.id}/social.txt?token=${ADMIN_TOKEN}`).then((res) => res.text());
    assert.match(socialCopy, /社群文案/);

    admin.close();
    spectator.close();
    p1.close();
    p2.close();
    p3.close();
  } finally {
    server.kill();
  }
});

function connectClient() {
  return createClient(BASE_URL, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 2_000
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${event} ack`)), 2_500);
    socket.emit(event, payload, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

function onceConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function waitForEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), 3_000);
    socket.once(event, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    try {
      const response = await fetch(`${BASE_URL}/healthz`);
      if (response.ok) return;
    } catch {
      // Keep trying while the child process starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not become healthy");
}
