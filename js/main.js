// js/main.js — entry point, wiring, and the fixed-timestep accumulator loop
// (BUILD_SPEC.md §5, hard rule 4). physics.js owns the simulation, input.js
// owns drag-to-aim/wall-placement UI state, rules.js owns turn/armed/score/
// timer/wall-legality state; this file wires them together, interpolates
// physics state for render, and owns the DOM lifecycle of the goal popup,
// HUD bar, win overlay, and wall-placement controls (screen chrome, not
// canvas draws — see index.html/styles.css).

import { setupContext, drawFrame, computeScale } from './render.js';
import { createWorld, step, isSettled, checkFalls } from './physics.js';
import { attachInput } from './input.js';
import {
  createMatchState, resetMatch, KICKOFF, onLaunch,
  tick as rulesTick, forfeitTurn, tickMatchClock,
  isWallLegal, placeWall, removeWall, initialWalls,
} from './rules.js';
import { lerp } from './vec.js';
import { CONFIG } from './config.js';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');

const popup = document.getElementById('goal-popup');
const goalScoreA = document.getElementById('goal-score-a'); // Fix 1 (2026-08-24 follow-up): pre-declared in index.html so onGoal() below can set .textContent/.style.color instead of building an HTML string
const goalScoreB = document.getElementById('goal-score-b');
if (
  !(popup instanceof HTMLElement) || !(goalScoreA instanceof HTMLElement) || !(goalScoreB instanceof HTMLElement)
) {
  throw new Error('missing #goal-popup/#goal-score-a/#goal-score-b elements');
}

const scoreA = document.getElementById('score-a');
const scoreB = document.getElementById('score-b');
const wallButtonA = document.getElementById('wall-button-a');
const wallButtonB = document.getElementById('wall-button-b');
const matchClockEl = document.getElementById('match-clock');
const turnClockEl = document.getElementById('turn-clock'); // item 4: HUD centre slot's new primary readout
if (
  !(scoreA instanceof HTMLElement) || !(scoreB instanceof HTMLElement) ||
  !(wallButtonA instanceof HTMLButtonElement) || !(wallButtonB instanceof HTMLButtonElement) ||
  !(matchClockEl instanceof HTMLElement) || !(turnClockEl instanceof HTMLElement)
) {
  throw new Error('missing HUD elements');
}

const winOverlay = document.getElementById('win-overlay');
const winMessage = document.getElementById('win-message');
const playAgainButton = document.getElementById('play-again');
const changeFieldButton = document.getElementById('change-field'); // item 18: separate from Play again's own same-field restart
if (
  !(winOverlay instanceof HTMLElement) || !(winMessage instanceof HTMLElement) ||
  !(playAgainButton instanceof HTMLElement) || !(changeFieldButton instanceof HTMLElement)
) {
  throw new Error('missing #win-overlay/#win-message/#play-again/#change-field elements');
}

const turnPrompt = document.getElementById('turn-prompt'); // Part 3
if (!(turnPrompt instanceof HTMLElement)) throw new Error('missing #turn-prompt element');

const wallControls = document.getElementById('wall-controls');
const wallCancelButton = document.getElementById('wall-cancel');
const wallRemoveButton = document.getElementById('wall-remove');
const wallRotateButton = document.getElementById('wall-rotate');
const wallConfirmButton = document.getElementById('wall-confirm');
if (
  !(wallControls instanceof HTMLElement) || !(wallCancelButton instanceof HTMLElement) ||
  !(wallRemoveButton instanceof HTMLElement) ||
  !(wallRotateButton instanceof HTMLElement) || !(wallConfirmButton instanceof HTMLButtonElement)
) {
  throw new Error('missing #wall-controls elements');
}

const modePicker = document.getElementById('mode-picker');
const modeArenaButton = document.getElementById('mode-arena');
const modeVoidButton = document.getElementById('mode-void');
if (!(modePicker instanceof HTMLElement) || !(modeArenaButton instanceof HTMLElement) || !(modeVoidButton instanceof HTMLElement)) {
  throw new Error('missing #mode-picker elements');
}

