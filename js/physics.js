// @ts-check
// js/physics.js — integration, rail collision, circle-circle contact stop,
// rest detection (BUILD_SPEC.md §5 Motion + ARENA subsection; VOID's open-edge
// branch is step 7, not built here — see the spec's own note that VOID is
// "one branch in the collision code"). No DOM/canvas imports: runs headless
// under `node test.js`.
//
// Circle-circle contact stops the circle(s) involved dead (velocity zeroed,
// overlap de-penetrated) — Eytan's live correction to the original step-2
// call: "why pass through. it stops the circle and then a popup says you
// lost this round." The stop is physics; the popup/lost-round is a rules-layer
// consequence of contact and is step 3 content, not built here.

import { CONFIG } from './config.js';
import { subtract, length, closestPointOnSegment, reflect } from './vec.js';

// Precomputed ONCE at module init, applied as a plain multiply every step —
// never re-derived per-step (determinism/perf requirement).
const DRAG_FACTOR = Math.exp(-CONFIG.physics.drag * CONFIG.physics.dt);

/**
 * @typedef {Object} Circle
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} prevX  position before this step's integration, for render lerp
 * @property {number} prevY
 * @property {number} rawX  position after integration but before resolveRails
 *   clips it — rules.js (step 3) tests pass/goal-line crossings against this
 *   raw motion segment, since a rail clip in the same step could otherwise
 *   silently erase a crossing that geometrically already happened.
 * @property {number} rawY
 * @property {boolean} fallen  VOID mode only (§5/§7): true once this
 *   circle's centre has left the field bounds. Frozen in place the instant
 *   it's set (see `checkFalls`) — excluded from further meaningful physics
 *   until rules.js resolves the penalty and respawns it. Always false in
 *   ARENA, where nothing can ever leave the bounded field.
 */

/**
 * @typedef {Object} Wall
 * @property {number} x  segment start point (grid-aligned)
 * @property {number} y
 * @property {'horizontal' | 'vertical'} orientation  spans (x,y) to
 *   (x+CONFIG.wall.length, y) if horizontal, (x, y+CONFIG.wall.length) if vertical
 */

/**
 * @typedef {Object} World
 * @property {Circle[]} circles  fixed-order, indices 0..CONFIG.piece.count-1
 * @property {number} motionTime  seconds the world has been continuously
 *   unsettled (BUILD_SPEC.md §5 stuck-state cap); resets to 0 the instant
 *   isSettled() is true. Plain field on the returned object — a test can
 *   preset it directly (e.g. `world.motionTime = 6.0`) to exercise the
 *   6-second cap without stepping 720 real frames.
 * @property {Wall | null} wall  §7: at most one wall exists on the field, shared
 */

/**
 * @param {{x: number, y: number}[]} positions  starting centres, one per circle
 * @returns {World}
 */
export function createWorld(positions) {
  return {
    circles: positions.map((p) => ({
      x: p.x, y: p.y, vx: 0, vy: 0,
      prevX: p.x, prevY: p.y, rawX: p.x, rawY: p.y,
      fallen: false,
    })),
    motionTime: 0,
    wall: null,
  };
}

/**
 * The wall's two endpoints, derived from its compact `{x,y,orientation}`
 * form — the one place that expansion happens, so physics.js's collision
 * code, rules.js's legality check, and render.js's draw call can never
 * silently disagree on where the wall actually is.
 * @param {Wall} wall @returns {{p1: {x:number,y:number}, p2: {x:number,y:number}}}
 */
export function wallEndpoints(wall) {
  const { length } = CONFIG.wall;
  return wall.orientation === 'horizontal'
    ? { p1: { x: wall.x, y: wall.y }, p2: { x: wall.x + length, y: wall.y } }
    : { p1: { x: wall.x, y: wall.y }, p2: { x: wall.x, y: wall.y + length } };
}

/**
 * Force every circle to `positions` and full rest — used for the initial
 * kick-off at page load and for the post-goal kick-off reset (step 3).
 * Mutates `world` in place (never replaces the object) since `input.js`
 * closes over the original `world` reference at `attachInput()` time; a
 * fresh object would leave it silently reading/writing a stale one.
 * `prevX/prevY/rawX/rawY` are set to the same new position (not left stale)
 * so render's lerp doesn't smear a visible streak across the field on the
 * reset frame.
 * @param {World} world @param {{x: number, y: number}[]} positions
 */
