import * as C from "./constants";
import type { Body, Direction, ReadState } from "./game";
export const directions: Direction[] = ["up", "right", "down", "left"];
export const vectors: Record<Direction, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};
export const opposite = (d: Direction): Direction =>
  directions[(directions.indexOf(d) + 2) % 4];
export const center = (tx: number, ty: number) => ({
  x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
  y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
  tx,
  ty,
});
export function locate(b: { x: number; y: number }): {
  tx: number;
  ty: number;
} {
  return {
    tx: Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE),
    ty: Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE),
  };
}
export const blank = (c: string) =>
  Array.from({ length: C.GRID_ROWS }, () => c.repeat(C.GRID_COLS));
export function put(rows: string[], x: number, y: number, c: string): void {
  rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1);
}
export function layout(): string[] {
  const a = blank("#");
  const h = (y: number, x: number, z: number) => {
    for (let i = x; i <= z; i++) put(a, i, y, ".");
  };
  const v = (x: number, y: number, z: number) => {
    for (let i = y; i <= z; i++) put(a, x, i, ".");
  };
  for (const y of [1, 5, 11, 16]) h(y, 1, 34);
  for (const x of [1, 5, 9, 13, 22, 26, 30, 34]) v(x, 1, 16);
  for (const y of [3, 8, 14])
    for (const [x, z] of [
      [1, 13],
      [22, 34],
    ])
      h(y, x, z);
  for (const x of [15, 20]) {
    v(x, 1, 5);
    v(x, 11, 16);
  }
  h(3, 15, 20);
  h(13, 15, 20);
  h(11, 0, 35);
  for (let y = 7; y <= 9; y++) for (let x = 16; x <= 19; x++) put(a, x, y, "d");
  put(a, 17, 6, "g");
  return a;
}
export function tile(
  s: Pick<ReadState, "tiles">,
  x: number,
  y: number,
): string {
  return s.tiles[y]?.[x] ?? "#";
}
export function wrapRow(s: Pick<ReadState, "tiles">): number {
  return s.tiles.findIndex((r) => r[0] !== "#" && r[C.GRID_COLS - 1] !== "#");
}
export function neighbor(
  s: Pick<ReadState, "tiles">,
  x: number,
  y: number,
  d: Direction,
): { tx: number; ty: number } {
  const [dx, dy] = vectors[d];
  let tx = x + dx;
  if (y === wrapRow(s)) tx = (tx + C.GRID_COLS) % C.GRID_COLS;
  return { tx, ty: y + dy };
}
export function open(
  s: Pick<ReadState, "tiles">,
  x: number,
  y: number,
  den = false,
): boolean {
  const t = tile(s, x, y);
  return t === "." || (den && (t === "d" || t === "g"));
}
export function options(
  s: Pick<ReadState, "tiles">,
  x: number,
  y: number,
  den = false,
): Direction[] {
  return directions.filter((d) => {
    const n = neighbor(s, x, y, d);
    return open(s, n.tx, n.ty, den);
  });
}
export function distances(
  s: Pick<ReadState, "tiles">,
  x: number,
  y: number,
  den = false,
): number[] {
  const out = Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(-1);
  if (!open(s, x, y, den)) return out;
  const q = [{ tx: x, ty: y }];
  out[y * C.GRID_COLS + x] = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    for (const d of options(s, p.tx, p.ty, den)) {
      const n = neighbor(s, p.tx, p.ty, d);
      const id = n.ty * C.GRID_COLS + n.tx;
      if (out[id] < 0) {
        out[id] = out[p.ty * C.GRID_COLS + p.tx] + 1;
        q.push(n);
      }
    }
  }
  return out;
}
export function route(
  s: Pick<ReadState, "tiles">,
  b: Body,
  target: { tx: number; ty: number },
  den = false,
): Direction | null {
  const dist = distances(s, target.tx, target.ty, den);
  let best = Infinity;
  let result: Direction | null = null;
  for (const d of options(s, b.tx, b.ty, den)) {
    const n = neighbor(s, b.tx, b.ty, d);
    const v = dist[n.ty * C.GRID_COLS + n.tx];
    if (v >= 0 && v < best) {
      best = v;
      result = d;
    }
  }
  return result;
}
/** Exact grid traversal: target rock may be lit, but intermediate rock occludes. */
export function lineClear(
  s: Pick<ReadState, "tiles">,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  const start = locate(a),
    end = locate(b);
  let x = start.tx,
    y = start.ty;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    sx = Math.sign(dx),
    sy = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : C.TILE / Math.abs(dx),
    deltaY = dy === 0 ? Infinity : C.TILE / Math.abs(dy);
  let nextX =
    dx === 0
      ? Infinity
      : (C.GRID_ORIGIN_X + (x + (sx > 0 ? 1 : 0)) * C.TILE - a.x) / dx;
  let nextY =
    dy === 0
      ? Infinity
      : (C.GRID_ORIGIN_Y + (y + (sy > 0 ? 1 : 0)) * C.TILE - a.y) / dy;
  for (let i = 0; i < C.GRID_COLS + C.GRID_ROWS + 4; i++) {
    if (x === end.tx && y === end.ty) return true;
    if (!(x === start.tx && y === start.ty) && tile(s, x, y) === "#")
      return false;
    if (Math.abs(nextX - nextY) < 1e-10) {
      if (tile(s, x + sx, y) === "#" || tile(s, x, y + sy) === "#")
        return false;
      x += sx;
      y += sy;
      nextX += deltaX;
      nextY += deltaY;
    } else if (nextX < nextY) {
      x += sx;
      nextX += deltaX;
    } else {
      y += sy;
      nextY += deltaY;
    }
  }
  return false;
}
export const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => Math.hypot(a.x - b.x, a.y - b.y);
/** Travel consumes the remaining step at a center before taking a buffered turn. */
export function move(
  s: Pick<ReadState, "tiles">,
  b: Body,
  speed: number | (() => number),
  den: boolean,
  choose: () => Direction | null,
): void {
  Object.assign(b, locate(b));
  b.moving = false;
  if (!open(s, b.tx, b.ty, den)) return;
  let timeLeft = C.TICK_DT;
  while (timeLeft > 1e-9) {
    const c = center(b.tx, b.ty);
    const at = Math.abs(b.x - c.x) < 1e-7 && Math.abs(b.y - c.y) < 1e-7;
    if (at) {
      const d = choose();
      if (!d) break;
      b.dir = d;
      const n = neighbor(s, b.tx, b.ty, b.dir);
      if (!open(s, n.tx, n.ty, den)) break;
    }
    const [dx, dy] = vectors[b.dir];
    // Distance to next center, including the half tile across a tunnel boundary.
    let gap = dx
      ? dx > 0
        ? c.x - b.x
        : b.x - c.x
      : dy > 0
        ? c.y - b.y
        : b.y - c.y;
    if (gap < 1e-7) gap += C.TILE;
    const rate = typeof speed === "number" ? speed : speed();
    const step = Math.min(timeLeft * rate, gap);
    b.x += dx * step;
    b.y += dy * step;
    timeLeft -= step / rate;
    b.moving = true;
    if (b.ty === wrapRow(s)) {
      const w = C.GRID_COLS * C.TILE;
      if (b.x < C.GRID_ORIGIN_X) b.x += w;
      if (b.x >= C.GRID_ORIGIN_X + w) b.x -= w;
    }
    Object.assign(b, locate(b));
  }
}