// Player A's kick-off triangle (BUILD_SPEC.md §3, widened per rules.js's
// own comment) — the same table rules.js's post-goal reset reuses, so
// there is exactly one source of truth for kick-off coordinates.
const world = createWorld(KICKOFF.A);
world.walls = initialWalls(); // §7: both players' walls exist from the very start, same as resetMatch gives every later match
const match = createMatchState();

/** @type {CanvasRenderingContext2D} */
let ctx;

/** Updates the canvas backing store for the current viewport/DPR. Does not
 * touch `world` — a resize never resets simulation state.
 *
 * Item 13 (2026-08-23 polish pass): also publishes the field's own left
 * offset/width as CSS custom properties, so styles.css can constrain #hud
 * to that range instead of the full viewport (on desktop the field is
 * centred and narrower than the viewport — computeScale — which used to
 * leave the score readouts far from the field they describe). Called once
 * up front (below) for the initial paint, not just on every subsequent
 * resize event, so the properties are never left unset on first load. */
function resize() {
  ctx = setupContext(canvas, canvas.clientWidth, canvas.clientHeight);
  const { scale, offsetX } = computeScale(canvas.clientWidth, canvas.clientHeight);
  document.documentElement.style.setProperty('--field-left', `${offsetX}px`);
  document.documentElement.style.setProperty('--field-width', `${CONFIG.field.w * scale}px`);
}
resize();

window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);

/** @type {number | null} wall-clock deadline (performance.now()-based, not
 * accumulator/dt-tied) — a mobile backgrounding gap during the popup just
 * finds it already expired on resume rather than stuck open. */
let popupUntil = null;

/** @type {{position: {x: number, y: number}, since: number} | null} VOID
 * mode's derez fade (§5) — physics.js/rules.js stay wall-clock-free by
 * design, so main.js owns the timestamp. `position` is a frozen snapshot
 * of where the circle fell, taken the instant `checkFalls` detects it —
 * rules.js resolves the fall (and respawns the circle elsewhere) on
 * essentially the very next settled check, well before this fade would
 * finish, so the fade can't track the live circle without jumping to the
 * respawn point mid-animation; render.js draws it as an independent
 * "ghost" instead (see drawFallingGhost). Only one circle can ever be
 * falling at a time (only the launched circle moves), so a single slot is
 * enough — no map/array needed. */
let fallingSince = null;

/** @type {{x: number, y: number}[]} step 8 (§10): the launched circle's
 * last CONFIG.trail.length interpolated positions, oldest first. Cleared
 * whenever no flick is in flight — only ever one circle moving at a time
 * (same reasoning as `fallingSince`), so a single shared array is enough. */
let trail = [];

/** @type {string | null} Fix 2 (2026-08-24 follow-up): the shooting
 * player's colour, snapshotted once at the instant the trail begins (the
 * same `prevCurrentPlayer` captured below for the pass-flash fix is the
 * source) rather than read live off `match.currentPlayer` at render time —
 * same reasoning as `passFlash`/`goalFlash`/`illegalPulseColor`: a live
 * read can misattribute the effect once currentPlayer/launchedIndex change
 * mid-resolution. Cleared alongside `trail` itself. */
let trailColor = null;

/** @type {{index: number, player: 'A'|'B', since: number} | null} the
 * completed-pass flash (§10), performance.now()-based like every other
 * one-shot effect here. `index`/`player` are captured once, at the instant
 * the flash triggers below — NOT read live off input.js's selectedIndex
 * (already null by the time a flick is in flight: input.js:215 nulls it on
 * release, before this flash's own window even opens) or off
 * match.currentPlayer/match.launchedIndex (rules.js can resolve the flick
 * — flipping currentPlayer and nulling launchedIndex — inside the very
 * tick() call that raises this edge, or later within the flash's own
 * display window; either live read would misattribute the flash to the
 * wrong pair of circles or the wrong colour). Fixes a real bug: this used
 * to be a bare timestamp and the draw call filtered on live selectedIndex,
 * which meant the flash never rendered at all (see render.js's drawPassLine
 * doc comment for the full story). */
let passFlash = null;

/** @type {number | null} wall-clock start of the "turn lost, no goal"
 * border pulse (§10). */
let illegalPulseSince = null;

