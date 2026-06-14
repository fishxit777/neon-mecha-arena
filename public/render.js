export function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(320, Math.round(rect.width * ratio));
  const height = Math.max(240, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
}

export function renderGame(canvas, state, options = {}) {
  const ctx = canvas.getContext("2d");
  const size = fitCanvas(canvas);
  const room = state?.room;
  const arena = state?.arena || { width: 1280, height: 720 };
  const compact = size.width < 900;
  const topHudHeight = compact ? 138 : 122;
  const focusPlayer = room?.players?.find((player) => player.id === options.focusPlayerId) || null;
  const view = computeView(size, arena, options.padding ?? (compact ? 8 : 34), topHudHeight, options.fit, focusPlayer);

  ctx.clearRect(0, 0, size.width, size.height);
  drawBackdrop(ctx, size);
  drawArena(ctx, view, arena);

  if (!room) {
    drawCentered(ctx, size, "NO SESSION", "Waiting for live room data", 0.5);
    return;
  }

  drawBattleEvents(ctx, view, arena, room.battleEvents);
  drawProjectiles(ctx, view, room.projectiles || []);
  drawPlayers(ctx, view, room.players || [], options.focusPlayerId);
  drawDamageEvents(ctx, view, room.damageEvents || []);
  drawHud(ctx, size, room, options, topHudHeight);

  if (options.showQr && options.qrImage?.complete) {
    drawQr(ctx, size, options.qrImage, options.playerUrl);
  }

  if (room.status !== "playing") {
    if (room.status === "finished") {
      drawVictoryOverlay(ctx, size, room);
    } else {
      drawCentered(ctx, size, "等待開局", "掃描 QR code 加入遊戲", 0.66);
    }
  }

  drawDirectorSignal(ctx, size, room.director, topHudHeight);
  drawBattleEventSignal(ctx, size, room.battleEvents);
}

function computeView(size, arena, padding, topHudHeight = 0, fit = "contain", focus = null) {
  const availableW = size.width - padding * 2;
  const availableH = size.height - topHudHeight - padding * 2;
  const scale = fit === "cover" ? Math.max(availableW / arena.width, availableH / arena.height) : Math.min(availableW / arena.width, availableH / arena.height);
  const width = arena.width * scale;
  const height = arena.height * scale;
  const centeredX = (size.width - width) / 2;
  const centeredY = topHudHeight + Math.max(padding, (availableH - height) / 2);
  if (fit === "cover" && focus) {
    const focusX = size.width / 2 - focus.x * scale;
    const focusY = topHudHeight + availableH * 0.52 - focus.y * scale;
    return {
      x: clamp(focusX, size.width - padding - width, padding),
      y: clamp(focusY, topHudHeight + availableH - height - padding, topHudHeight + padding),
      width,
      height,
      scale
    };
  }
  return {
    x: centeredX,
    y: centeredY,
    width,
    height,
    scale
  };
}

function toScreen(view, point) {
  return {
    x: view.x + point.x * view.scale,
    y: view.y + point.y * view.scale
  };
}

function drawBackdrop(ctx, size) {
  const gradient = ctx.createLinearGradient(0, 0, size.width, size.height);
  gradient.addColorStop(0, "#0A0C10");
  gradient.addColorStop(0.48, "#07101B");
  gradient.addColorStop(1, "#02060D");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = "#00F5FF";
  ctx.lineWidth = 1;
  for (let y = 0; y < size.height; y += 42) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(size.width, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawArena(ctx, view, arena) {
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);

  ctx.fillStyle = "#050914";
  ctx.fillRect(0, 0, arena.width, arena.height);

  const gridGlow = ctx.createLinearGradient(0, 0, arena.width, arena.height);
  gridGlow.addColorStop(0, "rgba(0, 128, 255, 0.18)");
  gridGlow.addColorStop(0.5, "rgba(0, 245, 255, 0.08)");
  gridGlow.addColorStop(1, "rgba(255, 34, 68, 0.10)");
  ctx.fillStyle = gridGlow;
  ctx.fillRect(0, 0, arena.width, arena.height);

  ctx.strokeStyle = "rgba(27, 46, 78, 0.76)";
  ctx.lineWidth = 2 / view.scale;
  for (let x = 80; x < arena.width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, arena.height);
    ctx.stroke();
  }
  for (let y = 80; y < arena.height; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(arena.width, y);
    ctx.stroke();
  }

  const scanY = ((Date.now() / 22) % arena.height) | 0;
  const scan = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 60);
  scan.addColorStop(0, "rgba(0,245,255,0)");
  scan.addColorStop(0.5, "rgba(0,245,255,0.08)");
  scan.addColorStop(1, "rgba(0,245,255,0)");
  ctx.fillStyle = scan;
  ctx.fillRect(0, scanY - 60, arena.width, 120);

  ctx.fillStyle = "rgba(57,255,20,0.08)";
  ctx.fillRect(arena.width / 2 - 10, 0, 20, arena.height);
  ctx.strokeStyle = "rgba(0,245,255,0.28)";
  ctx.lineWidth = 4 / view.scale;
  ctx.strokeRect(0, 0, arena.width, arena.height);
  ctx.restore();
}

function drawPlayers(ctx, view, players, focusPlayerId = null) {
  for (const player of players) {
    const pos = toScreen(view, player);
    const visualScale = Math.max(view.scale, 0.54);
    const radius = 43 * visualScale;
    const appearance = player.appearance || {};
    const focused = player.id === focusPlayerId;

    ctx.save();
    ctx.globalAlpha = player.alive ? 1 : 0.36;
    drawMechaUnit(ctx, pos, player, appearance, visualScale);
    drawShield(ctx, pos, player, radius, visualScale);
    if (focused) drawFocusMarker(ctx, pos, player, radius, visualScale);
    drawLifePips(ctx, pos.x, pos.y + radius + 4 * visualScale, player, visualScale);
    drawPilotCard(ctx, pos, player, radius, appearance, visualScale, focused);
    drawNameplate(ctx, pos, player, radius, appearance, visualScale);
    ctx.restore();
  }
}

