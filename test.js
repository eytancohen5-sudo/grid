// test.js — plain assert harness, no framework (docs/adr/0002). Run: node test.js
// Step 1 covered computeScale only (field, no interaction). Step 2 added
// launch physics. Step 3 adds rules.js: vec.js, physics.js, and rules.js
// must all run headless here with zero DOM/canvas imports (ADR-0002) —
// that constraint is what makes this file possible at all.

import assert from 'node:assert/strict';
import { computeScale } from './js/render.js';
import { CONFIG } from './js/config.js';
import { normalize } from './js/vec.js';
import { createWorld, step, launchCircle, restSnap, checkFalls, goalXRange, resetWorld } from './js/physics.js';
import {
  KICKOFF, createMatchState, resetMatch, onLaunch, tick, forfeitTurn, tickMatchClock,
  isWallLegal, placeWall, removeWall, KICKOFF_WALLS, initialWalls,
} from './js/rules.js';

const { w, h } = CONFIG.field;
const margin = CONFIG.marginCells;
const hudHeight = CONFIG.hud.height; // step 4: computeScale now reserves this at the top
let passed = 0;
let total = 0;

function check(name, fn) {
  total++;
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

check('computeScale: narrow/portrait viewport is width-bound', () => {
  const viewportW = 400;
  const viewportH = 1000;
  const { scale, offsetX, offsetY } = computeScale(viewportW, viewportH);
  const expected = viewportW / (w + margin * 2);
  assert.ok(Math.abs(scale - expected) < 1e-9, 'scale derives from width');
  assert.ok(Math.abs(offsetX - margin * scale) < 1e-9, 'horizontal offset is exactly the margin');
  assert.ok(offsetY > hudHeight + margin * scale, 'vertical axis has extra room beyond the HUD band + minimum margin');
});

check('computeScale: wide/landscape viewport is height-bound', () => {
  const viewportW = 1000;
  const viewportH = 400;
  const { scale, offsetX, offsetY } = computeScale(viewportW, viewportH);
  const expected = (viewportH - hudHeight) / (h + margin * 2);
  assert.ok(Math.abs(scale - expected) < 1e-9, 'scale derives from height, net of the reserved HUD band');
  assert.ok(Math.abs(offsetY - (hudHeight + margin * scale)) < 1e-9, 'vertical offset is the HUD band plus the margin');
  assert.ok(offsetX > margin * scale, 'horizontal axis has extra room beyond the minimum margin');
});

check('computeScale: viewport matching the field+margin aspect (net of the HUD band) binds both axes', () => {
  const scaleIn = 50;
  const viewportW = (w + margin * 2) * scaleIn;
  const viewportH = (h + margin * 2) * scaleIn + hudHeight;
  const { scale, offsetX, offsetY } = computeScale(viewportW, viewportH);
  assert.ok(Math.abs(scale - scaleIn) < 1e-9, 'scale matches the input scale exactly');
  assert.ok(Math.abs(offsetX - margin * scaleIn) < 1e-9, 'horizontal offset is exactly the margin');
  assert.ok(Math.abs(offsetY - (hudHeight + margin * scaleIn)) < 1e-9, 'vertical offset is the HUD band plus the margin');
});

// --- Step 2: physics/input coverage ---------------------------------------

/** Player A's / Player B's kick-off triangles — same rules.js `KICKOFF`
 * table main.js starts with and reuses after a goal, so there is exactly
 * one source of truth for these coordinates (widened from §3's literal
 * values per live playtesting, see rules.js's own comment). */
function kickoffWorld() {
  return createWorld(KICKOFF.A);
}
function kickoffWorldB() {
  return createWorld(KICKOFF.B);
}

/** Launches `index` in `direction` at `speed`, driving rules.js's tick()
 * every physics step exactly as main.js's accumulator loop does, until the
 * flick resolves (world settled and the flick no longer in flight) or
 * `maxSteps` is exhausted. Returns rules.js's result (null, or a goal
 * object) from whichever step actually resolved the flick. */
function runFlick(world, match, index, direction, speed, maxSteps = 10_000) {
  launchCircle(world, index, normalize(direction), speed);
  onLaunch(match, world, index);
  let result = null;
  for (let i = 0; i < maxSteps; i++) {
    const contacts = step(world);
    const fallen = checkFalls(world); // VOID-only; always [] in ARENA, so this is a no-op for every pre-step-7 caller
    const r = tick(match, world, contacts, fallen);
    if (r) result = r;
    if (match.launchedIndex === null) break;
  }
  return result;
}

check('motion: full-power travel distance converges to maxSpeed/drag (unbounded, no rails) within 2%', () => {
  // §5's "roughly 18 cells" describes the drag model alone, before ARENA's
  // rails ever enter the picture (that subsection comes after in the spec).
  // It genuinely can't be measured through the real bounded field: the
  // field's own diagonal (sqrt(10^2+14^2) =~ 17.2) is shorter than the
  // unobstructed travel distance, so any full-power shot in this field hits
  // a lossy rail bounce before drag alone would ever stop it. This checks
  // the relationship directly from CONFIG, so it survives future retuning.
  const { maxSpeed, drag, dt, restThreshold } = CONFIG.physics;
  const dragFactor = Math.exp(-drag * dt); // same formula physics.js precomputes once at module init
  let v = maxSpeed;
  let distance = 0;
  let steps = 0;
  while (v >= restThreshold && steps < 1_000_000) {
    v *= dragFactor;
    distance += v * dt;
    steps++;
  }
  const expected = maxSpeed / drag;
  assert.ok(Math.abs(distance - expected) < expected * 0.02,
    `distance ${distance} should be within 2% of maxSpeed/drag = ${expected}`);
});

check('determinism: a recorded input log replays bit-identical across 1000 runs', () => {
  const log = [
    { atStep: 0, index: 0, direction: { x: 0.6, y: -0.8 }, speed: 20 },
    { atStep: 200, index: 1, direction: { x: -1, y: 0 }, speed: 15 },
    { atStep: 600, index: 2, direction: { x: 0, y: 1 }, speed: 10 },
  ];
  const totalSteps = 900;

  function run() {
    const world = kickoffWorld();
    for (let i = 0; i < totalSteps; i++) {
      for (const event of log) {
        if (event.atStep === i) launchCircle(world, event.index, event.direction, event.speed);
      }
      step(world);
    }
    return JSON.stringify(world.circles);
  }

  const first = run();
  for (let i = 0; i < 1000; i++) {
    assert.equal(run(), first, `run ${i} diverged from the first run`);
  }
});

/** Mirrors input.js's pull -> speed formula (power = pull/maxPull, speed =
 * power * maxSpeed) purely from CONFIG, to test the relationship in
 * isolation from DOM pointer events. */
function speedForPull(pull) {
  const clamped = Math.min(pull, CONFIG.input.maxPull);
  return (clamped / CONFIG.input.maxPull) * CONFIG.physics.maxSpeed;
}

check('pull -> speed: linear (speed(pull=3) approx 0.5 * speed(pull=6))', () => {
  const s3 = speedForPull(3);
  const s6 = speedForPull(6);
  assert.ok(Math.abs(s3 / (0.5 * s6) - 1) < 0.001, `expected s3 ~= 0.5*s6, got s3=${s3}, s6=${s6}`);
});

check('MAX_PULL clamp: speed(6) === speed(6.001) === speed(10), exact', () => {
  const s6 = speedForPull(6);
  assert.equal(speedForPull(6.001), s6);
  assert.equal(speedForPull(10), s6);
});

check('MIN_PULL cancel boundary: strict <, cancels(0.29)===true, cancels(0.3)===false', () => {
  const cancels = (pull) => pull < CONFIG.input.minPull;
  assert.equal(cancels(0.29), true);
  assert.equal(cancels(0.3), false);
});

check('rail reflection (horizontal edge, bottom): normal (vy) flips+scales by restRail, tangential (vx) untouched by the rail', () => {
  const { drag, dt, restRail } = CONFIG.physics;
  const dragFactor = Math.exp(-drag * dt);
  const r = CONFIG.piece.radius;

  // x=1: outside the goal's x-range [3.5, 6.5] (step 3 reopened that span —
  // see the goal-mouth test just below) — an ordinary, still-solid rail.
  const world = createWorld([{ x: 1, y: h - r - 0.001 }, { x: 8, y: 1 }, { x: 9, y: 1 }]);
  world.circles[0].vx = 3;
  world.circles[0].vy = 5;
  step(world);

  const c = world.circles[0];
  const expectedVx = 3 * dragFactor; // drag only — the rail never touches the tangential axis
  const expectedVy = -(5 * dragFactor) * restRail; // drag, then flip+scale on the normal axis

  assert.ok(Math.abs(c.vx - expectedVx) < 1e-9, `tangential vx: got ${c.vx}, expected ${expectedVx}`);
  assert.ok(Math.abs(c.vy - expectedVy) < 1e-9, `normal vy: got ${c.vy}, expected ${expectedVy}`);
  assert.ok(Math.abs(c.y - (h - r)) < 1e-9, 'position clamps exactly to boundary - radius');
});

check('goal mouth (step 3): does not bounce inside the goal span, still bounces immediately outside it', () => {
  const r = CONFIG.piece.radius;

  const outside = createWorld([{ x: 1, y: h - r - 0.001 }, { x: 8, y: 1 }, { x: 9, y: 1 }]);
  outside.circles[0].vy = 5;
  step(outside);
  assert.ok(outside.circles[0].vy < 0, 'x=1 (outside [3.5,6.5]): still reflects, vy flips negative');

  const inside = createWorld([{ x: 5, y: h - r - 0.001 }, { x: 8, y: 1 }, { x: 9, y: 1 }]);
  inside.circles[0].vy = 5;
  step(inside);
  assert.ok(inside.circles[0].vy > 0, 'x=5 (inside [3.5,6.5]): passes through, only drag applied, vy stays positive');
  assert.ok(inside.circles[0].y > h - r, 'x=5: centre is now past the old solid boundary');
});

check('goal backstop (step 3): a full-power own-goal shot settles bounded, not unbounded flight', () => {
  const { h, goalBackstop } = CONFIG.field;
  const world = createWorld(KICKOFF.A);
  const match = createMatchState();
  runFlick(world, match, 0, { x: 0, y: 1 }, CONFIG.physics.maxSpeed, 20_000);
  assert.ok(world.circles[0].y <= h + goalBackstop + 1e-6, `settled within the backstop bound, got y=${world.circles[0].y}`);
  assert.ok(Number.isFinite(world.circles[0].y), 'finite, not NaN/Infinity');
});

check('rail reflection (vertical edge, right): normal (vx) flips+scales by restRail, tangential (vy) untouched by the rail', () => {
  const { drag, dt, restRail } = CONFIG.physics;
  const dragFactor = Math.exp(-drag * dt);
  const r = CONFIG.piece.radius;

  const world = createWorld([{ x: w - r - 0.001, y: 7 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
  world.circles[0].vx = 5;
  world.circles[0].vy = 3;
  step(world);

  const c = world.circles[0];
  const expectedVy = 3 * dragFactor;
  const expectedVx = -(5 * dragFactor) * restRail;

  assert.ok(Math.abs(c.vy - expectedVy) < 1e-9, `tangential vy: got ${c.vy}, expected ${expectedVy}`);
  assert.ok(Math.abs(c.vx - expectedVx) < 1e-9, `normal vx: got ${c.vx}, expected ${expectedVx}`);
  assert.ok(Math.abs(c.x - (w - r)) < 1e-9, 'position clamps exactly to boundary - radius');
});

check('position de-penetration: a circle placed past a boundary clamps exactly to boundary - radius', () => {
  const r = CONFIG.piece.radius;
  const world = createWorld([{ x: w + 0.5, y: 5 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
  step(world);
  assert.equal(world.circles[0].x, w - r, 'clamps exactly to w - radius');
});

check('corner case: a circle overlapping two rails simultaneously resolves to finite, non-NaN state', () => {
  const world = createWorld([{ x: w + 0.5, y: h + 0.5 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
  world.circles[0].vx = 10;
  world.circles[0].vy = 10;
  step(world);
  const c = world.circles[0];
  assert.ok(Number.isFinite(c.x), 'x is finite (also excludes NaN)');
  assert.ok(Number.isFinite(c.y), 'y is finite (also excludes NaN)');
  assert.ok(Number.isFinite(c.vx), 'vx is finite (also excludes NaN)');
  assert.ok(Number.isFinite(c.vy), 'vy is finite (also excludes NaN)');
});

check('rest-snap: magnitude-based, exact boundary (strict <)', () => {
  const makeCircle = (vx, vy) => ({ x: 0, y: 0, prevX: 0, prevY: 0, vx, vy });

  const above = makeCircle(0.151, 0);
  restSnap(above);
  assert.equal(above.vx, 0.151, '|v|=0.151 unchanged');

  const atThreshold = makeCircle(0.15, 0);
  restSnap(atThreshold);
  assert.equal(atThreshold.vx, 0.15, '|v|=0.15 unchanged (strict <, not <=)');

  const below = makeCircle(0.149, 0);
  restSnap(below);
  assert.equal(below.vx, 0, '|v|=0.149 snaps vx to exactly 0');
  assert.equal(below.vy, 0, '|v|=0.149 snaps vy to exactly 0');
});

check('settle-timeout: forces all velocities to exactly zero at motionTime >= settleTimeout, without waiting 6 real seconds', () => {
  const world = createWorld([{ x: 5, y: 5 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
  world.circles[0].vx = 5;
  world.circles[0].vy = 5;
  world.circles[1].vx = -2; // a second circle in motion too — the cap must zero every circle, not just one
  world.motionTime = CONFIG.physics.settleTimeout; // preset directly to t=6.0 — no real-time wait

  step(world);

  for (const c of world.circles) {
    assert.equal(c.vx, 0, 'settle-timeout forces vx to exactly 0');
    assert.equal(c.vy, 0, 'settle-timeout forces vy to exactly 0');
  }
});

check('NaN/Infinity sweep: a grid of pull-direction x magnitude combos stays finite through many steps', () => {
  const directions = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 0.7071067811865476, y: 0.7071067811865476 },
    { x: -0.7071067811865476, y: -0.7071067811865476 },
  ];
  const magnitudes = [0, 0.5, 1, 3, 6, 26]; // includes rest (0) and full power (maxSpeed)

  for (const dir of directions) {
    for (const mag of magnitudes) {
      const world = kickoffWorld();
      launchCircle(world, 0, dir, mag);
      for (let i = 0; i < 1000; i++) {
        step(world);
        for (const c of world.circles) {
          assert.ok(
            Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.vx) && Number.isFinite(c.vy),
            `finite state required at dir=(${dir.x},${dir.y}) mag=${mag} step=${i}`
          );
        }
      }
    }
  }
});

check('circle-circle contact: a moving circle that would overlap a stationary one stops dead and de-penetrates to exactly 2*radius apart', () => {
  const r = CONFIG.piece.radius;
  // 1.0 apart at rest (no overlap); circle 0 launched at max speed straight
  // at circle 1 covers enough ground in a single dt=1/120 step to cross into
  // contact (< 2*radius) — verified: drag-adjusted travel ~0.214 cells, gap
  // was only 1.0 - 2*radius = 0.2 cells.
  const world = createWorld([{ x: 4, y: 5 }, { x: 5, y: 5 }, { x: 1, y: 1 }]);
  world.circles[0].vx = CONFIG.physics.maxSpeed;
  step(world);

  const a = world.circles[0];
  const b = world.circles[1];
  const dist = Math.hypot(b.x - a.x, b.y - a.y);

  assert.equal(a.vx, 0, 'moving circle stops dead: vx zeroed, not reflected');
  assert.equal(a.vy, 0, 'moving circle stops dead: vy zeroed, not reflected');
  // Tolerance, not strict equality: dist is recomputed via sqrt/division from
  // positions that were themselves derived from a division — the same style
  // every other exact-target check in this file uses once a sqrt is involved.
  assert.ok(Math.abs(dist - 2 * r) < 1e-9, `centres end up exactly 2*radius apart (not overlapping, not gapped), got ${dist}`);
});

check('circle-circle contact: two circles starting at identical coordinates (degenerate zero-distance fallback) resolve to finite positions, exactly 2*radius apart, velocities zeroed', () => {
  const r = CONFIG.piece.radius;
  const world = createWorld([{ x: 5, y: 7 }, { x: 5, y: 7 }, { x: 1, y: 1 }]);
  step(world);

  const a = world.circles[0];
  const b = world.circles[1];
  const dist = Math.hypot(b.x - a.x, b.y - a.y);

  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), 'circle 0 position is finite');
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), 'circle 1 position is finite');
  assert.ok(Math.abs(dist - 2 * r) < 1e-9, `centres end up exactly 2*radius apart, got ${dist}`);
  assert.equal(a.vx, 0, 'circle 0 vx zeroed');
  assert.equal(a.vy, 0, 'circle 0 vy zeroed');
  assert.equal(b.vx, 0, 'circle 1 vx zeroed');
  assert.equal(b.vy, 0, 'circle 1 vy zeroed');
});

check('vec.normalize: zero-length input does not throw or produce NaN', () => {
  const result = normalize({ x: 0, y: 0 });
  assert.equal(result.x, 0);
  assert.equal(result.y, 0);
});

// --- Step 3: rules.js coverage --------------------------------------------
// All scenarios below were verified numerically before being committed here
// (parameter search against the real implementation) — the physics numbers
// (speed/direction needed to actually reach a given outcome) aren't
// derivable by inspection alone the way step 1/2's checks were.

check('rules: pass detected — clean crossing between the other two circles arms the same player', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  const [c1, c2] = [world.circles[1], world.circles[2]];
  const mid = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
  const dir = { x: mid.x - world.circles[0].x, y: mid.y - world.circles[0].y };
  runFlick(world, match, 0, dir, 15);
  assert.equal(match.armed, true, 'pass completed -> armed');
  assert.equal(match.currentPlayer, 'A', 'same player continues');
});

check('rules: pass not detected — stops short of the segment ends the turn', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  const [c1, c2] = [world.circles[1], world.circles[2]];
  const mid = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
  const dir = { x: mid.x - world.circles[0].x, y: mid.y - world.circles[0].y };
  runFlick(world, match, 0, dir, 2); // too weak to reach the segment
  assert.equal(match.armed, false);
  assert.equal(match.currentPlayer, 'B', 'turn ends (case 6)');
});

check('rules: pass not detected — crosses the infinite line extension but outside the bounded segment', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  const [c1, c2] = [world.circles[1], world.circles[2]];
  // Aim toward a point beyond c1 on the c2->c1 extended line — the shot's
  // own line crosses the LINE the two circles sit on, but past c1's end,
  // outside the finite segment between them. Catches a line-vs-segment
  // intersection bug that a naive "does it cross this infinite line" test
  // would wrongly call a pass.
  const target = { x: c1.x + (c1.x - c2.x) * 0.5, y: c1.y + (c1.y - c2.y) * 0.5 };
  const dir = { x: target.x - world.circles[0].x, y: target.y - world.circles[0].y };
  runFlick(world, match, 0, dir, 6);
  assert.equal(match.armed, false);
  assert.equal(match.currentPlayer, 'B');
});

check('rules: pass not detected — aimed away from both other circles entirely', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  runFlick(world, match, 0, { x: -1, y: 0 }, 10);
  assert.equal(match.armed, false);
  assert.equal(match.currentPlayer, 'B');
});

check('rules: contact overrides a would-be pass — touching a circle ends the turn, never counted as a pass', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  const target = world.circles[1];
  const dir = { x: target.x - world.circles[0].x, y: target.y - world.circles[0].y };
  runFlick(world, match, 0, dir, 10);
  assert.equal(match.armed, false, 'never armed — contact pre-empts pass detection');
  assert.equal(match.currentPlayer, 'B', 'turn ends on contact (case 4)');
  const dist = Math.hypot(world.circles[0].x - world.circles[1].x, world.circles[0].y - world.circles[1].y);
  assert.ok(Math.abs(dist - 2 * CONFIG.piece.radius) < 1e-9, 'the two circles are in actual contact, confirming the shot really did touch');
});

check('rules: own goal is fully ignored — no goal, no turnover, no rollback, circle rests naturally past the line', () => {
  const world = kickoffWorld();
  const match = createMatchState(); // Player A, unarmed
  runFlick(world, match, 0, { x: 0, y: 1 }, 5); // toward A's own goal (bottom, y=h)
  assert.equal(match.armed, false, 'unchanged');
  assert.equal(match.currentPlayer, 'A', 'unchanged — no turnover');
  assert.ok(world.circles[0].y > h, 'rests past the goal line, not rolled back');
});

check('rules: opponent goal, not armed — turn ends, circle rolled back to exactly where the flick started', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  const start = { x: world.circles[1].x, y: world.circles[1].y };
  runFlick(world, match, 1, { x: 0, y: -1 }, 20); // toward A's opponent goal (top, y=0)
  assert.equal(match.armed, false);
  assert.equal(match.currentPlayer, 'B', 'turn ends');
  assert.equal(world.circles[1].x, start.x, 'rolled back exactly (x)');
  assert.equal(world.circles[1].y, start.y, 'rolled back exactly (y)');
});

