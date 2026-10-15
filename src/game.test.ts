/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ConstantClock, createEngine } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { game, type FathomState } from "./game";
import { debug } from "./debug";
import { blank, center, distances, layout, open, options, put } from "./maze";
import { initialState, lighting, reconcile, tick } from "./simulation";

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async (path: string) => new Response(await readFile(path)),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
afterAll(() => vi.unstubAllGlobals());
function fixture(): FathomState {
  let s = debug.clearPredators(initialState());
  s = debug.clearPlankton(s);
  const rows = blank("#");
  for (let x = 1; x < 35; x++) put(rows, x, 10, ".");
  s = debug.setMaze(s, rows);
  s = debug.setForagerTile(s, 3, 10);
  return debug.setScreen(s, "playing");
}
function step(
  s: FathomState,
  n = 1,
  held = false,
  sonar = false,
  ink = false,
): Set<C.CueName> {
  const cues = new Set<C.CueName>();
  for (let i = 0; i < n; i++)
    tick(s, held, sonar && i === 0, ink && i === 0, cues);
  reconcile(s);
  return cues;
}
async function engineHarness(ms = 1000 / 60) {
  const target = new EventTarget();
  const canvas = createCanvas(C.STAGE_W, C.STAGE_H);
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    game,
    clock: new ConstantClock(ms),
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => target,
    },
  });
  await engine.initialize();
  const key = (code: string, down = true) =>
    target.dispatchEvent(
      Object.assign(new Event(down ? "keydown" : "keyup"), {
        code,
        repeat: false,
      }),
    );
  return { engine, target, key };
}

