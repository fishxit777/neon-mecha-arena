import test from "node:test";
import assert from "node:assert/strict";
import {
  BATTLE_EVENT_TYPES,
  getProjectileDamageWithEvents
} from "../src/battleEvents.js";
import { GAME, GameWorld } from "../src/game.js";

const REQUIRED_EVENTS = ["energy_storm", "overload", "orbital_strike", "shield_boost", "supply_drop", "final_showdown"];

test("battle event catalog covers C1-C6 event families", () => {
  assert.deepEqual(Object.keys(BATTLE_EVENT_TYPES), REQUIRED_EVENTS);
  for (const type of REQUIRED_EVENTS) {
    assert.equal(typeof BATTLE_EVENT_TYPES[type].title, "string");
    assert.equal(BATTLE_EVENT_TYPES[type].durationMs > 0, true);
    assert.equal(BATTLE_EVENT_TYPES[type].priority > 0, true);
  }
});

test("round start schedules overload, orbital strike, and final showdown", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = createPlayableSession(world);

  const started = world.startRound(session.id);
  assert.equal(started.ok, true);

  const room = world.getSession(session.id).room;
  assert.deepEqual(
    room.battleEvents.schedule.map((event) => event.type),
    ["overload", "orbital_strike", "final_showdown"]
  );

  now = room.roundStartedAt + Math.round(GAME.roundDurationMs * 0.48) + 1;
  world.tick(now);

  const publicSession = world.getPublicSession(session.id);
  assert.equal(publicSession.room.battleEvents.active.some((event) => event.type === "overload"), true);
  assert.equal(publicSession.room.timeline.some((event) => event.action === "battle_overload"), true);
});

test("energy storm damages players outside the safe zone", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = createPlayableSession(world);
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const red = [...room.players.values()].find((player) => player.team === "red");
  const blue = [...room.players.values()].find((player) => player.team === "blue");
  red.x = 30;
  red.y = 30;
  blue.x = GAME.arenaWidth / 2;
  blue.y = GAME.arenaHeight / 2;

  const triggered = world.triggerBattleEvent(session.id, "energy_storm", { requestedBy: "test" });
  assert.equal(triggered.ok, true);

  now += 1_050;
  world.tick(now);

  assert.equal(red.hp, GAME.playerHp - 2);
  assert.equal(blue.hp, GAME.playerHp);
});

test("energy storm uses the armor break life rule", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = createPlayableSession(world);
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const red = [...room.players.values()].find((player) => player.team === "red");
  red.x = 30;
  red.y = 30;
  red.hp = 1;

  world.triggerBattleEvent(session.id, "energy_storm", { requestedBy: "test" });
  now += 1_050;
  world.tick(now);

  assert.equal(red.alive, true);
  assert.equal(red.lives, 1);
  assert.equal(red.broken, true);
  assert.equal(red.hp, GAME.playerHp);
});

test("orbital strike damages pilots in the center lane", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = createPlayableSession(world);
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const red = [...room.players.values()].find((player) => player.team === "red");
  const blue = [...room.players.values()].find((player) => player.team === "blue");
  red.x = GAME.arenaWidth / 2;
  red.y = GAME.arenaHeight / 2;
  blue.x = GAME.arenaWidth / 2 + 160;
  blue.y = GAME.arenaHeight / 2;

  const triggered = world.triggerBattleEvent(session.id, "orbital_strike", { requestedBy: "test" });
  assert.equal(triggered.ok, true);

  now += 1_450;
  world.tick(now);

  assert.equal(red.hp, GAME.playerHp - 12);
  assert.equal(blue.hp, GAME.playerHp);
});

test("shield boost protects the weaker team from projectile damage", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = createPlayableSession(world);
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const red = [...room.players.values()].find((player) => player.team === "red");
  const blue = [...room.players.values()].find((player) => player.team === "blue");
  red.hp = 20;
  blue.hp = 100;

  const shield = world.triggerBattleEvent(session.id, "shield_boost", { requestedBy: "test" });
  assert.equal(shield.ok, true);
  assert.equal(red.shieldHp, 30);
  assert.equal(blue.shieldHp, 0);

  red.x = blue.x - 70;
  red.y = blue.y;
  blue.facingX = -1;
  blue.facingY = 0;
  now += GAME.inputMinIntervalMs;
  world.applyInput(blue.socketId, { attack: true });
  for (let i = 0; i < 8; i += 1) {
    now += GAME.tickMs;
    world.tick(now);
  }

  assert.equal(red.hp, 20);
  assert.equal(red.shieldHp < 30, true);
});

test("supply drop heals the two lowest alive pilots", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = createPlayableSession(world, 4);
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const players = [...room.players.values()];
  players[0].hp = 12;
  players[1].hp = 35;
  players[2].hp = 65;
  players[3].hp = 90;

  const supply = world.triggerBattleEvent(session.id, "supply_drop", { requestedBy: "test" });
  assert.equal(supply.ok, true);

  assert.equal(players[0].hp, 37);
  assert.equal(players[1].hp, 60);
  assert.equal(players[2].hp, 65);
  assert.equal(players[3].hp, 90);
});

test("overload and final showdown increase projectile damage", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = createPlayableSession(world);
  world.startRound(session.id);
  const room = world.getSession(session.id).room;

  assert.equal(getProjectileDamageWithEvents(room, GAME.projectileDamage, now), GAME.projectileDamage);
  world.triggerBattleEvent(session.id, "overload", { requestedBy: "test" });
  assert.equal(getProjectileDamageWithEvents(room, GAME.projectileDamage, now), GAME.projectileDamage + 8);
  world.triggerBattleEvent(session.id, "final_showdown", { requestedBy: "test" });
  assert.equal(getProjectileDamageWithEvents(room, GAME.projectileDamage, now), GAME.projectileDamage + 20);
});

test("final showdown damages pilots outside the shrinking combat zone", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = createPlayableSession(world);
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const red = [...room.players.values()].find((player) => player.team === "red");
  const blue = [...room.players.values()].find((player) => player.team === "blue");
  red.x = 20;
  red.y = 20;
  blue.x = GAME.arenaWidth / 2;
  blue.y = GAME.arenaHeight / 2;

  const showdown = world.triggerBattleEvent(session.id, "final_showdown", { requestedBy: "test" });
  assert.equal(showdown.ok, true);

  now += 1_050;
  world.tick(now);

  assert.equal(red.hp, GAME.playerHp - 5);
  assert.equal(blue.hp, GAME.playerHp);
  assert.equal(world.getPublicSession(session.id).room.damageEvents.some((event) => event.source === "final_showdown"), true);
});

function createPlayableSession(world, players = 2) {
  const session = world.createSession("Battle Events");
  for (let index = 0; index < players; index += 1) {
    const result = world.joinSession({
      sessionId: session.id,
      socketId: `socket_${index}`,
      name: `Pilot ${index + 1}`,
      pilotId: `pilot_event_${index}`
    });
    assert.equal(result.ok, true);
  }
  return session;
}
