// js/config.js — every tunable constant lives here. Nothing inlined elsewhere.

export const CONFIG = {
  // --- BUILD_SPEC.md §11, copied verbatim ---------------------------------
  field: { w: 10, h: 14, goalWidth: 3, mode: 'arena', goalBackstop: 1.0 }, // 'arena' | 'void'; goalBackstop is step-3's own addition, see below
  modes: { arena: {}, void: { voidPenalty: 'goal' } }, // per-mode overrides
  piece: { radius: 0.4, count: 3 },
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
  wall: { length: 2, clearance: 2.0, usesPerPlayer: 5, thickness: 0.18 },
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
    wall: '#F8FAFC',
    wallIllegal: '#EF4444',
    passLine: 'rgba(34, 211, 238, 0.35)', // #22D3EE at 35%
  },

  // First-guess tunables — the spec requires these but gives no number.
  // Retune freely; not derived from anything else.
  // 0.75 -> 1.0 at step 5: the margin now also holds the turn-timer bar and
  // the ARMED badge simultaneously (not just one or the other) — bumped for
  // breathing room rather than fine-tuning pixel-perfect stacking math.
  marginCells: 1.0, // §2: field "always fits with a margin", no value given
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
  armedIndicator: { fontSize: 15, glow: 10 }, // px; the ARMED status badge text
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
  hud: { height: 40, fontSize: 20 }, // px; DOM element, not canvas-drawn (matches the goal popup's reasoning)

  // Step 5 additions (§8). turnTimer is canvas-drawn (tightly coupled to
  // the field's own rendered edges, same category as the ARMED badge/goal
  // glow) — the only element in this game with a genuine continuous
  // real-time animation (the last-5-seconds pulse), a deliberate exception
  // to the rest of the game's instant-show/hide visual language: §8a spec's
  // it as functional feedback ("the important one"), not step-8 juice.
  turnTimer: { barThickness: 4, pulseHz: 2, pulseMinAlpha: 0.3 },

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
  // ("once," "a short... pulse") but no numbers. trail.length is the one
  // spec gives directly ("keep the last 12 positions"), CONFIG'd anyway per
  // hard rule 3, same as every other spec-given number in this file.
  trail: { length: 12 },
  passFlash: { durationMs: 300, widthBoost: 2 }, // peak lineWidth = passLineWidth * (1 + widthBoost) — "expands outward"
  illegalPulse: { durationMs: 300, widthMultiplier: 2 }, // lineWidth = BORDER_WIDTH * widthMultiplier
  goalFlash: { durationMs: 500, washAlpha: 0.25, glowMultiplier: 2, mouthWidthMultiplier: 3 },
};