check('rules: opponent goal, armed — GOAL fires, correct scorer, kick-off reset to the conceding player (Player A scoring)', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  match.armed = true; // isolates case 2 from needing a full realistic pass setup first — see rules.js's own doc comment on MatchState being plain/directly-settable, same shape as physics.js's World.motionTime
  const result = runFlick(world, match, 0, { x: 0, y: -1 }, 22);
  assert.deepEqual(result, { type: 'goal', scorer: 'A', conceder: 'B', winner: null });
  assert.equal(match.lastScorer, 'A');
  assert.equal(match.currentPlayer, 'B', 'conceding player takes the next turn');
  assert.equal(match.armed, false);
  for (let i = 0; i < world.circles.length; i++) {
    assert.equal(world.circles[i].x, KICKOFF.B[i].x, `circle ${i} reset to KICKOFF.B x`);
    assert.equal(world.circles[i].y, KICKOFF.B[i].y, `circle ${i} reset to KICKOFF.B y`);
  }
});

check('rules: opponent goal, armed — GOAL fires, correct scorer, kick-off reset to the conceding player (Player B scoring, mirrored)', () => {
  // Mirrored-coordinate bugs only show up when the mirror is actually
  // exercised — this is the one test in the file that starts from
  // kickoffWorldB() / createMatchState('B') rather than Player A's layout.
  const world = kickoffWorldB();
  const match = createMatchState('B');
  match.armed = true;
  const result = runFlick(world, match, 0, { x: 0, y: 1 }, 22);
  assert.deepEqual(result, { type: 'goal', scorer: 'B', conceder: 'A', winner: null });
  assert.equal(match.currentPlayer, 'A');
  for (let i = 0; i < world.circles.length; i++) {
    assert.equal(world.circles[i].x, KICKOFF.A[i].x, `circle ${i} reset to KICKOFF.A x`);
    assert.equal(world.circles[i].y, KICKOFF.A[i].y, `circle ${i} reset to KICKOFF.A y`);
  }
  assert.equal(match.lastScorer, 'B', 'captured value survives the currentPlayer flip to A — never read live off currentPlayer');
});

