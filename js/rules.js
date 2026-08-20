// @ts-check
// js/rules.js — pass detection, armed state, turn state machine, contact
// turnover, goal detection (BUILD_SPEC.md §6, step 3). No DOM/canvas
// imports: runs headless under `node test.js`, same as physics.js/vec.js
// (docs/adr/0002-toolchain-no-build-step.md names all three as required
// headless sim modules).
//
// Score counting, the first-to-3 win check, and the full HUD scoreboard are
// explicitly step 4/5/6 content — this file only detects a GOAL and reports
// who scored; it never counts anything.

import { CONFIG } from './config.js';
import { segmentsIntersect, pointSegmentDistance, segmentSegmentDistance, subtract, length } from './vec.js';
import { goalXRange, resetWorld, respawnCircle, isSettled, wallEndpoints } from './physics.js';

/**
 * Widened from BUILD_SPEC.md §3's literal coordinates — Eytan's live
 * playtesting call (2026-08-20): the apex circle was only 1.803 cells from
 * each base circle, inside the 1.0-cell selection radius's 2.0-cell overlap
 * zone (confirmed cramped on his phone). Base-base is now 3.0 cells apart,
 * apex-base 2.121 cells — both clear of that threshold. Apex-to-rail
 * clearance is unchanged at 1.1 cells.
 */
export const KICKOFF = {
  A: [{ x: 3.5, y: 11.0 }, { x: 6.5, y: 11.0 }, { x: 5.0, y: 12.5 }],
  B: [{ x: 3.5, y: 3.0 }, { x: 6.5, y: 3.0 }, { x: 5.0, y: 1.5 }],
};

/** @typedef {'A' | 'B'} Player */

/**
 * @typedef {Object} MatchState
 * @property {Player} currentPlayer
 * @property {boolean} armed  starts false each turn, persists across
 *   consecutive completed passes by the same player (§6)
 * @property {number | null} launchedIndex  which circle is mid-flick, or
 *   null between flicks
 * @property {{x: number, y: number} | null} flickStart  the launched
 *   circle's position at the moment it was launched — §6 case 3's rollback
 *   target
 * @property {boolean} passedThisFlick  accumulated across every physics
 *   step of the current flick, never cleared to false mid-flick
 * @property {boolean} touchedThisFlick
 * @property {boolean} goalThisFlick  crossed the OPPONENT's goal mouth
 * @property {boolean} ownGoalThisFlick  crossed the player's OWN goal mouth
 * @property {boolean} fellThisFlick  VOID mode only (§5): the launched
 *   circle's centre left the field at some point during the flick.
 *   Checked FIRST in resolveFlick, ahead of even own-goal — §6 case 1:
 *   "this is checked first and overrides everything below, including a
 *   goal scored in the same flick." Always false in ARENA.
 * @property {number} flicksThisTurn  §14: counts every flick resolved since
 *   the current turn began (own goals and completed passes increment this
 *   without ending the turn); logged to the console and reset to 0 at every
 *   point the turn actually ends. Purely an instrumentation counter — no
 *   rule reads it. §14 flags whether continue-on-success makes turns too
 *   long as an open question for Eytan's playtesting, not something to
 *   guess at here; this only supplies the raw data.
 * @property {Player | null} lastScorer  captured once at the moment a GOAL
 *   is confirmed — deliberately NOT read live off currentPlayer afterward,
 *   since currentPlayer flips to the conceding player as part of the same
 *   atomic resolution (a live read would misattribute who actually scored)
 * @property {{A: number, B: number}} score  §9: no points, no currency —
 *   just a goal count per player, compared against CONFIG.rules.goalsToWin
 * @property {Player | null} winner  set once `score[player] >= goalsToWin`
 *   (or a sudden-death goal, see `suddenDeath`); once set, the match is
 *   over — input.js's popup-gate reuses this same "reject new drags"
 *   mechanism (see main.js) rather than a second flag
 * @property {'goals' | 'clock' | null} winReason  §9: "how it was won (3
 *   goals / on the clock)" — a sudden-death goal is still reported as
 *   'goals' (it IS a goal that ended it; only a clock-expiry-with-a-lead
 *   win, no goal involved, is 'clock')
 * @property {number} turnTimeLeft  §8a: seconds left in the current flick's
 *   decision window; counts down only while nothing is moving and no flick
 *   is in flight (main.js gates this), resets to CONFIG.timers.turnSeconds
 *   every time a flick resolves or a turn is forfeited
 * @property {number} matchTimeLeft  §8b: seconds left on the 5:00 match
 *   clock; ticks continuously including through physics motion, main.js
 *   only pauses it during the goal popup/win overlay
 * @property {boolean} suddenDeath  §8b: set once the match clock hits 0:00
 *   while the score is level — from then on ANY goal wins outright,
 *   regardless of `CONFIG.rules.goalsToWin`
 * @property {Player | null} wallPlacer  §7: "at the end of your turn,
 *   before control passes over" — set to whichever player's turn JUST
 *   ended (never the player about to act next), opening their wall
 *   placement/move/skip window. Only set on an actual turn change (cases
 *   3/4/6, a non-winning goal, or a forfeit) — never on a completed pass
 *   (case 5, same player continues) or an own goal (no turnover) or the
 *   winning goal (no next turn to defend against). `currentPlayer` has
 *   already flipped to the next actor by the time this is set — the two
 *   are deliberately different fields, not the same value read two ways.
 * @property {{A: number, B: number}} wallUses  §7: 5 placements per player,
 *   TUNABLE `CONFIG.wall.usesPerPlayer` — never replenishes mid-match
 */

