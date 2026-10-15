import type { Game } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import * as C from "./constants";
import { initialState, reconcile, clone, tick, lighting } from "./simulation";
import { debug, type FathomSnapshot } from "./debug";
import { render, menuItems, menuItemRect, controls } from "./presentation";
export type Direction = "up" | "down" | "left" | "right";
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";
export interface Body {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Direction;
  moving: boolean;
}
export interface Drifter extends Body {
  lit: boolean;
  mind: boolean;
  travel: boolean;
}
export interface Predator extends Drifter {
  kind: C.PredatorKind;
  state: "den" | "wander" | "chase" | "search";
  released: boolean;
  speed: number;
  alert: boolean;
  detectRange: number | null;
  hearingRange: number | null;
  hearingLock: boolean | null;
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;
  fix: { tx: number; ty: number } | null;
  alertLeft: number;
  mark: number;
  linger: number;
  sensed: boolean;
  chaseSpeed: number;
  pingIn: number;
  sincePing: number;
  searchTime: number;
  searchPing: boolean;
  flareIn: number;
  flarePhase: number;
  fade: number;
  releaseAt: number | null;
}
export interface Pulse {
  source: "forager" | "gloamfin";
  tint: "cyan" | "violet" | "orange";
  ox: number;
  oy: number;
  front: number;
  range: number;
  caught: number[];
  heard: boolean;
  owner: number | null;
}
export interface FathomState {
  version: number;
  screen: Screen;
  menuIndex: number | null;
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  drifterIn: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  windowRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: Body;
  drifters: Drifter[];
  predators: Predator[];
  pulses: Pulse[];
  inkClouds: { x: number; y: number; radius: number; remaining: number }[];
  simTime: number;
  pendingSonar: boolean;
  pendingInk: boolean;
  remainder: number;
  playTime: number;
  screenLeft: number;
  desired: Direction;
  rng: number;
  start: { tx: number; ty: number };
  pointerDown: Record<number, number>;
  assets: Record<string, ImageBitmap[]>;
}
export type ReadState = DeepReadonly<FathomState>;
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FathomDebugApi {
  version: number;
  reset(s: ReadState): FathomState;
  snapshot(s: ReadState): FathomSnapshot;
  reconcile(s: ReadState): FathomState;
  setScreen(s: ReadState, v: Screen): FathomState;
  setMenuIndex(s: ReadState, n: number): FathomState;
  setTitleIndex(s: ReadState, n: number): FathomState;
  menuItemRect(s: ReadState, n: number): Rect | null;
  setScore(s: ReadState, n: number): FathomState;
  setLives(s: ReadState, n: number): FathomState;
  setDepth(s: ReadState, n: number): FathomState;
  setMaze(s: ReadState, rows: string[]): FathomState;
  setPlankton(s: ReadState, x: number, y: number, v: boolean): FathomState;
  clearPlankton(s: ReadState): FathomState;
  clearFog(s: ReadState): FathomState;
  setForagerTile(s: ReadState, x: number, y: number): FathomState;
  setForagerDir(s: ReadState, d: Direction): FathomState;
  setBrightness(s: ReadState, n: number): FathomState;
  setBrightHold(s: ReadState, n: number): FathomState;
  clearPredators(s: ReadState): FathomState;
  addPredator(
    s: ReadState,
    k: C.PredatorKind,
    x: number,
    y: number,
  ): FathomState;
  setPredatorTile(s: ReadState, i: number, x: number, y: number): FathomState;
  setPredatorDir(s: ReadState, i: number, d: Direction): FathomState;
  setPredatorState(
    s: ReadState,
    i: number,
    v: "den" | "wander" | "chase",
  ): FathomState;
  setPredatorReleased(s: ReadState, i: number, v: boolean): FathomState;
  setPredatorMind(s: ReadState, i: number, v: boolean): FathomState;
  setPredatorTravel(s: ReadState, i: number, v: boolean): FathomState;
  spawnDrifter(s: ReadState, x: number, y: number): FathomState;
  clearDrifters(s: ReadState): FathomState;
  setDrifterMind(s: ReadState, i: number, v: boolean): FathomState;
  setDrifterTravel(s: ReadState, i: number, v: boolean): FathomState;
  setDrifterIn(s: ReadState, n: number): FathomState;
  setSonarCooldown(s: ReadState, n: number): FathomState;
  setInkCooldown(s: ReadState, n: number): FathomState;
}
export const BACKGROUND = "#03060c";
export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const action of C.ACTIONS)
      api.input.register(action, { keys: [...C.BINDINGS[action]] });
    const tones = [
      [780, 1100, 65],
      [580, 100, 420],
      [100, 35, 250],
      [260, 490, 240],
      [90, 800, 450],
      [180, 40, 480],
      [440, 1200, 650],
    ];
    Object.values(C.CUES).forEach((cue, i) =>
      api.audio.define(cue, {
        freq: tones[i][0],
        freqTo: tones[i][1],
        durationMs: tones[i][2],
        gain: 0.12,
        wave: i === 2 ? "triangle" : "sine",
      }),
    );
    const state = initialState();
    const sheets: [string, number][] = [
      ["glimmerfin", 8],
      ["lanternjaw", 16],
      ["gloamfin", 8],
      ["flarefish", 8],
      ["drifter", 8],
      ["flare-bloom", 8],
      ["trench-walls", 19],
    ];
    await Promise.all(
      sheets.map(async ([name, count]) => {
        state.assets[name] = await Promise.all(
          Array.from({ length: count }, (_, i) =>
            api.assets.loadImage(`${name}/${i}.png`),
          ),
        );
      }),
    );
    for (const key of [
      "screen",
      "depth",
      "score",
      "lives",
      "brightness",
      "visionRadius",
      "windowRadius",
      "planktonRemaining",
    ] as const)
      api.diagnostics.register(key, (s) => s[key]);
    api.diagnostics.register("sonar", (s) => s.sonar.cooldown);
    api.diagnostics.register("ink", (s) => s.ink.cooldown);
    api.diagnostics.register(
      "forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    for (let i = 0; i < C.ROSTER_CAP * C.DEN_ORDER.length; i++)
      api.diagnostics.register(`predator ${i}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
          : "none";
      });
    return [state, debug];
  },
  update(state, api, dt) {
    let s = clone(state);
    const wasPlaying = state.screen === "playing";
    s = controls(s, api);
    s.muted = api.audio.muted();
    const held = (["up", "down", "left", "right"] as Direction[]).filter(
      (d) => api.input.value(d) > 0,
    );
    if (s.screen === "playing") {
      for (const d of held)
        if (api.input.pressed(d) || held.length === 1) s.desired = d;
    }
    s.pendingSonar ||=
      wasPlaying && s.screen === "playing" && api.input.pressed("a");
    s.pendingInk ||=
      wasPlaying && s.screen === "playing" && api.input.pressed("b");
    s.remainder += dt;

    while (s.remainder + 1e-10 >= C.TICK_DT) {
      s.remainder = Math.max(0, s.remainder - C.TICK_DT);
      const cues = new Set<C.CueName>();
      tick(s, held.length > 0, s.pendingSonar, s.pendingInk, cues);
      s.pendingSonar = false;
      s.pendingInk = false;
      for (const cue of cues) api.audio.play(cue);
    }
    reconcile(s);
    if (s.screen === "playing" || s.screen === "countdown") lighting(s);
    return s;
  },
  render,
};
// The same regions are used by rendering, input, and the debug reading.
export { menuItems, menuItemRect };

export type { FathomSnapshot } from "./debug";
export type { PredatorKind } from "./constants";
