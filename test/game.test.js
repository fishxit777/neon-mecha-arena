import test from "node:test";
import assert from "node:assert/strict";
import { cleanNickname, GAME, GameWorld } from "../src/game.js";

test("cleanNickname trims unsafe names and banned words", () => {
  assert.equal(cleanNickname("  Bao  "), "Bao");
  assert.equal(cleanNickname("<b>Alice</b>"), "bAliceb");
  assert.match(cleanNickname("admin boss"), /^Player-/);
  assert.equal(cleanNickname("12345678901234567890"), "1234567890123456");
});

test("players join a session and are assigned teams", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Test Live");

  const p1 = world.joinSession({ sessionId: session.id, socketId: "s1", name: "Red" });
  now += 10;
  const p2 = world.joinSession({ sessionId: session.id, socketId: "s2", name: "Blue" });

  assert.equal(p1.ok, true);
  assert.equal(p2.ok, true);
  const publicSession = world.getPublicSession(session.id);
  assert.equal(publicSession.room.players.length, 2);
  assert.deepEqual(
    publicSession.room.players.map((player) => player.team),
    ["red", "blue"]
  );
});

test("latestPublicSession returns the newest session for fixed Studio source", () => {
  const world = new GameWorld(() => 1_000);
  const first = world.createSession("First");
  const second = world.createSession("Second");

  assert.equal(world.latestPublicSession().id, second.id);
  assert.notEqual(world.latestPublicSession().id, first.id);
});

test("room queues player over max capacity", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Capacity");

  for (let i = 0; i < GAME.maxPlayers + 1; i += 1) {
    now += 10;
    world.joinSession({ sessionId: session.id, socketId: `s${i}`, name: `P${i}` });
  }

  const publicSession = world.getPublicSession(session.id);
  assert.equal(publicSession.room.players.length, GAME.maxPlayers);
  assert.equal(publicSession.room.queue.length, 1);
});

test("start round explains why a second player is required", () => {
  const world = new GameWorld(() => 1_000);
  const session = world.createSession("Needs Two");
  world.joinSession({ sessionId: session.id, socketId: "s1", name: "Solo" });

  const started = world.startRound(session.id);

  assert.equal(started.ok, false);
  assert.equal(started.code, "NEED_TWO_PLAYERS");
  assert.equal(world.getPublicSession(session.id).room.status, "waiting");
  assert.equal(
    world.getPublicSession(session.id).room.analytics.errors.some((error) => error.code === "NEED_TWO_PLAYERS"),
    true
  );
});

test("admin can add an auto NPC so one human can test a full round", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Bot Fill");
  world.joinSession({ sessionId: session.id, socketId: "s1", name: "Human" });

  const added = world.addBotPlayer(session.id, "auto");
  assert.equal(added.ok, true);
  assert.equal(world.getPublicSession(session.id).room.players.filter((player) => player.isBot).length, 1);

  const started = world.startRound(session.id);
  assert.equal(started.ok, true);

  for (let i = 0; i < 18; i += 1) {
    now += GAME.tickMs;
    world.tick(now);
  }

  const room = world.getSession(session.id).room;
  const bot = [...room.players.values()].find((player) => player.isBot);
  assert.equal(bot.botMode, "auto");
  assert.equal(bot.roundStats.shots > 0, true);
});

test("admin can switch NPC to manual mode and remove it", () => {
  const world = new GameWorld(() => 1_000);
  const session = world.createSession("Bot Controls");
  world.joinSession({ sessionId: session.id, socketId: "s1", name: "Human" });
  world.addBotPlayer(session.id, "auto");

  const manual = world.setBotMode(session.id, "manual");
  assert.equal(manual.ok, true);
  assert.equal(world.getPublicSession(session.id).room.players.find((player) => player.isBot).botMode, "manual");

  const removed = world.removeBotPlayers(session.id);
  assert.equal(removed.ok, true);
  assert.equal(world.getPublicSession(session.id).room.players.some((player) => player.isBot), false);
});

test("first input is accepted and fast repeated input is rate limited", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Input");
  world.joinSession({ sessionId: session.id, socketId: "s1", name: "P1" });

  assert.deepEqual(world.applyInput("s1", { right: true }), { ok: true });
  assert.deepEqual(world.applyInput("s1", { left: true }), { ok: false, code: "RATE_LIMITED" });
  now += GAME.inputMinIntervalMs;
  assert.deepEqual(world.applyInput("s1", { left: true }), { ok: true });
  assert.equal(world.getPublicSession(session.id).room.analytics.errors.some((error) => error.code === "RATE_LIMITED"), false);
});