/** @type {string} colour for the pulse above — varies by cause (2026-08-23
 * polish pass): red for a genuine missed/contact flick (default, matches
 * drawIllegalPulse's own default), white for a pass that completed but
 * resolved as an unarmed goal (a rollback, not a foul — see the physics
 * loop below), the forfeiting player's own colour for a timeout. Set
 * alongside `illegalPulseSince` at every trigger site, never read before
 * `illegalPulseSince` is first set. */
let illegalPulseColor = CONFIG.colors.wallIllegal;

/** @type {{scorer: 'A' | 'B', since: number} | null} wall-clock start of
 * the goal flood/grid-pulse (§10) — `scorer` is captured once (same
 * reasoning as rules.js's own `lastScorer`: `match.currentPlayer` has
 * already flipped by the time this renders, so it can't be read live). */
let goalFlash = null;

/** §12 step 7: "a mode toggle before the match." Shown by default (see
 * styles.css — no `.hidden` class at load), blocking input until a choice
 * is made; re-shown on "Play again" so a session can try both fields
 * across matches without a page reload. `CONFIG.field.mode` is a plain
 * mutable property — every mode-aware read (physics.js, render.js) checks
 * it live, so flipping it here before play starts is sufficient; no other
 * reset is needed since kick-off positions don't depend on field mode. */
let modeChosen = false;
function pickMode(mode) {
  CONFIG.field.mode = mode;
  modeChosen = true;
  modePicker.classList.add('hidden');
}
modeArenaButton.addEventListener('click', () => pickMode('arena'));
modeVoidButton.addEventListener('click', () => pickMode('void'));

function updateHud() {
  scoreA.textContent = String(match.score.A);
  scoreB.textContent = String(match.score.B);
}
updateHud();

/** §8b: M:SS, amber under 60s. Only touches the DOM when the displayed
 * second actually changes, not every rendered frame. */
let lastDisplayedMatchSeconds = null;
function updateMatchClockDisplay() {
  const totalSeconds = Math.ceil(match.matchTimeLeft);
  if (totalSeconds === lastDisplayedMatchSeconds) return;
  lastDisplayedMatchSeconds = totalSeconds;
  const mm = Math.floor(totalSeconds / 60);
  const ss = String(totalSeconds % 60).padStart(2, '0');
  matchClockEl.textContent = CONFIG.timers.matchClockEnabled ? `${mm}:${ss}` : '';
  matchClockEl.classList.toggle('low', totalSeconds <= 60 && totalSeconds > 0);
}
updateMatchClockDisplay();

/** Item 4 (2026-08-23 polish pass): the turn countdown as an actual number
 * in the HUD's centre slot — same "only touch the DOM on an actual second
 * change" pattern as updateMatchClockDisplay above. No extra gating for
 * wall placement/etc needed here: match.turnTimeLeft itself already just
 * holds steady whenever the turn-timer decrement below is paused, so the
 * displayed number naturally holds steady too. */
let lastDisplayedTurnSeconds = null;
function updateTurnClockDisplay() {
  const totalSeconds = Math.ceil(match.turnTimeLeft);
  if (totalSeconds === lastDisplayedTurnSeconds) return;
  lastDisplayedTurnSeconds = totalSeconds;
  turnClockEl.textContent = String(totalSeconds);
  turnClockEl.classList.toggle('low', totalSeconds <= 5 && totalSeconds > 0);
}
updateTurnClockDisplay();

/** Item 17 (2026-08-23 polish pass): "Player A"/"Player B" used to only
 * ever appear once, on the win screen — everywhere else in this game
 * identity is colour+side (scores, walls, goals, the turn rail). Dropped
 * the letters from the win screen in favour of the same colour-name
 * language rather than adding a persistent HUD label elsewhere (HUD space
 * is already tight after items 4/14's growth). */
function playerLabel(player) {
  return player === 'A' ? 'CYAN' : 'AMBER';
}

/**
 * §9: on a normal goal, a brief popup then kick-off continues (rules.js
 * already applied that reset synchronously — the scrim covers the field
 * for the full popup duration, so it's never exposed as a jump-cut). On
 * the WINNING goal, skip the transient popup and go straight to the
 * full-screen win overlay instead — §9 describes it as the match's actual
 * end state, not one more instance of the per-goal flash. "How it was
 * won" (§9) comes from rules.js's `winReason`: a sudden-death goal after
 * the clock ran out is still reported as a goal win, only a no-goal
 * clock-expiry-with-a-lead is reported as "on the clock."
 * @param {{type: 'goal', scorer: 'A'|'B', conceder: 'A'|'B', winner: 'A'|'B'|null}} result
 */