check('rules: armed does not linger — a flick that neither passes, scores, nor touches resets it even though it was true a moment before', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  match.armed = true; // simulate already-armed from a prior pass
  runFlick(world, match, 0, { x: -1, y: 0 }, 10); // aimed away — case 6
  assert.equal(match.armed, false, 'the "sticky armed" bug class this test exists to catch');
  assert.equal(match.currentPlayer, 'B');
});

check('rules: determinism — an identical scripted flick replays bit-identical across 100 runs', () => {
  function run() {
    const world = kickoffWorld();
    const match = createMatchState();
    runFlick(world, match, 0, { x: 1, y: 0.3 }, 12);
    return JSON.stringify({ circles: world.circles, armed: match.armed, currentPlayer: match.currentPlayer });
  }
  const first = run();
  for (let i = 0; i < 100; i++) {
    assert.equal(run(), first, `run ${i} diverged from the first run`);
  }
});

check('rules: degenerate — a shot launched exactly along the pass line\'s own direction stays finite, does not throw', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  const [c1, c2] = [world.circles[1], world.circles[2]];
  const alongLine = { x: c2.x - c1.x, y: c2.y - c1.y }; // exact direction of the pass-line segment itself
  runFlick(world, match, 0, alongLine, 10);
  assert.ok(Number.isFinite(world.circles[0].x) && Number.isFinite(world.circles[0].y), 'position stays finite');
  assert.ok(Number.isFinite(world.circles[0].vx) && Number.isFinite(world.circles[0].vy), 'velocity stays finite');
});