/**
 * Who takes the very first turn of the match — §3/§9 only define kick-off
 * layout and the post-goal case, never match start. Player A, as an
 * explicit stated default (matches this project's existing page-load
 * behaviour; low-stakes for a symmetric hotseat game).
 * @param {Player} [firstPlayer]
 * @returns {MatchState}
 */
export function createMatchState(firstPlayer = 'A') {
  return {
    currentPlayer: firstPlayer,
    armed: false,
    launchedIndex: null,
    flickStart: null,
    passedThisFlick: false,
    touchedThisFlick: false,
    goalThisFlick: false,
    ownGoalThisFlick: false,
    fellThisFlick: false,
    flicksThisTurn: 0,
    lastScorer: null,
    score: { A: 0, B: 0 },
    winner: null,
    winReason: null,
    turnTimeLeft: CONFIG.timers.turnSeconds,
    matchTimeLeft: CONFIG.timers.matchSeconds,
    suddenDeath: false,
    wallPlacer: null,
    wallUses: { A: CONFIG.wall.usesPerPlayer, B: CONFIG.wall.usesPerPlayer },
  };
}

/**
 * §14: "Instrument it: log the number of flicks per turn to the console."
 * Called at every point a turn actually ends (never on a completed pass or
 * an own goal, which continue the same turn). Pure instrumentation — the
 * open question this feeds (does continue-on-success make turns too long?)
 * is explicitly Eytan's to answer from real playtesting data, not to guess
 * at here.
 * @param {MatchState} match
 */
function logTurnEnd(match) {
  console.log(`flicks this turn: ${match.flicksThisTurn}`);
  match.flicksThisTurn = 0;
}

/**
 * §8a: "on expiry: the turn is forfeited. No random shot, no penalty beyond
 * losing the turn." Same turn-ending shape as resolveFlick's case 4/6, but
 * triggered from outside a flick entirely (main.js calls this when
 * `turnTimeLeft` hits 0 while nothing is moving and no flick is pending).
 * @param {MatchState} match
 */
export function forfeitTurn(match) {
  const endingPlayer = match.currentPlayer;
  match.currentPlayer = opponent(endingPlayer);
  match.armed = false;
  match.turnTimeLeft = CONFIG.timers.turnSeconds;
  match.wallPlacer = endingPlayer; // §7: a forfeited turn is still "the end of your turn"
  logTurnEnd(match);
}

/**
 * §8b: advance the match clock by `dt` real seconds. A no-op once the
 * match is already won, or if `CONFIG.timers.matchClockEnabled` is off
 * (spec: "keep it switchable... ship with it on"). At 0:00: the leader
 * wins outright; if level, the clock simply stops ("the match goes to
 * next goal wins") via `suddenDeath`, and play continues.
 * @param {MatchState} match @param {number} dt
 */