function onGoal(result) {
  updateHud();
  if (result.winner) {
    const loser = result.winner === 'A' ? 'B' : 'A';
    const how = match.winReason === 'clock' ? 'on the clock' : `${match.score[result.winner]}–${match.score[loser]}`;
    winMessage.textContent = `${playerLabel(result.winner)} WINS — ${how}!`;
    winMessage.style.color = result.winner === 'A' ? CONFIG.colors.playerA : CONFIG.colors.playerB;
    winOverlay.classList.add('visible');
    return;
  }
  // Item 7 (polish pass): show the actual score, scorer's own number in
  // their own colour — not just "Congrats!". Fix 1 (2026-08-24 follow-up):
  // the two numbers are pre-declared <span>s in index.html now, updated via
  // .textContent + .style.color — same pattern updateHud/winMessage already
  // use — instead of building an HTML string (this was the only innerHTML
  // use in the codebase).
  goalScoreA.textContent = String(match.score.A);
  goalScoreA.style.color = CONFIG.colors.playerA;
  goalScoreB.textContent = String(match.score.B);
  goalScoreB.style.color = CONFIG.colors.playerB;
  popup.style.color = result.scorer === 'A' ? CONFIG.colors.playerA : CONFIG.colors.playerB;
  popup.classList.add('visible');
  popupUntil = performance.now() + CONFIG.goalPopup.durationMs;
}

/** A clock-expiry win (§8b, leader when 0:00 hits) never returns a `tick()`
 * result the way a goal does — main.js has to notice the winner appearing
 * on its own and show the overlay itself. */
function checkClockWin() {
  if (match.winner === null || winOverlay.classList.contains('visible')) return;
  winMessage.textContent = `${playerLabel(match.winner)} WINS — ON THE CLOCK!`;
  winMessage.style.color = match.winner === 'A' ? CONFIG.colors.playerA : CONFIG.colors.playerB;
  winOverlay.classList.add('visible');
}

/** Shared reset steps for both win-overlay actions below — score/turn/world
 * state back to a fresh match start, same either way. */
function resetForNewMatch() {
  resetMatch(match, world);
  updateHud();
  lastDisplayedMatchSeconds = null;
  updateMatchClockDisplay();
  lastDisplayedTurnSeconds = null;
  updateTurnClockDisplay();
  winOverlay.classList.remove('visible');
}

// Item 18 (2026-08-23 polish pass): "Play again" now restarts the SAME
// field/mode instead of bouncing back to the mode-picker screen —
// CONFIG.field.mode is already set from the match that just ended, and
// modeChosen stays true, so play can resume immediately.
playAgainButton.addEventListener('click', resetForNewMatch);

// "Change field" is the smaller, separate control for switching ARENA/VOID
// without a reload — this is the mode-picker round trip Play again used to
// always do.
changeFieldButton.addEventListener('click', () => {
  resetForNewMatch();
  modeChosen = false;
  modePicker.classList.remove('hidden');
});

// Always read live canvas dimensions rather than a cached transform, so a
// resize between pointer events can never leave input.js hit-testing
// against a stale transform.
const input = attachInput(
  canvas,
  world,
  match,
  () => computeScale(canvas.clientWidth, canvas.clientHeight),
  (index) => onLaunch(match, world, index),
  () => popupUntil !== null || match.winner !== null || !modeChosen
);

/** §7 (redesigned 2026-08-20, twice in one day): a player enters placement
 * mode for their OWN wall by tapping their side's button — no automatic
 * turn-machine window. Available any time it's genuinely their turn
 * (including mid-turn while armed, so a wall can set up a bounce shot, not
 * just defend). Every player has a wall on the field from kickoff onward
 * (`initialWalls`), so this is always a MOVE, seeded from wherever their
 * wall currently sits — `enterPlacement`'s own enabled-state check in
 * `updateWallControls` is what actually gates *when* the button can be
 * pressed. */