// --- Step 4: scoring, win check, resetMatch -------------------------------

check('rules: a goal below goalsToWin increments the score and does not set a winner', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  match.armed = true;
  const result = runFlick(world, match, 0, { x: 0, y: -1 }, 22);
  assert.equal(result.winner, null);
  assert.equal(match.winner, null);
  assert.equal(match.score.A, 1);
  assert.equal(match.score.B, 0);
});

check('rules: reaching goalsToWin sets the winner and does NOT reset the world (match is over, no next turn to set up)', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  match.score.A = CONFIG.rules.goalsToWin - 1; // one goal away from winning
  match.armed = true;
  const result = runFlick(world, match, 0, { x: 0, y: -1 }, 22);
  assert.equal(result.winner, 'A');
  assert.equal(match.winner, 'A');
  assert.equal(match.score.A, CONFIG.rules.goalsToWin);
  // world must NOT have been reset to KICKOFF.B (the usual post-goal reset) —
  // the winning circle should still be resting wherever the shot left it.
  const resetToB = world.circles.every((c, i) => c.x === KICKOFF.B[i].x && c.y === KICKOFF.B[i].y);
  assert.equal(resetToB, false, 'world was NOT reset on the winning goal');
});

check('rules: resetMatch ("Play again") fully restores score, turn state, and world position', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  match.score.A = CONFIG.rules.goalsToWin;
  match.winner = 'A';
  match.currentPlayer = 'B';
  match.armed = true;
  world.circles[0].x = 1;
  world.circles[0].y = 1; // simulate the field being in some arbitrary post-win state

  resetMatch(match, world);

  assert.deepEqual(match.score, { A: 0, B: 0 });
  assert.equal(match.winner, null);
  assert.equal(match.currentPlayer, 'A');
  assert.equal(match.armed, false);
  for (let i = 0; i < world.circles.length; i++) {
    assert.equal(world.circles[i].x, KICKOFF.A[i].x, `circle ${i} back to KICKOFF.A x`);
    assert.equal(world.circles[i].y, KICKOFF.A[i].y, `circle ${i} back to KICKOFF.A y`);
  }
});