export function tickMatchClock(match, dt) {
  if (!CONFIG.timers.matchClockEnabled || match.winner !== null || match.matchTimeLeft <= 0) return;
  match.matchTimeLeft = Math.max(0, match.matchTimeLeft - dt);
  if (match.matchTimeLeft === 0) {
    if (match.score.A !== match.score.B) {
      match.winner = match.score.A > match.score.B ? 'A' : 'B';
      match.winReason = 'clock';
    } else {
      match.suddenDeath = true;
    }
  }
}

/**
 * "Play again" (§9's win overlay action): full reset — score, turn state,
 * and world positions all back to a fresh match start. Mutates both
 * `match` and `world` in place (never replaces either object) for the same
 * reason `resetWorld` does: `input.js` and `main.js`'s closures hold the
 * original references.
 * @param {MatchState} match @param {import('./physics.js').World} world
 */
export function resetMatch(match, world) {
  match.currentPlayer = 'A';
  match.armed = false;
  match.launchedIndex = null;
  match.flickStart = null;
  match.passedThisFlick = false;
  match.touchedThisFlick = false;
  match.goalThisFlick = false;
  match.ownGoalThisFlick = false;
  match.fellThisFlick = false;
  match.flicksThisTurn = 0;
  match.lastScorer = null;
  match.score = { A: 0, B: 0 };
  match.winner = null;
  match.winReason = null;
  match.turnTimeLeft = CONFIG.timers.turnSeconds;
  match.matchTimeLeft = CONFIG.timers.matchSeconds;
  match.suddenDeath = false;
  match.wallPlacer = null;
  match.wallUses = { A: CONFIG.wall.usesPerPlayer, B: CONFIG.wall.usesPerPlayer };
  world.wall = null;
  resetWorld(world, KICKOFF.A);
}

/**
 * §7's three legality conditions, checked only at placement (the wall stays
 * legal afterward even if circles later rest near it): entirely inside the
 * field, >= CONFIG.wall.clearance cells from each goal-mouth segment, and
 * >= clearance from each circle's centre.
 * @param {import('./physics.js').Wall} wall @param {import('./physics.js').World} world
 * @returns {boolean}
 */
export function isWallLegal(wall, world) {
  const { w, h } = CONFIG.field;
  const { clearance } = CONFIG.wall;
  const { p1, p2 } = wallEndpoints(wall);

  const inside = (p) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  if (!inside(p1) || !inside(p2)) return false;

  const { min: goalMin, max: goalMax } = goalXRange();
  const topGoal = [{ x: goalMin, y: 0 }, { x: goalMax, y: 0 }];
  const bottomGoal = [{ x: goalMin, y: h }, { x: goalMax, y: h }];
  if (segmentSegmentDistance(p1, p2, topGoal[0], topGoal[1]) < clearance) return false;
  if (segmentSegmentDistance(p1, p2, bottomGoal[0], bottomGoal[1]) < clearance) return false;

  for (const c of world.circles) {
    if (pointSegmentDistance(c, p1, p2) < clearance) return false;
  }

  return true;
}

/**
 * Commits a wall placement/move: spends one of `wallPlacer`'s uses, sets
 * `world.wall`, and closes the placement window. Re-validates legality
 * itself rather than trusting the caller — input.js's UI already prevents
 * confirming an illegal position, but this is the actual gate, not that.
 * No-op (returns false) if called illegally: no `wallPlacer` open, the
 * player is out of uses, or the wall itself doesn't check out.
 * @param {MatchState} match @param {import('./physics.js').World} world
 * @param {import('./physics.js').Wall} wall
 * @returns {boolean} whether the placement was actually committed
 */
export function confirmWallPlacement(match, world, wall) {
  if (match.wallPlacer === null) return false;
  if (match.wallUses[match.wallPlacer] <= 0) return false;
  if (!isWallLegal(wall, world)) return false;

  world.wall = { x: wall.x, y: wall.y, orientation: wall.orientation };
  match.wallUses[match.wallPlacer] -= 1;
  match.wallPlacer = null;
  return true;
}

