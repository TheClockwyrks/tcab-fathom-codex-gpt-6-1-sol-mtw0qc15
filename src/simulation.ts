import * as C from "./constants";
import type {
  Body,
  Drifter,
  FathomState,
  Predator,
  ReadState,
  Pulse,
  Screen,
} from "./game";
import {
  blank,
  center,
  directions,
  distance,
  distances,
  layout,
  lineClear,
  locate,
  move,
  neighbor,
  open,
  opposite,
  options,
  put,
  route,
  tile,
} from "./maze";

/** Copy mutable simulation data while retaining the engine-loaded immutable bitmaps. */
export function clone(s: ReadState): FathomState {
  return {
    ...s,
    grid: { ...s.grid },
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    forager: { ...s.forager },
    start: { ...s.start },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix ? { ...p.fix } : null,
    })),
    drifters: s.drifters.map((d) => ({ ...d })),
    pulses: s.pulses.map((p) => ({ ...p, caught: [...p.caught] })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    pointerDown: { ...s.pointerDown },
    assets: s.assets as Record<string, ImageBitmap[]>,
  };
}
export function body(tx: number, ty: number): Body {
  return { ...center(tx, ty), dir: "up", moving: false };
}
export function drifter(tx: number, ty: number): Drifter {
  return { ...body(tx, ty), mind: true, travel: true, lit: false };
}
export function predator(
  kind: C.PredatorKind,
  tx: number,
  ty: number,
): Predator {
  return {
    ...drifter(tx, ty),
    kind,
    state: "wander",
    released: true,
    speed: kind === "lanternjaw" ? C.DRIFTER_SPEED : C.PREDATOR_SPEED,
    alert: false,
    detectRange: kind === "gloamfin" ? null : C.LANTERN_RANGE_BASE,
    hearingRange: kind === "gloamfin" ? C.GLOAMFIN_HEAR : null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    fix: null,
    alertLeft: 0,
    mark: 0,
    linger: 0,
    sensed: false,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    sincePing: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    flareIn: C.FLARE_INTERVAL,
    flarePhase: 0,
    fade: 0,
    releaseAt: null,
  };
}
export function roster(s: FathomState): void {
  const kinds = [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(s.depth, C.ROSTER_CAP_DEPTH) - 1),
  ];
  const den: { tx: number; ty: number }[] = [];
  s.tiles.forEach((r, y) =>
    [...r].forEach((t, x) => {
      if (t === "d") den.push({ tx: x, ty: y });
    }),
  );
  s.predators = kinds.map((k, i) => {
    const p = den[i % den.length] ?? s.start;
    return {
      ...predator(k, p.tx, p.ty),
      state: "den",
      released: false,
      releaseAt: i * C.DEN_RELEASE_GAP,
    };
  });
  s.playTime = 0;
}
export function initialState(
  assets: Record<string, ImageBitmap[]> = {},
  muted = false,
): FathomState {
  const tiles = layout();
  const s: FathomState = {
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((r) => r.replace(/[^.]/g, "-").replace(/\./g, "*")),
    visibility: blank("u"),
    forager: body(17, 16),
    drifters: [],
    predators: [],
    pulses: [],
    inkClouds: [],
    simTime: 0,
    pendingSonar: false,
    pendingInk: false,
    remainder: 0,
    playTime: 0,
    screenLeft: 2,
    desired: "up",
    rng: 0xabc123,
    start: { tx: 17, ty: 16 },
    pointerDown: {},
    assets,
  };
  roster(s);
  reconcile(s);
  return s;
}
export function reconcile(s: FathomState): FathomState {
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (s.depth - 1),
  );
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.reduce(
    (n, r) => n + [...r].filter((t) => t === "*").length,
    0,
  );
  for (const b of [s.forager, ...s.drifters, ...s.predators])
    Object.assign(b, locate(b));
  for (const p of s.predators) {
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
    p.speed =
      p.kind === "lanternjaw" && p.state === "wander"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
  }
  return s;
}
export function setScreen(s: FathomState, screen: Screen): void {
  if (screen === "playing" && s.screen !== "paused" && s.screen !== "playing")
    s.playTime = 0;
  s.screen = screen;
  s.menuIndex =
    screen === "title"
      ? s.titleIndex
      : ["paused", "gameover"].includes(screen)
        ? 0
        : null;
  if (screen === "countdown" || screen === "cleared") s.screenLeft = 2;
  s.pointerDown = {};
}
export function fresh(
  s: FathomState,
  screen: Screen,
  depth = 1,
  keepRun = false,
): FathomState {
  const n = initialState(s.assets, s.muted);
  n.titleIndex = s.titleIndex;
  n.simTime = s.simTime;
  n.remainder = s.remainder;
  n.depth = depth;
  if (keepRun) {
    n.score = s.score;
    n.lives = s.lives;
  }
  roster(n);
  reconcile(n);
  setScreen(n, screen);
  return n;
}
function resetLife(s: FathomState): void {
  // Previous light becomes memory; the countdown lights only the new start.
  s.visibility = s.visibility.map((row) => row.replace(/l/g, "r"));
  s.forager = body(s.start.tx, s.start.ty);
  s.brightness = 0;
  s.brightHold = 0;
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.desired = "up";
  roster(s);
  setScreen(s, "countdown");
}
function random(s: FathomState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
function wander(s: FathomState, b: Body, den = false) {
  const opts = options(s, b.tx, b.ty, den);
  const without = opts.filter((d) => d !== opposite(b.dir));
  const choices = without.length ? without : opts;
  return choices.length
    ? choices[Math.floor(random(s) * choices.length)]
    : null;
}
const same = (a: { tx: number; ty: number }, b: { tx: number; ty: number }) =>
  a.tx === b.tx && a.ty === b.ty;
function acquire(s: FathomState, p: Predator, fresh = false): void {
  if (p.state !== "chase" || fresh) {
    if (p.kind !== "lanternjaw") {
      p.alertLeft = C.ALERT_TIME;
      p.alert = true;
    }
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
  }
  p.state = "chase";
  p.fix = { tx: s.forager.tx, ty: s.forager.ty };
  p.linger = C.LINGER_TIME;
  p.searchTime = 0;
  p.searchPing = false;
  if (p.kind === "flarefish") {
    p.flarePhase = 0;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
    p.flareIn = C.FLARE_INTERVAL;
  }
}
function giveUp(p: Predator): void {
  p.state = "wander";
  p.fix = null;
  p.sensed = false;
  p.linger = 0;
  if (p.kind === "flarefish") {
    p.flareIn = C.FLARE_INTERVAL;
    p.flarePhase = 0;
    p.flaring = false;
    p.flareCharging = false;
    p.flareRadius = 0;
  }
}
function segmentDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(a.x + t * dx - c.x, a.y + t * dy - c.y);
}
export function cast(
  s: FathomState,
  source: Pulse["source"],
  b: Body,
  tint: Pulse["tint"],
  range: number,
  owner: number | null = null,
): void {
  s.pulses.push({
    source,
    tint,
    ox: b.tx,
    oy: b.ty,
    front: 0,
    range,
    caught: [],
    heard: false,
    owner,
  });
}
function ping(
  s: FathomState,
  p: Predator,
  tint: Pulse["tint"],
  cues: Set<C.CueName>,
): void {
  cast(s, "gloamfin", p, tint, C.GLOAMFIN_PING_RANGE, s.predators.indexOf(p));
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.sincePing = 0;
  cues.add(C.CUES.predatorPing);
}
function mind(s: FathomState, p: Predator, cues: Set<C.CueName>): void {
  const dt = C.TICK_DT;
  if (!p.mind) return;
  if (p.state === "den") {
    if (!s.tiles.some((r) => r.includes("d"))) return;
    if (p.releaseAt !== null && s.playTime + 1e-9 >= p.releaseAt)
      p.released = true;
    if (p.released && p.travel) {
      const gy = s.tiles.findIndex((r) => r.includes("g"));
      const gx = gy >= 0 ? s.tiles[gy].indexOf("g") : -1;
      if (gx < 0) return;
      const exits = options(s, gx, gy, true)
        .map((d) => neighbor(s, gx, gy, d))
        .filter((n) => tile(s, n.tx, n.ty) === ".");
      const target = exits[0];
      if (!target) return;
      move(s, p, C.PREDATOR_SPEED, true, () => route(s, p, target, true));
      if (tile(s, p.tx, p.ty) === ".") p.state = "wander";
    }
    return;
  }
  p.alertLeft = Math.max(0, p.alertLeft - dt);
  p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
  const dist = distance(p, s.forager);
  if (p.kind === "gloamfin") {
    const was = p.hearingLock;
    p.hearingLock = dist <= C.GLOAMFIN_HEAR;
    p.pingIn = Math.max(0, p.pingIn - dt);
    p.sincePing += dt;
    if (p.hearingLock) {
      acquire(s, p, !was);
    }
    p.chaseSpeed = Math.min(
      C.GLOAMFIN_CHASE_SPEED,
      p.chaseSpeed +
        ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * dt) /
          C.GLOAMFIN_RAMP_TIME,
    );
    if (
      p.state === "chase" &&
      p.fix &&
      same(p, p.fix) &&
      !same(p, s.forager) &&
      !p.hearingLock
    ) {
      p.state = "search";
      p.searchTime = 0;
      p.searchPing = false;
    }
    if (p.state === "search") {
      p.searchTime += dt;
      if (p.searchTime >= C.GLOAMFIN_GIVEUP) giveUp(p);
      else if (
        !p.searchPing &&
        p.searchTime >= C.GLOAMFIN_SEARCH_DELAY &&
        !p.hearingLock &&
        p.sincePing + 1e-9 >= C.GLOAMFIN_PING_MIN_GAP
      ) {
        ping(s, p, "orange", cues);
        p.searchPing = true;
      }
    }
    if (
      p.pingIn <= 1e-9 &&
      !p.hearingLock &&
      p.sincePing + 1e-9 >= C.GLOAMFIN_PING_MIN_GAP
    )
      ping(s, p, "violet", cues);
  } else {
    const blinded = s.inkClouds.some(
      (c) => segmentDistance(p, s.forager, c) <= c.radius,
    );
    const sensed =
      !blinded &&
      ((dist <= (p.detectRange ?? 0) && lineClear(s, p, s.forager)) ||
        (p.flaring && dist <= C.FLARE_RADIUS));
    if (blinded) {
      if (p.state === "chase") giveUp(p);
    } else if (sensed) {
      acquire(s, p);
      p.sensed = true;
    } else if (p.state === "chase") {
      p.sensed = false;
      p.linger = Math.max(0, p.linger - dt);
      if (p.linger <= 1e-9) giveUp(p);
    }
    if (p.kind === "flarefish" && p.state === "wander") {
      if (p.flarePhase === 0) {
        p.flareIn = Math.max(0, p.flareIn - dt);
        if (p.flareIn <= 1e-9) {
          p.flarePhase = 1;
          p.flareIn = C.FLARE_CHARGE;
          p.flareCharging = true;
        }
      } else if (p.flarePhase === 1) {
        p.flareIn = Math.max(0, p.flareIn - dt);
        if (p.flareIn <= 1e-9) {
          p.flarePhase = 2;
          p.flareIn = C.FLARE_BLOOM;
          p.flareCharging = false;
          p.flaring = true;
          p.flareRadius = C.FLARE_RADIUS;
          cues.add(C.CUES.flare);
          if (!blinded && dist <= C.FLARE_RADIUS) acquire(s, p);
        }
      } else {
        p.flareIn = Math.max(0, p.flareIn - dt);
        if (p.flareIn <= 1e-9) {
          p.flarePhase = 0;
          p.flaring = false;
          p.flareRadius = 0;
          p.flareIn = C.FLARE_INTERVAL;
          p.fade = 0.35;
        }
      }
    }
  }
  if (!p.travel) return;
  reconcileSpeed(p);
  const choose = () => {
    let d;
    if (p.state === "chase" && p.fix) {
      if (same(p, p.fix)) return null;
      d = route(s, p, p.fix);
    } else if (
      p.state === "search" &&
      p.fix &&
      Math.abs(p.tx - p.fix.tx) + Math.abs(p.ty - p.fix.ty) >
        C.GLOAMFIN_SEARCH_ROAM
    )
      d = route(s, p, p.fix);
    else d = wander(s, p);
    if (
      d &&
      p.kind === "gloamfin" &&
      p.state === "chase" &&
      d !== p.dir &&
      d !== opposite(p.dir)
    ) {
      p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
      p.speed = p.chaseSpeed;
    }
    return d ?? null;
  };
  if (p.state === "chase" && p.fix && !same(p, p.fix)) {
    const d = route(s, p, p.fix);
    if (d === opposite(p.dir)) p.dir = d;
  }
  if (
    p.state === "chase" &&
    p.fix &&
    same(p, p.fix) &&
    distance(p, center(p.tx, p.ty)) < 1e-7
  )
    return;
  move(s, p, () => p.speed, false, choose);
}
function reconcileSpeed(p: Predator): void {
  p.speed =
    p.kind === "lanternjaw" && p.state === "wander"
      ? C.DRIFTER_SPEED
      : p.kind === "gloamfin" && p.state === "chase"
        ? p.chaseSpeed
        : C.PREDATOR_SPEED;
}
function pulses(s: FathomState): void {
  for (const pulse of s.pulses) {
    const old = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const dist = distances(s, pulse.ox, pulse.oy);
    const reached = (x: number, y: number) => {
      const d = dist[y * C.GRID_COLS + x];
      return (
        d >= 0 &&
        d <= pulse.range &&
        d <= pulse.front + 1e-9 &&
        (d > old + 1e-9 || old === 0)
      );
    };
    if (pulse.source === "forager") {
      for (let y = 0; y < C.GRID_ROWS; y++)
        for (let x = 0; x < C.GRID_COLS; x++)
          if (reached(x, y)) {
            put(s.visibility, x, y, "l");
            for (const d of directions) {
              const n = neighbor(s, x, y, d);
              if (
                tile(s, n.tx, n.ty) === "#" &&
                n.tx >= 0 &&
                n.tx < C.GRID_COLS &&
                n.ty >= 0 &&
                n.ty < C.GRID_ROWS
              )
                put(s.visibility, n.tx, n.ty, "l");
            }
          }
      s.predators.forEach((p, i) => {
        if (
          p.state !== "den" &&
          p.kind !== "lanternjaw" &&
          reached(p.tx, p.ty) &&
          !pulse.caught.includes(i)
        ) {
          p.mark = C.SONAR_MARK_TIME;
          pulse.caught.push(i);
          if (p.kind === "gloamfin" && p.mind) acquire(s, p, true);
        }
      });
    } else if (!pulse.heard && reached(s.forager.tx, s.forager.ty)) {
      const hunter =
        pulse.owner === null ? undefined : s.predators[pulse.owner];
      if (hunter?.mind && hunter.state !== "den") acquire(s, hunter, true);
      pulse.heard = true;
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range + 1e-9);
}
export function lighting(s: FathomState): void {
  const lit = (b: { x: number; y: number }) =>
    distance(s.forager, b) <= s.visionRadius && lineClear(s, s.forager, b);
  const blooms = s.predators.filter((p) => p.state !== "den" && p.flaring);
  const inFlare = (b: { x: number; y: number }) =>
    blooms.some((p) => distance(p, b) <= C.FLARE_RADIUS);
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const c = center(x, y);
      if (lit(c) || inFlare(c)) put(s.visibility, x, y, "l");
    }
  for (const p of s.predators)
    p.lit =
      p.state !== "den" && (lit(p) || inFlare(p) || p.mark > 0 || p.alert);
  for (const d of s.drifters) d.lit = lit(d) || inFlare(d);
}
export function tick(
  s: FathomState,
  held: boolean,
  sonar: boolean,
  ink: boolean,
  cues: Set<C.CueName>,
): void {
  const dt = C.TICK_DT;
  s.simTime += dt;
  if (s.screen === "cleared") {
    s.screenLeft -= dt;
    if (s.screenLeft <= 1e-9)
      Object.assign(s, fresh(s, "countdown", s.depth + 1, true));
    return;
  }
  if (s.screen === "countdown") {
    lighting(s);
    s.screenLeft -= dt;
    if (s.screenLeft <= 1e-9) setScreen(s, "playing");
    return;
  }
  if (s.screen !== "playing") return;
  s.visibility = s.visibility.map((r) => r.replace(/l/g, "r"));
  for (const p of s.predators) {
    p.mark = Math.max(0, p.mark - dt);
    p.fade = Math.max(0, p.fade - dt);
  }
  s.sonar.cooldown = Math.max(0, s.sonar.cooldown - dt);
  s.ink.cooldown = Math.max(0, s.ink.cooldown - dt);
  if (sonar && s.sonar.cooldown === 0) {
    cast(s, "forager", s.forager, "cyan", s.sonar.range);
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    cues.add(C.CUES.sonar);
  }
  if (ink && s.ink.cooldown === 0) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    cues.add(C.CUES.ink);
  }
  const decay = Math.max(0, dt - s.brightHold);
  s.brightHold = Math.max(0, s.brightHold - dt);
  s.brightness *= 0.5 ** (decay / C.BRIGHT_HALFLIFE);
  s.inkClouds = s.inkClouds
    .map((c) => ({ ...c, remaining: c.remaining - dt }))
    .filter((c) => c.remaining > 1e-9);
  if (held) {
    if (s.desired === opposite(s.forager.dir)) s.forager.dir = s.desired;
    move(s, s.forager, C.FORAGER_SPEED, false, () => {
      const n = neighbor(s, s.forager.tx, s.forager.ty, s.desired);
      return open(s, n.tx, n.ty) ? s.desired : s.forager.dir;
    });
  } else s.forager.moving = false;
  const f = s.forager;
  if (s.plankton[f.ty]?.[f.tx] === "*" && tile(s, f.tx, f.ty) === ".") {
    put(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cues.add(C.CUES.eat);
    if (s.planktonRemaining === 0) {
      s.score += C.SCORE_CLEAR;
      cues.add(C.CUES.descend);
      setScreen(s, "cleared");
      return;
    }
  }
  reconcile(s);
  for (const p of s.predators) mind(s, p, cues);
  for (const d of s.drifters)
    if (d.mind && d.travel)
      move(s, d, C.DRIFTER_SPEED, false, () => wander(s, d));
  pulses(s);
  s.drifters = s.drifters.filter((d) => {
    if (same(d, f)) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  if (s.predators.some((p) => p.state !== "den" && same(p, f))) {
    cues.add(C.CUES.caught);
    if (s.lives === 0) setScreen(s, "gameover");
    else {
      s.lives--;
      resetLife(s);
    }
    return;
  }
  if (s.planktonRemaining > 0) {
    s.drifterIn = Math.max(0, s.drifterIn - dt);
    if (s.drifterIn <= 1e-9) {
      if (s.drifters.length < C.DRIFTER_MAX) {
        const y = s.tiles.findIndex((r) => r.includes("g"));
        if (y >= 0) {
          const x = s.tiles[y].indexOf("g");
          const n = options(s, x, y, true)
            .map((d) => neighbor(s, x, y, d))
            .find((n) => tile(s, n.tx, n.ty) === ".");
          if (n) s.drifters.push(drifter(n.tx, n.ty));
        }
      }
      s.drifterIn = C.DRIFTER_INTERVAL;
    }
  }
  s.playTime += dt;
  reconcile(s);
  lighting(s);
}
