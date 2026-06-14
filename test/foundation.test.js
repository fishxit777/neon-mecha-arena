import test from "node:test";
import assert from "node:assert/strict";
import {
  FOUNDATION_DOMAINS,
  createFoundationState,
  recordTimelineEvent,
  serializeTimeline,
  updateDomainStatus
} from "../src/foundation.js";
import { createRoomMetrics } from "../src/metrics.js";
import { MemoryProjectStore, STORE_COLLECTIONS } from "../src/storage.js";
import { GAME, GameWorld } from "../src/game.js";

test("foundation state includes all five unique-feature domains and QA suites", () => {
  const foundation = createFoundationState(1_000);

  assert.deepEqual(Object.keys(foundation.domains), Object.keys(FOUNDATION_DOMAINS));
  assert.deepEqual(foundation.qa.requiredSuites, ["director", "pilots", "events", "metrics", "assets"]);
  assert.equal(foundation.version.startsWith("step0"), true);
});

test("timeline records stable sequence, category, round, tick, and bounded history", () => {
  const foundation = createFoundationState(1_000);

  for (let i = 0; i < 4; i += 1) {
    recordTimelineEvent(
      foundation,
      {
        at: 1_000 + i,
        category: "director",
        action: "round_signal",
        sessionId: "live_test",
        roomId: "room_test",
        round: 2,
        tick: i,
        details: { index: i }
      },
      { limit: 3 }
    );
  }

  const timeline = serializeTimeline(foundation, 10);
  assert.equal(timeline.length, 3);
  assert.deepEqual(
    timeline.map((event) => event.sequence),
    [2, 3, 4]
  );
  assert.equal(timeline[0].category, "director");
  assert.equal(timeline[2].details.index, 3);
});

test("foundation domain status can be updated only for known domains", () => {
  const foundation = createFoundationState(1_000);
  const updated = updateDomainStatus(foundation, "metrics", "ready", 2_000);

  assert.equal(updated.status, "ready");
  assert.equal(updated.updatedAt, 2_000);
  assert.throws(() => updateDomainStatus(foundation, "unknown", "ready"), /Unknown foundation domain/);
});

test("memory project store keeps independent project collections", () => {
  const store = new MemoryProjectStore();

  assert.deepEqual(STORE_COLLECTIONS, ["sessions", "pilots", "events", "metrics", "assets"]);
  store.put("sessions", "live_1", { id: "live_1", label: "Demo" });
  store.append("events", { id: "evt_1", action: "session_created" });

  const session = store.get("sessions", "live_1");
  session.label = "Changed outside";

  assert.equal(store.count("sessions"), 1);
  assert.equal(store.get("sessions", "live_1").label, "Demo");
  assert.equal(store.list("events")[0].action, "session_created");
});

test("room metrics summarize capacity, queue, spectators, and team balance", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Metrics");

  world.joinSession({ sessionId: session.id, socketId: "s1", name: "Red" });
  now += 10;
  world.joinSession({ sessionId: session.id, socketId: "s2", name: "Blue" });
  world.joinSession({ sessionId: session.id, socketId: "obs", clientType: "spectator" });

  const room = world.getSession(session.id).room;
  const metrics = createRoomMetrics(room, { maxPlayers: GAME.maxPlayers, lastTickDurationMs: 1.25, now });

  assert.equal(metrics.activePlayers, 2);
  assert.equal(metrics.openSlots, GAME.maxPlayers - 2);
  assert.equal(metrics.spectators, 1);
  assert.deepEqual(metrics.teamCounts, { red: 1, blue: 1 });
  assert.deepEqual(metrics.aliveByTeam, { red: 1, blue: 1 });
  assert.equal(metrics.lastTickDurationMs, 1.25);
});

test("game world exposes foundation timeline and stores events", () => {
  let now = 1_000;
  const store = new MemoryProjectStore();
  const world = new GameWorld(() => now, store);
  const session = world.createSession("Foundation");

  now += 10;
  world.joinSession({ sessionId: session.id, socketId: "s1", name: "One" });
  now += 10;
  world.joinSession({ sessionId: session.id, socketId: "s2", name: "Two" });
  world.startRound(session.id);

  const publicSession = world.getPublicSession(session.id);

  assert.equal(publicSession.room.foundation.version.startsWith("step0"), true);
  assert.equal(publicSession.room.timeline.length >= 4, true);
  assert.equal(publicSession.room.auditLog.at(-1).action, "round_started");
  assert.equal(store.count("sessions"), 1);
  assert.equal(store.count("events") >= 4, true);
  assert.equal(store.get("metrics", `${session.id}:latest`).sessionId, session.id);
});
