import test from "node:test";
import assert from "node:assert/strict";
import { DIRECTOR_SIGNAL_TYPES } from "../src/director.js";
import { GAME, GameWorld } from "../src/game.js";

test("director catalog covers A1-A8 signal families", () => {
  assert.deepEqual(Object.keys(DIRECTOR_SIGNAL_TYPES), [
    "waiting",
    "opening_countdown",
    "full_house",
    "queue_pressure",
    "weak_team",
    "overdrive",
    "final_duel",
    "manual_hype",
    "hype_moment"
  ]);
});

test("round start creates opening countdown director signal", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Director");
  world.joinSession({ sessionId: session.id, socketId: "s1", name: "One" });
  world.joinSession({ sessionId: session.id, socketId: "s2", name: "Two" });

  const started = world.startRound(session.id);
  const publicSession = world.getPublicSession(session.id);

  assert.equal(started.ok, true);
  assert.equal(publicSession.room.director.phase, "opening");
  assert.equal(publicSession.room.director.activeSignal.type, "opening_countdown");
  assert.equal(publicSession.room.timeline.at(-2).action, "director_opening_countdown");
});

test("director emits overdrive and final-duel signals near round end", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Time");
  world.joinSession({ sessionId: session.id, socketId: "s1", name: "One" });
  world.joinSession({ sessionId: session.id, socketId: "s2", name: "Two" });
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  now = room.roundEndsAt - 19_000;
  world.tick(now);
  assert.equal(world.getPublicSession(session.id).room.director.activeSignal.type, "overdrive");

  now = room.roundEndsAt - 9_000;
  world.tick(now);
  assert.equal(world.getPublicSession(session.id).room.director.activeSignal.type, "final_duel");
});

test("director detects weak team state without changing HP by itself", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Balance");
  for (let i = 0; i < 4; i += 1) {
    now += 10;
    world.joinSession({ sessionId: session.id, socketId: `s${i}`, name: `P${i}` });
  }
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  for (const player of room.players.values()) {
    if (player.team === "blue") player.hp = 15;
  }

  now = room.director.activeSignal.expiresAt + GAME.tickMs;
  world.tick(now);
  const publicSession = world.getPublicSession(session.id);

  assert.equal(publicSession.room.director.activeSignal.type, "weak_team");
  assert.equal([...room.players.values()].filter((player) => player.team === "blue").every((player) => player.hp === 15), true);
});

test("admin can trigger manual and climax director signals and they are recorded", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Manual");

  const result = world.triggerDirectorSignal(session.id, "manual_hype", { label: "主播加壓" });
  const publicSession = world.getPublicSession(session.id);

  assert.equal(result.ok, true);
  assert.equal(result.signal.source, "admin");
  assert.equal(publicSession.room.director.activeSignal.type, "manual_hype");
  assert.equal(publicSession.room.timeline.at(-1).action, "director_manual_hype");

  const climax = world.triggerDirectorSignal(session.id, "hype_moment", { label: "高潮時刻" });
  const updatedSession = world.getPublicSession(session.id);

  assert.equal(climax.ok, true);
  assert.equal(updatedSession.room.director.activeSignal.type, "hype_moment");
  assert.equal(updatedSession.room.timeline.at(-1).action, "director_hype_moment");
});