function enterPlacement(player) {
  const currentWall = world.walls.find((w) => w.owner === player) ?? null;
  input.beginWallPlacement(player, currentWall);
  wallControls.classList.add('visible');
}
wallButtonA.addEventListener('click', () => enterPlacement('A'));
wallButtonB.addEventListener('click', () => enterPlacement('B'));

wallRotateButton.addEventListener('click', () => input.rotateWall());
wallCancelButton.addEventListener('click', () => {
  input.cancelWallPlacement();
  wallControls.classList.remove('visible');
});
wallRemoveButton.addEventListener('click', () => {
  const { placingFor } = input.getWallState();
  if (placingFor && removeWall(match, world, placingFor)) {
    input.cancelWallPlacement();
    wallControls.classList.remove('visible');
  }
});
wallConfirmButton.addEventListener('click', () => {
  const { preview, placingFor } = input.getWallState();
  if (preview && placingFor && placeWall(match, world, placingFor, preview)) {
    input.cancelWallPlacement(); // exits placement mode — committed, nothing left to drag
    wallControls.classList.remove('visible');
  }
});

/**
 * Keeps the wall-placement controls bar and each side's "Wall" button in
 * sync every frame. The controls bar tracks input.js's own placement-mode
 * state directly (no separate main.js flag to drift out of sync with it).
 * Each button is enabled only when it's genuinely legal to START moving
 * that wall right now: that player's own turn (including mid-turn while
 * armed — §7's offensive use case), the field settled with no flick in
 * flight (can't sensibly drag a wall while circles are still moving), the
 * match not over, a mode chosen, no popup covering the field, and nobody
 * already mid-placement (including yourself, until you cancel/confirm).
 * No "already placed" check any more — every player always has a wall to
 * move (or remove) from kickoff onward.
 */
function updateWallControls() {
  const { placingFor, preview } = input.getWallState();
  wallControls.classList.toggle('visible', placingFor !== null);
  if (placingFor !== null) {
    wallConfirmButton.disabled = !preview || !isWallLegal(preview, world, placingFor);
  }

  const canStartPlacing = (player) =>
    placingFor === null && modeChosen && popupUntil === null && match.winner === null &&
    match.currentPlayer === player && match.launchedIndex === null && isSettled(world);
  wallButtonA.disabled = !canStartPlacing('A');
  wallButtonB.disabled = !canStartPlacing('B');
}

// Engine constant, not a CONFIG value — caps wall-clock frameTime before
// it's added to the accumulator. Mobile tab-backgrounding (lock screen,
// notification, app-switch) is routine; without this an unclamped gap
// makes the accumulator try to run thousands of steps synchronously on
// resume.
const MAX_FRAME_TIME = 0.25;

let accumulator = 0;
/** @type {number | null} */
let lastTime = null;