describe("maze contract", () => {
  it("connects all corridors, mirrors them and has no dead ends or wide passages", () => {
    const tiles = layout(),
      s = { tiles };
    const seen = distances(s, 17, 16);
    let count = 0,
      total = 0;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const t = tiles[y][x],
          mirror = tiles[y][C.GRID_COLS - 1 - x];
        if (!"dg".includes(t) && !"dg".includes(mirror)) expect(t).toBe(mirror);
        if (t !== ".") continue;
        count++;
        expect(seen[y * C.GRID_COLS + x]).toBeGreaterThanOrEqual(0);
        const neighbors = options(s, x, y).filter((d) => {
          const v = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[
            d
          ];
          return open(s, (x + v[0] + 36) % 36, y + v[1]);
        }).length;
        total += neighbors;
        expect(neighbors).toBeGreaterThanOrEqual(2);
        expect(
          [tiles[y]?.[x + 1], tiles[y + 1]?.[x], tiles[y + 1]?.[x + 1]].every(
            (t) => t === ".",
          ),
        ).toBe(false);
      }
    expect(count / 544).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(total / count).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(total / count).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    const visited = new Set<number>();
    const runs: number[] = [];
    for (let id = 0; id < 648; id++) {
      const x = id % 36,
        y = Math.floor(id / 36);
      if (
        tiles[y][x] !== "." ||
        options(s, x, y).length !== 2 ||
        visited.has(id)
      )
        continue;
      const q = [id];
      visited.add(id);
      for (let j = 0; j < q.length; j++) {
        const p = q[j];
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ]) {
          const nx = ((p % 36) + dx + 36) % 36,
            ny = Math.floor(p / 36) + dy,
            n = ny * 36 + nx;
          if (
            open(s, nx, ny) &&
            options(s, nx, ny).length === 2 &&
            !visited.has(n)
          ) {
            visited.add(n);
            q.push(n);
          }
        }
      }
      runs.push(q.length);
    }
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(mean).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(mean).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
    expect(tiles.filter((r) => r[0] === "." && r[35] === ".")).toHaveLength(1);
    expect(tiles.join("").split("g")).toHaveLength(2);
    for (let y = 7; y <= 9; y++) expect(tiles[y].slice(16, 20)).toBe("dddd");
  });
});
describe("fixed-step ecology", () => {
  it("moves while held, stops on release and reverses between centers", () => {
    const s = fixture();
    s.desired = "right";
    s.forager.dir = "right";
    step(s, 15, true);
    expect(s.forager.x).toBeCloseTo(center(3, 10).x + 16);
    step(s, 30);
    expect(s.forager.x).toBeCloseTo(center(3, 10).x + 16);
    expect(s.forager.moving).toBe(false);
    s.desired = "left";
    step(s, 15, true);
    expect(s.forager.x).toBeCloseTo(center(3, 10).x);
  });
  it("takes a buffered corner only at its center", () => {
    const s = fixture();
    for (let y = 6; y < 10; y++) put(s.tiles, 5, y, ".");
    s.forager.dir = "right";
    s.desired = "right";
    step(s, 40, true);
    s.desired = "up";
    step(s, 20, true);
    expect(s.forager.x).toBeCloseTo(center(5, 10).x);
    expect(s.forager.y).toBeCloseTo(center(5, 10).y);
    step(s, 15, true);
    expect(s.forager.y).toBeCloseTo(center(5, 10).y - 16);
  });
  it("wraps continuously over an ordinary tile step", () => {
    let s = fixture();
    for (let x = 0; x < 36; x++) put(s.tiles, x, 10, ".");
    s = debug.setForagerTile(s, 0, 10);
    s = debug.setForagerDir(s, "left");
    s.desired = "left";
    step(s, 30, true);
    expect(s.forager.x).toBeCloseTo(center(35, 10).x);
    expect(s.forager.tx).toBe(35);
  });
  it("holds bodies on tiles closed by a fixture", () => {
    let s = fixture();
    s = debug.setMaze(s, blank("#"));
    s.desired = "right";
    const before = { ...s.forager };
    step(s, 120, true);
    expect(s.forager.x).toBe(before.x);
    expect(s.forager.y).toBe(before.y);
  });
  it("eats, scores, holds brightness then decays at its half-life", () => {
    let s = fixture();
    s = debug.setPlankton(s, 3, 10, true);
    s = debug.setPlankton(s, 34, 10, true);
    expect(step(s).has(C.CUES.eat)).toBe(true);
    expect(s.score).toBe(C.SCORE_PLANKTON);
    expect(s.brightness).toBe(C.BRIGHT_PER_EAT);
    step(s, 120);
    expect(s.brightness).toBeCloseTo(C.BRIGHT_PER_EAT);
    step(s, 108);
    expect(s.brightness).toBeCloseTo(C.BRIGHT_PER_EAT / 2);
  });
  it("clears only by eating the final mote, then descends preserving score and lives", () => {
    let s = fixture();
    step(s, 2);
    expect(s.screen).toBe("playing");
    s = debug.setPlankton(s, 3, 10, true);
    step(s);
    expect(s.screen).toBe("cleared");
    expect(s.score).toBe(C.SCORE_CLEAR + C.SCORE_PLANKTON);
    step(s, 240);
    expect(s.depth).toBe(2);
    expect(s.predators).toHaveLength(4);
    expect(s.screen).toBe("countdown");
    expect(s.sonar.range).toBe(8);
    expect(s.visibility.every((r) => /^u+$/.test(r))).toBe(true);
  });
  it("remembers terrain through lost lives and ends only with no reserve", () => {
    let s = fixture();
    lighting(s);
    const memory = s.visibility.join("");
    s = debug.addPredator(s, "lanternjaw", 3, 10);
    s = debug.setPredatorMind(s, 0, false);
    expect(step(s).has(C.CUES.caught)).toBe(true);
    expect(s.screen).toBe("countdown");
    expect(s.lives).toBe(2);
    expect(s.visibility[10][3]).toBe("r");
    expect(s.visibility.join("")).not.toBe(blank("u").join(""));
    expect(memory).toContain("l");
    s = fixture();
    s = debug.setLives(s, 0);
    s = debug.addPredator(s, "flarefish", 3, 10);
    s = debug.setPredatorMind(s, 0, false);
    step(s);
    expect(s.screen).toBe("gameover");
    expect(s.lives).toBe(0);
  });
  it("obeys light occlusion and keeps memory outside the vision circle", () => {
    const s = fixture();
    put(s.tiles, 5, 10, "#");
    lighting(s);
    expect(s.visibility[10][5]).toBe("l");
    expect(s.visibility[10][6]).toBe("u");
    put(s.visibility, 30, 10, "r");
    lighting(s);
    expect(s.visibility[10][30]).toBe("r");
    expect(s.windowRadius).toBe(C.KINDLE_VISION_MIN);
  });
  it("floods around corners, marks non-amber hunters on arrival and does not mark amber bodies", () => {
    let s = fixture();
    s = debug.addPredator(s, "gloamfin", 10, 10);
    s = debug.setPredatorTravel(s, 0, false);
    s = debug.addPredator(s, "lanternjaw", 11, 10);
    s = debug.setPredatorTravel(s, 1, false);
    step(s, 1, false, true);
    expect(s.predators[0].mark).toBe(0);
    step(s, 60);
    expect(s.predators[0].mark).toBeGreaterThan(0);
    expect(s.predators[0].state).toBe("chase");
    expect(s.predators[0].alert).toBe(true);
    expect(s.predators[1].mark).toBe(0);
    expect(s.sonar.ready).toBe(false);
    step(s, 181);
    expect(s.sonar.ready).toBe(true);
    expect(s.predators[0].mark).toBe(0);
  });
  it("ink breaks light fixes immediately but close hearing ignores it", () => {
    let s = fixture();
    s = debug.addPredator(s, "lanternjaw", 5, 10);
    s = debug.setPredatorTravel(s, 0, false);
    step(s);
    expect(s.predators[0].state).toBe("chase");
    step(s, 1, false, false, true);
    expect(s.predators[0].state).toBe("wander");
    s = debug.addPredator(s, "gloamfin", 5, 10);
    s = debug.setPredatorTravel(s, 1, false);
    step(s);
    expect(s.predators[1].hearingLock).toBe(true);
    expect(s.predators[1].state).toBe("chase");
    expect(s.inkClouds).toHaveLength(1);
  });
  it("light hunters linger after losing sight, and frozen minds make no decisions", () => {
    let s = fixture();
    s = debug.addPredator(s, "lanternjaw", 6, 10);
    s = debug.setPredatorTravel(s, 0, false);
    step(s);
    expect(s.predators[0].state).toBe("chase");
    s = debug.setForagerTile(s, 30, 10);
    step(s, 120);
    expect(s.predators[0].state).toBe("chase");
    step(s, 121);
    expect(s.predators[0].state).toBe("wander");
    s = debug.setPredatorMind(s, 0, false);
    const x = s.predators[0].x;
    step(s, 600);
    expect(s.predators[0].x).toBe(x);
    expect(s.predators[0].state).toBe("wander");
  });
  it("flares through rock and goes dark again after bloom", () => {
    let s = fixture();
    s = debug.setForagerTile(s, 1, 10);
    s = debug.addPredator(s, "flarefish", 20, 10);
    s = debug.setPredatorTravel(s, 0, false);
    step(s, 840);
    expect(s.predators[0].flareCharging).toBe(true);
    expect(s.predators[0].flaring).toBe(false);
    const cues = step(s, 60);
    expect(cues.has(C.CUES.flare)).toBe(true);
    expect(s.predators[0].flaring).toBe(true);
    expect(s.visibility[8][20]).toBe("l");
    step(s, 120);
    expect(s.predators[0].flaring).toBe(false);
    expect(s.visibility[8][20]).toBe("r");
  });
  it("admits drifters on cadence and awards the bonus on contact", () => {
    let s = initialState();
    s = debug.clearPredators(s);
    s = debug.setScreen(s, "playing");
    s = debug.setDrifterIn(s, 0);
    step(s);
    expect(s.drifters).toHaveLength(1);
    expect(s.drifterIn).toBe(C.DRIFTER_INTERVAL);
    s = debug.spawnDrifter(s, s.forager.tx, s.forager.ty);
    s = debug.setDrifterMind(s, 1, false);
    const score = s.score;
    step(s);
    expect(s.score).toBe(score + C.SCORE_DRIFTER);
  });
  it("reconcile is idempotent, pure and does not sense, reveal or advance", () => {
    let s = fixture();
    s = debug.setBrightness(s, 1);
    s = debug.setSonarCooldown(s, 99);
    s = debug.clearFog(s);
    const before = debug.snapshot(s);
    const next = debug.reconcile(s);
    expect(debug.snapshot(next)).toEqual(before);
    expect(debug.snapshot(s)).toEqual(before);
    expect(debug.reconcile(next)).toEqual(next);
  });
  it("rejects invalid poses and accepts disconnected fixtures", () => {
    const s = fixture();
    expect(() => debug.setBrightness(s, 2)).toThrow();
    expect(() => debug.setDepth(s, 0)).toThrow();
    expect(() => debug.setPredatorMind(s, 4, false)).toThrow();
    expect(() => debug.setMaze(s, ["."])).toThrow();
    expect(() => debug.setMenuIndex(s, 0)).toThrow();
    expect(() => debug.setForagerTile(s, 0, 0)).toThrow();
    expect(debug.setMaze(s, blank("#")).tiles).toEqual(blank("#"));
  });
});

