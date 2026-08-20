# GRID — Build Spec v1

The single source of truth for the first playable version. Written to be implemented without
asking questions. Where a value is tunable it is marked **TUNABLE** and must live in `CONFIG`.

Companion doc: `CONCEPT_v2.md` (the why). This file is the what.

---

## 0. Scope of v1

Two players, **one device, hot seat**. No accounts, no network, no menus, no store, no
sound required. One screen: the match. The whole point of v1 is to answer one question —
*is the pass gate plus the wall actually fun?*

**Not in v1:** AI opponent, online play, sound design, animations beyond those listed,
settings screen, persistence.

---

## 1. Stack

**Plain HTML + ES modules + Canvas 2D. No framework, no build step, no dependencies.**

Run with `python3 -m http.server 8000` and open on a phone over the LAN. That is the entire
toolchain.

Rejected, and why: Unity and Godot both bury a 500-line game in project scaffolding, binary
scene files, and an export step — and they make iteration with an AI assistant slower, not
faster. A physics engine (matter.js, planck) is also rejected: three circles, one wall and
four rails is about 150 lines of collision code, and hand-rolling it keeps the simulation
deterministic and debuggable. If this ships to app stores later, wrap it in Capacitor; the
game code does not change.

```
index.html
styles.css
js/config.js     — every constant, nothing else
js/vec.js        — 2D vector helpers
js/physics.js    — integration, collisions, rest detection
js/rules.js      — pass detection, turn state machine, scoring, wall legality
js/render.js     — canvas drawing, all visual style
js/input.js      — pointer handling, drag-to-aim, wall placement
js/main.js       — game loop, wiring
```

---

## 2. Coordinate system

- The unit is **one cell**. All game logic is in cells, never in pixels.
- Field is **10 cells wide × 14 cells tall**. Origin `(0,0)` is the top-left corner of the
  field. `x` grows right, `y` grows down.
- Rendering converts cells → pixels with a single scale factor computed from the viewport.
  The field always fits with a margin; portrait orientation is assumed.
- Player A (bottom) attacks the **top** goal. Player B (top) attacks the **bottom** goal.

### Goals
- Goal width **3 cells** **TUNABLE**, centred on each short end: from `x = 3.5` to `x = 6.5`.
- The top goal mouth is the segment `y = 0`, `x ∈ [3.5, 6.5]`. The bottom goal mouth is
  `y = 14`, `x ∈ [3.5, 6.5]`.

---

## 3. The pieces

- **Three circles, shared by both players.** No ownership, no separate ball.
- Radius **0.4 cells** (diameter 0.8) **TUNABLE**.
- Mass is equal and irrelevant in v1 — circles that touch end the turn (§6), so
  circle-circle momentum transfer is cosmetic.

### Kick-off layout
At match start and after every goal, place the circles in a triangle in the **defending
half of the player who is about to take the turn**:

- Player A to take the turn (attacking the top goal): circles at
  `(4.0, 11.0)`, `(6.0, 11.0)`, `(5.0, 12.5)`.
- Player B to take the turn (attacking the bottom goal): mirrored —
  `(4.0, 3.0)`, `(6.0, 3.0)`, `(5.0, 1.5)`.

Walls are **not** removed at kick-off — each player's wall (§7) is permanent for the
whole match once placed. Only a full "Play again" clears them.

---

## 4. Input — drag to launch

1. Pointer down within `1.0` cells of a circle's centre selects that circle.
2. Drag **away** from the circle. The launch direction is the **opposite** of the drag
   vector (slingshot).
3. **Pull distance sets power. The pull is capped at 6 cells** — dragging further does not
   add power and the aim line stops growing at 6 cells, so the player can see the cap.
   - `pull = min(distance(pointer, circleCentre), 6.0)` **TUNABLE: `MAX_PULL = 6.0`**
   - `power = pull / MAX_PULL` → `0…1`
   - `launchSpeed = power * MAX_SPEED`, where **`MAX_SPEED = 26` cells/second** **TUNABLE**