function frame(now) {
  if (lastTime === null) lastTime = now;
  // Two different notions of "elapsed" on purpose. `frameTime` is clamped
  // for the PHYSICS accumulator only — protects the simulation from trying
  // to fast-forward through a huge gap (tab backgrounded, thottled rAF) in
  // one burst. The turn timer and match clock are plain wall-clock
  // countdowns with no catch-up risk; clamping them would make a real
  // background gap silently NOT count against a player's 20 seconds or the
  // 5:00 match clock, which is exactly backwards from §8's intent — so they
  // use the true, unclamped elapsed time instead.
  const rawElapsed = (now - lastTime) / 1000;
  const frameTime = Math.min(rawElapsed, MAX_FRAME_TIME);
  lastTime = now;
  accumulator += frameTime;

  // Always advances by the literal CONFIG.physics.dt, never the measured
  // frameTime — determinism requirement (hard rule 4). rules.js's tick()
  // runs once per physics step here, not once per rendered frame: a fast
  // shot can cross several physics steps within one interpolated frame,
  // and crossing detection is only meaningful step-by-step.
  while (accumulator >= CONFIG.physics.dt) {
    const wasPassedThisFlick = match.passedThisFlick;
    const prevCurrentPlayer = match.currentPlayer;
    // Pre-tick snapshot for the pass-flash fix below — rulesTick() (called
    // just below) can null match.launchedIndex within this very call, once
    // the flick resolves, so it must be captured before that call runs, not
    // read back off `match` afterward.
    const launchedIndexThisStep = match.launchedIndex;

    const contacts = step(world);
    const fallen = checkFalls(world); // VOID mode only; always [] in ARENA
    if (fallen.length > 0) {
      const c = world.circles[fallen[0]];
      fallingSince = { position: { x: c.x, y: c.y }, since: now }; // snapshot — see fallingSince's own doc comment on why
    }
    const result = rulesTick(match, world, contacts, fallen);

    // §10 step 8 triggers. "Completed pass" fires on the rising edge of
    // passedThisFlick — the instant the crossing happens, not once the
    // whole flick later settles ("the player must learn the rule from this
    // flash"). Goal vs. "illegal flick, turn lost" are distinguished by
    // whether currentPlayer flipped this tick: every turn-ending case in
    // rules.js flips it (goal-and-continue, contact, miss, rollback, VOID
    // turnover) except a completed pass or an own goal, neither of which
    // ends the turn — so a flip with no goal result is exactly the miss/
    // contact/rollback case §10 calls "illegal."
    //
    // `index`/`player` snapshotted here (not read live later) — see
    // passFlash's own doc comment above for why.
    if (!wasPassedThisFlick && match.passedThisFlick) {
      passFlash = { index: launchedIndexThisStep, player: prevCurrentPlayer, since: now };
    }
    if (result?.type === 'goal') {
      goalFlash = { scorer: result.scorer, since: now };
    } else if (prevCurrentPlayer !== match.currentPlayer) {
      illegalPulseSince = now;
      // Item 8: a pass that completed but resolved as an unarmed goal
      // (rules.js case 3 — a rollback, not a foul) is distinguishable here
      // purely from state main.js can already observe: rules.js never
      // resets match.goalThisFlick after resolving, so if a goal-crossing
      // happened at all this flick AND the turn still ended with no `goal`
      // result above, that's unambiguously case 3 (case 2, armed+goal,
      // would have returned a `goal` result and taken the branch above
      // instead). Gets its own colour so it doesn't fire the identical red
      // cue right after a bright pass flash — see drawIllegalPulse's doc
      // comment.
      illegalPulseColor = match.goalThisFlick ? CONFIG.colors.pieceActive : CONFIG.colors.wallIllegal;
    }

    if (match.launchedIndex !== null) {
      // Snapshot on the rising edge only (trail.length === 0 -> about to
      // push the first sample) — same prevCurrentPlayer already captured
      // above, not a live read taken later at render time. See trailColor's
      // own doc comment above for why.
      if (trail.length === 0) trailColor = prevCurrentPlayer === 'A' ? CONFIG.colors.playerA : CONFIG.colors.playerB;
      const c = world.circles[match.launchedIndex];
      trail.push({ x: c.x, y: c.y });
      if (trail.length > CONFIG.trail.length) trail.shift();
    } else if (trail.length > 0) {
      trail = [];
      trailColor = null;
    }

    if (result) onGoal(result);
    accumulator -= CONFIG.physics.dt;
  }

  // The fade always plays its full course regardless of how fast rules.js
  // resolves/respawns underneath it — it's an independent ghost at a fixed
  // snapshot position, not tied to any live circle. Checked once per
  // rendered frame, not per physics step: a display concern, not sim state.
  if (fallingSince !== null && now - fallingSince.since >= CONFIG.void.derezFadeMs) {
    fallingSince = null;
  }
  const fallingFade = fallingSince
    ? { position: fallingSince.position, alpha: Math.max(0, 1 - (now - fallingSince.since) / CONFIG.void.derezFadeMs) }
    : null;

  // Same one-shot fade-and-clear pattern as fallingFade above, for each of
  // step 8's three timed effects.
  if (passFlash !== null && now - passFlash.since >= CONFIG.passFlash.durationMs) passFlash = null;
  const passFlashRender = passFlash
    ? { index: passFlash.index, player: passFlash.player, progress: (now - passFlash.since) / CONFIG.passFlash.durationMs }
    : null;

  if (illegalPulseSince !== null && now - illegalPulseSince >= CONFIG.illegalPulse.durationMs) illegalPulseSince = null;
  const illegalPulseAlpha = illegalPulseSince !== null ? Math.max(0, 1 - (now - illegalPulseSince) / CONFIG.illegalPulse.durationMs) : 0;

  if (goalFlash !== null && now - goalFlash.since >= CONFIG.goalFlash.durationMs) goalFlash = null;
  const goalFlashRender = goalFlash ? { scorer: goalFlash.scorer, progress: (now - goalFlash.since) / CONFIG.goalFlash.durationMs } : null;

  if (popupUntil !== null && now >= popupUntil) {
    popup.classList.remove('visible');
    popupUntil = null;
  }

  updateWallControls();

  // §8a: the turn timer only counts down while nothing is moving, no flick
  // is in flight ("pauses while the physics are running"), not during the
  // goal popup, and not while a player is placing their wall ("pauses...
  // while the wall-placement step is open" — no longer a distinct turn-
  // machine phase per the §7 redesign, but the same intent: don't let
  // placement UI burn the decision clock) — real wall-clock time, once per
  // rendered frame, not tied to the fixed physics step. Also gated on
  // `modeChosen`: without it, a player still reading the mode picker burns
  // their first turn timer in the background and can get silently
  // forfeited before the match has visibly started.
  //
  // Extracted to `awaitingShot` (Part 3, 2026-08-23 polish pass): this
  // predicate now has a second consumer — the turn-prompt below reads it
  // too, to know when the acting player hasn't done anything yet this
  // turn. Same value, no behaviour change to the timer gate itself.
  const awaitingShot =
    modeChosen && match.winner === null && popupUntil === null && input.getWallState().placingFor === null &&
    match.launchedIndex === null && isSettled(world);
  if (awaitingShot) {
    match.turnTimeLeft = Math.max(0, match.turnTimeLeft - rawElapsed);
    if (match.turnTimeLeft === 0) {
      const prevCurrentPlayer = match.currentPlayer;
      forfeitTurn(match);
      if (match.currentPlayer !== prevCurrentPlayer) {
        // always true — forfeitTurn always flips — kept explicit for symmetry with the physics-loop trigger above
        illegalPulseSince = now;
        // Item 19: a timeout forfeit (no flick attempted at all) gets the
        // forfeiting player's own colour — distinct from both the red
        // missed-flick cue and item 8's white wasted-pass cue above.
        illegalPulseColor = prevCurrentPlayer === 'A' ? CONFIG.colors.playerA : CONFIG.colors.playerB;
      }
    }
  }

  // Part 3 (2026-08-23 polish pass): "Place your wall — or just take your
  // shot," shown only before the acting player's first action of the turn
  // — disappears the instant they grab a circle (selectedIndex !== null),
  // no dismiss button, no timer, no turn-counter. flicksThisTurn === 0 is
  // what keeps this from reappearing after a completed pass mid-turn (the
  // player has already acted this turn at that point, even though nothing
  // is currently selected).
  const showTurnPrompt = awaitingShot && match.flicksThisTurn === 0 && input.getState().selectedIndex === null;
  turnPrompt.classList.toggle('visible', showTurnPrompt);
  if (showTurnPrompt) {
    turnPrompt.classList.toggle('for-a', match.currentPlayer === 'A');
    turnPrompt.classList.toggle('for-b', match.currentPlayer === 'B');
  }

  // §8b: the match clock ticks continuously — including through physics
  // motion and wall placement — only pausing on the goal popup overlay and
  // (same reasoning as the turn timer above) before a mode has been chosen.
  if (modeChosen && popupUntil === null) {
    tickMatchClock(match, rawElapsed);
    checkClockWin();
  }
  updateMatchClockDisplay();
  updateTurnClockDisplay();

  const alpha = accumulator / CONFIG.physics.dt;
  const interpolated = world.circles.map((c) =>
    lerp({ x: c.prevX, y: c.prevY }, { x: c.x, y: c.y }, alpha)
  );

  drawFrame(
    ctx, canvas.clientWidth, canvas.clientHeight, interpolated, input.getState(), match, world, input.getWallState(),
    fallingFade, trail, trailColor, passFlashRender, illegalPulseAlpha, goalFlashRender, illegalPulseColor
  );
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