describe("predator navigation and clocks", () => {
  it("releases the den roster on staggered slots while travel is disabled", () => {
    let s = initialState();
    s = debug.clearPlankton(s);
    s = debug.setScreen(s, "playing");
    for (let i = 0; i < s.predators.length; i++)
      s = debug.setPredatorTravel(s, i, false);
    step(s);
    expect(s.predators.map((p) => p.released)).toEqual([true, false, false]);
    step(s, 600);
    expect(s.predators.map((p) => p.released)).toEqual([true, true, false]);
    step(s, 600);
    expect(s.predators.map((p) => p.released)).toEqual([true, true, true]);
    expect(s.predators.every((p) => p.state === "den")).toBe(true);
    expect(s.predators.every((p) => !p.lit)).toBe(true);
  });
  it("paths around a wall instead of taking a direct rock shortcut", () => {
    let s = fixture();
    s = debug.setForagerTile(s, 9, 10);
    for (let x = 3; x <= 9; x++) put(s.tiles, x, 8, ".");
    put(s.tiles, 3, 9, ".");
    put(s.tiles, 9, 9, ".");
    put(s.tiles, 6, 10, "#");
    s = debug.addPredator(s, "lanternjaw", 3, 10);
    s = debug.setPredatorState(s, 0, "chase");
    step(s, 30);
    expect(s.predators[0].dir).toBe("up");
    expect(s.predators[0].ty).toBe(9);
    expect(s.predators[0].x).toBe(center(3, 10).x);
  });
  it("winds a Gloamfin up after a chase corner and searches an empty fix", () => {
    let s = fixture();
    for (let y = 6; y <= 10; y++) put(s.tiles, 8, y, ".");
    s = debug.setForagerTile(s, 8, 6);
    s = debug.addPredator(s, "gloamfin", 8, 10);
    s = debug.setPredatorDir(s, 0, "right");
    s = debug.setPredatorState(s, 0, "chase");
    step(s);
    expect(s.predators[0].speed).toBe(C.GLOAMFIN_CORNER_SPEED);
    expect(s.predators[0].y).toBeCloseTo(
      center(8, 10).y - C.GLOAMFIN_CORNER_SPEED * C.TICK_DT,
    );
    s = debug.setPredatorTravel(s, 0, false);
    step(s, 240);
    expect(s.predators[0].speed).toBe(C.GLOAMFIN_CHASE_SPEED);
    s = fixture();
    s = debug.setForagerTile(s, 9, 10);
    s = debug.addPredator(s, "gloamfin", 5, 10);
    s = debug.setPredatorState(s, 0, "chase");
    s = debug.setForagerTile(s, 30, 10);
    step(s, 140);
    expect(s.predators[0].state).toBe("search");
    s = debug.setPredatorTravel(s, 0, false);
    step(s, 150);
    expect(s.pulses.some((p) => p.tint === "orange")).toBe(true);
    step(s, 600);
    expect(s.predators[0].state).toBe("wander");
  });
  it("a bloom acquires through rock on a later tick, then ends at once", () => {
    let s = fixture();
    s = debug.setForagerTile(s, 1, 10);
    s = debug.addPredator(s, "flarefish", 20, 10);
    s = debug.setPredatorTravel(s, 0, false);
    step(s, 900);
    expect(s.predators[0].flaring).toBe(true);
    put(s.tiles, 18, 10, "#");
    s = debug.setForagerTile(s, 16, 10);
    step(s);
    expect(s.predators[0].state).toBe("chase");
    expect(s.predators[0].alert).toBe(true);
    expect(s.predators[0].flaring).toBe(false);
  });
  it("reset restores the entire observable dive and preserves mute", () => {
    let s = fixture();
    s = debug.setDepth(s, 9);
    s = debug.setScore(s, 1234);
    s = debug.setBrightness(s, 1);
    s = debug.setInkCooldown(s, 100);
    s = debug.spawnDrifter(s, 6, 10);
    s.muted = true;
    step(s, 5);
    const reset = debug.reset(s),
      expected = initialState();
    expected.muted = true;
    expect(debug.snapshot(reset)).toEqual(debug.snapshot(expected));
    expect(
      reset.predators.every((p) => p.mind && p.travel && !p.released),
    ).toBe(true);
  });
});