function drawFocusMarker(ctx, pos, player, radius, scale) {
  const color = player.team === "red" ? "#FF8899" : "#72C5FF";
  const y = pos.y - radius - 36 * scale;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14 * scale;
  ctx.beginPath();
  ctx.moveTo(pos.x - 28 * scale, y - 7 * scale);
  ctx.lineTo(pos.x - 14 * scale, y);
  ctx.lineTo(pos.x - 28 * scale, y + 7 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.font = `900 ${Math.max(11, Math.round(15 * scale))}px "Orbitron", "Microsoft JhengHei", sans-serif`;
  ctx.fillText("YOU", pos.x - 10 * scale, y + 1 * scale);
  ctx.restore();
}

function drawShield(ctx, pos, player, radius, scale) {
  if (player.shieldHp <= 0) return;
  const shieldRatio = Math.max(0.2, Math.min(1, player.shieldHp / 60));
  ctx.save();
  ctx.shadowColor = "#00F5FF";
  ctx.shadowBlur = 20;
  ctx.strokeStyle = `rgba(0,245,255,${0.28 + shieldRatio * 0.38})`;
  ctx.lineWidth = Math.max(2, 4 * scale);
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius + 12 * scale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * shieldRatio);
  ctx.stroke();
  ctx.restore();
}

