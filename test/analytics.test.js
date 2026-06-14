import test from "node:test";
import assert from "node:assert/strict";
import { sessionExportToCsv } from "../src/metrics.js";
import { GAME, GameWorld } from "../src/game.js";

test("admin analytics covers live counts, queue, spectator, teams, latency, funnel, controls, and errors", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Analytics");

  world.recordJoinPageView(session.id, "visitor_1");
  for (let index = 0; index < GAME.maxPlayers + 1; index += 1) {
    now += 10;
    world.joinSession({
      sessionId: session.id,
      socketId: `player_${index}`,
      name: `Pilot ${index}`,
      pilotId: `pilot_analytics_${index}`
    });
  }
  world.joinSession({ sessionId: session.id, socketId: "obs_1", clientType: "spectator" });
  world.recordClientLatency("player_0", 42);
  world.recordClientLatency("obs_1", 68);
  world.setLocked(session.id, true);
  world.setLocked(session.id, false);
  world.kickPlayer(session.id, world.getPublicSession(session.id).room.players[0].id);
  world.resetRoom(session.id, false, "resets");
  world.recordSessionError(session.id, { code: "QA_ERROR", message: "Synthetic analytics error", source: "test" });

  const publicSession = world.getPublicSession(session.id);
  const analytics = publicSession.room.analytics;

  assert.equal(publicSession.metrics.activePlayers, GAME.maxPlayers);
  assert.equal(publicSession.metrics.queuedPlayers, 0);
  assert.equal(analytics.funnel.joinPageViews, 1);
  assert.equal(analytics.funnel.successfulJoins, GAME.maxPlayers);
  assert.equal(analytics.funnel.queuedJoins, 1);
  assert.equal(analytics.spectators.online, true);
  assert.equal(analytics.teams.players.red + analytics.teams.players.blue, GAME.maxPlayers);
  assert.equal(analytics.latency.averageMs, 55);
  assert.equal(analytics.controls.locks, 1);
  assert.equal(analytics.controls.unlocks, 1);
  assert.equal(analytics.controls.kicks, 1);
  assert.equal(analytics.controls.resets, 1);
  assert.equal(analytics.errors.at(-1).code, "QA_ERROR");
  assert.equal(analytics.activityPeak.total > 0, true);
});

test("round history, MVP summary, and JSON/CSV export are generated", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Export");
  world.joinSession({ sessionId: session.id, socketId: "red", name: "Red", pilotId: "pilot_export_red" });
  world.joinSession({ sessionId: session.id, socketId: "blue", name: "Blue", pilotId: "pilot_export_blue" });
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const red = [...room.players.values()].find((player) => player.team === "red");
  const blue = [...room.players.values()].find((player) => player.team === "blue");
  red.roundStats.hits = 2;
  red.roundStats.damageDealt = 100;
  blue.hp = 0;
  blue.alive = false;
  now += 5_000;
  world.tick(now);

  const publicSession = world.getPublicSession(session.id);
  assert.equal(publicSession.room.analytics.rounds.length, 1);
  assert.equal(publicSession.room.analytics.rounds[0].winnerTeam, "red");
  assert.equal(publicSession.room.analytics.mvp.name, "Red");

  const exportData = world.getSessionExport(session.id);
  assert.equal(exportData.session.id, session.id);
  assert.equal(exportData.analytics.rounds.length, 1);
  assert.equal(exportData.players.length, 2);

  const csv = sessionExportToCsv(exportData);
  assert.match(csv, /section,id,name,type,value,detail/);
  assert.match(csv, /round/);
  assert.match(csv, /player/);
});