// --- Step 5: timers (§8) ---------------------------------------------------

check('rules: a flick resolving resets turnTimeLeft to fresh CONFIG.timers.turnSeconds, even a non-scoring one', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  match.turnTimeLeft = 3; // simulate it having counted most of the way down
  runFlick(world, match, 0, { x: -1, y: 0 }, 10); // aimed away — case 6
  assert.equal(match.turnTimeLeft, CONFIG.timers.turnSeconds);
});

check('rules: forfeitTurn — turn passes, armed clears, timer resets, no shot/penalty beyond losing the turn', () => {
  const match = createMatchState();
  match.armed = true;
  match.turnTimeLeft = 0;
  forfeitTurn(match);
  assert.equal(match.currentPlayer, 'B');
  assert.equal(match.armed, false);
  assert.equal(match.turnTimeLeft, CONFIG.timers.turnSeconds);
});

check('rules: tickMatchClock counts down by the given delta', () => {
  const match = createMatchState();
  tickMatchClock(match, 10);
  assert.equal(match.matchTimeLeft, CONFIG.timers.matchSeconds - 10);
});

check('rules: match clock hitting 0:00 with a leader wins outright, reported "on the clock"', () => {
  const match = createMatchState();
  match.score.A = 2;
  match.score.B = 1;
  match.matchTimeLeft = 0.5;
  tickMatchClock(match, 1); // overshoots past zero — must clamp, not go negative
  assert.equal(match.matchTimeLeft, 0);
  assert.equal(match.winner, 'A');
  assert.equal(match.winReason, 'clock');
});

check('rules: match clock hitting 0:00 while level sets suddenDeath instead of a winner, and the clock stops', () => {
  const match = createMatchState();
  match.score.A = 1;
  match.score.B = 1;
  match.matchTimeLeft = 0.5;
  tickMatchClock(match, 1);
  assert.equal(match.matchTimeLeft, 0);
  assert.equal(match.winner, null);
  assert.equal(match.suddenDeath, true);
  tickMatchClock(match, 5); // further ticks after hitting 0 are a no-op
  assert.equal(match.matchTimeLeft, 0);
});

check('rules: sudden death — any goal wins outright, even with the score still under goalsToWin', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  match.suddenDeath = true;
  match.armed = true;
  const result = runFlick(world, match, 0, { x: 0, y: -1 }, 22);
  assert.equal(result.winner, 'A');
  assert.ok(match.score.A < CONFIG.rules.goalsToWin, 'won well under the normal goal threshold');
  assert.equal(match.winReason, 'goals', 'a sudden-death goal is still reported as a goal win, not "on the clock"');
});

