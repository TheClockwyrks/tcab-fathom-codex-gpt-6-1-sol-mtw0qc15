import type { RenderApi, UpdateApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { FathomState, ReadState, Rect } from "./game";
import {
  center,
  directions,
  distance,
  distances,
  lineClear,
  neighbor,
  tile,
} from "./maze";
import { fresh, setScreen } from "./simulation";
export const colors = {
  cyan: "#86f7e7",
  dim: "#5d8b97",
  white: "#d5f3ef",
  amber: "#ffb66c",
  violet: "#bc9aff",
  orange: "#ff935e",
};
const font = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
export function menuItems(s: Pick<ReadState, "screen">): readonly string[] {
  return s.screen === "title"
    ? C.TITLE_ITEMS
    : s.screen === "paused"
      ? C.PAUSE_ITEMS
      : s.screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function menuItemRect(
  s: Pick<ReadState, "screen">,
  index: number,
): Rect | null {
  if (!Number.isInteger(index) || index < 0 || index >= menuItems(s).length)
    return null;
  return s.screen === "title"
    ? { x: 96, y: 419 + index * 62, w: 390, h: 50 }
    : { x: 440, y: 355 + index * 62, w: 400, h: 50 };
}
export function controls(s: FathomState, api: UpdateApi): FathomState {
  const input = api.input;
  if (input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
  if (s.screen === "playing") {
    if (input.pressed("pause")) setScreen(s, "paused");
    return s;
  }
  if (
    s.screen === "paused" &&
    (input.pressed("pause") || input.pressed("back"))
  ) {
    setScreen(s, "playing");
    return s;
  }
  if (s.screen === "countdown" || s.screen === "cleared") return s;
  let confirm = input.pressed("confirm");
  const back = input.pressed("back");
  const items = menuItems(s);
  if (items.length) {
    if (input.pressed("up"))
      s.menuIndex = ((s.menuIndex ?? 0) + items.length - 1) % items.length;
    if (input.pressed("down"))
      s.menuIndex = ((s.menuIndex ?? 0) + 1) % items.length;
  }
  for (const sample of input.pointerSamples()) {
    const hit = items.findIndex((_, i) => {
      const r = menuItemRect(s, i)!;
      return (
        sample.x >= r.x &&
        sample.x <= r.x + r.w &&
        sample.y >= r.y &&
        sample.y <= r.y + r.h
      );
    });
    if (sample.type === "move" && sample.device !== "touch" && hit >= 0)
      s.menuIndex = hit;
    if (
      sample.type === "down" &&
      (sample.button === "primary" || sample.device === "touch")
    ) {
      s.pointerDown[sample.id] = s.screen === "howto" ? -2 : hit;
      if (hit >= 0) s.menuIndex = hit;
    }
    if (sample.type === "up") {
      if (s.screen === "howto" && s.pointerDown[sample.id] === -2)
        confirm = true;
      else if (hit >= 0 && s.pointerDown[sample.id] === hit) {
        s.menuIndex = hit;
        confirm = true;
      }
      delete s.pointerDown[sample.id];
    }
  }
  if (s.screen === "howto") {
    if (confirm || back) return fresh(s, "title");
    return s;
  }
  if (back && s.screen === "gameover") return fresh(s, "title");
  if (!confirm) return s;
  if (s.screen === "title") {
    s.titleIndex = s.menuIndex ?? 0;
    if (s.menuIndex === 0) return fresh(s, "countdown");
    setScreen(s, "howto");
  } else if (s.screen === "paused") {
    if (s.menuIndex === 0) setScreen(s, "playing");
    else return fresh(s, s.menuIndex === 1 ? "countdown" : "title");
  } else if (s.screen === "gameover")
    return fresh(s, s.menuIndex === 0 ? "countdown" : "title");
  return s;
}
function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size = 14,
  color = colors.dim,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(str, x, y);
}
function line(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = "#19343c",
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function sprite(
  ctx: CanvasRenderingContext2D,
  s: ReadState,
  name: string,
  frame: number,
  x: number,
  y: number,
  size = C.TILE,
): void {
  const img = s.assets[name]?.[frame];
  if (img)
    ctx.drawImage(img as ImageBitmap, x - size / 2, y - size / 2, size, size);
}
function swim(dir: string, time: number, moving = true, rate = 8): number {
  return (
    ({ down: 0, up: 2, left: 4, right: 6 }[dir] ?? 0) +
    (moving ? Math.floor(time * rate) % 2 : 0)
  );
}
function mote(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  glow(ctx, x, y, 15, "#ff8c4555");
  ctx.fillStyle = colors.amber;
  ctx.beginPath();
  ctx.arc(x, y, 2.7, 0, Math.PI * 2);
  ctx.fill();
}
function terrain(
  ctx: CanvasRenderingContext2D,
  s: ReadState,
  x: number,
  y: number,
  visibility: string,
): void {
  const px = C.GRID_ORIGIN_X + x * C.TILE,
    py = C.GRID_ORIGIN_Y + y * C.TILE;
  let frame = 17;
  if (visibility !== "u") {
    const t = tile(s, x, y);
    frame = t === "g" ? 18 : 16;
    if (t === "#") {
      frame = 0;
      directions.forEach((d, i) => {
        const n = neighbor(s, x, y, d);
        if (tile(s, n.tx, n.ty) === "#") frame |= 1 << i;
      });
    }
  }
  ctx.save();
  sprite(ctx, s, "trench-walls", frame, px + C.TILE / 2, py + C.TILE / 2);
  if (visibility === "r") {
    ctx.fillStyle = "#030b12bc";
    ctx.fillRect(px, py, C.TILE, C.TILE);
  }
  if (s.plankton[y][x] === "*" && visibility !== "u") {
    ctx.globalAlpha = visibility === "r" ? 0.25 : 0.95;
    glow(ctx, px + 16, py + 16, 10, "#76fbd62f");
    ctx.fillStyle = colors.cyan;
    ctx.beginPath();
    ctx.arc(px + 16, py + 16, C.PLANKTON_DOT / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
function predatorBody(
  ctx: CanvasRenderingContext2D,
  s: ReadState,
  p: ReadState["predators"][number],
): void {
  if (!p.lit || p.state === "den") return;
  ctx.save();
  const passive =
    distance(s.forager, p) <= s.visionRadius && lineClear(s, s.forager, p);
  const bloom = s.predators.some(
    (f) => f.flaring && distance(f, p) <= C.FLARE_RADIUS,
  );
  if (p.mark > 0 && !passive && !bloom && !p.alert)
    ctx.globalAlpha = p.mark / C.SONAR_MARK_TIME;
  const frame =
    p.kind === "lanternjaw" && p.state === "wander"
      ? 8 + (Math.floor(s.simTime * 8) % 8)
      : swim(p.dir, s.simTime, p.moving, 7);
  sprite(ctx, s, p.kind, frame, p.x, p.y);
  if (p.alert) {
    const c = p.kind === "gloamfin" ? colors.violet : colors.orange;
    glow(ctx, p.x, p.y, 40, c + "45");
    const r = 18 + (1 - p.alertLeft / C.ALERT_TIME) * 22;
    ctx.strokeStyle = c;
    ctx.globalAlpha = p.alertLeft / C.ALERT_TIME;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.moveTo(p.x + Math.cos(a) * r * 0.65, p.y + Math.sin(a) * r * 0.65);
      ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
function flare(
  ctx: CanvasRenderingContext2D,
  s: ReadState,
  p: ReadState["predators"][number],
): void {
  if (!(p.flareCharging || p.flaring || p.fade > 0)) return;
  const frame = p.flareCharging
    ? Math.min(2, Math.floor((1 - p.flareIn / C.FLARE_CHARGE) * 3))
    : p.flaring
      ? 3 + Math.min(2, Math.floor((1 - p.flareIn / C.FLARE_BLOOM) * 3))
      : 6 + (p.fade < 0.175 ? 1 : 0);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.6;
  sprite(ctx, s, "flare-bloom", frame, p.x, p.y, C.FLARE_RADIUS * 2);
  ctx.restore();
}
function mazeView(ctx: CanvasRenderingContext2D, s: ReadState): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
  // The outer window masks ground and amber bulbs, never the hunter effects.
  ctx.fillStyle = "#03060c";
  ctx.fillRect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.save();
  ctx.beginPath();
  ctx.arc(s.forager.x, s.forager.y, s.windowRadius, 0, Math.PI * 2);
  ctx.clip();
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++)
      terrain(ctx, s, x, y, s.visibility[y][x]);
  glow(ctx, s.forager.x, s.forager.y, s.windowRadius, "#3bbfa80e");
  for (const p of s.predators)
    if (p.kind === "lanternjaw" && p.state !== "den") mote(ctx, p.x, p.y);
  for (const d of s.drifters) mote(ctx, d.x, d.y);
  ctx.restore();
  for (const p of s.predators)
    if (p.flaring) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, C.FLARE_RADIUS, 0, Math.PI * 2);
      ctx.clip();
      for (let y = 0; y < C.GRID_ROWS; y++)
        for (let x = 0; x < C.GRID_COLS; x++)
          if (distance(p, center(x, y)) <= C.FLARE_RADIUS + C.TILE)
            terrain(ctx, s, x, y, s.visibility[y][x]);
      ctx.restore();
    }
  for (const p of s.predators) predatorBody(ctx, s, p);
  for (const d of s.drifters)
    if (d.lit)
      sprite(ctx, s, "drifter", Math.floor(s.simTime * 8) % 8, d.x, d.y);
  // Keep the amber points identical and additive when bodies appear.
  ctx.save();
  ctx.beginPath();
  ctx.arc(s.forager.x, s.forager.y, s.windowRadius, 0, Math.PI * 2);
  ctx.clip();
  for (const p of s.predators)
    if (p.kind === "lanternjaw" && p.state !== "den") mote(ctx, p.x, p.y);
  for (const d of s.drifters) mote(ctx, d.x, d.y);
  ctx.restore();
  for (const cloud of s.inkClouds) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, cloud.remaining);
    glow(ctx, cloud.x, cloud.y, cloud.radius, "#000005");
    ctx.fillStyle = "#010208bf";
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.radius * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const pulse of s.pulses) {
    const dist = distances(s, pulse.ox, pulse.oy);
    const c =
      pulse.tint === "cyan"
        ? colors.cyan
        : pulse.tint === "violet"
          ? colors.violet
          : colors.orange;
    ctx.save();
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.shadowColor = c;
    ctx.shadowBlur = 10;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const d = dist[y * C.GRID_COLS + x];
        if (d < 0 || d > pulse.range || pulse.front < d || pulse.front > d + 1)
          continue;
        const p = center(x, y);
        // Each outward corridor edge carries its own crest. Junctions split it.
        for (const dir of directions) {
          const n = neighbor(s, x, y, dir);
          if (dist[n.ty * C.GRID_COLS + n.tx] !== d + 1) continue;
          const q = center(n.tx, n.ty);
          if (Math.abs(q.x - p.x) > C.TILE) continue;
          const t = pulse.front - d;
          const fx = p.x + (q.x - p.x) * t,
            fy = p.y + (q.y - p.y) * t;
          const vx = ((q.y - p.y) / C.TILE) * 10,
            vy = (-(q.x - p.x) / C.TILE) * 10;
          ctx.beginPath();
          ctx.moveTo(fx - vx, fy - vy);
          ctx.lineTo(fx + vx, fy + vy);
          ctx.stroke();
        }
      }
    ctx.restore();
  }
  for (const p of s.predators) flare(ctx, s, p);
  glow(ctx, s.forager.x, s.forager.y, 35, "#67ffe12e");
  sprite(
    ctx,
    s,
    "glimmerfin",
    swim(s.forager.dir, s.simTime, s.forager.moving),
    s.forager.x,
    s.forager.y,
  );
  ctx.restore();
}
function gauge(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  cooldown: number,
  total: number,
  key: string,
): void {
  text(
    ctx,
    `${label}  [${key}]`,
    x,
    682,
    12,
    cooldown === 0 ? colors.cyan : colors.dim,
  );
  ctx.fillStyle = "#142d36";
  ctx.fillRect(x, 693, 146, 3);
  ctx.fillStyle = colors.cyan;
  ctx.fillRect(x, 693, 146 * Math.max(0, 1 - cooldown / total), 3);
}
function hud(ctx: CanvasRenderingContext2D, s: ReadState): void {
  text(ctx, "F A T H O M", 64, 34, 17, colors.white);
  text(ctx, C.DIVE_LABEL, 65, 58, 10, colors.dim);
  text(
    ctx,
    String(s.score).padStart(6, "0"),
    640,
    59,
    48,
    colors.white,
    "center",
  );
  text(
    ctx,
    `${s.planktonRemaining} MOTES REMAIN`,
    1216,
    35,
    12,
    colors.cyan,
    "right",
  );
  text(ctx, "P / ESC  PAUSE     M  SOUND", 1216, 58, 10, colors.dim, "right");
  line(ctx, 64, 72, 1216, 72);
  line(ctx, 64, 660, 1216, 660);
  text(ctx, `DEPTH ${s.depth}`, 64, 692, 16, colors.white);
  for (let i = 0; i < s.lives; i++)
    sprite(ctx, s, "glimmerfin", 6, 242 + i * 27, 687, 24);
  gauge(ctx, "SONAR", 734, s.sonar.cooldown, C.SONAR_COOLDOWN, "SPACE");
  gauge(ctx, "INK", 930, s.ink.cooldown, C.INK_COOLDOWN, "SHIFT");
  text(
    ctx,
    s.muted ? "SOUND OFF" : "SOUND ON",
    1216,
    691,
    10,
    colors.dim,
    "right",
  );
}
function menu(ctx: CanvasRenderingContext2D, s: ReadState): void {
  menuItems(s).forEach((label, i) => {
    const r = menuItemRect(s, i)!;
    const selected = i === s.menuIndex;
    ctx.fillStyle = selected ? "#123439" : "#07151d";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (selected) {
      ctx.fillStyle = colors.cyan;
      ctx.fillRect(r.x, r.y, 3, r.h);
    }
    text(
      ctx,
      label,
      r.x + 24,
      r.y + 31,
      17,
      selected ? colors.cyan : colors.dim,
    );
    text(
      ctx,
      selected ? "→" : "·",
      r.x + r.w - 24,
      r.y + 31,
      19,
      selected ? colors.cyan : colors.dim,
      "right",
    );
  });
}
function ambience(ctx: CanvasRenderingContext2D): void {
  glow(ctx, 950, 290, 570, "#0b474831");
  glow(ctx, 100, 700, 500, "#082c4428");
  // Suspended marine snow is deterministic and does not run a second clock.
  for (let i = 0; i < 95; i++) {
    const x = (i * 193 + 41) % 1280,
      y = (i * i * 37 + 23) % 720;
    ctx.fillStyle = i % 7 === 0 ? "#548b8d" : "#193a45";
    ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, 1);
  }
  line(ctx, 64, 64, 1216, 64);
  text(ctx, "F / 01", 64, 45, 12, colors.cyan);
  text(ctx, "ABYSSAL EXPLORATION DIVISION", 1216, 45, 11, colors.dim, "right");
}
function title(ctx: CanvasRenderingContext2D, s: ReadState): void {
  ambience(ctx);
  text(ctx, "A BIOLUMINESCENT MAZE CHASE", 96, 157, 12, colors.cyan);
  text(ctx, C.TITLE_TEXT, 87, 276, 104, colors.white);
  text(ctx, C.TAGLINE_TEXT, 99, 321, 20, colors.cyan);
  text(ctx, "A little light. A long way down.", 99, 373, 14, colors.dim);
  menu(ctx, s);
  text(ctx, "↑ ↓  SELECT     ENTER  DESCEND", 99, 574, 11, colors.dim);
  // A specimen window: actual trench art, cut by a circular observation lens.
  const ox = 924,
    oy = 340,
    r = 211;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ox, oy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#071b23";
  ctx.fillRect(ox - r, oy - r, r * 2, r * 2);
  ctx.save();
  ctx.translate(ox - 640, oy - 352);
  for (let y = 2; y < 16; y++)
    for (let x = 10; x < 25; x++) terrain(ctx, s, x, y, "r");
  ctx.restore();
  glow(ctx, ox, oy, 202, "#24b4a929");
  for (const rr of [76, 143, 203]) {
    ctx.strokeStyle = "#69dfcd18";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ox, oy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  line(ctx, ox - r, oy, ox + r, oy, "#7acdbd18");
  line(ctx, ox, oy - r, ox, oy + r, "#7acdbd18");
  glow(ctx, ox, oy, 60, "#52fadd40");
  sprite(ctx, s, "glimmerfin", 6, ox, oy, 64);
  mote(ctx, ox + 125, oy - 103);
  mote(ctx, ox - 97, oy + 114);
  ctx.restore();
  ctx.strokeStyle = "#38626a";
  ctx.beginPath();
  ctx.arc(ox, oy, r + 9, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 48; i++) {
    const a = (i * Math.PI) / 24;
    line(
      ctx,
      ox + Math.cos(a) * (r + 15),
      oy + Math.sin(a) * (r + 15),
      ox + Math.cos(a) * (r + (i % 4 === 0 ? 26 : 19)),
      oy + Math.sin(a) * (r + (i % 4 === 0 ? 26 : 19)),
      "#31535c",
    );
  }
  text(ctx, "01 / GLIMMERFIN", ox, 614, 12, colors.cyan, "center");
  text(ctx, "YOUR LIGHT GIVES YOU AWAY", ox, 638, 10, colors.dim, "center");
  line(ctx, 64, 664, 1216, 664);
  text(ctx, "KINDLE", 64, 692, 12, colors.cyan);
  text(
    ctx,
    "LIGHT REVEALS. SOUND TRAVELS. THE DEEP LISTENS.",
    640,
    692,
    10,
    colors.dim,
    "center",
  );
  text(ctx, "M  SOUND", 1216, 692, 10, colors.dim, "right");
}
function howto(ctx: CanvasRenderingContext2D, s: ReadState): void {
  ambience(ctx);
  text(ctx, "FIELD GUIDE / 01", 96, 121, 12, colors.cyan);
  text(ctx, "Know what finds you.", 92, 181, 38, colors.white);
  const entries = [
    [
      "lanternjaw",
      "01  LANTERNJAW",
      "Follows your light.",
      "An amber glimmer may hide a jaw.",
    ],
    [
      "gloamfin",
      "02  GLOAMFIN",
      "Follows your sound.",
      "Your sonar can give you away.",
    ],
    [
      "flarefish",
      "03  FLAREFISH",
      "Hunts by light and flare.",
      "Get clear before the bloom.",
    ],
  ];
  entries.forEach(([sheet, name, a, b], i) => {
    const x = 96 + i * 378;
    line(ctx, x, 220, x + 334, 220);
    sprite(ctx, s, sheet, 6, x + 28, 267, 48);
    text(ctx, name, x, 320, 17, colors.white);
    text(ctx, a, x, 351, 13, colors.cyan);
    text(ctx, b, x, 379, 11, colors.dim);
  });
  text(ctx, "Read the dark", 96, 452, 21, colors.white);
  text(
    ctx,
    "Graze every mote to descend. Eating makes your light grow — and attracts hunters.",
    96,
    484,
    13,
    colors.dim,
  );
  text(
    ctx,
    "Your light reveals nearby passages. Sonar reaches around corners. Explored ground stays",
    96,
    512,
    13,
    colors.dim,
  );
  text(
    ctx,
    "in memory, but only inside your circle. Drop ink to blind the hunters that see.",
    96,
    537,
    13,
    colors.dim,
  );
  text(
    ctx,
    "WASD / ARROWS  SWIM     SPACE  SONAR     SHIFT  INK     P / ESC  PAUSE     M  SOUND",
    96,
    592,
    12,
    colors.cyan,
  );
  line(ctx, 64, 650, 1216, 650);
  text(ctx, "ENTER / ESC / CLICK TO RETURN", 96, 683, 12, colors.white);
}
export function render(s: ReadState, api: RenderApi): void {
  const ctx = api.ctx;
  ctx.imageSmoothingEnabled = false;
  if (s.screen === "title") {
    title(ctx, s);
    return;
  }
  if (s.screen === "howto") {
    howto(ctx, s);
    return;
  }
  if (s.screen === "gameover") {
    ambience(ctx);
    text(ctx, "SIGNAL LOST", 640, 198, 16, colors.cyan, "center");
    text(ctx, "The deep keeps its own.", 640, 266, 38, colors.white, "center");
    text(
      ctx,
      `${String(s.score).padStart(6, "0")} POINTS   /   DEPTH ${s.depth}`,
      640,
      314,
      18,
      colors.dim,
      "center",
    );
    menu(ctx, s);
    return;
  }
  mazeView(ctx, s);
  hud(ctx, s);
  if (s.screen === "paused") {
    ctx.fillStyle = "#030b12c9";
    ctx.fillRect(310, 180, 660, 408);
    text(ctx, "HOLDING DEPTH", 640, 259, 13, colors.cyan, "center");
    text(ctx, "Paused", 640, 315, 38, colors.white, "center");
    menu(ctx, s);
  } else if (s.screen === "countdown" || s.screen === "cleared") {
    const title =
      s.screen === "countdown"
        ? `DIVE  ${Math.max(1, Math.ceil(s.screenLeft))}`
        : `DEPTH ${s.depth} CLEARED`;
    ctx.fillStyle = "#030b12c9";
    ctx.fillRect(360, 280, 560, 140);
    text(ctx, title, 640, 344, 30, colors.white, "center");
    text(
      ctx,
      s.screen === "countdown"
        ? "LET YOUR EYES ADJUST"
        : "THE ABYSS GOES DEEPER",
      640,
      383,
      12,
      colors.cyan,
      "center",
    );
  }
}