/**
 * "Skipping is always allowed and costs nothing" (§7) — closes the
 * placement window without touching `world.wall` or spending a use.
 * @param {MatchState} match
 */
export function skipWallPlacement(match) {
  match.wallPlacer = null;
}

/** @param {Player} player @returns {Player} */
function opponent(player) {
  return player === 'A' ? 'B' : 'A';
}

/**
 * Call the instant a real (non-cancelled) launch fires — see input.js's
 * `attachInput` `onLaunch` callback. Captures the flick-start position for
 * §6 case 3's rollback and resets this flick's accumulated event flags.
 * @param {MatchState} match @param {import('./physics.js').World} world
 * @param {number} index
 */
export function onLaunch(match, world, index) {
  const c = world.circles[index];
  match.launchedIndex = index;
  match.flickStart = { x: c.x, y: c.y };
  match.passedThisFlick = false;
  match.touchedThisFlick = false;
  match.goalThisFlick = false;
  match.ownGoalThisFlick = false;
  match.fellThisFlick = false;
}

/**
 * Which goal edge (if any) the launched circle's raw motion this step
 * crossed, classified as the player's own goal or the opponent's. §2: top
 * goal (y=0) is Player B's own end, bottom (y=h) is Player A's own end
 * (matches the already-established render.js colour convention).
 * @param {import('./physics.js').Circle} c @param {Player} shooter
 * @returns {'own' | 'opponent' | null}
 */
function goalCrossing(c, shooter) {
  const { h } = CONFIG.field;
  const { min: goalMin, max: goalMax } = goalXRange();

  // Same prevX/prevY -> rawX/rawY pre-clip motion segment as the pass-line
  // check above — rawY/y are equal whenever no clip happened this step
  // (the common case anywhere but the backstop), which would otherwise
  // collapse this to a zero-length point and silently miss every crossing.
  function crossesLine(lineY) {
    if ((c.prevY - lineY) * (c.rawY - lineY) > 0) return false; // same side, no crossing
    if (c.prevY === c.rawY) return false; // no y-motion this step; nothing to cross
    const t = (lineY - c.prevY) / (c.rawY - c.prevY);
    const crossX = c.prevX + t * (c.rawX - c.prevX);
    return crossX >= goalMin && crossX <= goalMax;
  }

  const crossedTop = crossesLine(0);
  const crossedBottom = crossesLine(h);
  if (!crossedTop && !crossedBottom) return null;

  const ownEdgeCrossed = shooter === 'A' ? crossedBottom : crossedTop;
  return ownEdgeCrossed ? 'own' : 'opponent';
}

/**
 * Call once per physics step, immediately after `physics.step(world)`,
 * inside main.js's fixed-step accumulator loop — pass/goal-line crossing
 * detection needs the true per-step motion segment, which collapses once
 * several steps land in a single interpolated render frame.
 *
 * Observes events continuously while a flick is in flight (sticky flags,
 * cleared only by the next `onLaunch`); only RESOLVES the turn once the
 * whole world is at rest, per §6: "Resolution... once everything is at rest."
 *
 * @param {MatchState} match @param {import('./physics.js').World} world
 * @param {[number, number][]} contacts  this step's contact pairs, from `physics.step()`'s return value
 * @param {number[]} [fallen]  VOID mode only: circle indices that fell for
 *   the first time this step, from `physics.checkFalls()`'s return value.
 *   Optional/omittable in ARENA calls — always empty there anyway.
 * @returns {null | {type: 'goal', scorer: Player, conceder: Player, winner: Player | null}}
 */
