// js/input.js — pointer handling, drag-to-aim, wall placement (BUILD_SPEC.md
// §4, §7). Owns its own Pointer Events listeners; main.js wires it up via
// attachInput(). Not one of the three sim modules (ADR-0002), so no
// @ts-check here — it's DOM-heavy by nature. The only render.js import is
// toCellSpace: input.js never reaches for CONFIG.colors or a draw helper,
// and never computes the scale/offset transform itself — that stays
// render.js's job alone.

import { CONFIG } from './config.js';
import { subtract, scale as scaleVec, length, normalize } from './vec.js';
import { toCellSpace } from './render.js';
import { isSettled, launchCircle } from './physics.js';

/**
 * Wire up drag-to-aim and wall placement on `canvas`. The two are mutually
 * exclusive modes on the same pointer listeners (never active together —
 * `match.wallPlacer` gates which one a given pointer event drives), not two
 * separate listener sets.
 * @param {HTMLCanvasElement} canvas
 * @param {import('./physics.js').World} world
 * @param {import('./rules.js').MatchState} match
 * @param {() => {scale: number, offsetX: number, offsetY: number}} getTransform
 *   Returns the current cell<->pixel transform; called fresh on every
 *   pointer event (not cached at attach time) so a resize mid-session can't
 *   leave input.js hit-testing against a stale transform.
 * @param {(index: number) => void} [onLaunch]
 *   Called the instant a real (non-cancelled, pull >= minPull) launch
 *   fires — rules.js uses this to capture the flick-start position for its
 *   case-3 rollback. Never called on a cancelled release.
 * @param {() => boolean} [isInputBlocked]
 *   Returns true while some non-physics reason should reject a new grab
 *   (the goal popup showing, or the match being won). `isSettled(world)`
 *   alone isn't enough once those exist.
 * @returns {{
 *   getState: () => { selectedIndex: number|null, direction: {x:number,y:number}|null, pull: number, rejectedIndex: number|null },
 *   getWallState: () => { preview: import('./physics.js').Wall | null },
 *   beginWallPlacement: () => void,
 *   rotateWall: () => void,
 * }}
 */