// --- Step 6: the wall (§5 Wall subsection, §7) ------------------------------
// Redesigned 2026-08-20 from Eytan's live playtest feedback: one shared,
// 5-times-movable wall became two permanent, one-shot, player-owned walls.
// The old wallPlacer/wallUses/confirmWallPlacement/skipWallPlacement tests
// are gone, not just renamed — but the turn-ending invariants they
// incidentally also pinned (turn ends on cases 4/6, stays open on case 5 or
// an own goal) are independently covered via `currentPlayer`/`armed` in the
// step 3 section above, so nothing is lost by deleting them outright.

check('rules: isWallLegal — a wall away from goals, circles, and other walls is legal', () => {
  const world = kickoffWorld();
  assert.equal(isWallLegal({ x: 4, y: 7, orientation: 'horizontal' }, world), true);
});

check('rules: isWallLegal — within clearance of a goal mouth is illegal', () => {
  const world = kickoffWorld();
  assert.equal(isWallLegal({ x: 4, y: 1, orientation: 'horizontal' }, world), false);
});

check('rules: isWallLegal — within clearance of a circle centre is illegal', () => {
  const world = kickoffWorld(); // circle 0 sits at (3.5, 11)
  assert.equal(isWallLegal({ x: 3.0, y: 11, orientation: 'horizontal' }, world), false);
});

check('rules: isWallLegal — a placement that would extend outside the field is illegal', () => {
  const world = kickoffWorld();
  assert.equal(isWallLegal({ x: 9, y: 7, orientation: 'horizontal' }, world), false); // x=9..11 > w=10
});

check('rules: isWallLegal — within clearance of the OTHER player\'s already-placed wall is illegal', () => {
  // Circles parked well clear of both test positions — this test is
  // isolating wall-vs-wall clearance specifically, not circle clearance
  // (already covered above).
  const world = createWorld([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }]);
  world.walls.push({ x: 4, y: 7, orientation: 'horizontal', owner: 'A' });
  assert.equal(isWallLegal({ x: 4, y: 7.5, orientation: 'horizontal' }, world), false, 'well within clearance of A\'s wall');
  assert.equal(isWallLegal({ x: 4, y: 10, orientation: 'horizontal' }, world), true, 'far enough away (>= 2.0 cells, clear of goals too) is still legal');
});

check('rules: placeWall — legal placement on your own turn commits, tagged with the right owner', () => {
  const world = kickoffWorld();
  const match = createMatchState(); // Player A's turn
  const wall = { x: 4, y: 7, orientation: 'horizontal' };
  const ok = placeWall(match, world, 'A', wall);
  assert.equal(ok, true);
  assert.equal(world.walls.length, 1);
  assert.deepEqual(world.walls[0], { ...wall, owner: 'A' });
});

check('rules: placeWall — an illegal position is rejected, nothing changes', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  const ok = placeWall(match, world, 'A', { x: 4, y: 1, orientation: 'horizontal' });
  assert.equal(ok, false);
  assert.equal(world.walls.length, 0);
});

check('rules: placeWall — rejected when it\'s not that player\'s turn', () => {
  const world = kickoffWorld();
  const match = createMatchState(); // Player A's turn
  const ok = placeWall(match, world, 'B', { x: 4, y: 7, orientation: 'horizontal' });
  assert.equal(ok, false);
  assert.equal(world.walls.length, 0);
});

check('rules: placeWall — calling it again for the same player MOVES their wall, doesn\'t add a second one', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  assert.equal(placeWall(match, world, 'A', { x: 4, y: 7, orientation: 'horizontal' }), true);
  const moved = placeWall(match, world, 'A', { x: 4, y: 4, orientation: 'horizontal' });
  assert.equal(moved, true);
  assert.equal(world.walls.length, 1, 'still exactly one wall for A, replaced not appended');
  assert.deepEqual(world.walls[0], { x: 4, y: 4, orientation: 'horizontal', owner: 'A' });
});

check('rules: placeWall — moving your own wall doesn\'t reject on clearance from where it already was', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  const wall = { x: 4, y: 7, orientation: 'horizontal' };
  assert.equal(placeWall(match, world, 'A', wall), true);
  // Same exact spot again — would fail a naive "too close to an existing
  // wall" check if it didn't exclude the mover's own current wall first.
  assert.equal(placeWall(match, world, 'A', wall), true);
  assert.equal(world.walls.length, 1);
});

check('rules: removeWall — takes a player\'s wall off the field; a no-op if they have none or it isn\'t their turn', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  placeWall(match, world, 'A', { x: 4, y: 7, orientation: 'horizontal' });
  assert.equal(removeWall(match, world, 'B'), false, 'not B\'s turn');
  assert.equal(world.walls.length, 1, 'unaffected by the rejected call');
  assert.equal(removeWall(match, world, 'A'), true);
  assert.equal(world.walls.length, 0);
  assert.equal(removeWall(match, world, 'A'), false, 'nothing left to remove');
});

check('rules: placeWall — allowed mid-turn while armed (a wall placed after a completed pass, to set up a bounce shot)', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  match.armed = true; // simulates a pass already completed this turn — still Player A's turn
  assert.equal(placeWall(match, world, 'A', { x: 4, y: 7, orientation: 'horizontal' }), true);
});