export function tick(match, world, contacts, fallen = []) {
  if (match.launchedIndex === null) return null;
  const idx = match.launchedIndex;
  const launched = world.circles[idx];
  const others = world.circles.filter((_, i) => i !== idx);

  if (fallen.includes(idx)) {
    match.fellThisFlick = true;
  }

  // The true pre-clip motion for this step is prevX/prevY (position before
  // this step's integration) -> rawX/rawY (position after integration, but
  // before resolveRails could clip it) — NOT rawX/rawY -> x/y, which is a
  // zero-length point whenever no rail-clip happened this step (the common
  // case), silently missing every crossing.
  if (
    segmentsIntersect(
      { x: launched.prevX, y: launched.prevY },
      { x: launched.rawX, y: launched.rawY },
      others[0],
      others[1]
    )
  ) {
    match.passedThisFlick = true;
  }

  if (contacts.some(([a, b]) => a === idx || b === idx)) {
    match.touchedThisFlick = true;
  }

  const crossing = goalCrossing(launched, match.currentPlayer);
  if (crossing === 'opponent') match.goalThisFlick = true;
  if (crossing === 'own') match.ownGoalThisFlick = true;

  if (!isSettled(world)) return null;

  const result = resolveFlick(match, world, idx);
  match.launchedIndex = null;
  return result;
}

/**
 * §6's resolution priority, once everything is at rest. Own-goal is a full
 * override checked before the six numbered cases (§5: textually distinct
 * from case 3 — both case 2 and case 3 say "the opponent's goal"
 * specifically; own-goal covers the complementary, non-overlapping case).
 * @param {MatchState} match @param {import('./physics.js').World} world @param {number} idx
 */
function resolveFlick(match, world, idx) {
  // §8a: "restarts on every flick" — every branch below represents a flick
  // that just concluded, so this fires unconditionally at the top rather
  // than being duplicated in each branch.
  match.turnTimeLeft = CONFIG.timers.turnSeconds;
  match.flicksThisTurn += 1; // §14 instrumentation — same "every branch is one concluded flick" reasoning

  const launched = world.circles[idx];

  // Case 1 (VOID mode only, §6): fell off the field. Checked FIRST,
  // overriding even a goal scored in the same flick — the spec's own
  // explicit priority, not an assumption.
  if (match.fellThisFlick) {
    return resolveFall(match, world, idx);
  }

  // Own goal (§5): ignored entirely — no goal, no turnover, no rollback,
  // armed/currentPlayer untouched. The circle simply rests wherever physics
  // left it (bounded by physics.js's goal backstop, so it can't strand).
  if (match.ownGoalThisFlick) {
    return null;
  }

  // Case 2: opponent's goal, armed -> GOAL. §9: first to CONFIG.rules.
  // goalsToWin wins outright, or — once the match clock has run out level
  // (§8b's suddenDeath) — this single goal wins regardless of the count.
  // Either way the match ends there, no kick-off reset (no next turn to
  // set up). Otherwise: kick-off resets, conceding player takes the next
  // turn, exactly as before score-tracking existed.
  if (match.goalThisFlick && match.armed) {
    const scorer = match.currentPlayer;
    const conceder = opponent(scorer);
    match.lastScorer = scorer;
    match.score[scorer] += 1;
    match.armed = false;

    if (match.score[scorer] >= CONFIG.rules.goalsToWin || match.suddenDeath) {
      match.winner = scorer;
      match.winReason = 'goals'; // §9: a sudden-death goal is still "won by goals," not "on the clock"
      logTurnEnd(match);
      return { type: 'goal', scorer, conceder, winner: scorer };
    }

    resetWorld(world, KICKOFF[conceder]);
    match.currentPlayer = conceder;
    match.wallPlacer = scorer; // §7: the scorer's turn just ended too — their placement window, before the conceder's kick-off turn begins
    logTurnEnd(match);
    return { type: 'goal', scorer, conceder, winner: null };
  }

  // Case 3: opponent's goal, not armed -> turn ends, circle rolled back to
  // exactly where the flick started.
  if (match.goalThisFlick && !match.armed) {
    const start = /** @type {{x: number, y: number}} */ (match.flickStart);
    launched.x = launched.prevX = launched.rawX = start.x;
    launched.y = launched.prevY = launched.rawY = start.y;
    launched.vx = 0;
    launched.vy = 0;
    const endingPlayer = match.currentPlayer;
    match.currentPlayer = opponent(endingPlayer);
    match.armed = false;
    match.wallPlacer = endingPlayer;
    logTurnEnd(match);
    return null;
  }

  // Case 4: touched another circle -> turn ends. Gated on strictContact
  // (§6: "with STRICT_CONTACT on, touching another circle already ends the
  // turn") — always true in v1 (no settings screen), but reading the CONFIG
  // value rather than hardcoding makes it the flag's first real consumer.
  if (CONFIG.rules.strictContact && match.touchedThisFlick) {
    const endingPlayer = match.currentPlayer;
    match.currentPlayer = opponent(endingPlayer);
    match.armed = false;
    match.wallPlacer = endingPlayer;
    logTurnEnd(match);
    return null;
  }

  // Case 5: pass completed -> armed, same player continues. Turn hasn't
  // ended, so no wall-placement window opens here.
  if (match.passedThisFlick) {
    match.armed = true;
    return null;
  }

  // Case 6: none of the above -> turn ends.
  const endingPlayer = match.currentPlayer;
  match.currentPlayer = opponent(endingPlayer);
  match.armed = false;
  match.wallPlacer = endingPlayer;
  logTurnEnd(match);
  return null;
}

