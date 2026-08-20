// @ts-check
// js/vec.js — pure 2D vector helpers. No DOM/canvas imports: this file (and
// physics.js, which builds on it) must run headless under `node test.js`
// (ADR-0002). Small, obvious set — only what physics.js/input.js/main.js
// actually call, nothing speculative.

/** @typedef {{x: number, y: number}} Vec */

/** @param {Vec} a @param {Vec} b @returns {Vec} */
export function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** @param {Vec} a @param {number} s @returns {Vec} */
export function scale(a, s) {
  return { x: a.x * s, y: a.y * s };
}

/**
 * Hand-rolled sqrt(x*x+y*y) — never Math.hypot (not correctly-rounded, and
 * can drift across JS engines; determinism requirement, BUILD_SPEC.md §5).
 * @param {Vec} a @returns {number}
 */
export function length(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

/**
 * Unit vector in the direction of `a`. Guarded: a zero-length input returns
 * {x:0, y:0} instead of throwing or producing NaN (0/0).
 * @param {Vec} a @returns {Vec}
 */
export function normalize(a) {
  const len = length(a);
  if (len === 0) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

/**
 * Linear interpolation from `a` to `b`. Used by main.js to blend each
 * circle's previous-step and current-step position for render interpolation
 * (hard rule 2: this stays cell-space math here, not in render.js).
 * @param {Vec} a @param {Vec} b @param {number} t @returns {Vec}
 */
export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Reflects velocity `v` off a surface with unit normal `n`, scaling the
 * normal component by `restitution`; the tangential component is left
 * untouched. General form of the axis-aligned `-v*rest` rail bounce
 * (physics.js keeps that simpler version for rails; this is for the wall,
 * §7/§5, where a circle hitting a segment's endpoint can reflect off a
 * normal at any angle, not just axis-aligned).
 * @param {Vec} v @param {Vec} n @param {number} restitution @returns {Vec}
 */
export function reflect(v, n, restitution) {
  const vDotN = v.x * n.x + v.y * n.y;
  const scale = (1 + restitution) * vDotN;
  return { x: v.x - scale * n.x, y: v.y - scale * n.y };
}

/**
 * Closest point on segment a-b to point p. Degenerate (zero-length) segment
 * falls back to `a`.
 * @param {Vec} p @param {Vec} a @param {Vec} b @returns {Vec}
 */
export function closestPointOnSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) return a;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/**
 * Minimum distance from point `p` to segment a-b.
 * @param {Vec} p @param {Vec} a @param {Vec} b @returns {number}
 */
export function pointSegmentDistance(p, a, b) {
  const closest = closestPointOnSegment(p, a, b);
  return length(subtract(p, closest));
}

/**
 * Minimum distance between two segments p1-p2 and p3-p4 (0 if they
 * intersect). For non-intersecting segments the minimum is always achieved
 * at one of the four endpoint-to-opposite-segment distances — the
 * distance-between-segments function is piecewise linear/convex, so no
 * interior-to-interior case can beat all four endpoint cases.
 * @param {Vec} p1 @param {Vec} p2 @param {Vec} p3 @param {Vec} p4 @returns {number}
 */
export function segmentSegmentDistance(p1, p2, p3, p4) {
  if (segmentsIntersect(p1, p2, p3, p4)) return 0;
  return Math.min(
    pointSegmentDistance(p1, p3, p4),
    pointSegmentDistance(p2, p3, p4),
    pointSegmentDistance(p3, p1, p2),
    pointSegmentDistance(p4, p1, p2)
  );
}

/** Orientation of turn p->q->r: 1 clockwise, -1 counter-clockwise, 0 collinear. */
function orientation(p, q, r) {
  const val = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (val > 0) return 1;
  if (val < 0) return -1;
  return 0;
}

/** True if q lies on segment pr, given p/q/r are already known collinear. */
function onSegment(p, q, r) {
  return (
    q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)
  );
}

/**
 * Standard orientation-based segment-segment intersection test: does segment
 * p1-p2 cross segment p3-p4, including endpoint-touching and collinear-
 * overlap cases. Used for pass-line and goal-line crossing detection
 * (BUILD_SPEC.md §6, step 3) — stays in +,-,* and comparisons only, no
 * sqrt/trig, per the determinism rules. A shot fired exactly along the pass
 * line is a real thing a player will do, so the collinear branches (the
 * last four checks) are load-bearing, not a rare edge case to skip.
 * @param {Vec} p1 @param {Vec} p2 @param {Vec} p3 @param {Vec} p4 @returns {boolean}
 */
export function segmentsIntersect(p1, p2, p3, p4) {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  if (o1 !== o2 && o3 !== o4) return true;

  if (o1 === 0 && onSegment(p1, p3, p2)) return true;
  if (o2 === 0 && onSegment(p1, p4, p2)) return true;
  if (o3 === 0 && onSegment(p3, p1, p4)) return true;
  if (o4 === 0 && onSegment(p3, p2, p4)) return true;

  return false;
}
