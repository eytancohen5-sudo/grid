// js/main.js — entry point, wiring, and the fixed-timestep accumulator loop
// (BUILD_SPEC.md §5, hard rule 4). physics.js owns the simulation, input.js
// owns drag-to-aim/wall placement, rules.js owns turn/armed/score/timer/wall
// state; this file wires them together, interpolates physics state for
// render, and owns the DOM lifecycle of the goal popup, HUD bar, win
// overlay, and wall-placement controls (screen chrome, not canvas draws —
// see index.html/styles.css).

import { setupContext, drawFrame, computeScale } from './render.js';
import { createWorld, step, isSettled, checkFalls } from './physics.js';
import { attachInput } from './input.js';
import {
  createMatchState, resetMatch, KICKOFF, onLaunch,
  tick as rulesTick, forfeitTurn, tickMatchClock,
  isWallLegal, confirmWallPlacement, skipWallPlacement,
} from './rules.js';
import { lerp } from './vec.js';
import { CONFIG } from './config.js';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');

const popup = document.getElementById('goal-popup');
if (!(popup instanceof HTMLElement)) throw new Error('missing #goal-popup element');

const scoreA = document.getElementById('score-a');
const scoreB = document.getElementById('score-b');
const wallUsesA = document.getElementById('wall-uses-a');
const wallUsesB = document.getElementById('wall-uses-b');
const matchClockEl = document.getElementById('match-clock');
if (
  !(scoreA instanceof HTMLElement) || !(scoreB instanceof HTMLElement) ||
  !(wallUsesA instanceof HTMLElement) || !(wallUsesB instanceof HTMLElement) ||
  !(matchClockEl instanceof HTMLElement)
) {
  throw new Error('missing HUD elements');
}

const winOverlay = document.getElementById('win-overlay');
const winMessage = document.getElementById('win-message');
const playAgainButton = document.getElementById('play-again');
if (!(winOverlay instanceof HTMLElement) || !(winMessage instanceof HTMLElement) || !(playAgainButton instanceof HTMLElement)) {
  throw new Error('missing #win-overlay/#win-message/#play-again elements');
}

const wallControls = document.getElementById('wall-controls');
const wallSkipButton = document.getElementById('wall-skip');
const wallRotateButton = document.getElementById('wall-rotate');
const wallConfirmButton = document.getElementById('wall-confirm');
if (
  !(wallControls instanceof HTMLElement) || !(wallSkipButton instanceof HTMLElement) ||
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
const match = createMatchState();

let ctx = setupContext(canvas, canvas.clientWidth, canvas.clientHeight);

/** Updates the canvas backing store for the current viewport/DPR. Does not
 * touch `world` — a resize never resets simulation state. */
function resize() {
  ctx = setupContext(canvas, canvas.clientWidth, canvas.clientHeight);
}

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

/** @type {number | null} wall-clock start of the completed-pass flash
 * (§10), performance.now()-based like every other one-shot effect here. */
let passFlashSince = null;

/** @type {number | null} wall-clock start of the "turn lost, no goal" red
 * border pulse (§10). */
let illegalPulseSince = null;

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
  wallUsesA.textContent = String(match.wallUses.A);
  wallUsesB.textContent = String(match.wallUses.B);
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
    winMessage.textContent = `Player ${result.winner} wins — ${how}!`;
    winMessage.style.color = result.winner === 'A' ? CONFIG.colors.playerA : CONFIG.colors.playerB;
    winOverlay.classList.add('visible');
    return;
  }
  popup.textContent = 'Congrats!';
  popup.style.color = result.scorer === 'A' ? CONFIG.colors.playerA : CONFIG.colors.playerB;
  popup.classList.add('visible');
  popupUntil = performance.now() + CONFIG.goalPopup.durationMs;
}

/** A clock-expiry win (§8b, leader when 0:00 hits) never returns a `tick()`
 * result the way a goal does — main.js has to notice the winner appearing
 * on its own and show the overlay itself. */
function checkClockWin() {
  if (match.winner === null || winOverlay.classList.contains('visible')) return;
  winMessage.textContent = `Player ${match.winner} wins — on the clock!`;
  winMessage.style.color = match.winner === 'A' ? CONFIG.colors.playerA : CONFIG.colors.playerB;
  winOverlay.classList.add('visible');
}