4. Releasing below **`MIN_PULL = 0.3` cells** cancels the shot — nothing happens, turn is
   not consumed.
5. While dragging, show: the aim line from the circle in the launch direction, a power
   indicator that visibly saturates at the 6-cell cap, and the live pass line (§6).

No flick-velocity input. Pull distance only — it is repeatable, it works with a thumb, and
it is the same gesture on any device.

---

## 5. Physics

Fixed timestep. **`dt = 1/120` s**, accumulator-driven, render interpolates. Determinism
matters: identical inputs must produce identical outcomes.

### Motion
Exponential drag, integrated per step:
```
v *= exp(-DRAG * dt)        DRAG = 1.45   (TUNABLE)
p += v * dt
```
A circle comes to rest when `|v| < 0.15` cells/s **TUNABLE**; snap velocity to zero.
With these numbers a full-power shot travels roughly 18 cells before stopping — about one
and a quarter field lengths.

### Field modes — two fields, one rule set

The game ships with **two field types**, chosen before the match. Everything else is
identical. `CONFIG.field.mode = 'arena' | 'void'`.

#### ARENA — walled
All four edges bounce. Restitution **`0.60`** **TUNABLE `restRail`**. Reflect the component
normal to the edge and clamp the circle back inside. The only way out is through a goal
mouth. Bank shots off the side rails are a legitimate tool.

Visually: a solid glowing border around the field.

#### VOID — open edge
There are no rails. The grid simply ends, and a circle whose **centre** leaves the field
**falls**.

- A fallen circle is derezzed with a short fall-and-fade, not an instant delete.
- **Penalty: the opponent is awarded a goal.** **TUNABLE: `voidPenalty: 'goal' | 'turnover'`.**
  - `'goal'` — the fall concedes. Kick-off follows, exactly as after a normal goal.
  - `'turnover'` — the turn simply ends and the fallen circle respawns on the centre spot
    (nearest free position if occupied).
- Either way all three circles must be back on the field before the next turn: the game is
  unplayable with two.
- The goal mouths still score normally. Overshooting past a goal is a fall.

Visually: no border. The outermost cell of grid fades to black, and the last grid line is
brighter than the rest — a ledge. Nothing beyond it.

> **Why two fields, not one.** ARENA is the forgiving one: hard shots are safe, so a new
> player can flail without being punished, and the wall is a nuisance. VOID makes the
> 6-cell pull cap mean something — full power near an edge is now a real risk — and it
> turns the wall from an obstacle into a weapon, because deflecting an opponent's circle
> into the void wins you a goal. That is the single strongest argument for the wall
> existing at all. Build ARENA first; VOID is one branch in the collision code.

> **Tuning note.** VOID will likely need either a slightly wider field or a lower
> `maxSpeed` than ARENA, or every strong shot dies. Expect to fork two or three numbers per
> mode. Keep them as `CONFIG.modes.arena` / `CONFIG.modes.void` overrides on top of the
> base config — do not fork the code.

### Goal detection
A goal is scored when a circle's centre crosses the goal-mouth segment while the shooting
player is **armed** (§6). The goal mouth does not bounce; everything else on that edge does.

### Wall
Solid segment, 2 cells long, zero thickness for collision but drawn `0.18` cells thick.
Circle-vs-segment collision with restitution **`0.75`** **TUNABLE**: find the closest point
on the segment, resolve penetration along the normal, reflect the normal velocity component.
Handle the segment's two endpoints as circle-vs-point.

### Stuck states
- If a circle is at rest and overlapping the wall or a rail (from a placement or a resolve
  edge case), push it out along the shortest axis before the next turn begins.
- If two circles come to rest overlapping, separate them symmetrically.
- Hard cap: if the world has not settled after **6 seconds** of simulation, force all
  velocities to zero and resolve the turn normally.

---

## 6. Rules — the turn state machine

State per turn: `currentPlayer`, `armed` (boolean, starts **false** at the beginning of
every turn).