test("analog aim creates a diagonal 360-degree projectile", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Analog Aim");
  const p1 = world.joinSession({ sessionId: session.id, socketId: "s1", name: "Red" });
  world.joinSession({ sessionId: session.id, socketId: "s2", name: "Blue" });
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const red = room.players.get(p1.playerId);
  red.x = 80;
  red.y = 80;
  now += GAME.inputMinIntervalMs;
  world.applyInput("s1", { attack: true, aimX: 1, aimY: 1, moveX: 0.7, moveY: 0.7 });
  now += GAME.tickMs;
  world.tick(now);

  const projectile = [...room.projectiles.values()][0];
  assert.equal(projectile.vx > 0, true);
  assert.equal(projectile.vy > 0, true);
  assert.equal(Math.abs(projectile.vx - projectile.vy) < 1, true);
});

test("start round, projectile hit, and winner are server-authoritative", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Round");
  const p1 = world.joinSession({ sessionId: session.id, socketId: "s1", name: "Red" });
  world.joinSession({ sessionId: session.id, socketId: "s2", name: "Blue" });

  const started = world.startRound(session.id);
  assert.equal(started.ok, true);

  const room = world.getSession(session.id).room;
  const red = room.players.get(p1.playerId);
  const blue = [...room.players.values()].find((player) => player.team === "blue");
  red.x = blue.x - 70;
  red.y = blue.y;
  red.facingX = 1;
  red.facingY = 0;
  now += GAME.inputMinIntervalMs;
  world.applyInput("s1", { attack: true });

  for (let i = 0; i < 8; i += 1) {
    now += GAME.tickMs;
    world.tick(now);
  }

  assert.equal(blue.hp < GAME.playerHp, true);
  blue.hp = 0;
  blue.alive = false;
  world.tick(now + GAME.tickMs);
  assert.equal(world.getPublicSession(session.id).room.winnerTeam, "red");
});

test("combat damage is exposed as floating damage events", () => {
  const now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Damage Events");
  world.joinSession({ sessionId: session.id, socketId: "s1", name: "Red" });
  world.joinSession({ sessionId: session.id, socketId: "s2", name: "Blue" });
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const blue = [...room.players.values()].find((player) => player.team === "blue");
  world.applyCombatDamage(room, blue, 10, { now, source: "test" });

  const events = world.getPublicSession(session.id).room.damageEvents;
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, 10);
  assert.equal(events[0].source, "test");
  assert.equal(events[0].targetId, blue.id);
});

test("combat damage breaks armor before eliminating a pilot", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Armor Break");
  world.joinSession({ sessionId: session.id, socketId: "s1", name: "Red" });
  world.joinSession({ sessionId: session.id, socketId: "s2", name: "Blue" });
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const blue = [...room.players.values()].find((player) => player.team === "blue");

  blue.hp = 6;
  const first = world.applyCombatDamage(room, blue, 18, { now, source: "test" });
  assert.equal(first.armourBroken, true);
  assert.equal(first.eliminated, false);
  assert.equal(blue.alive, true);
  assert.equal(blue.lives, 1);
  assert.equal(blue.broken, true);
  assert.equal(blue.hp, GAME.playerHp);
  assert.equal(blue.breakAnim, 35);

  now += 50;
  blue.hp = 6;
  const second = world.applyCombatDamage(room, blue, 18, { now, source: "test" });
  assert.equal(second.armourBroken, false);
  assert.equal(second.eliminated, true);
  assert.equal(blue.alive, false);
  assert.equal(blue.lives, 0);
  assert.equal(blue.hp, 0);
});

test("reset removes disconnected mid-round players", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Disconnect");
  world.joinSession({ sessionId: session.id, socketId: "s1", name: "One" });
  world.joinSession({ sessionId: session.id, socketId: "s2", name: "Two" });
  world.startRound(session.id);

  world.disconnect("s1");
  const reset = world.resetRoom(session.id);

  assert.equal(reset.ok, true);
  assert.equal(world.getPublicSession(session.id).room.players.length, 1);
});