export function attachInput(canvas, world, match, getTransform, onLaunch, isInputBlocked) {
  /** @type {number | null} */
  let activePointerId = null;
  /** @type {number | null} */
  let selectedIndex = null;
  /** @type {{x: number, y: number} | null} */
  let direction = null;
  let pull = 0;
  /** @type {{index: number, until: number} | null} */
  let rejectedFlash = null;

  /** @type {import('./physics.js').Wall | null} */
  let wallPreview = null;

  /** clientX/clientY -> canvas-relative CSS pixels -> cell space. */
  function pointerToCell(e) {
    const rect = canvas.getBoundingClientRect();
    return toCellSpace(e.clientX - rect.left, e.clientY - rect.top, getTransform());
  }

  /** Nearest circle within selectRadius, or null. Ties prefer the lower
   * index for free: `dist < bestDist` is strict, so an exact tie never
   * displaces an already-found earlier index. */
  function findNearestInRange(cell) {
    /** @type {number | null} */
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < world.circles.length; i++) {
      const dist = length(subtract(world.circles[i], cell));
      if (dist <= CONFIG.input.selectRadius && dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  /** Pull = distance from circle centre to pointer, clamped to maxPull.
   * Direction = unit vector opposite the drag vector (slingshot, §4.2). */
  function updateDrag(index, cell) {
    const dragVec = subtract(cell, world.circles[index]);
    pull = Math.min(length(dragVec), CONFIG.input.maxPull);
    direction = normalize(scaleVec(dragVec, -1));
  }

  function clearDrag() {
    activePointerId = null;
    selectedIndex = null;
    direction = null;
    pull = 0;
  }

  // --- Wall placement (§7) --------------------------------------------

  /** Snaps a raw cell position to a valid grid-aligned wall placement for
   * `orientation`, clamped so the full CONFIG.wall.length segment stays on
   * the field. `cell` is treated as the wall's intended CENTRE (the drag
   * follows the pointer with the wall centred under it), not its corner. */
  function snapWallPosition(cell, orientation) {
    const { w, h } = CONFIG.field;
    const { length: wallLength } = CONFIG.wall;
    if (orientation === 'horizontal') {
      const x = Math.round(cell.x - wallLength / 2);
      const y = Math.round(cell.y);
      return { x: Math.max(0, Math.min(w - wallLength, x)), y: Math.max(0, Math.min(h, y)), orientation };
    }
    const x = Math.round(cell.x);
    const y = Math.round(cell.y - wallLength / 2);
    return { x: Math.max(0, Math.min(w, x)), y: Math.max(0, Math.min(h - wallLength, y)), orientation };
  }

  /** Call once when `match.wallPlacer` transitions from null to a player —
   * seeds the preview from the existing wall (moving it) or a sensible
   * default (placing a new one), so something legible is visible before
   * the player's first touch, not just after. */
  function beginWallPlacement() {
    wallPreview = world.wall
      ? { ...world.wall }
      : snapWallPosition({ x: CONFIG.field.w / 2, y: CONFIG.field.h / 2 }, 'horizontal');
  }

  /** Tap-a-control rotate (§7). Keeps the segment's centre roughly fixed
   * rather than resetting position, then re-snaps/re-clamps for the field. */
  function rotateWall() {
    if (!wallPreview) return;
    const { length: wallLength } = CONFIG.wall;
    const centerX = wallPreview.x + (wallPreview.orientation === 'horizontal' ? wallLength / 2 : 0);
    const centerY = wallPreview.y + (wallPreview.orientation === 'vertical' ? wallLength / 2 : 0);
    const nextOrientation = wallPreview.orientation === 'horizontal' ? 'vertical' : 'horizontal';
    wallPreview = snapWallPosition({ x: centerX, y: centerY }, nextOrientation);
  }

  function onWallPointerDown(e) {
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    if (wallPreview) wallPreview = snapWallPosition(pointerToCell(e), wallPreview.orientation);
  }

  function onWallPointerMove(e) {
    if (e.pointerId !== activePointerId || !wallPreview) return;
    wallPreview = snapWallPosition(pointerToCell(e), wallPreview.orientation);
  }

  function onWallPointerUp(e) {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null; // the preview simply stays wherever it was dragged to; Confirm/Skip are separate explicit actions (§7)
  }

  // --- Shared pointer routing ------------------------------------------

  function onPointerDown(e) {
    if (match.wallPlacer !== null) return onWallPointerDown(e);
    if (activePointerId !== null) return; // one active drag at a time — ignore concurrent touches
    const cell = pointerToCell(e);
    const nearest = findNearestInRange(cell);

    if (!isSettled(world) || (isInputBlocked?.() ?? false) || nearest === null) {
      // Rejected grab (sim still moving) or an empty tap — both a no-op
      // (decision 1). Only flash-dim when an actual circle was tapped;
      // tapping empty space has nothing to dim.
      if (nearest !== null) {
        rejectedFlash = { index: nearest, until: performance.now() + CONFIG.input.rejectedFlashMs };
      }
      return;
    }

    activePointerId = e.pointerId;
    selectedIndex = nearest;
    canvas.setPointerCapture(e.pointerId);
    updateDrag(nearest, cell);
  }

  function onPointerMove(e) {
    if (match.wallPlacer !== null) return onWallPointerMove(e);
    if (e.pointerId !== activePointerId || selectedIndex === null) return;
    updateDrag(selectedIndex, pointerToCell(e));
  }

  function onPointerUp(e) {
    if (match.wallPlacer !== null) return onWallPointerUp(e);
    if (e.pointerId !== activePointerId) return;
    if (pull >= CONFIG.input.minPull && selectedIndex !== null && direction !== null) {
      const speed = (pull / CONFIG.input.maxPull) * CONFIG.physics.maxSpeed;
      launchCircle(world, selectedIndex, direction, speed);
      onLaunch?.(selectedIndex); // real launch only — never on a cancelled release
    }
    clearDrag(); // below minPull: cancels cleanly, no shot, no lingering visual state
  }

  function onPointerCancel(e) {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    clearDrag(); // identical to a below-minPull release — real mobile requirement (OS gestures fire this, not pointerup)
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  // Second, independent layer of gesture suppression alongside styles.css's
  // touch-action: none — without {passive:false} here, preventDefault() on
  // a raw touchmove silently no-ops and dragging also scrolls the page.
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  function getState() {
    const now = performance.now();
    const rejectedIndex = rejectedFlash !== null && now < rejectedFlash.until ? rejectedFlash.index : null;
    return { selectedIndex, direction, pull, rejectedIndex };
  }

  function getWallState() {
    return { preview: wallPreview };
  }

  return { getState, getWallState, beginWallPlacement, rotateWall };
}
