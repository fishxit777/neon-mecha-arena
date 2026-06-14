import test from "node:test";
import assert from "node:assert/strict";
import { assetBundleToText, buildAssetBundle } from "../src/assets.js";
import { buildClientReport, buildRoundSummary, buildSocialPosts } from "../src/copy-generator.js";
import { GameWorld } from "../src/game.js";

test("asset bundle generates victory card, MVP list, summary, scripts, social posts, and report HTML", () => {
  let now = 1_000;
  const world = new GameWorld(() => now);
  const session = world.createSession("Assets");
  world.joinSession({ sessionId: session.id, socketId: "red", name: "Red Asset", pilotId: "pilot_asset_red" });
  world.joinSession({ sessionId: session.id, socketId: "blue", name: "Blue Asset", pilotId: "pilot_asset_blue" });
  world.startRound(session.id);

  const room = world.getSession(session.id).room;
  const red = [...room.players.values()].find((player) => player.team === "red");
  const blue = [...room.players.values()].find((player) => player.team === "blue");
  red.roundStats.hits = 3;
  red.roundStats.damageDealt = 100;
  blue.hp = 0;
  blue.alive = false;
  now += 6_000;
  world.tick(now);

  const exportData = world.getSessionExport(session.id);
  const bundle = buildAssetBundle(exportData);

  assert.equal(bundle.mvpList.some((mvp) => mvp.name === "Red Asset"), true);
  assert.match(bundle.roundSummary, /Round 1/);
  assert.match(bundle.nextRoundScript, /下一局/);
  assert.equal(bundle.socialPosts.length, 3);
  assert.match(bundle.victoryCard.svg, /<svg/);
  assert.match(bundle.victoryCard.svg, /RED WINS/);
  assert.match(bundle.clientReportHtml, /活動報告/);
  assert.match(assetBundleToText(bundle), /社群文案/);
});

test("copy generator returns fallback copy before any round finishes", () => {
  const world = new GameWorld(() => 1_000);
  const session = world.createSession("No Round Yet");
  const exportData = world.getSessionExport(session.id);

  assert.match(buildRoundSummary(exportData), /尚未完成任何回合/);
  assert.equal(buildSocialPosts(exportData).length, 3);
  assert.equal(buildClientReport(exportData).totals.rounds, 0);
});