/**
 * VOID mode's fall penalty (§5): "the opponent is awarded a goal" (the
 * faller's turn is treated as conceding, same downstream flow as a normal
 * goal — kick-off, win-check) or "the turn simply ends and the fallen
 * circle respawns," per `CONFIG.modes.void.voidPenalty`. Either way this
 * is the FALLER's flick concluding — matches every other case's rule that
 * `wallPlacer` goes to whoever was `currentPlayer` when the flick ended,
 * not whoever benefits from the outcome.
 * @param {MatchState} match @param {import('./physics.js').World} world @param {number} idx
 */
function resolveFall(match, world, idx) {
  const faller = match.currentPlayer;
  const opp = opponent(faller);
  const penalty = CONFIG.modes.void.voidPenalty;

  if (penalty === 'goal') {
    // "The fall concedes. Kick-off follows, exactly as after a normal
    // goal" — the faller is the conceder (§9's usual pattern), not the scorer.
    match.lastScorer = opp;
    match.score[opp] += 1;
    match.armed = false;

    if (match.score[opp] >= CONFIG.rules.goalsToWin || match.suddenDeath) {
      match.winner = opp;
      match.winReason = 'goals';
      logTurnEnd(match);
      return { type: 'goal', scorer: opp, conceder: faller, winner: opp };
    }

    resetWorld(world, KICKOFF[faller]); // faller concedes, takes the next kick-off turn
    match.currentPlayer = faller;
    match.wallPlacer = faller;
    logTurnEnd(match);
    return { type: 'goal', scorer: opp, conceder: faller, winner: null };
  }

  // 'turnover': no score change. Only the fallen circle needs to come
  // back — resetWorld (whole kick-off) would be the wrong tool, it would
  // also move the two circles that were never involved.
  respawnCircle(world, idx, findRespawnPosition(world, idx));
  match.currentPlayer = opp;
  match.armed = false;
  match.wallPlacer = faller;
  logTurnEnd(match);
  return null;
}

/**
 * §5: "the fallen circle respawns on the centre spot (nearest free
 * position if occupied)." Tries the exact centre first, then a small ring
 * of candidate offsets at increasing distance. Plain +,-,* only (per the
 * determinism rules) — no trig; with only 3 circles ever on a 10x14 field
 * this resolves on the first or second candidate in any realistic case,
 * the wider search is defensive, not load-bearing.
 * @param {import('./physics.js').World} world @param {number} excludeIndex
 * @returns {{x: number, y: number}}
 */
function findRespawnPosition(world, excludeIndex) {
  const { w, h } = CONFIG.field;
  const r = CONFIG.piece.radius;
  const minDist = 2 * r;
  const center = { x: w / 2, y: h / 2 };

  const isFree = (pos) =>
    pos.x - r >= 0 && pos.x + r <= w && pos.y - r >= 0 && pos.y + r <= h &&
    world.circles.every((c, i) => i === excludeIndex || c.fallen || length(subtract(c, pos)) >= minDist);

  if (isFree(center)) return center;

  const offsets = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 },
  ];
  for (let step = 1; step <= 4; step++) {
    for (const o of offsets) {
      const candidate = { x: center.x + o.x * step * minDist, y: center.y + o.y * step * minDist };
      if (isFree(candidate)) return candidate;
    }
  }
  return center; // pathological fallback — unreachable with only 3 circles on this field
}