function drawLifePips(ctx, x, y, player, scale) {
  const maxLives = player.maxLives || 2;
  const lives = player.lives ?? maxLives;
  const pipW = 20 * scale;
  const pipH = 7 * scale;
  const gap = 5 * scale;
  const totalW = maxLives * pipW + (maxLives - 1) * gap;
  ctx.save();
  for (let index = 0; index < maxLives; index += 1) {
    const left = x - totalW / 2 + index * (pipW + gap);
    ctx.fillStyle = index < lives ? "#39FF14" : "#1B2E4E";
    ctx.shadowColor = index < lives ? "#39FF14" : "transparent";
    ctx.shadowBlur = index < lives ? 10 : 0;
    ctx.beginPath();
    ctx.moveTo(left + 4 * scale, y);
    ctx.lineTo(left + pipW, y);
    ctx.lineTo(left + pipW - 4 * scale, y + pipH);
    ctx.lineTo(left, y + pipH);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawNameplate(ctx, pos, player, radius, appearance, scale) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `${Math.max(10, Math.round(15 * scale))}px "Share Tech Mono", Consolas, monospace`;
  ctx.fillStyle = player.team === "red" ? "#FF8899" : "#72C5FF";
  ctx.shadowColor = player.team === "red" ? "#FF2244" : "#0080FF";
  ctx.shadowBlur = 7;
  ctx.fillText(player.name, pos.x, pos.y + radius + 18 * scale);
  if (player.titles?.[0] && player.titles[0] !== "Rookie") {
    ctx.font = `${Math.max(8, Math.round(10 * scale))}px "Share Tech Mono", Consolas, monospace`;
    ctx.fillStyle = appearance.trail || "#C8D8E8";
    ctx.fillText(player.titles[0], pos.x, pos.y + radius + 34 * scale);
  }
  ctx.restore();
}

function drawPilotCard(ctx, pos, player, radius, appearance, scale, focused) {
  if (scale < 0.58) return;
  const color = player.team === "red" ? "#FF2244" : "#0080FF";
  const secondary = player.team === "red" ? "#FFB0B8" : "#9DEBFF";
  const unit = Math.max(0.72, Math.min(1.08, scale));
  const width = (focused ? 176 : 142) * unit;
  const height = (focused ? 47 : 40) * unit;
  const x = pos.x - width / 2;
  const y = pos.y - radius - height - 14 * unit;
  const title = player.titles?.[0] || "Rookie";
  const hpRatio = Math.max(0, Math.min(1, (player.hp || 0) / 100));

  ctx.save();
  ctx.globalAlpha *= player.alive ? 0.98 : 0.55;
  ctx.fillStyle = "rgba(5, 9, 20, 0.72)";
  ctx.strokeStyle = focused ? secondary : "rgba(74, 96, 128, 0.7)";
  ctx.lineWidth = focused ? 2 : 1;
  ctx.shadowColor = focused ? secondary : "transparent";
  ctx.shadowBlur = focused ? 14 * unit : 0;
  roundRect(ctx, x, y, width, height, 3 * unit);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 4 * unit, height);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(x + 4 * unit, y, width - 8 * unit, 1 * unit);

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#F8FBFF";
  ctx.font = `900 ${Math.max(10, Math.round(12 * unit))}px "Orbitron", "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`PILOT ${player.name}`, x + 12 * unit, y + 7 * unit);

  ctx.fillStyle = secondary;
  ctx.font = `700 ${Math.max(8, Math.round(9 * unit))}px "Share Tech Mono", Consolas, monospace`;
  ctx.fillText(title.toUpperCase(), x + 12 * unit, y + 24 * unit);

  const barX = x + width - 58 * unit;
  const barY = y + 13 * unit;
  ctx.fillStyle = "rgba(17,29,53,0.94)";
  roundRect(ctx, barX, barY, 45 * unit, 6 * unit, 2 * unit);
  ctx.fill();
  ctx.fillStyle = hpRatio > 0.35 ? "#39FF14" : "#FFB700";
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 8 * unit;
  roundRect(ctx, barX, barY, 45 * unit * hpRatio, 6 * unit, 2 * unit);
  ctx.fill();
  ctx.shadowBlur = 0;

  if (player.shieldHp > 0) {
    ctx.strokeStyle = "#00F5FF";
    ctx.lineWidth = 1.5 * unit;
    ctx.beginPath();
    ctx.arc(x + width - 20 * unit, y + 27 * unit, 9 * unit, -Math.PI / 2, Math.PI * 1.2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMechaUnit(ctx, pos, player, appearance, visualScale) {
  const palette = mechaPalette(player, appearance);
  const scale = visualScale;
  const facingX = Math.abs(player.facingX || 0) > 0.1 ? Math.sign(player.facingX) : player.team === "red" ? 1 : -1;
  const pulse = 0.72 + Math.sin(Date.now() / 170 + pos.x * 0.01) * 0.22;
  const broken = player.broken || (player.lives ?? 2) <= 1;
  const breakPulse = Math.max(0, player.breakAnim || 0) / 60;

  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.scale(facingX, 1);

  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 18 + 24 * breakPulse;
  ctx.fillStyle = "rgba(0,0,0,0.48)";
  ctx.beginPath();
  ctx.ellipse(0, 42 * scale, 42 * scale, 11 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  if (Math.abs(player.facingX || 0) + Math.abs(player.facingY || 0) > 0.2) {
    drawThrusterTrail(ctx, scale, palette);
  }

  drawMechaLimb(ctx, -17, 20, -31, 50, scale, palette.armor, palette.hull);
  drawMechaLimb(ctx, 17, 20, 31, 50, scale, palette.armor, palette.hull);

  ctx.fillStyle = palette.hull;
  ctx.strokeStyle = palette.armor;
  ctx.lineWidth = Math.max(2, 3 * scale);
  roundRect(ctx, -24 * scale, -30 * scale, 48 * scale, 58 * scale, 5 * scale);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = broken ? "rgba(255,136,0,0.28)" : "rgba(255,255,255,0.08)";
  roundRect(ctx, -18 * scale, -20 * scale, 36 * scale, 10 * scale, 3 * scale);
  ctx.fill();

  ctx.fillStyle = palette.bright;
  ctx.shadowColor = palette.bright;
  ctx.shadowBlur = 18 + 15 * pulse;
  ctx.beginPath();
  ctx.moveTo(0, -13 * scale);
  ctx.lineTo(13 * scale, 6 * scale);
  ctx.lineTo(0, 22 * scale);
  ctx.lineTo(-13 * scale, 6 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = palette.hull;
  ctx.strokeStyle = broken ? "#FF8800" : palette.armor;
  roundRect(ctx, -18 * scale, -54 * scale, 36 * scale, 24 * scale, 4 * scale);
  ctx.fill();
  ctx.stroke();

  const scan = (Date.now() / 8) % (28 * scale);
  ctx.fillStyle = palette.accent;
  roundRect(ctx, -12 * scale, -45 * scale, 24 * scale, 5 * scale, 2 * scale);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect((-12 * scale) + scan - 3 * scale, -45 * scale, 3 * scale, 5 * scale);

  drawArmorPlate(ctx, -52, -27, -22, -7, scale, broken ? "#FF8800" : palette.armor);
  drawArmorPlate(ctx, 22, -27, 52, -7, scale, broken ? "#FF8800" : palette.armor);
  drawMechaArm(ctx, -53, -2, scale, palette.armor, palette.stripe);
  drawMechaCannon(ctx, 34, -6, scale, palette.armor, palette.stripe);

  if (broken) {
    drawBrokenStripes(ctx, scale, palette);
  }
  if (player.breakAnim > 0) {
    drawArmourBreakSparks(ctx, scale, palette, player.breakAnim);
  }

  ctx.restore();
}

function mechaPalette(player, appearance = {}) {
  if (player.team === "red") {
    return {
      hull: "#1A0005",
      armor: appearance.frame || "#CC1030",
      bright: appearance.core || "#FF2244",
      accent: "#FF8800",
      stripe: "#FF4400",
      glow: appearance.trail || "#FF2244"
    };
  }
  return {
    hull: "#00091C",
    armor: appearance.frame || "#0055CC",
    bright: appearance.core || "#0088FF",
    accent: "#00DDFF",
    stripe: "#00AAFF",
    glow: appearance.trail || "#0066FF"
  };
}

function drawThrusterTrail(ctx, scale, palette) {
  ctx.save();
  ctx.globalAlpha *= 0.78;
  ctx.fillStyle = palette.accent;
  ctx.shadowColor = palette.accent;
  ctx.shadowBlur = 16 * scale;
  for (const x of [-22, 22]) {
    ctx.beginPath();
    ctx.moveTo(x * scale, 27 * scale);
    ctx.lineTo((x - 7) * scale, 55 * scale);
    ctx.lineTo((x + 8) * scale, 44 * scale);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawBrokenStripes(ctx, scale, palette) {
  ctx.save();
  ctx.strokeStyle = "#FF8800";
  ctx.lineWidth = Math.max(1, 2 * scale);
  ctx.shadowColor = "#FF8800";
  ctx.shadowBlur = 9 * scale;
  ctx.beginPath();
  ctx.moveTo(-15 * scale, -9 * scale);
  ctx.lineTo(14 * scale, 18 * scale);
  ctx.moveTo(-10 * scale, 18 * scale);
  ctx.lineTo(17 * scale, -8 * scale);
  ctx.stroke();
  ctx.fillStyle = palette.stripe;
  ctx.fillRect(-5 * scale, -56 * scale, 10 * scale, 4 * scale);
  ctx.restore();
}

function drawArmourBreakSparks(ctx, scale, palette, framesLeft) {
  ctx.save();
  const ratio = framesLeft / 60;
  ctx.globalAlpha *= Math.min(1, ratio * 1.4);
  for (let index = 0; index < 12; index += 1) {
    const angle = index * 0.9 + Date.now() / 120;
    const distance = (28 + (60 - framesLeft) * 0.7 + (index % 3) * 9) * scale;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance * 0.72;
    ctx.fillStyle = index % 2 ? "#FF8800" : palette.bright;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10 * scale;
    ctx.fillRect(x, y, 4 * scale, 4 * scale);
  }
  ctx.restore();
}

function drawMechaBooster(ctx, x, y, scale, trail, pulse) {
  ctx.save();
  ctx.globalAlpha *= 0.55 + pulse * 0.25;
  ctx.fillStyle = trail;
  ctx.shadowColor = trail;
  ctx.shadowBlur = 14 * scale;
  ctx.beginPath();
  ctx.moveTo(x * scale, y * scale);
  ctx.lineTo((x - 9) * scale, (y + 27) * scale);
  ctx.lineTo((x + 9) * scale, (y + 27) * scale);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawArmorPlate(ctx, x1, y1, x2, y2, scale, accent) {
  ctx.fillStyle = "#111D35";
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  ctx.beginPath();
  ctx.moveTo(x1 * scale, y1 * scale);
  ctx.lineTo(x2 * scale, (y1 + 3) * scale);
  ctx.lineTo((x2 - 4) * scale, y2 * scale);
  ctx.lineTo((x1 + 5) * scale, (y2 + 5) * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawMechaLimb(ctx, hipX, hipY, footX, footY, scale, frame, fill) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = frame;
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  ctx.beginPath();
  ctx.moveTo((hipX - 7) * scale, hipY * scale);
  ctx.lineTo((hipX + 7) * scale, hipY * scale);
  ctx.lineTo((footX + 8) * scale, footY * scale);
  ctx.lineTo((footX - 10) * scale, footY * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawMechaArm(ctx, x, y, scale, accent, frame) {
  ctx.fillStyle = "#0D1525";
  ctx.strokeStyle = frame;
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  roundRect(ctx, x * scale, y * scale, 16 * scale, 30 * scale, 4 * scale);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = accent;
  roundRect(ctx, (x + 4) * scale, (y + 22) * scale, 8 * scale, 7 * scale, 2 * scale);
  ctx.fill();
}

function drawMechaCannon(ctx, x, y, scale, accent, frame) {
  ctx.fillStyle = "#0D1525";
  ctx.strokeStyle = frame;
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  roundRect(ctx, x * scale, y * scale, 18 * scale, 26 * scale, 4 * scale);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = accent;
  roundRect(ctx, (x + 13) * scale, (y + 6) * scale, 18 * scale, 7 * scale, 2 * scale);
  ctx.fill();
  roundRect(ctx, (x + 13) * scale, (y + 17) * scale, 18 * scale, 7 * scale, 2 * scale);
  ctx.fill();
}

function drawBattleEvents(ctx, view, arena, battleEvents) {
  const active = battleEvents?.active || [];
  if (!active.length) return;
  const types = new Set(active.map((event) => event.type));
  const finalShowdown = active.find((event) => event.type === "final_showdown");
  const now = Date.now();
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  if (types.has("energy_storm")) drawEnergyStorm(ctx, arena, view.scale, now);
  if (finalShowdown) drawFinalShowdownZone(ctx, arena, view.scale, now, finalShowdown);
  if (types.has("orbital_strike")) drawOrbitalStrike(ctx, arena, view.scale, now);
  if (types.has("overload")) drawOverloadField(ctx, arena, view.scale, now);
  if (types.has("shield_boost")) drawShieldBoostField(ctx, arena, view.scale, now);
  if (types.has("supply_drop")) drawSupplyDropBeacons(ctx, arena, view.scale, now);
  ctx.restore();
}

function drawEnergyStorm(ctx, arena, scale, now) {
  const cx = arena.width / 2;
  const cy = arena.height / 2;
  const radius = Math.min(arena.width, arena.height) * 0.38;
  ctx.save();
  ctx.fillStyle = "rgba(255, 34, 68, 0.18)";
  ctx.fillRect(0, 0, arena.width, arena.height);
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  const pulse = Math.sin(now / 140) * 10;
  ctx.strokeStyle = "rgba(255, 183, 0, 0.92)";
  ctx.shadowColor = "#FFB700";
  ctx.shadowBlur = 18 / scale;
  ctx.lineWidth = 5 / scale;
  ctx.setLineDash([18 / scale, 10 / scale]);
  ctx.beginPath();
  ctx.arc(cx, cy, radius + pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "rgba(255, 34, 68, 0.35)";
  ctx.lineWidth = 2 / scale;
  for (let index = 0; index < 9; index += 1) {
    const angle = now / 900 + index * 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 34 + index * 18, angle, angle + 0.34);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOverloadField(ctx, arena, scale, now) {
  ctx.save();
  const flash = 0.34 + Math.sin(now / 100) * 0.16;
  ctx.fillStyle = `rgba(255, 183, 0, ${Math.max(0.04, flash * 0.08)})`;
  ctx.fillRect(0, 0, arena.width, arena.height);
  ctx.strokeStyle = "rgba(255, 183, 0, 0.58)";
  ctx.shadowColor = "#FFB700";
  ctx.shadowBlur = 18 / scale;
  ctx.lineWidth = 3 / scale;
  for (let index = 0; index < 7; index += 1) {
    const x = 80 + index * 180 + Math.sin(now / 220 + index) * 12;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 90, 150);
    ctx.lineTo(x + 30, 290);
    ctx.lineTo(x + 120, arena.height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFinalShowdownZone(ctx, arena, scale, now, event) {
  ctx.save();
  const centerX = arena.width / 2;
  const centerY = arena.height / 2;
  const duration = Math.max(1, (event.expiresAt || now + 1) - (event.startedAt || now));
  const progress = Math.max(0, Math.min(1, (now - (event.startedAt || now)) / duration));
  const safeRadius = Math.min(arena.width, arena.height) * (0.44 - progress * 0.2);
  ctx.fillStyle = "rgba(255, 40, 60, 0.24)";
  ctx.fillRect(0, 0, arena.width, arena.height);
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(centerX, centerY, safeRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  const pulse = Math.sin(now / 130) * 9;
  ctx.strokeStyle = "rgba(255,183,0,0.7)";
  ctx.lineWidth = 2 / scale;
  ctx.setLineDash([18 / scale, 10 / scale]);
  ctx.beginPath();
  ctx.arc(centerX, centerY, safeRadius + pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  ctx.arc(centerX, centerY, safeRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawOrbitalStrike(ctx, arena, scale, now) {
  ctx.save();
  const cx = arena.width / 2;
  const beamWidth = 110 + Math.sin(now / 120) * 22;
  const gradient = ctx.createLinearGradient(cx - beamWidth, 0, cx + beamWidth, 0);
  gradient.addColorStop(0, "rgba(0,245,255,0)");
  gradient.addColorStop(0.35, "rgba(0,245,255,0.2)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.35)");
  gradient.addColorStop(0.65, "rgba(255,183,0,0.22)");
  gradient.addColorStop(1, "rgba(255,183,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(cx - beamWidth, 0, beamWidth * 2, arena.height);

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.shadowColor = "#00F5FF";
  ctx.shadowBlur = 24 / scale;
  ctx.lineWidth = 3 / scale;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, arena.height);
  ctx.stroke();

  ctx.strokeStyle = "rgba(0,245,255,0.42)";
  ctx.lineWidth = 2 / scale;
  for (let y = -120 + (now / 7) % 180; y < arena.height + 180; y += 180) {
    ctx.beginPath();
    ctx.arc(cx, y, 48, 0, Math.PI * 2);
    ctx.moveTo(cx - 72, y);
    ctx.lineTo(cx + 72, y);
    ctx.moveTo(cx, y - 72);
    ctx.lineTo(cx, y + 72);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShieldBoostField(ctx, arena, scale, now) {
  ctx.save();
  const wave = (now / 16) % arena.height;
  ctx.strokeStyle = "rgba(57,255,20,0.32)";
  ctx.shadowColor = "#39FF14";
  ctx.shadowBlur = 18 / scale;
  ctx.lineWidth = 3 / scale;
  for (let index = 0; index < 6; index += 1) {
    const y = (wave + index * 170) % arena.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(arena.width / 2, y - 45, arena.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSupplyDropBeacons(ctx, arena, scale, now) {
  ctx.save();
  const points = [
    [arena.width * 0.28, arena.height * 0.68],
    [arena.width * 0.5, arena.height * 0.34],
    [arena.width * 0.74, arena.height * 0.62]
  ];
  ctx.strokeStyle = "rgba(0,245,255,0.5)";
  ctx.fillStyle = "rgba(0,245,255,0.22)";
  ctx.shadowColor = "#00F5FF";
  ctx.shadowBlur = 16 / scale;
  for (const [x, y] of points) {
    const r = 22 + Math.sin(now / 180 + x) * 6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 34, y);
    ctx.lineTo(x + 34, y);
    ctx.moveTo(x, y - 34);
    ctx.lineTo(x, y + 34);
    ctx.stroke();
  }
  ctx.restore();
}

function drawProjectiles(ctx, view, projectiles) {
  for (const projectile of projectiles) {
    const pos = toScreen(view, projectile);
    const color = projectile.team === "red" ? "#FFB0B8" : "#9DEBFF";
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, Math.max(4, 7 * view.scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawDamageEvents(ctx, view, damageEvents) {
  const now = Date.now();
  for (const event of damageEvents) {
    const createdAt = event.createdAt || now;
    const age = Math.max(0, now - createdAt);
    if (age > 1800) continue;
    const progress = age / 1800;
    const pos = toScreen(view, event);
    const floatY = pos.y - (32 + progress * 46) * Math.max(0.75, view.scale);
    const amount = Math.max(1, Math.round(event.amount || 0));
    const isHazard = ["energy_storm", "orbital_strike", "final_showdown"].includes(event.source);
    const color = isHazard ? "#FFB700" : "#FFEA70";
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - progress);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.max(18, 26 * view.scale)}px "Orbitron", "Microsoft JhengHei", sans-serif`;
    ctx.lineWidth = Math.max(3, 4 * view.scale);
    ctx.strokeStyle = "rgba(4, 7, 14, 0.95)";
    ctx.shadowColor = color;
    ctx.shadowBlur = isHazard ? 18 : 12;
    ctx.strokeText(`-${amount}`, pos.x, floatY);
    ctx.fillStyle = color;
    ctx.fillText(`-${amount}`, pos.x, floatY);
    ctx.restore();
  }
}