export function resetWorld(world, positions) {
  world.circles.forEach((c, i) => {
    c.x = c.prevX = c.rawX = positions[i].x;
    c.y = c.prevY = c.rawY = positions[i].y;
    c.vx = 0;
    c.vy = 0;
    c.fallen = false;
  });
  world.motionTime = 0;
}

/**
 * Move exactly one circle to `position` and full rest, clearing `fallen` —
 * the VOID mode respawn (§5: penalty resolved, "the fallen circle respawns
 * on the centre spot") when the other two circles are fine where they are
 * and only the fallen one needs to come back. `resetWorld` (whole-field
 * kick-off) is the wrong tool here — it would also move the two circles
 * that were never involved.
 * @param {World} world @param {number} index @param {{x: number, y: number}} position
 */
export function respawnCircle(world, index, position) {
  const c = world.circles[index];
  c.x = c.prevX = c.rawX = position.x;
  c.y = c.prevY = c.rawY = position.y;
  c.vx = 0;
  c.vy = 0;
  c.fallen = false;
}

/**
 * The goal mouth's x-range (BUILD_SPEC.md §2: centred, CONFIG.field.goalWidth
 * wide), derived once from CONFIG so `resolveRails` (below) and `render.js`'s
 * `drawGoals` can never silently disagree on where the gap actually is.
 * @returns {{min: number, max: number}}
 */
export function goalXRange() {
  const { w, goalWidth } = CONFIG.field;
  return { min: w / 2 - goalWidth / 2, max: w / 2 + goalWidth / 2 };
}

/**
 * Whole-simulation rest check — magnitude-based rest-snap (see step()) means
 * a settled circle's velocity is exactly (0,0), so this is an exact compare,
 * not a threshold re-check.
 * @param {World} world @returns {boolean}
 */
export function isSettled(world) {
  return world.circles.every((c) => c.vx === 0 && c.vy === 0);
}

/**
 * Apply a launch to one circle. `direction` must already be a unit vector
 * (input.js builds it via vec.js's normalize) — this does not renormalize.
 * @param {World} world @param {number} index
 * @param {{x: number, y: number}} direction @param {number} speed
 */
export function launchCircle(world, index, direction, speed) {
  const c = world.circles[index];
  c.vx = direction.x * speed;
  c.vy = direction.y * speed;
}

/**
 * Advance the world by exactly one fixed step of CONFIG.physics.dt. Always
 * uses the CONFIG constant directly (no dt parameter) so a caller structurally
 * cannot pass a measured wall-clock frameTime here — main.js's accumulator
 * clamps/accumulates frameTime separately and calls this once per whole dt.
 * @param {World} world
 * @returns {[number, number][]} circle-index pairs that contacted this step
 *   (BUILD_SPEC.md §6, step 3 reads this to detect "touched another circle" —
 *   single-sourced from the same check resolveCircleCollisions already does,
 *   rather than a second independently-drifting distance check elsewhere).
 */
export function step(world) {
  const dt = CONFIG.physics.dt;
  for (const c of world.circles) {
    if (c.fallen) continue; // VOID mode: frozen until rules.js respawns it — no further physics

    c.prevX = c.x;
    c.prevY = c.y;

    c.vx *= DRAG_FACTOR;
    c.vy *= DRAG_FACTOR;
    c.x += c.vx * dt;
    c.y += c.vy * dt;

    c.rawX = c.x;
    c.rawY = c.y;

    if (CONFIG.field.mode !== 'void') resolveRails(c);
    if (world.wall) resolveWallCollision(c, world.wall);
    restSnap(c);
  }
  const contacts = resolveCircleCollisions(world);
  applySettleTimeout(world, dt);
  return contacts;
}

/**
 * VOID mode only (§5/§7): "a circle whose centre leaves the field falls."
 * Freezes velocity to exactly zero the instant it's detected — a fallen
 * circle doesn't coast to a stop somewhere arbitrary off-screen, it's
 * derezzed on the spot (render.js's fall-and-fade plays out visually from
 * this frozen position). `fallen` latches true so a circle already falling
 * doesn't re-trigger every subsequent step.
 *
 * "The goal mouths still score normally. Overshooting past a goal is a
 * fall" (§5) reads as a spatial split, not a depth cutoff: exiting through
 * the goal corridor (x within the goal span) is scoring, however far it
 * carries — rules.js's own goal-crossing check already decided that the
 * instant the line was crossed, independent of settling. "Overshooting
 * PAST a goal" is missing the corridor — exiting y<0/y>h at an x outside
 * the goal span, same as flying off the side. So the goal span is exempt
 * from the y-bound entirely; only x<0/x>w (or drifting outside the span
 * while already past the line) ever falls there. If a fall is later
 * detected on this same circle after a goal was already scored this
 * flick, §6 case 1's priority means the fall is allowed to override it —
 * that's spec'd, not a bug; this exemption just stops every goal from
 * being misread as a fall in the first place.
 * @param {World} world
 * @returns {number[]} indices that fell for the first time this call
 */