check('physics: wall flat-side collision — normal component reflects by restWall, tangential untouched', () => {
  const { drag, dt, restWall } = CONFIG.physics;
  const dragFactor = Math.exp(-drag * dt);
  const r = CONFIG.piece.radius;
  const world = createWorld([{ x: 5, y: 7 - r - 0.001 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
  world.walls = [{ x: 4, y: 7, orientation: 'horizontal', owner: 'A' }];
  world.circles[0].vx = 3;
  world.circles[0].vy = 5;
  step(world);
  const c = world.circles[0];
  assert.ok(Math.abs(c.vx - 3 * dragFactor) < 1e-9, 'tangential (vx) is drag-only, untouched by the wall');
  assert.ok(Math.abs(c.vy - -(5 * dragFactor) * restWall) < 1e-9, 'normal (vy) flips and scales by restWall');
});

check('physics: wall endpoint collision — reflects off a point normal (both velocity components change, not just one)', () => {
  const r = CONFIG.piece.radius;
  const restWall = CONFIG.physics.restWall;
  const dragFactor = Math.exp(-CONFIG.physics.drag * CONFIG.physics.dt);
  // Positioned exactly r+epsilon from the wall's left endpoint (4,7) along
  // the up-left diagonal, closing the gap with a head-on diagonal velocity
  // — verified analytically: with velocity purely along the approach
  // normal, this reduces to the same -restWall*v_dragged case restRail
  // uses, just off-axis, so the expected value is exact, not approximate.
  const dx = -Math.SQRT1_2, dy = -Math.SQRT1_2;
  const world = createWorld([
    { x: 4 + dx * (r + 0.001), y: 7 + dy * (r + 0.001) }, { x: 1, y: 1 }, { x: 9, y: 1 },
  ]);
  world.walls = [{ x: 4, y: 7, orientation: 'horizontal', owner: 'A' }];
  world.circles[0].vx = 2;
  world.circles[0].vy = 2;
  step(world);
  const c = world.circles[0];
  const expected = -restWall * 2 * dragFactor;
  assert.ok(Math.abs(c.vx - expected) < 1e-9, `vx: got ${c.vx}, expected ${expected}`);
  assert.ok(Math.abs(c.vy - expected) < 1e-9, `vy: got ${c.vy}, expected ${expected}`);
  const distToEndpoint = Math.hypot(c.x - 4, c.y - 7);
  assert.ok(Math.abs(distToEndpoint - r) < 1e-9, 'de-penetrated to exactly touching the endpoint');
});

check('physics: two walls coexisting both deflect circles in the same step, independently', () => {
  const { drag, dt, restWall } = CONFIG.physics;
  const dragFactor = Math.exp(-drag * dt);
  const r = CONFIG.piece.radius;
  // Two separate walls, far enough apart (>= CONFIG.wall.clearance) that
  // neither's de-penetration can touch the other circle.
  const world = createWorld([
    { x: 5, y: 7 - r - 0.001 }, // circle 0 approaches wall A's flat side from above
    { x: 5, y: 11 - r - 0.001 }, // circle 1 approaches wall B's flat side from above
    { x: 9, y: 13 },
  ]);
  world.walls = [
    { x: 4, y: 7, orientation: 'horizontal', owner: 'A' },
    { x: 4, y: 11, orientation: 'horizontal', owner: 'B' },
  ];
  world.circles[0].vy = 5;
  world.circles[1].vy = 5;
  step(world);
  const expectedVy = -(5 * dragFactor) * restWall;
  assert.ok(Math.abs(world.circles[0].vy - expectedVy) < 1e-9, 'circle 0 correctly bounces off wall A');
  assert.ok(Math.abs(world.circles[1].vy - expectedVy) < 1e-9, 'circle 1 correctly bounces off wall B, independently');
});

check('rules: a moved wall survives a goal kick-off (resetWorld), but resetMatch ("Play again") resets both walls to their defaults', () => {
  const world = kickoffWorld();
  const match = createMatchState();
  placeWall(match, world, 'A', { x: 4, y: 4, orientation: 'horizontal' }); // moved off the default
  resetWorld(world, KICKOFF.B);
  assert.equal(world.walls.length, 1, 'a normal kick-off (post-goal reset) does not touch walls');
  assert.deepEqual(world.walls[0], { x: 4, y: 4, orientation: 'horizontal', owner: 'A' }, 'still at the moved-to spot, not reset');
  resetMatch(match, world);
  assert.equal(world.walls.length, 2, '"Play again" is a genuinely fresh match — both starting walls are back');
  assert.deepEqual(world.walls.find((w) => w.owner === 'A'), { ...KICKOFF_WALLS.A, owner: 'A' });
  assert.deepEqual(world.walls.find((w) => w.owner === 'B'), { ...KICKOFF_WALLS.B, owner: 'B' });
});

check('rules: initialWalls — both starting positions are themselves legal, individually and together', () => {
  const world = kickoffWorld();
  const walls = initialWalls();
  assert.equal(walls.length, 2);
  assert.equal(isWallLegal(walls[0], createWorld(KICKOFF.A)), true, 'A\'s default position is legal on an empty field');
  world.walls.push(walls[0]);
  assert.equal(isWallLegal(walls[1], world), true, 'B\'s default position is legal with A\'s already placed');
});

// --- Step 7: VOID mode (§5/§7) ---------------------------------------------
// CONFIG.field.mode/CONFIG.modes.void.voidPenalty are plain mutable fields
// (no test-mode override plumbing exists) — every check here sets what it
// needs and restores 'arena'/'goal' before returning, so mode never leaks
// into a check that runs after it.

check('physics (VOID): a circle whose centre leaves via the side is flagged fallen, velocity frozen to zero', () => {
  CONFIG.field.mode = 'void';
  const world = createWorld([{ x: -0.5, y: 7 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
  world.circles[0].vx = -5;
  world.circles[0].vy = 3;
  const fallen = checkFalls(world);
  assert.deepEqual(fallen, [0]);
  assert.equal(world.circles[0].fallen, true);
  assert.equal(world.circles[0].vx, 0, 'velocity frozen on fall');
  assert.equal(world.circles[0].vy, 0);
  CONFIG.field.mode = 'arena';
});

check('physics (VOID): a circle past the goal line but OUTSIDE the goal x-span falls (misses the goal mouth)', () => {
  CONFIG.field.mode = 'void';
  const world = createWorld([{ x: 1, y: -0.5 }, { x: 4, y: 1 }, { x: 5, y: 1 }]); // x=1 is left of goalXRange()'s [3.5, 6.5]
  assert.deepEqual(checkFalls(world), [0]);
  CONFIG.field.mode = 'arena';
});

check('physics (VOID): a circle past the goal line WITHIN the goal x-span never falls, however far past', () => {
  CONFIG.field.mode = 'void';
  const { min, max } = goalXRange();
  const midGoalX = (min + max) / 2;
  const world = createWorld([{ x: midGoalX, y: -50 }, { x: 1, y: 1 }, { x: 2, y: 1 }]); // 50 cells past the line, still centred in the mouth
  assert.deepEqual(checkFalls(world), [], '"the goal mouths still score normally" (§5) — depth past the line never matters inside the span');
  assert.equal(world.circles[0].fallen, false);
  CONFIG.field.mode = 'arena';
});

check('physics (VOID): checkFalls is a no-op outside VOID mode, even for a circle placed far off-field', () => {
  CONFIG.field.mode = 'arena';
  const world = createWorld([{ x: -50, y: -50 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
  assert.deepEqual(checkFalls(world), []);
  assert.equal(world.circles[0].fallen, false);
});

check('rules (VOID): an ARMED shot into the opponent\'s goal mouth scores normally (case 2) and is never flagged fallen, however far it overshoots with no backstop', () => {
  CONFIG.field.mode = 'void';
  const world = kickoffWorld();
  const match = createMatchState();
  match.armed = true;
  // x stays 3.5 (goalXRange min, in-span) throughout — a pure y-direction shot toward the opponent's goal (y=0).
  const result = runFlick(world, match, 0, { x: 0, y: -1 }, 22);
  assert.deepEqual(result, { type: 'goal', scorer: 'A', conceder: 'B', winner: null });
  assert.equal(match.score.A, 1);
  for (let i = 0; i < world.circles.length; i++) {
    assert.equal(world.circles[i].x, KICKOFF.B[i].x, `circle ${i} reset to KICKOFF.B — the normal post-goal kickoff, not the fall penalty's`);
    assert.equal(world.circles[i].y, KICKOFF.B[i].y);
  }
  CONFIG.field.mode = 'arena';
});

check('rules (VOID): a shot into your OWN goal mouth is ignored — no score, no turnover — and never flagged fallen, however far it flies', () => {
  CONFIG.field.mode = 'void';
  const world = kickoffWorld();
  const match = createMatchState(); // Player A; own goal is the bottom, y=h
  const result = runFlick(world, match, 0, { x: 0, y: 1 }, 22);
  assert.equal(result, null);
  assert.equal(match.score.A, 0);
  assert.equal(match.currentPlayer, 'A', 'no turnover on an own goal');
  assert.equal(world.circles[0].fallen, false, 'own-goal corridor exit is never a fall');
  assert.ok(world.circles[0].y > h, 'rests well past the line, physics-only — no backstop in VOID, no rollback in rules');
  CONFIG.field.mode = 'arena';
});

check('rules (VOID): fall penalty "goal" — opponent scores, the faller concedes and takes the next kick-off', () => {
  CONFIG.field.mode = 'void';
  CONFIG.modes.void.voidPenalty = 'goal';
  const world = kickoffWorld();
  const match = createMatchState(); // Player A
  const result = runFlick(world, match, 0, { x: -1, y: 0 }, 22); // off the left side — outside any goal span, unambiguous fall
  assert.deepEqual(result, { type: 'goal', scorer: 'B', conceder: 'A', winner: null });
  assert.equal(match.score.B, 1);
  assert.equal(match.currentPlayer, 'A', 'the faller takes the next kick-off, not the scorer');
  for (let i = 0; i < world.circles.length; i++) {
    assert.equal(world.circles[i].x, KICKOFF.A[i].x, `circle ${i} reset to KICKOFF.A — the faller's own kickoff`);
    assert.equal(world.circles[i].y, KICKOFF.A[i].y);
  }
  CONFIG.field.mode = 'arena';
});

check('rules (VOID): fall penalty "turnover" — no score change, only the fallen circle respawns, the other two untouched', () => {
  CONFIG.field.mode = 'void';
  CONFIG.modes.void.voidPenalty = 'turnover';
  const world = kickoffWorld();
  const match = createMatchState();
  const before1 = { x: world.circles[1].x, y: world.circles[1].y };
  const before2 = { x: world.circles[2].x, y: world.circles[2].y };
  const result = runFlick(world, match, 0, { x: -1, y: 0 }, 22);
  assert.equal(result, null, 'turnover has no goal object to report');
  assert.deepEqual(match.score, { A: 0, B: 0 });
  assert.equal(match.currentPlayer, 'B', 'turn passes to the opponent');
  assert.equal(world.circles[0].fallen, false, 'respawned, no longer fallen');
  assert.ok(world.circles[0].x >= 0 && world.circles[0].x <= w && world.circles[0].y >= 0 && world.circles[0].y <= h, 'respawned inside the field');
  assert.deepEqual({ x: world.circles[1].x, y: world.circles[1].y }, before1, 'uninvolved circle untouched');
  assert.deepEqual({ x: world.circles[2].x, y: world.circles[2].y }, before2, 'uninvolved circle untouched');
  CONFIG.modes.void.voidPenalty = 'goal';
  CONFIG.field.mode = 'arena';
});

check('rules (VOID): fall + "turnover" respawn keeps clearance from an occupant sitting on the centre spot', () => {
  CONFIG.field.mode = 'void';
  CONFIG.modes.void.voidPenalty = 'turnover';
  const world = kickoffWorld();
  const match = createMatchState();
  const centerX = w / 2;
  const centerY = h / 2;
  world.circles[1].x = centerX;
  world.circles[1].y = centerY; // occupies the default respawn spot; circle 0's path (y=11 constant) never comes near it
  runFlick(world, match, 0, { x: -1, y: 0 }, 22);
  const minDist = 2 * CONFIG.piece.radius;
  const dist = Math.hypot(world.circles[0].x - centerX, world.circles[0].y - centerY);
  assert.ok(dist >= minDist - 1e-9, `respawn keeps clearance from the occupant, got dist=${dist}`);
  assert.equal(world.circles[1].x, centerX, 'occupant itself untouched');
  assert.equal(world.circles[1].y, centerY);
  CONFIG.modes.void.voidPenalty = 'goal';
  CONFIG.field.mode = 'arena';
});

console.log(`\n${passed}/${total} checks passed`);
