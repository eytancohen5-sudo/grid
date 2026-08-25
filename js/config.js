// js/config.js — every tunable constant lives here. Nothing inlined elsewhere.

export const CONFIG = {
  // --- BUILD_SPEC.md §11, copied verbatim ---------------------------------
  field: { w: 10, h: 14, goalWidth: 3, mode: 'arena', goalBackstop: 1.0 }, // 'arena' | 'void'; goalBackstop is step-3's own addition, see below
  modes: { arena: {}, void: { voidPenalty: 'goal' } }, // per-mode overrides
  // radius 0.4 -> 0.3 (polish pass, 2026-08-23, Eytan-approved Decision 2):
  // smaller ball reads less cluttered against 3 circles + 2 walls on a 10x14
  // field. BUILD_SPEC.md §3 still shows 0.4 "TUNABLE" — deliberate drift,
  // same as marginCells before it, not a doc bug to chase.
  piece: { radius: 0.3, count: 3 },
  input: {
    maxPull: 6.0,
    minPull: 0.3,
    selectRadius: 1.0, // §4.1's "within 1.0 cells" pick radius
    // Not in §11 or §4 — forge's own choice for decision 1's rejected-grab
    // dim (no spec value given, so CONFIG'd rather than inlined per hard
    // rule 3). rejectedFlashAlpha reuses passLine's existing 35% as a
    // precedent for "dim/faint" rather than inventing a new fraction.
    rejectedFlashMs: 150,
    rejectedFlashAlpha: 0.35,
  },
  physics: {
    maxSpeed: 26,
    drag: 1.45,
    restRail: 0.60,
    restWall: 0.75,
    restThreshold: 0.15,
    dt: 1 / 120,
    settleTimeout: 6.0,
  },
  rules: { goalsToWin: 3, strictContact: true },
  // usesPerPlayer removed — each player now has exactly one permanent wall
  // (redesigned 2026-08-20 from Eytan's live playtest feedback: a shared,
  // 5-times-movable wall to one wall each, placed once, stays forever).
  // "placed or not" is already answered by whether world.walls has an entry
  // for that owner — a separate counter would just be redundant state.
  // `clearance` now also gates the minimum distance BETWEEN the two walls,
  // reusing the existing goal/circle clearance value rather than adding a
  // second tunable — physics.js's sequential per-circle wall resolution
  // requires this to stay above 2*piece.radius (0.6, was 0.8 pre-radius-change)
  // or two walls close
  // enough together can volley a circle between them; 2.0 clears that with
  // comfortable margin.
  // legalOverlayAlpha (polish pass, item 9, 2026-08-23): 0.15 -> 0.4 — the
  // old value read as barely brighter than the ordinary grid lines,
  // especially under playerB's amber (composites dimmer than cyan at the
  // same alpha against this game's near-black bg). 0.4 checked against both
  // player colours: clearly brighter than gridLine for each, still well
  // short of a committed wall's full opacity.
  wall: { length: 2, clearance: 2.0, thickness: 0.18, legalOverlayAlpha: 0.4 },
  timers: { turnSeconds: 20, matchSeconds: 300, matchClockEnabled: true },

  // --- Additions beyond §11 (hard rule 3: every tunable number lives here,
  //     never inline it — these are needed by render.js and have no usable
  //     value in config.js yet) ----------------------------------------

  // §10's colour table, ported straight across. passLine's "35%" alpha is
  // converted to an rgba() string; everything else stays hex.
  colors: {
    bg: '#05070A',
    gridLine: '#0E2A33',
    fieldEdge: '#164E63',
    playerA: '#22D3EE', // cyan — bottom player, their goal, their turn
    playerB: '#F59E0B', // amber — top player, their goal, their turn
    piece: '#E2F6FF',
    pieceActive: '#FFFFFF',
    // wall: no longer its own token (2026-08-20) — each player's wall now
    // renders in that player's own colour (playerA/playerB), matching every
    // other player-owned element, now that walls are no longer neutral and
    // shared.
    wallIllegal: '#EF4444',
    passLine: 'rgba(34, 211, 238, 0.35)', // #22D3EE at 35%
  },

  // First-guess tunables — the spec requires these but gives no number.
  // Retune freely; not derived from anything else.
  // 0.75 -> 1.0 at step 5: the margin now also holds the turn-timer bar and
  // the ARMED badge simultaneously (not just one or the other) — bumped for
  // breathing room rather than fine-tuning pixel-perfect stacking math.
  // 1.0 -> 1.5 at the 2026-08-23 polish pass (item 12): the margin now
  // stacks FOUR things on the acting player's edge — the draining
  // turn-timer bar, the new persistent turn-identity rail (item 1), a gap,
  // and the now-larger two-state ARMED badge text — not just two. Computed
  // (not eyeballed): drain bar 4px + gap 2px + rail 8px + gap 2px + badge
  // text+glow ~24px =~ 40px needed; at a representative 390px-wide phone
  // this now clears that with a few px to spare. Same "first guess, retune
  // freely on a real device" status as every value in this section.
  marginCells: 1.5, // §2: field "always fits with a margin", no value given
  fieldEdgeGlow: 8, // §5/§10: "faint glow" via shadowBlur, no px value given

  // Step 2 additions — same "spec gives the effect, not the number" pattern.
  pieceGlow: 15, // §10: circles get 12-18px shadowBlur, no single value; midpoint, same pattern as fieldEdgeGlow
  passLineWidth: 2, // §10 gives passLine a color+alpha, no width; spec-silent, CONFIG'd not inlined
  aimLine: {
    minWidth: 2, maxWidth: 5, // px, ramps with pull/maxPull
    minGlow: 4, maxGlow: 16, // shadowBlur px, ramps with pull/maxPull
    minAlpha: 0.55, // alpha reaches 1.0 at maxPull; rendered dimmer than this below minPull (cancel cue)
  },

  // Step 3 additions. field.goalBackstop (above, in the §11 block since it's
  // a field-geometry value): once the goal mouth reopens this step, an
  // own-goal shot (no rollback, §5: "play continues from where it rests")
  // would otherwise sail ~18 cells into open space with nothing to catch
  // it. 1.0 cell of solid backstop past each goal line, same restitution as
  // a normal rail, gives the goal shallow depth instead of an open void —
  // bounded, deterministic, no page-reload-required scenario. Not VOID mode
  // (step 7, actual falling) — a narrow safety net so this step stays
  // playable on its own.
  font: "ui-monospace, 'SF Mono', 'Consolas', monospace", // first rendered text this step; shared by the ARMED badge and the goal popup
  // fontSize 15 -> 18 at the 2026-08-23 polish pass (ARMED badge item):
  // "size it up toward the HUD's normal text size" (hud.fontSize is 20) —
  // most of the way there without quite matching the HUD's own hierarchy,
  // since this now also has to carry a two-state label ("PASS TO ARM" is
  // longer than "ARMED") rather than only ever rendering one short word.
  armedIndicator: { fontSize: 18, glow: 10 }, // px; the ARMED status badge text
  armedGoalGlow: 22, // shadowBlur px on the armed player's target goal-mouth stroke, replacing the normal fieldEdgeGlow baseline for that one mouth only
  goalPopup: {
    durationMs: 1400, // wall-clock auto-dismiss delay (performance.now()-based, same pattern as input.rejectedFlashMs — survives a backgrounding gap cleanly)
    scrimAlpha: 0.6, // full-canvas dim while showing — a celebration, not an error modal, so not darker
    fontSize: 56, // px
  },

  // Step 4 additions. §10: "one thin bar, top of screen, outside the field"
  // — this is the first step with real HUD content (a score), so this is
  // when render.js's computeScale actually reserves the space rather than
  // letting the bar float over the grid's top margin.
  // height 40 -> 56 at the 2026-08-23 polish pass (item 14): the wall
  // button's tap target was under the 44px accessibility guideline: with
  // the old 40px bar and its padding there simply wasn't room to grow it in
  // place. Raised instead of relocating the button out of the HUD entirely
  // — relocating risked new collisions with the bottom-band turn-prompt/
  // wall-controls elements (Part 3), which is a real interaction-design
  // call, not a pure sizing one; "raise CONFIG.hud.height" was the other,
  // pre-approved option for this item. NOTE: styles.css's #hud height must
  // stay in sync (documented duplication, same as every CSS/config.js pair
  // in this file — CSS can't import config.js).
  hud: { height: 56, fontSize: 20 }, // px; DOM element, not canvas-drawn (matches the goal popup's reasoning)

  // Step 5 additions (§8). turnTimer is canvas-drawn (tightly coupled to
  // the field's own rendered edges, same category as the ARMED badge/goal
  // glow) — the only element in this game with a genuine continuous
  // real-time animation (the last-5-seconds pulse), a deliberate exception
  // to the rest of the game's instant-show/hide visual language: §8a spec's
  // it as functional feedback ("the important one"), not step-8 juice.
  turnTimer: { barThickness: 4, pulseHz: 2, pulseMinAlpha: 0.3 },

  // turnRail (2026-08-23 polish pass, item 1): a SECOND, separate bar from
  // turnTimer above — persistent, full-width, does not shrink/dim with the
  // countdown (answers "whose turn," not "how much time's left"), and
  // unlike turnTimer is never suppressed during wall placement (item 2).
  // `gap` spaces it from turnTimer's own bar, and again from the ARMED
  // badge beyond it — one knob for both, so the whole margin stack retunes
  // together. `washAlpha` is the acting player's half-field colour wash,
  // same fillRect/globalAlpha technique as goalFlash.washAlpha below, just
  // persistent instead of one-shot and half-field instead of full-field.
  turnRail: { thickness: 8, gap: 2, washAlpha: 0.04 },

  // goalChevron (2026-08-23 polish pass, item 3): a small inward tick at
  // the acting player's actual attack target (not their own/defended
  // goal), shown from turn start — independent of `armed`, unlike the
  // existing armedGoalGlow boost on drawGoals, which stays armed-only.
  // pieceActive (white) per the spec — a non-hue cue layered on top of the
  // already-colour-coded goal mouths.
  goalChevron: { size: 10, glow: 6 }, // px

  // Step 7 additions (§5 VOID subsection). void.voidPenalty already lives
  // in modes.void per §11 — this is the one new visual-only tunable: how
  // long the "short fall-and-fade" derez plays before the circle is fully
  // gone (main.js tracks the wall-clock start time, same pattern as
  // goalPopup.durationMs). The spec's own tuning note ("VOID will likely
  // need... a slightly wider field or a lower maxSpeed... expect to fork
  // two or three numbers per mode") is NOT acted on here — there's no
  // playtesting basis yet to pick those numbers, so CONFIG.modes.void
  // stays as narrow as §11 shipped it (voidPenalty only). Flagged, not
  // silently decided.
  void: { derezFadeMs: 500 },

  // Step 8 additions (§10 Effects). All three durations are first-guess
  // tunables like everything else in this section — §10 gives the effect
  // ("once," "a short... pulse") but no numbers.
  // trail (polish pass, 2026-08-23, Eytan-approved): reshaped into a
  // falling-star comet — length 12 -> 20, plus per-sample radius/alpha
  // tapering. This intentionally deviates from BUILD_SPEC.md §10's "keep the
  // last 12 positions, draw them at decreasing alpha," per Eytan's direct
  // instruction — flagged here so it doesn't read as unintended drift later.
  trail: { length: 20, minRadiusScale: 0.15, maxAlpha: 0.9, alphaExponent: 2 },
  passFlash: { durationMs: 300, widthBoost: 2 }, // peak lineWidth = passLineWidth * (1 + widthBoost) — "expands outward"
  illegalPulse: { durationMs: 300, widthMultiplier: 2 }, // lineWidth = BORDER_WIDTH * widthMultiplier
  goalFlash: { durationMs: 500, washAlpha: 0.25, glowMultiplier: 2, mouthWidthMultiplier: 3 },

  // turnPrompt (2026-08-23 polish pass, Part 3): the new "Place your wall —
  // or just take your shot" line. DOM-only chrome (same reasoning as
  // goalPopup/hud above — CSS can't import config.js), still CONFIG'd per
  // hard rule 3, following goalPopup.fontSize's own precedent.
  turnPrompt: { fontSize: 13 }, // px
};