describe("engine integration", () => {
  it("loads all seeded art, registers diagnostics and drives menus, mute, pause and pointer", async () => {
    const { engine, key, target } = await engineHarness();
    expect(
      Object.values(engine.state.assets).reduce((n, a) => n + a.length, 0),
    ).toBe(75);
    expect(engine.debug.version).toBe(C.FATHOM_DEBUG_VERSION);
    expect(engine.diagnostics().every((d) => !d.error)).toBe(true);
    key("ArrowDown");
    await engine.advance(1);
    key("ArrowDown", false);
    key("Enter");
    await engine.advance(1);
    key("Enter", false);
    expect(engine.state.screen).toBe("howto");
    expect(engine.state.titleIndex).toBe(1);
    key("Escape");
    await engine.advance(1);
    key("Escape", false);
    expect(engine.state.screen).toBe("title");
    expect(engine.state.menuIndex).toBe(1);
    const r = engine.debug.menuItemRect(engine.state, 0)!;
    for (const type of ["pointerdown", "pointerup"])
      target.dispatchEvent(
        Object.assign(new Event(type), {
          clientX: r.x + 10,
          clientY: r.y + 10,
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: type === "pointerdown" ? 1 : 0,
          isPrimary: true,
        }),
      );
    await engine.advance(1);
    expect(engine.state.screen).toBe("countdown");
    await engine.advance(121);
    expect(engine.state.screen).toBe("playing");
    key("Escape");
    await engine.advance(1);
    key("Escape", false);
    expect(engine.state.screen).toBe("paused");
    const before = engine.state.forager.x;
    await engine.advance(30);
    expect(engine.state.forager.x).toBe(before);
    key("Escape");
    await engine.advance(1);
    key("Escape", false);
    expect(engine.state.screen).toBe("playing");
    key("KeyM");
    await engine.advance(1);
    expect(engine.state.muted).toBe(true);
    engine.destroy();
  });
  it("produces identical simulation across different frame divisions and leaves previous state untouched", async () => {
    const { engine } = await engineHarness(1000 / 120);
    const start = fixture();
    engine.apply(() => start);
    const before = debug.snapshot(start);
    await engine.advance(120);
    const a = debug.snapshot(engine.state);
    expect(debug.snapshot(start)).toEqual(before);
    engine.apply(() => fixture());
    engine.setClock(new ConstantClock(1000 / 30));
    await engine.advance(30);
    expect(debug.snapshot(engine.state)).toEqual(a);
    engine.destroy();
  });
});