export function checkFalls(world) {
  if (CONFIG.field.mode !== 'void') return [];
  const { w, h } = CONFIG.field;
  const { min: goalMin, max: goalMax } = goalXRange();
  const fallen = [];
  for (let i = 0; i < world.circles.length; i++) {
    const c = world.circles[i];
    if (c.fallen) continue;
    const inGoalSpan = c.x >= goalMin && c.x <= goalMax;
    const yOut = !inGoalSpan && (c.y < 0 || c.y > h);
    const xOut = c.x < 0 || c.x > w;
    if (xOut || yOut) {
      c.fallen = true;
      c.vx = 0;
      c.vy = 0;
      fallen.push(i);
    }
  }
  return fallen;
}

/**
 * Side edges (x=0, x=w) always solid, exactly as before. Top/bottom edges
 * (y=0, y=h) are solid EXCEPT within the goal mouth's x-range (§5: "the
 * goal mouth does not bounce; everything else on that edge does") — step 3
 * reopens the gap step 2 deliberately kept solid (there was no rules layer
 * yet to give a circle passing through it any meaning).
 *
 * Axis-independent per edge: the x-check only ever reads/writes x/vx, the
 * y-check only ever reads/writes y/vy (using the already-resolved x to
 * decide goal-span membership — safe, since a circle whose x was just
 * clamped to a side rail, ~0.4 or ~9.6, can never simultaneously be inside
 * the goal's x-range, ~3.5 to 6.5), so a corner resolves correctly with
 * zero special-casing regardless of check order.
 *
 * Within the goal span, a second boundary — CONFIG.field.goalBackstop cells
 * past y=0/y=h — still solid, same restitution as a normal rail. Without
 * this, §5's own-goal rule ("play continues from where it rests," no
 * rollback) has no bound: a full-power own-goal shot would sail ~18 cells
 * into open space, reintroducing the exact "stranded, unrecoverable"
 * problem step 2's all-solid workaround existed to prevent. This is a
 * narrow safety net, not VOID mode (step 7, actual falling) — the goal
 * simply has shallow depth instead of being an open void.
 * VOID mode (§5/§7) skips this function entirely — "there are no rails" —
 * one branch in the collision code, per the spec's own framing, rather
 * than a second physics path: `step()` only calls this at all when
 * `CONFIG.field.mode !== 'void'`.
 * @param {Circle} c
 */
function resolveRails(c) {
  const r = CONFIG.piece.radius;
  const { w, h, goalBackstop } = CONFIG.field;
  const restRail = CONFIG.physics.restRail;

  if (c.x - r < 0) {
    c.x = r;
    c.vx = -c.vx * restRail;
  } else if (c.x + r > w) {
    c.x = w - r;
    c.vx = -c.vx * restRail;
  }

  const { min: goalMin, max: goalMax } = goalXRange();
  const inGoalSpan = c.x >= goalMin && c.x <= goalMax;

  if (inGoalSpan) {
    if (c.y - r < -goalBackstop) {
      c.y = -goalBackstop + r;
      c.vy = -c.vy * restRail;
    } else if (c.y + r > h + goalBackstop) {
      c.y = h + goalBackstop - r;
      c.vy = -c.vy * restRail;
    }
    // else: between the backstop and the field edge — passes through freely
  } else {
    if (c.y - r < 0) {
      c.y = r;
      c.vy = -c.vy * restRail;
    } else if (c.y + r > h) {
      c.y = h - r;
      c.vy = -c.vy * restRail;
    }
  }
}

/**
 * Circle-vs-wall collision (§5/§7): "find the closest point on the segment,
 * resolve penetration along the normal, reflect the normal velocity
 * component... handle the segment's two endpoints as circle-vs-point."
 * `closestPointOnSegment` handles both cases uniformly with no special-case
 * branch: when the closest point falls in the segment's interior, the
 * resulting normal is perpendicular to the (always axis-aligned, §7) wall —
 * an ordinary flat-side bounce. When the closest point IS an endpoint, the
 * normal instead points straight from that endpoint to the circle's centre,
 * which can be any angle — exactly "circle-vs-point," for free.
 * @param {Circle} c @param {Wall} wall
 */
