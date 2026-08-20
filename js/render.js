// js/render.js — the only file that touches pixels. All game logic works in
// cells (BUILD_SPEC.md §2); this file is the cells -> pixels boundary.

import { CONFIG } from './config.js';
import { goalXRange } from './physics.js';
import { isWallLegal } from './rules.js';

// §10 gives field-edge/goal strokes as "2px" directly, unlike fieldEdgeGlow —
// pixel-space stroke width, not a cell-space tunable, so it's a bare literal
// here rather than a CONFIG entry.
const BORDER_WIDTH = 2;

/**
 * Size the canvas backing store for the current viewport and devicePixelRatio,
 * and return a 2D context whose coordinate space is CSS pixels.
 * @param {HTMLCanvasElement} canvas
 * @param {number} cssWidth
 * @param {number} cssHeight
 * @returns {CanvasRenderingContext2D}
 */
export function setupContext(canvas, cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * Fit the CONFIG.field.w x CONFIG.field.h cell grid inside a viewport with a
 * margin of CONFIG.marginCells cells, preserving aspect ratio, below a
 * reserved CONFIG.hud.height px band at the top (§10: the HUD sits
 * "outside the field, top of screen" — a fixed DOM element, so its height
 * is a flat px value like the HUD bar's own font size, not cell-scaled).
 * Pure function (no canvas, no DOM) so it can be checked headlessly — see
 * test.js.
 * @param {number} viewportW
 * @param {number} viewportH
 * @returns {{scale: number, offsetX: number, offsetY: number}}
 */
export function computeScale(viewportW, viewportH) {
  const { w, h } = CONFIG.field;
  const margin = CONFIG.marginCells;
  const hudHeight = CONFIG.hud.height;
  const availableH = viewportH - hudHeight;
  const scale = Math.min(
    viewportW / (w + margin * 2),
    availableH / (h + margin * 2)
  );
  const offsetX = (viewportW - w * scale) / 2;
  const offsetY = hudHeight + (availableH - h * scale) / 2;
  return { scale, offsetX, offsetY };
}

/**
 * Inverse of computeScale: canvas-relative CSS-pixel coordinates -> cell
 * space. Pure (no DOM/canvas reads) — kept beside computeScale so the pair
 * can't drift out of sync if the fit-margin math ever changes. This is the
 * only export from this file input.js may import (never CONFIG.colors or
 * the draw helpers below — input.js stays render-agnostic otherwise).
 * @param {number} px @param {number} py
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @returns {{x: number, y: number}}
 */
export function toCellSpace(px, py, transform) {
  return {
    x: (px - transform.offsetX) / transform.scale,
    y: (py - transform.offsetY) / transform.scale,
  };
}

/** Fills the whole viewport, including outside the field (§10). */
export function drawBackground(ctx, viewportW, viewportH) {
  ctx.fillStyle = CONFIG.colors.bg;
  ctx.fillRect(0, 0, viewportW, viewportH);
}

/** The 10x14 cell lines. 1px, no glow (§10). */
export function drawGrid(ctx, transform) {
  const { scale, offsetX, offsetY } = transform;
  const { w, h } = CONFIG.field;
  ctx.save();
  ctx.strokeStyle = CONFIG.colors.gridLine;
  ctx.lineWidth = 1; // §10 gives this directly ("1px"), unlike fieldEdgeGlow — not a CONFIG entry
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const px = offsetX + x * scale;
    ctx.moveTo(px, offsetY);
    ctx.lineTo(px, offsetY + h * scale);
  }
  for (let y = 0; y <= h; y++) {
    const py = offsetY + y * scale;
    ctx.moveTo(offsetX, py);
    ctx.lineTo(offsetX + w * scale, py);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * ARENA's solid glowing border (§5). VOID mode draws no border at all —
 * `drawVoidLedge` (below) is its own visual treatment for that edge, drawn
 * separately by `drawFrame` — so this is the one place the mode branch
 * lives, per the spec's own "one branch in the collision code" framing
 * extended to rendering.
 */
export function drawFieldEdge(ctx, transform) {
  if (CONFIG.field.mode === 'void') return;
  const { scale, offsetX, offsetY } = transform;
  const { w, h } = CONFIG.field;
  ctx.save();
  ctx.strokeStyle = CONFIG.colors.fieldEdge;
  ctx.lineWidth = BORDER_WIDTH;
  ctx.shadowColor = CONFIG.colors.fieldEdge;
  ctx.shadowBlur = CONFIG.fieldEdgeGlow;
  ctx.strokeRect(offsetX, offsetY, w * scale, h * scale);
  ctx.restore();
}

/**
 * VOID mode's edge treatment (§5): "no border. The outermost cell of grid
 * fades to black, and the last grid line is brighter than the rest — a
 * ledge. Nothing beyond it." The fade is a plain linear gradient per edge,
 * opaque `colors.bg` right at the boundary fading to fully transparent one
 * cell inward (revealing the ordinary grid unmodified beyond that band) —
 * drawn AFTER the grid so it fades what's already there, not before.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 */
export function drawVoidLedge(ctx, transform) {
  const { scale, offsetX, offsetY } = transform;
  const { w, h } = CONFIG.field;
  const bg = CONFIG.colors.bg;

  ctx.save();
  const top = ctx.createLinearGradient(0, offsetY, 0, offsetY + scale);
  top.addColorStop(0, bg);
  top.addColorStop(1, 'transparent');
  ctx.fillStyle = top;
  ctx.fillRect(offsetX, offsetY, w * scale, scale);

  const bottom = ctx.createLinearGradient(0, offsetY + h * scale, 0, offsetY + h * scale - scale);
  bottom.addColorStop(0, bg);
  bottom.addColorStop(1, 'transparent');
  ctx.fillStyle = bottom;
  ctx.fillRect(offsetX, offsetY + h * scale - scale, w * scale, scale);

  const left = ctx.createLinearGradient(offsetX, 0, offsetX + scale, 0);
  left.addColorStop(0, bg);
  left.addColorStop(1, 'transparent');
  ctx.fillStyle = left;
  ctx.fillRect(offsetX, offsetY, scale, h * scale);

  const right = ctx.createLinearGradient(offsetX + w * scale, 0, offsetX + w * scale - scale, 0);
  right.addColorStop(0, bg);
  right.addColorStop(1, 'transparent');
  ctx.fillStyle = right;
  ctx.fillRect(offsetX + w * scale - scale, offsetY, scale, h * scale);
  ctx.restore();

  // "The last grid line is brighter than the rest" — the field boundary,
  // reusing fieldEdge's colour/glow now that it's not spent on a border.
  ctx.save();
  ctx.strokeStyle = CONFIG.colors.fieldEdge;
  ctx.lineWidth = 1;
  ctx.shadowColor = CONFIG.colors.fieldEdge;
  ctx.shadowBlur = CONFIG.fieldEdgeGlow;
  ctx.strokeRect(offsetX, offsetY, w * scale, h * scale);
  ctx.restore();
}

/**
 * The two goal mouths (§2: y=0 and y=h, x-range from physics.js's
 * `goalXRange()` — the same source physics.js's own collision code derives
 * from, so the two can never silently disagree on where the gap is),
 * coloured by the player who defends that end: bottom (y=h) is Player A's
 * own end, top (y=0) is Player B's own end.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {'top' | 'bottom' | null} [armedGoal]  which mouth (if any) is the
 *   acting player's current target — boosts its glow only, never its hue
 *   (§10: "intensity/width/glow ramp, never hue" — the same rule already
 *   applied to the aim line, extended here to a new element).
 */
export function drawGoals(ctx, transform, armedGoal = null) {
  const { scale, offsetX, offsetY } = transform;
  const { h } = CONFIG.field;
  const { min: goalMin, max: goalMax } = goalXRange();
  const xStart = offsetX + goalMin * scale;
  const xEnd = offsetX + goalMax * scale;

  ctx.save();
  ctx.lineWidth = BORDER_WIDTH; // same border as drawFieldEdge, just recoloured over the mouth span

  ctx.shadowBlur = armedGoal === 'top' ? CONFIG.armedGoalGlow : CONFIG.fieldEdgeGlow;
  ctx.strokeStyle = CONFIG.colors.playerB;
  ctx.shadowColor = CONFIG.colors.playerB;
  ctx.beginPath();
  ctx.moveTo(xStart, offsetY);
  ctx.lineTo(xEnd, offsetY);
  ctx.stroke();

  ctx.shadowBlur = armedGoal === 'bottom' ? CONFIG.armedGoalGlow : CONFIG.fieldEdgeGlow;
  ctx.strokeStyle = CONFIG.colors.playerA;
  ctx.shadowColor = CONFIG.colors.playerA;
  ctx.beginPath();
  ctx.moveTo(xStart, offsetY + h * scale);
  ctx.lineTo(xEnd, offsetY + h * scale);
  ctx.stroke();

  ctx.restore();
}

/**
 * The ARMED status badge (§10: "essential... the only readout of the single
 * most confusing piece of state in the game"). Text only, no background
 * plate — glow against CONFIG.colors.bg is contrast enough. Positioned just
 * outside the field edge on the acting player's side. First rendered text
 * in this game; font/size/glow are flat CSS px (same category as
 * BORDER_WIDTH — pixel-space, not cell-scaled).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {import('./rules.js').MatchState} match
 */
export function drawArmedBadge(ctx, transform, match) {
  if (!match.armed) return;
  const { scale, offsetX, offsetY } = transform;
  const { w, h } = CONFIG.field;
  const color = match.currentPlayer === 'A' ? CONFIG.colors.playerA : CONFIG.colors.playerB;
  const centerX = offsetX + (w / 2) * scale;
  const gap = 6; // px, between the field edge and the badge text

  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = CONFIG.armedIndicator.glow;
  ctx.font = `${CONFIG.armedIndicator.fontSize}px ${CONFIG.font}`;
  ctx.textAlign = 'center';
  if (match.currentPlayer === 'A') {
    ctx.textBaseline = 'top';
    ctx.fillText('ARMED', centerX, offsetY + h * scale + gap);
  } else {
    ctx.textBaseline = 'bottom';
    ctx.fillText('ARMED', centerX, offsetY - gap);
  }
  ctx.restore();
}

/**
 * The live line between the two non-selected circles' current centres (§6,
 * used by the pass-detection rule from step 3 on; purely visual here).
 * Only drawn while a drag is active — with no selection there's nothing to
 * distinguish "the other two" from. Deliberately no glow outside a flash
 * (preserves visual contrast for the completed-pass flash below, §10's
 * most important cue).
 *
 * `flashProgress` (step 8, §10: "the pass line flashes bright cyan and
 * expands outward once") drives a one-shot brighten-and-thicken: full
 * white-hot alpha/glow/width at progress 0, easing back to the normal dim
 * line by progress 1. `null` outside an active flash — the ordinary dim
 * line, same as before step 8.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {{x: number, y: number}[]} circles
 * @param {number | null} selectedIndex
 * @param {number | null} [flashProgress]  0 (just completed) -> 1 (fully faded)
 */
export function drawPassLine(ctx, transform, circles, selectedIndex, flashProgress = null) {
  if (selectedIndex === null) return;
  const { scale, offsetX, offsetY } = transform;
  const others = circles.filter((_, i) => i !== selectedIndex);
  const [a, b] = others;

  ctx.save();
  if (flashProgress === null) {
    ctx.strokeStyle = CONFIG.colors.passLine; // rgba() already bakes in 35% alpha — no extra globalAlpha
    ctx.lineWidth = CONFIG.passLineWidth;
  } else {
    const ease = 1 - flashProgress; // 1 at the moment of completion -> 0 once fully faded
    ctx.strokeStyle = CONFIG.colors.playerA; // "bright cyan" (§10) — playerA is this game's cyan token
    ctx.globalAlpha = ease;
    ctx.shadowColor = CONFIG.colors.playerA;
    ctx.shadowBlur = CONFIG.pieceGlow * ease;
    ctx.lineWidth = CONFIG.passLineWidth * (1 + CONFIG.passFlash.widthBoost * ease); // "expands outward" — thickens toward the flash, settles back to normal
  }
  ctx.beginPath();
  ctx.moveTo(offsetX + a.x * scale, offsetY + a.y * scale);
  ctx.lineTo(offsetX + b.x * scale, offsetY + b.y * scale);
  ctx.stroke();
  ctx.restore();
}

/**
 * Step 8 (§10): "Moving circle: a fading trail — keep the last 12
 * positions, draw them at decreasing alpha." Drawn before `drawPieces` so
 * the real circle (full colour, full glow) renders on top of its own
 * trail, not the other way round. Flat fill, no glow — keeps the trail
 * visually subordinate to the real piece (§10: "that is what makes this
 * look cheap rather than sharp").
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {{x: number, y: number}[]} trail  oldest first, newest last
 */
export function drawTrail(ctx, transform, trail) {
  if (trail.length === 0) return;
  const { scale, offsetX, offsetY } = transform;
  const r = CONFIG.piece.radius * scale;

  ctx.save();
  ctx.fillStyle = CONFIG.colors.piece;
  for (let i = 0; i < trail.length; i++) {
    ctx.globalAlpha = (i + 1) / trail.length;
    ctx.beginPath();
    ctx.arc(offsetX + trail[i].x * scale, offsetY + trail[i].y * scale, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Step 8 (§10): "Illegal flick (turn lost): a short red pulse on the field
 * border." Fires whenever a flick ends the turn without scoring (rules.js's
 * `wallPlacer` opening with no goal — see main.js) — a plain red stroke
 * over the same rect `drawFieldEdge`/`drawVoidLedge` already outline,
 * fading out. Drawn regardless of field mode: VOID has no persistent
 * border, but the pulse is a temporary overlay on top of whatever edge
 * treatment is already there, not a replacement for it.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {number} alpha  0 (gone) -> 1 (peak, just triggered)
 */
export function drawIllegalPulse(ctx, transform, alpha) {
  if (alpha <= 0) return;
  const { scale, offsetX, offsetY } = transform;
  const { w, h } = CONFIG.field;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = CONFIG.colors.wallIllegal; // this game's one red token — reused, not a new colour
  ctx.lineWidth = BORDER_WIDTH * CONFIG.illegalPulse.widthMultiplier;
  ctx.shadowColor = CONFIG.colors.wallIllegal;
  ctx.shadowBlur = CONFIG.fieldEdgeGlow;
  ctx.strokeRect(offsetX, offsetY, w * scale, h * scale);
  ctx.restore();
}

/**
 * Step 8 (§10): "Goal: the goal mouth floods with the scorer's colour, the
 * whole grid pulses once." Two parts, both driven by the same fade: a
 * heavily boosted redraw of the SCORED-ON mouth (the opponent's goal from
 * the scorer's perspective — mirrors `drawGoals`' own colour-by-defended-
 * end convention, just keyed off the captured `scorer` rather than live
 * `match.currentPlayer`, which has already flipped by the time a goal
 * result reaches main.js), plus a translucent full-field wash in the same
 * colour for "the whole grid pulses."
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {{scorer: 'A' | 'B', progress: number} | null} goalFlash  progress: 0 (just scored) -> 1 (fully faded)
 */
export function drawGoalFlash(ctx, transform, goalFlash) {
  if (!goalFlash) return;
  const { scale, offsetX, offsetY } = transform;
  const { w, h } = CONFIG.field;
  const { min: goalMin, max: goalMax } = goalXRange();
  const ease = 1 - goalFlash.progress;
  const color = goalFlash.scorer === 'A' ? CONFIG.colors.playerA : CONFIG.colors.playerB;
  // Scorer A shoots at the top mouth (B's own end); scorer B shoots at the
  // bottom (A's own end) — same mapping drawFrame already uses for armedGoal.
  const mouthY = goalFlash.scorer === 'A' ? offsetY : offsetY + h * scale;

  ctx.save();
  ctx.globalAlpha = CONFIG.goalFlash.washAlpha * ease;
  ctx.fillStyle = color;
  ctx.fillRect(offsetX, offsetY, w * scale, h * scale);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = ease;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = CONFIG.armedGoalGlow * CONFIG.goalFlash.glowMultiplier * ease;
  ctx.lineWidth = BORDER_WIDTH * CONFIG.goalFlash.mouthWidthMultiplier;
  ctx.beginPath();
  ctx.moveTo(offsetX + goalMin * scale, mouthY);
  ctx.lineTo(offsetX + goalMax * scale, mouthY);
  ctx.stroke();
  ctx.restore();
}

/**
 * The three circles (§3, §10). Fill colour is pieceActive only for a
 * genuinely selected (accepted-grab) circle — never for a rejected one.
 * A circle mid rejected-grab flash (decision 1) is dimmed via globalAlpha,
 * reusing the existing fill/glow draw rather than adding a new visual.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {{x: number, y: number}[]} circles
 * @param {{selectedIndex: number | null, rejectedIndex: number | null}} inputState
 */
export function drawPieces(ctx, transform, circles, inputState) {
  const { scale, offsetX, offsetY } = transform;
  const r = CONFIG.piece.radius * scale;

  ctx.save();
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const color = i === inputState.selectedIndex ? CONFIG.colors.pieceActive : CONFIG.colors.piece;
    ctx.globalAlpha = i === inputState.rejectedIndex ? CONFIG.input.rejectedFlashAlpha : 1;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = CONFIG.pieceGlow;
    ctx.beginPath();
    ctx.arc(offsetX + c.x * scale, offsetY + c.y * scale, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * VOID mode's "short fall-and-fade" derez (§5). Deliberately NOT drawn by
 * indexing into the live `circles` array: rules.js resolves a fall (and
 * respawns the circle elsewhere) on essentially the very next settled
 * check, well before a fade would finish playing — piggybacking on the
 * live circle's position would make it jump to the respawn point mid-fade.
 * main.js instead hands back a frozen snapshot of where it fell, taken the
 * instant `checkFalls` detected it, so this draws an independent "ghost"
 * that fades out in place while the real circle is already back in play
 * elsewhere. Same "stop, don't reflect" physics as the rest of this game
 * — this is the ONLY thing in the entire visual language that fades
 * in/out over time (the turn-timer pulse is the other continuous-time
 * exception), because §5 explicitly asks for it: "not an instant delete."
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {{position: {x: number, y: number}, alpha: number} | null} fallingFade
 */
export function drawFallingGhost(ctx, transform, fallingFade) {
  if (!fallingFade || fallingFade.alpha <= 0) return;
  const { scale, offsetX, offsetY } = transform;
  const r = CONFIG.piece.radius * scale;

  ctx.save();
  ctx.globalAlpha = fallingFade.alpha;
  ctx.fillStyle = CONFIG.colors.piece;
  ctx.shadowColor = CONFIG.colors.piece;
  ctx.shadowBlur = CONFIG.pieceGlow;
  ctx.beginPath();
  ctx.arc(offsetX + fallingFade.position.x * scale, offsetY + fallingFade.position.y * scale, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Aim line = power indicator, one element (§4.5, §10). Runs from the
 * selected circle's visible edge out to centre + direction*(radius+pull).
 * Width/glow/alpha ramp linearly with power = pull/maxPull and all freeze
 * together once pull saturates at the 6-cell cap (acceptance test #2).
 * Below minPull, alpha drops under aimLine.minAlpha as a cancel cue.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {{x: number, y: number}[]} circles
 * @param {{selectedIndex: number | null, direction: {x: number, y: number} | null, pull: number}} inputState
 */
export function drawAimLine(ctx, transform, circles, inputState) {
  const { selectedIndex, direction, pull } = inputState;
  if (selectedIndex === null || direction === null) return;

  const { scale, offsetX, offsetY } = transform;
  const circle = circles[selectedIndex];
  const radius = CONFIG.piece.radius;
  const { maxPull, minPull } = CONFIG.input;
  const { minWidth, maxWidth, minGlow, maxGlow, minAlpha } = CONFIG.aimLine;
  const power = pull / maxPull;

  const startX = offsetX + (circle.x + direction.x * radius) * scale;
  const startY = offsetY + (circle.y + direction.y * radius) * scale;
  const endX = offsetX + (circle.x + direction.x * (radius + pull)) * scale;
  const endY = offsetY + (circle.y + direction.y * (radius + pull)) * scale;

  // Below minPull, fall back to the bare power ratio instead of the
  // min/max-anchored ramp below: power is always << minAlpha in that range
  // (minPull/maxPull = 0.05 by the shipped CONFIG numbers), so this reads
  // as "dimmer than minAlpha" (the cancel cue) without a second tunable.
  ctx.save();
  ctx.globalAlpha = pull < minPull ? power : minAlpha + (1 - minAlpha) * power;
  ctx.strokeStyle = CONFIG.colors.pieceActive; // intensity/width/glow ramp, never hue (§10)
  ctx.shadowColor = CONFIG.colors.pieceActive;
  ctx.shadowBlur = minGlow + (maxGlow - minGlow) * power;
  ctx.lineWidth = minWidth + (maxWidth - minWidth) * power;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.restore();
}

/**
 * §8a's turn timer: a thin bar along the acting player's edge, in their
 * colour, draining left-to-right as `match.turnTimeLeft` counts down, and
 * pulsing in the last 5 seconds. The one genuinely continuous real-time
 * animation in this game (a deliberate, spec'd exception to the instant-
 * show/hide language everything else uses — this is core functional
 * feedback, not step-8 juice). Hidden once the match is won — there's no
 * "next flick" left to be counting down to.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {import('./rules.js').MatchState} match
 */
export function drawTurnTimer(ctx, transform, match) {
  if (match.winner !== null || match.wallPlacer !== null) return;
  const { scale, offsetX, offsetY } = transform;
  const { w, h } = CONFIG.field;
  const { turnSeconds } = CONFIG.timers;
  const { barThickness, pulseHz, pulseMinAlpha } = CONFIG.turnTimer;
  const color = match.currentPlayer === 'A' ? CONFIG.colors.playerA : CONFIG.colors.playerB;
  const frac = Math.max(0, match.turnTimeLeft) / turnSeconds;
  const barWidth = w * scale * frac;
  const y = match.currentPlayer === 'A' ? offsetY + h * scale : offsetY - barThickness;

  let alpha = 1;
  if (match.turnTimeLeft <= 5 && match.turnTimeLeft > 0) {
    const wave = 0.5 + 0.5 * Math.sin((performance.now() / 1000) * pulseHz * Math.PI * 2);
    alpha = pulseMinAlpha + (1 - pulseMinAlpha) * wave;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(offsetX, y, barWidth, barThickness);
  ctx.restore();
}

/**
 * The wall (§5/§7): a segment `CONFIG.wall.length` cells long, drawn
 * `CONFIG.wall.thickness` cells thick (a genuine cell-space value per §5 —
 * unlike BORDER_WIDTH, this one scales with the field) with round end caps,
 * which visually matches the physics model beneath it: the two endpoints
 * collide as circle-vs-point, not a flat cut-off edge. Reused for both the
 * confirmed wall and the live placement preview — only the color differs.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {import('./physics.js').Wall} wall @param {string} color
 */
export function drawWall(ctx, transform, wall, color) {
  const { scale, offsetX, offsetY } = transform;
  const { length, thickness } = CONFIG.wall;
  const p1 = { x: offsetX + wall.x * scale, y: offsetY + wall.y * scale };
  const p2 = wall.orientation === 'horizontal'
    ? { x: offsetX + (wall.x + length) * scale, y: p1.y }
    : { x: p1.x, y: offsetY + (wall.y + length) * scale };

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * §7: "legal positions are shown as a dimmed overlay of allowed grid
 * lines" — every candidate `orientation` placement that would currently
 * pass `isWallLegal`, drawn as one batched dim stroke. Only ~135-145
 * candidates per orientation on this field size; cheap enough to
 * recompute every frame rather than cache.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{scale: number, offsetX: number, offsetY: number}} transform
 * @param {'horizontal' | 'vertical'} orientation
 * @param {import('./physics.js').World} world
 */
export function drawWallLegalOverlay(ctx, transform, orientation, world) {
  const { scale, offsetX, offsetY } = transform;
  const { w, h } = CONFIG.field;
  const { length } = CONFIG.wall;

  ctx.save();
  ctx.strokeStyle = CONFIG.colors.wall;
  ctx.globalAlpha = 0.15;
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (orientation === 'horizontal') {
    for (let y = 0; y <= h; y++) {
      for (let x = 0; x <= w - length; x++) {
        if (!isWallLegal({ x, y, orientation }, world)) continue;
        const px = offsetX + x * scale;
        const py = offsetY + y * scale;
        ctx.moveTo(px, py);
        ctx.lineTo(px + length * scale, py);
      }
    }
  } else {
    for (let x = 0; x <= w; x++) {
      for (let y = 0; y <= h - length; y++) {
        if (!isWallLegal({ x, y, orientation }, world)) continue;
        const px = offsetX + x * scale;
        const py = offsetY + y * scale;
        ctx.moveTo(px, py);
        ctx.lineTo(px, py + length * scale);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws one full frame: background, grid, field edge, goals (with the
 * armed-player's target goal glowing hotter), the wall layer, pass line,
 * pieces, aim line, turn-timer bar, ARMED badge (§10 order — pass line
 * under the circles so circle glow isn't interrupted; aim line on top
 * since it must never be occluded). While wall placement is open (§7), the
 * confirmed wall is replaced by the legal-position overlay plus a live,
 * legality-colored preview instead — one wall shown at a time, not both.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} viewportW @param {number} viewportH
 * @param {{x: number, y: number}[]} circles  interpolated, cell-space, fixed order
 * @param {{selectedIndex: number | null, direction: {x: number, y: number} | null, pull: number, rejectedIndex: number | null}} inputState
 * @param {import('./rules.js').MatchState} match
 * @param {import('./physics.js').World} world
 * @param {{preview: import('./physics.js').Wall | null}} [wallState]
 * @param {{position: {x: number, y: number}, alpha: number} | null} [fallingFade]  see drawFallingGhost
 * @param {{x: number, y: number}[]} [trail]  see drawTrail; defaults to empty (no trail)
 * @param {number | null} [passFlashProgress]  see drawPassLine
 * @param {number} [illegalPulseAlpha]  see drawIllegalPulse; defaults to 0 (off)
 * @param {{scorer: 'A' | 'B', progress: number} | null} [goalFlash]  see drawGoalFlash
 */
export function drawFrame(
  ctx, viewportW, viewportH, circles, inputState, match, world, wallState,
  fallingFade = null, trail = [], passFlashProgress = null, illegalPulseAlpha = 0, goalFlash = null
) {
  const transform = computeScale(viewportW, viewportH);
  // Player A's target is the top goal (B's own end); Player B's target is
  // the bottom goal (A's own end) — matches BUILD_SPEC.md §2's attack/own
  // mapping and the render.js colour convention already established.
  const armedGoal = match.armed ? (match.currentPlayer === 'A' ? 'top' : 'bottom') : null;
  const placing = match.wallPlacer !== null && wallState?.preview;

  drawBackground(ctx, viewportW, viewportH);
  drawGrid(ctx, transform);
  drawFieldEdge(ctx, transform);
  if (CONFIG.field.mode === 'void') drawVoidLedge(ctx, transform);
  drawIllegalPulse(ctx, transform, illegalPulseAlpha);
  drawGoals(ctx, transform, armedGoal);
  drawGoalFlash(ctx, transform, goalFlash);

  if (placing) {
    drawWallLegalOverlay(ctx, transform, wallState.preview.orientation, world);
  } else if (world.wall) {
    drawWall(ctx, transform, world.wall, CONFIG.colors.wall);
  }

  drawPassLine(ctx, transform, circles, inputState.selectedIndex, passFlashProgress);
  drawTrail(ctx, transform, trail);
  drawPieces(ctx, transform, circles, inputState);
  drawFallingGhost(ctx, transform, fallingFade);
  drawAimLine(ctx, transform, circles, inputState);
  drawTurnTimer(ctx, transform, match);
  drawArmedBadge(ctx, transform, match);

  if (placing) {
    const legal = isWallLegal(wallState.preview, world);
    drawWall(ctx, transform, wallState.preview, legal ? CONFIG.colors.wall : CONFIG.colors.wallIllegal);
  }
}