function drawHud(ctx, size, room, options, topHudHeight) {
  const players = room.players || [];
  const red = teamSummary(players, "red");
  const blue = teamSummary(players, "blue");
  const secondsLeft = room.roundEndsAt ? Math.max(0, Math.ceil((room.roundEndsAt - Date.now()) / 1000)) : 0;
  const compact = size.width < 900;
  const pad = compact ? 22 : 34;
  const mid = size.width / 2;
  const barY = compact ? 78 : 74;
  const barH = compact ? 9 : 12;
  const teamW = Math.max(110, (size.width - pad * 2 - 24) / 2);

  ctx.save();
  ctx.fillStyle = "rgba(7, 11, 20, 0.96)";
  ctx.fillRect(0, 0, size.width, topHudHeight);
  ctx.strokeStyle = "rgba(27, 46, 78, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, topHudHeight - 2);
  ctx.lineTo(size.width, topHudHeight - 2);
  ctx.stroke();

  ctx.font = `${compact ? 16 : 22}px "Orbitron", "Microsoft JhengHei", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#00F5FF";
  ctx.shadowColor = "#00F5FF";
  ctx.shadowBlur = 12;
  ctx.fillText("NMA", pad, 34);

  ctx.shadowBlur = 0;
  ctx.textAlign = "center";
  ctx.fillStyle = "#F8FBFF";
  ctx.font = `900 ${compact ? 22 : 32}px "Orbitron", "Microsoft JhengHei", sans-serif`;
  ctx.fillText(`ROUND ${room.round || 0}`, mid, 34);

  ctx.textAlign = "right";
  ctx.fillStyle = "#FFB700";
  ctx.font = `${compact ? 19 : 26}px "Share Tech Mono", Consolas, monospace`;
  ctx.fillText(formatClock(secondsLeft), size.width - pad, 34);

  drawTeamBar(ctx, pad, barY, teamW, barH, "RED", red, "#FF2244", "left", compact);
  drawTeamBar(ctx, size.width - pad - teamW, barY, teamW, barH, "BLUE", blue, "#0080FF", "right", compact);

  ctx.strokeStyle = "rgba(27, 46, 78, 0.95)";
  ctx.beginPath();
  ctx.moveTo(mid, 52);
  ctx.lineTo(mid, topHudHeight - 2);
  ctx.stroke();

  if (room.notice && room.status === "playing") {
    ctx.textAlign = "center";
    ctx.fillStyle = room.notice === "ARMOUR BREAK" ? "#FF8800" : "#4A6080";
    ctx.font = `${compact ? 12 : 14}px "Share Tech Mono", Consolas, monospace`;
    ctx.fillText(room.notice, mid, topHudHeight - 18);
  }

  ctx.restore();
}

function drawTeamBar(ctx, x, y, width, height, label, summary, color, align, compact = false) {
  const ratio = summary.max > 0 ? Math.max(0, Math.min(1, summary.power / summary.max)) : 0;
  const narrow = compact || width < 220;
  const anchor = align === "left" ? x : x + width;
  const teamLabel = align === "left" ? `▲ ${label}` : `${label} ▲`;
  const outerMetricX = align === "left" ? x : x + width;
  const innerMetricX = narrow
    ? align === "left" ? x + width * 0.72 : x + width * 0.28
    : align === "left" ? x + width : x;
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(5, 9, 20, 0.76)";
  ctx.strokeStyle = "rgba(27, 46, 78, 0.92)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, x - 8, y - 32, width + 16, 78, 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = `900 ${narrow ? 17 : 19}px "Orbitron", "Microsoft JhengHei", sans-serif`;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillText(teamLabel, anchor, y - 21);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#4A6080";
  ctx.font = `${narrow ? 12 : 13}px "Share Tech Mono", Consolas, monospace`;
  if (narrow) {
    ctx.textAlign = "left";
    ctx.fillText(align === "left" ? `${summary.alive}/${summary.total || 0}` : `${summary.power}`, x, y + 31);
    ctx.textAlign = "right";
    ctx.fillText(align === "left" ? `${summary.power}` : `${summary.alive}/${summary.total || 0}`, x + width, y + 31);
  } else {
    ctx.fillText(`${summary.alive}/${summary.total || 0} ONLINE`, outerMetricX, y + 31);
    ctx.fillText(`${summary.lives}/${summary.maxLives} ARMOR`, innerMetricX, y + 31);
  }

  ctx.fillStyle = "rgba(17, 29, 53, 0.96)";
  roundRect(ctx, x, y, width, height, 1.5);
  ctx.fill();

  for (let index = 0; index < 10; index += 1) {
    const segX = x + (width / 10) * index;
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(segX + 2, y + 1, Math.max(0, width / 10 - 4), height - 2);
  }

  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  const fillX = align === "left" ? x : x + width - width * ratio;
  roundRect(ctx, fillX, y, width * ratio, height, 1.5);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);

  if (!narrow) {
    ctx.fillStyle = "#C8D8E8";
    ctx.font = `12px "Share Tech Mono", Consolas, monospace`;
    ctx.fillText(`${summary.power}`, innerMetricX, y + 17);
  }
  ctx.restore();
}

function teamSummary(players, team) {
  const list = players.filter((player) => player.team === team);
  const alive = list.filter((player) => player.alive).length;
  const maxLives = list.reduce((sum, player) => sum + (player.maxLives || 2), 0);
  const lives = list.reduce((sum, player) => sum + Math.max(0, player.lives ?? (player.alive ? 1 : 0)), 0);
  const max = Math.max(1, maxLives * 100);
  const power = list.reduce((sum, player) => {
    if (!player.alive) return sum;
    return sum + Math.max(0, player.hp || 0) + Math.max(0, (player.lives ?? 1) - 1) * 100;
  }, 0);
  return { total: list.length, alive, maxLives, lives, max, power: Math.round(power) };
}

function formatClock(seconds) {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function drawQr(ctx, size, image, playerUrl) {
  const qrSize = Math.min(170, size.width * 0.16);
  const x = size.width - qrSize - 28;
  const y = size.height - qrSize - 104;
  ctx.save();
  ctx.fillStyle = "rgba(245,248,255,0.94)";
  roundRect(ctx, x - 12, y - 12, qrSize + 24, qrSize + 78, 5);
  ctx.fill();
  ctx.drawImage(image, x, y, qrSize, qrSize);
  ctx.fillStyle = "#0A0C10";
  ctx.font = "700 14px Microsoft JhengHei, Arial";
  ctx.textAlign = "center";
  ctx.fillText("掃碼加入", x + qrSize / 2, y + qrSize + 27);
  if (playerUrl) {
    const parts = shortUrlParts(playerUrl);
    ctx.font = "10px Consolas, monospace";
    ctx.fillStyle = "#4A6080";
    ctx.fillText(parts.host, x + qrSize / 2, y + qrSize + 43);
    ctx.fillText(parts.path, x + qrSize / 2, y + qrSize + 57);
  }
  ctx.restore();
}

function drawDirectorSignal(ctx, size, director, topHudHeight = 138) {
  const signal = director?.activeSignal;
  if (!signal) return;
  if (size.width < 900) {
    drawCompactDirectorSignal(ctx, size, signal, topHudHeight);
    return;
  }
  const left = size.width < 720 ? 18 : Math.max(80, size.width * 0.22);
  const width = size.width < 720 ? size.width - 36 : Math.min(720, size.width * 0.56);
  const height = size.width < 720 ? 104 : 118;
  const y = size.width < 720 ? 156 : 144;
  const tone = toneTheme(signal.tone);
  const remaining = Math.max(0, signal.expiresAt - Date.now());
  const progress = Math.max(0, Math.min(1, remaining / Math.max(1, signal.expiresAt - signal.startedAt)));

  ctx.save();
  ctx.globalAlpha = 0.96;
  ctx.fillStyle = tone.bg;
  ctx.shadowColor = tone.glow;
  ctx.shadowBlur = 28;
  roundRect(ctx, left, y, width, height, 4);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = tone.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = tone.accent;
  roundRect(ctx, left + 14, y + 16, 8, height - 32, 2);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#F8FBFF";
  ctx.font = `${size.width < 720 ? "700 22px" : "900 30px"} "Orbitron", "Microsoft JhengHei", sans-serif`;
  ctx.fillText(signal.title, left + 38, y + 45);
  ctx.fillStyle = "#C8D8E8";
  ctx.font = `${size.width < 720 ? "14px" : "18px"} "Share Tech Mono", Consolas, monospace`;
  ctx.fillText(signal.body, left + 38, y + 76);
  ctx.textAlign = "right";
  ctx.fillStyle = tone.accent;
  ctx.font = `${size.width < 720 ? "700 12px" : "700 14px"} "Share Tech Mono", Consolas, monospace`;
  ctx.fillText(signal.source === "admin" ? "HOST" : "AI DIRECTOR", left + width - 24, y + 42);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  roundRect(ctx, left + 38, y + height - 22, width - 76, 6, 2);
  ctx.fill();
  ctx.fillStyle = tone.accent;
  roundRect(ctx, left + 38, y + height - 22, (width - 76) * progress, 6, 2);
  ctx.fill();
  ctx.restore();
}

function drawCompactDirectorSignal(ctx, size, signal, topHudHeight) {
  const tone = toneTheme(signal.tone);
  const remaining = Math.max(0, signal.expiresAt - Date.now());
  const progress = Math.max(0, Math.min(1, remaining / Math.max(1, signal.expiresAt - signal.startedAt)));
  const y = topHudHeight + 2;
  const h = 44;

  ctx.save();
  ctx.fillStyle = "rgba(7,11,20,0.86)";
  ctx.fillRect(0, y, size.width, h);
  ctx.strokeStyle = tone.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, y + h - 1);
  ctx.lineTo(size.width, y + h - 1);
  ctx.stroke();

  ctx.fillStyle = tone.accent;
  ctx.shadowColor = tone.glow;
  ctx.shadowBlur = 12;
  ctx.font = "700 15px Microsoft JhengHei, Arial";
  ctx.textAlign = "left";
  ctx.fillText(signal.title, 40, y + 20);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#C8D8E8";
  ctx.font = "12px Microsoft JhengHei, Arial";
  ctx.fillText(signal.body, 40, y + 36);

  ctx.fillStyle = tone.accent;
  ctx.font = "700 10px Share Tech Mono, Consolas, monospace";
  ctx.textAlign = "right";
  ctx.fillText(signal.source === "admin" ? "HOST" : "AI", size.width - 18, y + 20);

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(40, y + h - 7, size.width - 80, 3);
  ctx.fillStyle = tone.accent;
  ctx.fillRect(40, y + h - 7, (size.width - 80) * progress, 3);
  ctx.restore();
}

function drawBattleEventSignal(ctx, size, battleEvents) {
  const event = (battleEvents?.active || []).slice().sort((a, b) => b.priority - a.priority)[0];
  if (!event) return;
  const tone = toneTheme(event.tone === "supply" ? "assist" : event.tone);
  const w = Math.min(500, size.width - 36);
  const h = 70;
  const x = size.width < 900 ? 18 : 34;
  const y = 148;
  ctx.save();
  ctx.fillStyle = "rgba(7,11,20,0.86)";
  ctx.strokeStyle = tone.line;
  ctx.shadowColor = tone.glow;
  ctx.shadowBlur = 18;
  roundRect(ctx, x, y, w, h, 3);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = tone.accent;
  ctx.font = "700 17px Microsoft JhengHei, Arial";
  ctx.fillText(event.title, x + 18, y + 28);
  ctx.fillStyle = "#C8D8E8";
  ctx.font = "13px Microsoft JhengHei, Arial";
  ctx.fillText(event.body, x + 18, y + 52);
  ctx.restore();
}

function drawCentered(ctx, size, title, detail, yRatio = 0.5) {
  const boxW = Math.min(620, size.width - 48);
  const boxH = 150;
  const x = (size.width - boxW) / 2;
  const y = size.height * yRatio - boxH / 2;
  ctx.save();
  ctx.fillStyle = "rgba(7, 11, 20, 0.82)";
  roundRect(ctx, x, y, boxW, boxH, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,245,255,0.22)";
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#F8FBFF";
  ctx.font = "900 38px Orbitron, Microsoft JhengHei, Arial";
  ctx.fillText(title, size.width / 2, y + 58);
  ctx.font = "20px Microsoft JhengHei, Arial";
  ctx.fillStyle = "#C8D8E8";
  ctx.fillText(detail, size.width / 2, y + 100);
  ctx.restore();
}

function drawVictoryOverlay(ctx, size, room) {
  const winner = room.winnerTeam;
  const mvp = room.roundSummary?.mvp;
  const winnerColor = winner === "red" ? "#FF2244" : winner === "blue" ? "#0080FF" : "#FFB700";
  const label = winner === "red" ? "RED TEAM" : winner === "blue" ? "BLUE TEAM" : "DRAW";
  const players = room.players || [];
  const redAlive = players.filter((player) => player.team === "red" && player.alive).length;
  const blueAlive = players.filter((player) => player.team === "blue" && player.alive).length;
  const totalKills = players.reduce((sum, player) => sum + (player.roundStats?.eliminations || 0), 0);
  const totalDamage = players.reduce((sum, player) => sum + (player.roundStats?.damageDealt || 0), 0);

  ctx.save();
  const fade = ctx.createLinearGradient(0, 0, 0, size.height);
  fade.addColorStop(0, "rgba(0,0,0,0.78)");
  fade.addColorStop(0.45, "rgba(5,10,22,0.88)");
  fade.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.textAlign = "center";
  ctx.fillStyle = "#4A6080";
  ctx.font = "18px Share Tech Mono, Consolas, monospace";
  ctx.fillText(`ROUND ${room.round || 0} RESULT`, size.width / 2, size.height * 0.42);

  ctx.shadowColor = winnerColor;
  ctx.shadowBlur = 38;
  ctx.fillStyle = winnerColor;
  ctx.font = `900 ${Math.max(46, Math.min(112, size.width * 0.115))}px Orbitron, Microsoft JhengHei, Arial`;
  ctx.fillText(label, size.width / 2, size.height * 0.49);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#F8FBFF";
  ctx.font = `700 ${Math.max(24, Math.min(44, size.width * 0.045))}px Orbitron, Microsoft JhengHei, Arial`;
  ctx.fillText(winner === "draw" ? "NO CLEAR WINNER" : "VICTORY", size.width / 2, size.height * 0.55);

  ctx.strokeStyle = winnerColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size.width * 0.34, size.height * 0.58);
  ctx.lineTo(size.width * 0.66, size.height * 0.58);
  ctx.stroke();

  ctx.fillStyle = "#FFB700";
  ctx.font = "20px Share Tech Mono, Consolas, monospace";
  const mvpLine = mvp ? `★ MVP · PILOT ${mvp.name} · ${mvp.stats?.eliminations || 0} KILLS · ${mvp.stats?.damageDealt || 0} DMG` : `★ TOTAL DAMAGE · ${Math.round(totalDamage)}`;
  ctx.fillText(mvpLine, size.width / 2, size.height * 0.64);

  const cardY = size.height * 0.68;
  const cardW = Math.min(210, size.width * 0.22);
  const gap = Math.min(24, size.width * 0.025);
  drawVictoryStat(ctx, size.width / 2 - cardW - gap, cardY, cardW, "RED ALIVE", redAlive, "#FF2244");
  drawVictoryStat(ctx, size.width / 2, cardY, cardW, "TOTAL KILLS", totalKills, "#00F5FF");
  drawVictoryStat(ctx, size.width / 2 + cardW + gap, cardY, cardW, "BLUE ALIVE", blueAlive, "#0080FF");
  drawVictoryCommand(ctx, size.width / 2, Math.min(size.height - 120, cardY + 128), winnerColor, Math.min(420, size.width - 80));
  ctx.restore();
}

function drawVictoryStat(ctx, centerX, y, width, label, value, color) {
  ctx.save();
  roundRect(ctx, centerX - width / 2, y, width, 92, 2);
  ctx.fillStyle = "rgba(7,11,20,0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(27,46,78,0.96)";
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "900 32px Orbitron, Microsoft JhengHei, Arial";
  ctx.fillText(String(value), centerX, y + 38);
  ctx.fillStyle = "#4A6080";
  ctx.font = "13px Share Tech Mono, Consolas, monospace";
  ctx.fillText(label, centerX, y + 68);
  ctx.restore();
}

function drawVictoryCommand(ctx, centerX, y, color, width = 420) {
  const height = 72;
  ctx.save();
  ctx.fillStyle = "rgba(5, 9, 20, 0.72)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  roundRect(ctx, centerX - width / 2, y, width, height, 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = color;
  ctx.font = "900 26px Orbitron, Microsoft JhengHei, Arial";
  ctx.fillText("NEXT ROUND", centerX + 28, y + 32);
  ctx.fillStyle = "#C8D8E8";
  ctx.font = "13px Microsoft JhengHei, Arial";
  ctx.fillText("後台按下一局，立即進入下一場", centerX + 28, y + 55);

  ctx.fillStyle = "#F8FBFF";
  roundRect(ctx, centerX - width / 2 + 32, y + 22, 32, 28, 3);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(centerX - width / 2 + 43, y + 29);
  ctx.lineTo(centerX - width / 2 + 43, y + 43);
  ctx.lineTo(centerX - width / 2 + 56, y + 36);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function toneTheme(tone) {
  const themes = {
    neutral: { bg: "rgba(13,21,37,0.9)", line: "rgba(74,96,128,0.78)", accent: "#C8D8E8", glow: "rgba(74,96,128,0.28)" },
    charge: { bg: "rgba(0,27,43,0.92)", line: "rgba(0,245,255,0.72)", accent: "#00F5FF", glow: "rgba(0,245,255,0.38)" },
    warning: { bg: "rgba(61,40,12,0.9)", line: "rgba(255,183,0,0.72)", accent: "#FFB700", glow: "rgba(255,183,0,0.34)" },
    assist: { bg: "rgba(12,48,26,0.9)", line: "rgba(57,255,20,0.75)", accent: "#39FF14", glow: "rgba(57,255,20,0.35)" },
    danger: { bg: "rgba(64,12,24,0.91)", line: "rgba(255,34,68,0.78)", accent: "#FF2244", glow: "rgba(255,34,68,0.4)" },
    climax: { bg: "rgba(64,44,4,0.92)", line: "rgba(255,183,0,0.8)", accent: "#FFB700", glow: "rgba(255,183,0,0.42)" },
    hype: { bg: "rgba(49,20,64,0.9)", line: "rgba(244,114,182,0.78)", accent: "#f472b6", glow: "rgba(244,114,182,0.36)" }
  };
  return themes[tone] || themes.neutral;
}

function shortUrlParts(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.host,
      path: parsed.pathname
    };
  } catch {
    return {
      host: "",
      path: url
    };
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