function resolveWallCollision(c, wall) {
  const r = CONFIG.piece.radius;
  const { p1, p2 } = wallEndpoints(wall);
  const closest = closestPointOnSegment({ x: c.x, y: c.y }, p1, p2);
  const d = subtract({ x: c.x, y: c.y }, closest);
  const dist = length(d);
  if (dist >= r) return;

  // Degenerate case (circle centre exactly on the segment): arbitrary axis,
  // same fallback pattern as resolveCircleCollisions.
  const n = dist > 0 ? { x: d.x / dist, y: d.y / dist } : { x: 1, y: 0 };

  const push = r - dist;
  c.x += n.x * push;
  c.y += n.y * push;

  const vDotN = c.vx * n.x + c.vy * n.y;
  if (vDotN < 0) {
    const reflected = reflect({ x: c.vx, y: c.vy }, n, CONFIG.physics.restWall);
    c.vx = reflected.x;
    c.vy = reflected.y;
  }
}

/**
 * Circle-circle contact (BUILD_SPEC.md §3/§6): when two circles' centres are
 * closer than 2 * CONFIG.piece.radius, the pair stops dead — velocity zeroed
 * on both (a no-op for whichever one was already at rest) and the overlap
 * de-penetrated symmetrically along the centre-to-centre axis, same principle
 * as resolveRails but split evenly between both circles instead of clamping
 * one circle to a fixed boundary. No "elastic bounce": stop, not reflect.
 *
 * Runs once per step over every pair, after the per-circle integration loop
 * (it needs every circle's post-integration position, not just one). Fixed
 * 3-pair iteration, no dynamic structures — same style as the rest of this
 * file, and three pairs is nothing.
 *
 * No bookkeeping for "which circle is the launched one": mass is equal (§3),
 * so splitting the correction evenly is correct in general, and this
 * project's current architecture only ever has one circle in motion at a
 * time anyway, so it reduces to "the moving circle stops" without hardcoding
 * that assumption here.
 * @param {World} world
 * @returns {[number, number][]} index pairs that contacted this call
 */
function resolveCircleCollisions(world) {
  const minDist = 2 * CONFIG.piece.radius;
  const circles = world.circles;
  const contacts = [];
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i];
      const b = circles[j];
      if (a.fallen || b.fallen) continue; // VOID mode: a fallen circle doesn't interact with anything until respawned
      const d = subtract(b, a);
      const dist = length(d);
      if (dist >= minDist) continue;

      // Degenerate exact-overlap case (dist === 0): fall back to an
      // arbitrary axis rather than divide by zero.
      const nx = dist > 0 ? d.x / dist : 1;
      const ny = dist > 0 ? d.y / dist : 0;
      const push = (minDist - dist) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      a.vx = 0;
      a.vy = 0;
      b.vx = 0;
      b.vy = 0;
      contacts.push([i, j]);
    }
  }
  return contacts;
}

/**
 * Magnitude-based rest-snap: below threshold, both components snap to
 * exactly 0. Exported (unlike resolveRails) specifically so test.js can
 * assert its exact threshold boundary directly — through step() alone this
 * boundary is unobservable, since drag always multiplies velocity before
 * rest-snap ever sees it.
 * @param {Circle} c
 */
export function restSnap(c) {
  const speed = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
  if (speed < CONFIG.physics.restThreshold) {
    c.vx = 0;
    c.vy = 0;
  }
}

/**
 * Hard cap (BUILD_SPEC.md §5 Stuck states): if the world has not settled
 * within CONFIG.physics.settleTimeout seconds of continuous motion, force
 * every velocity to exactly zero. This should never organically trigger at
 * step 2's physics numbers (full-power settle is ~3.6s) — if it fires during
 * testing, that's a bug signal, per the console.warn.
 * @param {World} world @param {number} dt
 */
function applySettleTimeout(world, dt) {
  if (world.motionTime >= CONFIG.physics.settleTimeout) {
    for (const c of world.circles) {
      c.vx = 0;
      c.vy = 0;
    }
    world.motionTime = 0;
    console.warn('physics: settle-timeout cap triggered — forcing all velocities to zero');
    return;
  }
  world.motionTime = isSettled(world) ? 0 : world.motionTime + dt;
}