playAgainButton.addEventListener('click', () => {
  resetMatch(match, world);
  updateHud();
  lastDisplayedMatchSeconds = null;
  updateMatchClockDisplay();
  winOverlay.classList.remove('visible');
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

wallRotateButton.addEventListener('click', () => input.rotateWall());
wallSkipButton.addEventListener('click', () => skipWallPlacement(match));
wallConfirmButton.addEventListener('click', () => {
  const preview = input.getWallState().preview;
  if (preview) confirmWallPlacement(match, world, preview);
  updateHud(); // wall-uses just changed
});

/** §7's placement window opens the instant `wallPlacer` is set (inside
 * rules.js's resolveFlick, synchronous with turn resolution) — but for a
 * non-winning GOAL specifically, that's the same instant the goal popup
 * starts its ~1.4s show. Gating the wall UI's own visibility on
 * `popupUntil === null` too avoids the confirm/rotate/skip controls
 * appearing underneath (and interactable through) that scrim. */
let wallUiActive = false;
function updateWallUi() {
  const shouldShow = match.wallPlacer !== null && popupUntil === null && match.winner === null;
  if (shouldShow && !wallUiActive) {
    input.beginWallPlacement();
    wallControls.classList.add('visible');
    wallUiActive = true;
  } else if (!shouldShow && wallUiActive) {
    wallControls.classList.remove('visible');
    wallUiActive = false;
  }
  if (wallUiActive) {
    const preview = input.getWallState().preview;
    wallConfirmButton.disabled = !preview || match.wallUses[match.wallPlacer] <= 0 || !isWallLegal(preview, world);
  }
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
    const prevWallPlacer = match.wallPlacer;

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
    // rules.js's own already-tested wallPlacer invariant: it opens on every
    // turn-ending case (goal or not), so a goal result takes priority and a
    // bare wallPlacer-opened-with-no-goal is exactly the miss/contact/
    // rollback case §10 calls "illegal."
    if (!wasPassedThisFlick && match.passedThisFlick) passFlashSince = now;
    if (result?.type === 'goal') {
      goalFlash = { scorer: result.scorer, since: now };
    } else if (prevWallPlacer === null && match.wallPlacer !== null) {
      illegalPulseSince = now;
    }

    if (match.launchedIndex !== null) {
      const c = world.circles[match.launchedIndex];
      trail.push({ x: c.x, y: c.y });
      if (trail.length > CONFIG.trail.length) trail.shift();
    } else if (trail.length > 0) {
      trail = [];
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
  if (passFlashSince !== null && now - passFlashSince >= CONFIG.passFlash.durationMs) passFlashSince = null;
  const passFlashProgress = passFlashSince !== null ? (now - passFlashSince) / CONFIG.passFlash.durationMs : null;

  if (illegalPulseSince !== null && now - illegalPulseSince >= CONFIG.illegalPulse.durationMs) illegalPulseSince = null;
  const illegalPulseAlpha = illegalPulseSince !== null ? Math.max(0, 1 - (now - illegalPulseSince) / CONFIG.illegalPulse.durationMs) : 0;

  if (goalFlash !== null && now - goalFlash.since >= CONFIG.goalFlash.durationMs) goalFlash = null;
  const goalFlashRender = goalFlash ? { scorer: goalFlash.scorer, progress: (now - goalFlash.since) / CONFIG.goalFlash.durationMs } : null;

  if (popupUntil !== null && now >= popupUntil) {
    popup.classList.remove('visible');
    popupUntil = null;
  }

  updateWallUi();

  // §8a: the turn timer only counts down while nothing is moving, no flick
  // is in flight ("pauses while the physics are running"), not during the
  // goal popup, and not while wall placement is open ("pauses... while the
  // wall-placement step is open") — real wall-clock time, once per
  // rendered frame, not tied to the fixed physics step. Also gated on
  // `modeChosen`: without it, a player still reading the mode picker burns
  // their first turn timer in the background and can get silently
  // forfeited before the match has visibly started.
  if (
    modeChosen && match.winner === null && popupUntil === null && match.wallPlacer === null &&
    match.launchedIndex === null && isSettled(world)
  ) {
    match.turnTimeLeft = Math.max(0, match.turnTimeLeft - rawElapsed);
    if (match.turnTimeLeft === 0) {
      forfeitTurn(match); // always opens wallPlacer (this block's own guard already confirms it was null) — same "turn lost, no goal" signal as the physics loop above
      illegalPulseSince = now;
    }
  }

  // §8b: the match clock ticks continuously — including through physics
  // motion and wall placement — only pausing on the goal popup overlay and
  // (same reasoning as the turn timer above) before a mode has been chosen.
  if (modeChosen && popupUntil === null) {
    tickMatchClock(match, rawElapsed);
    checkClockWin();
  }
  updateMatchClockDisplay();

  const alpha = accumulator / CONFIG.physics.dt;
  const interpolated = world.circles.map((c) =>
    lerp({ x: c.prevX, y: c.prevY }, { x: c.x, y: c.y }, alpha)
  );

  drawFrame(
    ctx, canvas.clientWidth, canvas.clientHeight, interpolated, input.getState(), match, world, input.getWallState(),
    fallingFade, trail, passFlashProgress, illegalPulseAlpha, goalFlashRender
  );
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
