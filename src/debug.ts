import * as C from "./constants";
import type {
  Direction,
  FathomDebugApi,
  FathomState,
  Predator,
  ReadState,
  Screen,
} from "./game";
import { blank, center, open, put, tile } from "./maze";
import {
  clone,
  drifter,
  initialState,
  predator,
  reconcile,
  roster,
  setScreen,
} from "./simulation";
import { menuItems, menuItemRect } from "./presentation";
function requireValue(
  valid: boolean,
  message = "Invalid Fathom debug argument",
): asserts valid {
  if (!valid) throw new RangeError(message);
}
function number(n: number, min = 0, max = Infinity, integer = false): void {
  requireValue(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isInteger(n)),
  );
}
function bool(v: boolean): void {
  requireValue(typeof v === "boolean");
}
function dir(d: Direction): void {
  requireValue(["up", "down", "left", "right"].includes(d));
}
function coords(s: ReadState, x: number, y: number, den = false): void {
  number(x, 0, C.GRID_COLS - 1, true);
  number(y, 0, C.GRID_ROWS - 1, true);
  requireValue(open(s, x, y, den), "Tile is closed");
}
function pose(s: ReadState, fn: (n: FathomState) => void): FathomState {
  const n = clone(s);
  fn(n);
  return reconcile(n);
}
function pred(
  s: ReadState,
  i: number,
  fn: (p: Predator, n: FathomState) => void,
): FathomState {
  number(i, 0, s.predators.length - 1, true);
  return pose(s, (n) => fn(n.predators[i], n));
}
function driftFlag(
  s: ReadState,
  i: number,
  v: boolean,
  key: "mind" | "travel",
): FathomState {
  number(i, 0, s.drifters.length - 1, true);
  bool(v);
  return pose(s, (n) => {
    n.drifters[i][key] = v;
  });
}
export function snapshot(s: ReadState) {
  return {
    version: s.version,
    screen: s.screen,
    menuIndex: s.menuIndex,
    titleIndex: s.titleIndex,
    depth: s.depth,
    score: s.score,
    lives: s.lives,
    muted: s.muted,
    planktonRemaining: s.planktonRemaining,
    drifterIn: s.drifterIn,
    brightness: s.brightness,
    brightHold: s.brightHold,
    visionRadius: s.visionRadius,
    windowRadius: s.windowRadius,
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    grid: { ...s.grid },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    drifters: s.drifters.map((d) => ({
      x: d.x,
      y: d.y,
      tx: d.tx,
      ty: d.ty,
      lit: d.lit,
      mind: d.mind,
      travel: d.travel,
    })),
    predators: s.predators.map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      tx: p.tx,
      ty: p.ty,
      dir: p.dir,
      state: p.state,
      released: p.released,
      mind: p.mind,
      travel: p.travel,
      speed: p.speed,
      alert: p.alert,
      lit: p.lit,
      detectRange: p.detectRange,
      hearingRange: p.hearingRange,
      hearingLock: p.hearingLock,
      flareCharging: p.flareCharging,
      flaring: p.flaring,
      flareRadius: p.flareRadius,
    })),
    pulses: s.pulses.map((p) => ({
      source: p.source,
      tint: p.tint,
      ox: p.ox,
      oy: p.oy,
      front: p.front,
      range: p.range,
    })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    simTime: s.simTime,
  };
}
export type FathomSnapshot = ReturnType<typeof snapshot>;
export const debug: FathomDebugApi = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s) =>
    initialState(s.assets as Record<string, ImageBitmap[]>, s.muted),
  snapshot,
  reconcile: (s) => reconcile(clone(s)),
  setScreen: (s, v) => {
    requireValue(
      (
        [
          "title",
          "howto",
          "countdown",
          "playing",
          "paused",
          "cleared",
          "gameover",
        ] as Screen[]
      ).includes(v),
    );
    return pose(s, (n) => setScreen(n, v));
  },
  setMenuIndex: (s, i) => {
    number(i, 0, menuItems(s).length - 1, true);
    return pose(s, (n) => {
      n.menuIndex = i;
    });
  },
  setTitleIndex: (s, i) => {
    number(i, 0, C.TITLE_ITEMS.length - 1, true);
    return pose(s, (n) => {
      n.titleIndex = i;
    });
  },
  menuItemRect,
  setScore: (s, v) => {
    number(v, 0, Infinity, true);
    return pose(s, (n) => {
      n.score = v;
    });
  },
  setLives: (s, v) => {
    number(v, 0, Infinity, true);
    return pose(s, (n) => {
      n.lives = v;
    });
  },
  setDepth: (s, v) => {
    number(v, 1, Infinity, true);
    return pose(s, (n) => {
      n.depth = v;
      roster(n);
    });
  },
  setMaze: (s, rows) => {
    requireValue(
      Array.isArray(rows) &&
        rows.length === C.GRID_ROWS &&
        rows.every(
          (r) =>
            typeof r === "string" &&
            r.length === C.GRID_COLS &&
            /^[#.dg]+$/.test(r),
        ),
    );
    const text = rows.join("");
    const gates = [...text].filter((t) => t === "g").length;
    requireValue((!text.includes("d") && gates === 0) || gates === 1);
    return pose(s, (n) => {
      n.tiles = [...rows];
    });
  },
  setPlankton: (s, x, y, v) => {
    coords(s, x, y);
    bool(v);
    return pose(s, (n) => put(n.plankton, x, y, v ? "*" : "-"));
  },
  clearPlankton: (s) =>
    pose(s, (n) => {
      n.plankton = blank("-");
    }),
  clearFog: (s) =>
    pose(s, (n) => {
      n.visibility = blank("u");
    }),
  setForagerTile: (s, x, y) => {
    coords(s, x, y);
    return pose(s, (n) => {
      Object.assign(n.forager, center(x, y), { moving: false });
    });
  },
  setForagerDir: (s, d) => {
    dir(d);
    return pose(s, (n) => {
      n.forager.dir = d;
      n.desired = d;
      n.forager.moving = false;
    });
  },
  setBrightness: (s, v) => {
    number(v, 0, 1);
    return pose(s, (n) => {
      n.brightness = v;
    });
  },
  setBrightHold: (s, v) => {
    number(v, 0, C.BRIGHT_HOLD);
    return pose(s, (n) => {
      n.brightHold = v;
    });
  },
  clearPredators: (s) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator: (s, k, x, y) => {
    requireValue(C.DEN_ORDER.includes(k));
    coords(s, x, y);
    return pose(s, (n) => {
      n.predators.push(predator(k, x, y));
    });
  },
  setPredatorTile: (s, i, x, y) => {
    coords(s, x, y, true);
    return pred(s, i, (p) => Object.assign(p, center(x, y)));
  },
  setPredatorDir: (s, i, d) => {
    dir(d);
    return pred(s, i, (p) => {
      p.dir = d;
    });
  },
  setPredatorState: (s, i, v) => {
    requireValue(["den", "wander", "chase"].includes(v));
    return pred(s, i, (p, n) => {
      requireValue(
        v === "den"
          ? ["d", "g"].includes(tile(n, p.tx, p.ty))
          : tile(n, p.tx, p.ty) === ".",
      );
      p.state = v;
      p.fix = v === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = v === "chase" ? C.LINGER_TIME : 0;
      p.sensed = false;
      p.hearingLock = p.kind === "gloamfin" ? false : null;
      p.alert = false;
      p.alertLeft = 0;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
      if (p.kind === "flarefish") {
        p.flareIn = C.FLARE_INTERVAL;
        p.flarePhase = 0;
        p.flareCharging = false;
        p.flaring = false;
        p.flareRadius = 0;
      }
    });
  },
  setPredatorReleased: (s, i, v) => {
    bool(v);
    return pred(s, i, (p) => {
      p.released = v;
    });
  },
  setPredatorMind: (s, i, v) => {
    bool(v);
    return pred(s, i, (p) => {
      p.mind = v;
    });
  },
  setPredatorTravel: (s, i, v) => {
    bool(v);
    return pred(s, i, (p) => {
      p.travel = v;
    });
  },
  spawnDrifter: (s, x, y) => {
    coords(s, x, y);
    return pose(s, (n) => {
      n.drifters.push(drifter(x, y));
    });
  },
  clearDrifters: (s) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s, i, v) => driftFlag(s, i, v, "mind"),
  setDrifterTravel: (s, i, v) => driftFlag(s, i, v, "travel"),
  setDrifterIn: (s, v) => {
    number(v, 0, C.DRIFTER_INTERVAL);
    return pose(s, (n) => {
      n.drifterIn = v;
    });
  },
  setSonarCooldown: (s, v) => {
    number(v);
    return pose(s, (n) => {
      n.sonar.cooldown = v;
    });
  },
  setInkCooldown: (s, v) => {
    number(v);
    return pose(s, (n) => {
      n.ink.cooldown = v;
    });
  },
};
