import test from "node:test";
import assert from "node:assert/strict";
import { GAME, GameWorld } from "../src/game.js";

test("pilot id is stable and returning pilots are detected", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Pilots");
  const pilotId = "pilot_returning_0001";

  const first = world.joinSession({ sessionId: session.id, socketId: "s1", name: "Bao", pilotId });
  world.disconnect("s1");
  now += 10;
  const second = world.joinSession({ sessionId: session.id, socketId: "s2", name: "Bao", pilotId });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const player = world.getPublicSession(session.id).room.players[0];
  assert.equal(player.pilotId, pilotId);
  assert.equal(player.returningPilot, true);
});

test("round start counts sorties and projectile hit records pilot stats", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Hits");
  const p1 = world.joinSession({ sessionId: session.id, socketId: "s1", name: "Red", pilotId: "pilot_red_000001" });
  world.joinSession({ sessionId: session.id, socketId: "s2", name: "Blue", pilotId: "pilot_blue_000001" });
  world.startRound(session.id);

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

  assert.equal(red.roundStats.shots, 1);
  assert.equal(red.roundStats.hits, 1);
  assert.equal(red.roundStats.damageDealt, GAME.projectileDamage);
  assert.equal(world.store.get("pilots", red.pilotId).sortieCount, 1);
});

test("round finish creates MVP, wins, survival, streak, title, appearance, and leaderboard", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("MVP");
  const redJoin = world.joinSession({ sessionId: session.id, socketId: "s1", name: "Red Ace", pilotId: "pilot_red_000002" });
  world.joinSession({ sessionId: session.id, socketId: "s2", name: "Blue", pilotId: "pilot_blue_000002" });
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const red = room.players.get(redJoin.playerId);
  const blue = [...room.players.values()].find((player) => player.team === "blue");
  red.roundStats.hits = 3;
  red.roundStats.damageDealt = 100;
  red.roundStats.eliminations = 1;
  blue.hp = 0;
  blue.alive = false;
  blue.roundStats.knockedOutAt = now + 5_000;
  now += 6_000;
  world.tick(now);

  const publicSession = world.getPublicSession(session.id);
  const redProfile = world.store.get("pilots", red.pilotId);

  assert.equal(publicSession.room.status, "finished");
  assert.equal(publicSession.room.roundSummary.mvp.pilotId, red.pilotId);
  assert.equal(redProfile.wins, 1);
  assert.equal(redProfile.mvpCount, 1);
  assert.equal(redProfile.winStreak, 1);
  assert.equal(redProfile.survivalSeconds >= 6, true);
  assert.equal(redProfile.titles.includes("MVP Core"), true);
  assert.equal(redProfile.appearance.variant, "mvp");
  assert.equal(publicSession.pilots.leaderboard[0].id, red.pilotId);
});

test("session leaderboard only includes pilots from the selected session", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const main = world.createSession("Main");
  const qa = world.createSession("QA");

  const mainRed = world.joinSession({ sessionId: main.id, socketId: "main-red", name: "Main Red", pilotId: "pilot_main_red001" });
  world.joinSession({ sessionId: main.id, socketId: "main-blue", name: "Main Blue", pilotId: "pilot_main_blue01" });

  const qaRed = world.joinSession({ sessionId: qa.id, socketId: "qa-red", name: "QA Red", pilotId: "pilot_qa_red00001" });
  world.joinSession({ sessionId: qa.id, socketId: "qa-blue", name: "QA Blue", pilotId: "pilot_qa_blue0001" });
  world.startRound(qa.id);

  const qaRoom = world.getSession(qa.id).room;
  const qaWinner = qaRoom.players.get(qaRed.playerId);
  const qaLoser = [...qaRoom.players.values()].find((player) => player.id !== qaWinner.id);
  qaWinner.roundStats.hits = 8;
  qaWinner.roundStats.damageDealt = 300;
  qaLoser.hp = 0;
  qaLoser.alive = false;
  now += 2_000;
  world.tick(now);

  const publicMain = world.getPublicSession(main.id);
  const leaderboardIds = publicMain.pilots.leaderboard.map((pilot) => pilot.id);

  assert.equal(leaderboardIds.includes(mainRed.session.room.players[0].pilotId), true);
  assert.equal(leaderboardIds.some((id) => id.startsWith("pilot_qa_")), false);
  assert.equal(publicMain.pilots.totalPilots, 2);
  assert.equal(publicMain.pilots.globalTotalPilots, 4);
});