### One rule for every flick
> **Every flick must either complete a pass, or score a goal. Otherwise your turn ends.**

**Pass completed** = during the shot, the centre of the launched circle **crosses the
straight segment between the centres of the other two circles**, and the launched circle
**does not touch either of them** at any point during the shot.

- Test the crossing continuously across each physics step (segment-segment intersection
  between the circle's motion this step and the current line between the other two).
  Both other circles are stationary during a shot, so that line is fixed for the shot.
- **Touching another circle ends the turn immediately** — the strict variation, and it is
  what makes position matter. **TUNABLE: `STRICT_CONTACT = true`.**

### Resolution, in order, once everything is at rest
1. **VOID mode only** — any circle fell off the field → apply `voidPenalty` (§5). This is
   checked first and overrides everything below, including a goal scored in the same flick.
2. The launched circle entered the opponent's goal **and** `armed` was true → **GOAL**.
3. The launched circle entered the opponent's goal but `armed` was false → **no goal**, turn
   ends, circle is returned to where it started the flick.
4. The launched circle touched another circle → turn ends.
5. Pass completed → `armed = true`, **same player flicks again**.
6. None of the above → turn ends.

A circle knocked off by a *collision* counts the same as the launched circle falling — in
VOID mode you are responsible for every circle your shot disturbs. With `STRICT_CONTACT`
on, touching another circle already ends the turn, so this only bites when contact is
switched off.

`armed` persists across consecutive flicks within a turn and resets to false when the turn
passes to the other player.

### Own goal
A circle entering **your own** goal is ignored — no goal, no turnover, play continues from
where it rests. Simplest rule that cannot be exploited.

---

## 7. The wall

Redesigned 2026-08-20 from Eytan's live playtest feedback on the original shared-wall
version (kept below in spirit, not literally — the mechanic actually shipped is this one):

- **Each player has their own wall.** Two can exist on the field at once, one per player,
  each placed **exactly once per match**, **TUNABLE: `WALLS_PER_PLAYER = 1`** (a future
  session may raise this to 2 — the implementation does not hardcode "at most one total").
  Once placed, a wall is **permanent** for the rest of the match — it cannot be moved or
  replaced. There is no "skip" budget concept: a player who never places simply never has
  one, no penalty either way, no deadline.
- Length **2 cells**, aligned to grid lines, **horizontal or vertical only**.
- **When:** a player may place their wall any time it's genuinely their own turn to act —
  including mid-turn while already armed (a completed pass), so a wall can set up an
  offensive bounce shot, not only defend against the opponent's next turn. Not a separate
  phase between turns; there is no window that opens or closes on its own.
- **Legality at the moment of placement** — all must hold:
  - The wall lies entirely inside the field.
  - Distance from the wall segment to **each goal mouth segment** ≥ **2.0 cells**.
  - Distance from the wall segment to **each circle's centre** ≥ **2.0 cells**.
  - Distance from the wall segment to **the other player's wall** (if placed yet) ≥
    **2.0 cells** — reuses the same clearance value rather than a second tunable; this
    must stay above `2 * piece.radius` (0.8 cells) or two walls placed too close together
    can pass a circle back and forth between them in the physics resolution.
- After placement the wall stays put and stays legal even if circles come to rest beside it.
  The clearance rules are checked **only at placement**. Walls survive kick-offs (§3) —
  only starting a brand new match clears them.

### Placement UI
A **"Create Wall" button on each player's side of the HUD**, enabled only when it's legal
for that player to start placing right now (their own turn, nothing already in flight, they
haven't placed yet). Tapping it opens the same drag-to-position UI as before: drag the wall
anywhere on the field, it snaps to grid lines; a rotate control switches horizontal/vertical;
**legal positions are shown as a dimmed overlay of allowed grid lines**, coloured to match
that player's own wall colour, and the live preview renders red and cannot be confirmed
while illegal. Confirm commits it — permanently. Cancel closes the dialog without spending
anything; the button becomes available again to reopen it later on that same turn.

---

## 8. Timers

Two separate clocks. They do different jobs and both are needed.

### 8a. Turn timer — the important one
**20 seconds per flick** **TUNABLE: `turnSeconds = 20`**.

- Starts the moment control passes to a player, and **restarts on every flick** — so a
  player who keeps completing passes keeps getting fresh time.
- Pauses while the physics are running and while the wall-placement step is open.
- Displayed as a thin bar along the acting player's edge of the field, in their colour,
  draining. Last 5 seconds it pulses.
- **On expiry: the turn is forfeited.** No random shot, no penalty beyond losing the turn.

This one is not optional. In a game where a good player can hold the table across many
consecutive flicks, the turn timer is the only thing standing between the opponent and
watching someone else play. It is also the honest answer to the problem I flagged in v1:
a wall clock does not discipline a turn-based game — a per-turn clock does.

### 8b. Match clock
**5:00 total** **TUNABLE: `matchSeconds = 300`, `matchClockEnabled = true`**.

- Counts down continuously while the match is live; pauses on overlays.
- At 0:00 the player **ahead on goals wins**. If level, the match goes to **next goal
  wins** — the clock stops and play continues.
- Shown in the HUD, centred, small. It turns amber under 60 seconds.

Keep it switchable. A 5-minute cap makes the game a commute-sized session and forces
attacking play; it can also cut a good match off mid-build-up, which is infuriating.
Playtesting decides. Ship with it on, be ready to turn it off.

## 9. Scoring and match end

- First to **3 goals** wins **TUNABLE: `GOALS_TO_WIN = 3`** — or the leader when the match
  clock expires (§8b).
- No points, no currency.
- After a goal: brief flash, then kick-off (§3) with the **conceding player** taking the
  first turn. Both timers reset; the match clock does not.
- On win: a full-screen overlay with the score, how it was won (3 goals / on the clock), and
  a single "Play again" action.

---

## 10. Visual system — Tron grid

All colour lives in `config.js`. Nothing hard-coded in `render.js`.

| Token | Hex | Use |
|---|---|---|
| `bg` | `#05070A` | Background, outside the field too |
| `gridLine` | `#0E2A33` | The 10×14 cell lines, 1px, no glow |
| `fieldEdge` | `#164E63` | Field border, 2px, faint glow |
| `playerA` | `#22D3EE` | Cyan — bottom player, their goal, their turn indicator |
| `playerB` | `#F59E0B` | Amber — top player, their goal, their turn indicator |
| `piece` | `#E2F6FF` | The three circles — neutral, nobody owns them |
| `pieceActive` | `#FFFFFF` | The selected circle while aiming |
| `wallIllegal` | `#EF4444` | Wall while in an illegal position |
| `passLine` | `#22D3EE` at 35% | The live line between the two non-selected circles |

Cyan/amber is deliberate: it separates cleanly under all common colour-vision deficiencies,
where the obvious red/green would not.

No dedicated `wall` token — each player's own wall (§7) renders in that player's own
`playerA`/`playerB` colour, same as their goal and turn indicator.

### Effects (all with `ctx.shadowBlur`, no image assets)
- Circles: filled, `shadowBlur` 12–18px in their own colour.
- Moving circle: a fading trail — keep the last 12 positions, draw them at decreasing alpha.
- **Completed pass:** the pass line flashes bright cyan and expands outward once. This is
  the game's most important feedback — the player must learn the rule from this flash, not
  from a tutorial.
- **Illegal flick (turn lost):** a short red pulse on the field border.
- **Goal:** the goal mouth floods with the scorer's colour, the whole grid pulses once.
- Nothing else moves. No particles, no screen shake, no bloom on the grid itself — that is
  what makes this look cheap rather than sharp.

### HUD
One thin bar, top of screen, outside the field:
`[B score] · [Create Wall (B)] · [match clock] · [Create Wall (A)] · [A score]`
plus, on the field itself: the **ARMED** indicator beside the acting player's edge, and the
draining **turn-timer bar** along that same edge in their colour.

The **ARMED** indicator is essential: it is the only readout of the single most confusing
piece of state in the game. When armed, also draw a faint glow ring on the goal the player
may shoot at.

---

## 11. `CONFIG` — every tunable in one object

```js
export const CONFIG = {
  field:   { w: 10, h: 14, goalWidth: 3, mode: 'arena' },   // 'arena' | 'void'
  modes:   { arena: {}, void: { voidPenalty: 'goal' } },     // per-mode overrides
  piece:   { radius: 0.4, count: 3 },
  input:   { maxPull: 6.0, minPull: 0.3 },
  physics: { maxSpeed: 26, drag: 1.45, restRail: 0.60, restWall: 0.75,
             restThreshold: 0.15, dt: 1/120, settleTimeout: 6.0 },
  rules:   { goalsToWin: 3, strictContact: true },
  wall:    { length: 2, clearance: 2.0, thickness: 0.18 },   // one permanent wall per player — no uses budget (§7)
  timers:  { turnSeconds: 20, matchSeconds: 300, matchClockEnabled: true },
}
```
Every one of these will be changed during playtesting. If a number is not reachable from
this object, it is a bug.

---

## 12. Build order

Each step must be playable or visible before moving on.

1. **Field.** Canvas, scaling, grid, goals, colours. No interaction.
2. **Launch.** Three circles, drag-to-aim with the 6-cell cap, physics, rails, rest
   detection. Any circle, any time, no rules. *This is the step where the game either feels
   good or does not — spend time here.*
3. **Rules.** Pass detection, armed state, turn machine, contact turnover, HUD.
4. **Goals.** Scoring, kick-off reset, first-to-3, win overlay.
5. **Timers.** Turn timer, then match clock (§8).
6. **Wall.** Placement UI, legality, collision, one permanent wall per player.
7. **VOID mode.** The second field: no rails, falls, the penalty, the ledge visual, and a
   mode toggle before the match. One branch in the collision code — not a second game.
8. **Polish.** Trails, pass flash, goal flash, illegal pulse, the derez fall.

---

## 13. Acceptance tests

Manual, run on a phone. All must pass.

1. Pulling back 3 cells launches at roughly half the speed of pulling back 6 cells.
2. Pulling back 10 cells behaves **identically** to pulling back 6 cells, and the aim line
   stops growing at 6.
3. ARENA: a full-power shot into a rail bounces and does not escape the field.
3b. VOID: a full-power shot off the side falls, concedes a goal, and all three circles are
    back on the field for the next turn.
3c. Switching mode between matches changes nothing else about the rules.
4. Launching a circle so it passes between the other two, without touching them, keeps the
   turn and lights ARMED.
5. Launching a circle into the goal while **not** armed does not score, and the turn ends.
6. Launching a circle into the goal while armed scores, and kick-off gives the turn to the
   conceding player.
7. Grazing another circle ends the turn even if the pass line was crossed.
8. A wall cannot be confirmed within 2 cells of any circle, either goal, or the other
   player's wall, and the illegal state is visible before confirming.
9. A circle at rest never ends up overlapping a wall or a rail.
10. Each player can place their wall exactly once; once placed, "Create Wall" is no longer
    available to them, the wall persists after a goal, and only "Play again" clears it.
11. Three consecutive goals ends the match with the overlay.
12. The turn timer restarts on every completed pass, pauses while circles are moving, and
    forfeits the turn at zero.
13. With the match clock at 0:00 and the score level, play continues until the next goal.
14. Nothing in the game is unreachable from `CONFIG`.

---

## 14. Known open questions — do not invent answers, flag them

- Whether **continue-on-success** produces turns so long that the second player disengages.
  Instrument it: log the number of flicks per turn to the console. If the median is above
  6, the rule needs a cap.
- Whether **strict contact** is too punishing for a new player.
- Whether the wall is fun or merely obstructive. It is the last thing built for exactly this
  reason.
