# AGENTS.md — Akh Sheli

Canonical project governance for Codex and compatibility sessions.

## 1. Project identity

- **Project:** Akh Sheli
- **Current playable:** **GRID**, a two-player, one-device hot-seat physics tactics game.
- **Core loop:** launch one of three shared circles; complete a clean pass to arm the attack; score through the opponent's goal. Each player starts with a wall that can be moved or removed on their turn.
- **Purpose of v1:** learn whether the pass gate plus player-controlled walls is fun.
- **Platform:** web first; iOS/Android wrappers may follow later (`docs/adr/0001`).
- **Stack:** plain HTML, CSS, ES modules, and Canvas 2D; zero dependencies and no build step (`docs/adr/0002`).
- **Persistence/backend:** none. No accounts, network play, or saved state.
- **Observed live surfaces, HTTP 200 verified 2026-08-20:**
  - GitHub Pages: `https://eytancohen5-sudo.github.io/grid/`
  - 10seconds mirror: `https://10seconds.com/grid/`

These URLs prove a surface exists; they do not establish release authority or a deploy command.

## 2. Repository layout and sources of truth

- `index.html`, `styles.css` — page shell and HUD styling
- `js/config.js` — tunable constants
- `js/vec.js`, `js/physics.js`, `js/rules.js` — headless simulation and rules
- `js/render.js`, `js/input.js`, `js/main.js` — Canvas rendering, input, and wiring
- `test.js` — plain Node assert harness
- `BUILD_SPEC.md` — v1 base specification
- `DOUBTS.md` — implementation/playtest decisions and known judgment calls
- `docs/adr/` — accepted architecture decisions
- `.codex/agents/*.toml` — canonical Codex runtime agent definitions
- `.codex/agents/*.md` — non-authoritative migration references
- `.codex/skills/*/SKILL.md` — project workflows
- `.claude/` and `CLAUDE.md` — Claude compatibility only; `AGENTS.md` wins on conflict

**Known product-spec drift:** `BUILD_SPEC.md` §7 still describes the earlier one-shot permanent-wall rule. The current code/tests and the latest entries in `DOUBTS.md` implement Eytan's later ruling: both walls start pre-placed and may be moved or removed. Reconcile that section with `designer` before implementing further wall changes.

## 3. Team and routing

`@champ` is the mandatory entry point for every main-thread session. No file read, command, or other dispatch occurs before Champ emits the routing plan.

| Agent | Ownership |
|---|---|
| `champ` | Decomposes and routes; never implements. |
| `challenger` | Reviews non-trivial plans before production code. Read-only. |
| `designer` | Authors gameplay mechanics, balance, progression, and rules. |
| `artdirector` | Authors game visual direction, HUD/UI, feedback, and player flow. |
| `forge` | Only agent that writes production game code. |
| `reviewer` | Reviews correctness, clarity, and maintainability. Read-only. |
| `sentinel` | Security and QA gate; owns smoke tests and blocks release. |
| `atlas` | Owns configuration, future save-state, hosting, and releases after clearance. |
| `scribe` | Records architecture decisions in `docs/adr/`. |

Standard production flow:

```text
champ → challenger → forge → reviewer → sentinel → atlas
```

`designer` and `artdirector` author player-facing requirements before Forge implements them. For a trivial, read-only task, Champ may route the main thread to answer directly without further ceremony.

## 4. Session rules

1. One app per session: `.` (Akh Sheli root).
2. Champ emits the plan; the main thread executes it.
3. Challenger approval precedes production-code edits.
4. Any rollback, removal, or cancellation decision is persisted before the session ends.
5. Architecture, hosting, save-data, external-integration, or team-structure decisions get an ADR.
6. Preserve unrelated work. Eytan runs parallel sessions; use a dedicated `/tmp` worktree for edits and never overwrite a dirty file you did not create.

## 5. Build and verification

Run locally:

```sh
python3 -m http.server 8000
```

Required automated check:

```sh
node test.js
```

The current harness has 67 assertions. Nothing in `js/vec.js`, `js/physics.js`, or `js/rules.js` may import the DOM or Canvas; the shipping simulation must remain runnable headlessly in Node.

Core gameplay changes require both the headless suite and a real pointer/hit-testing check in a browser. Calling `element.click()` alone does not prove a control is tappable.

## 6. Project workflows

| Workflow | Contract |
|---|---|
| `/review` | Reviewer quality pass, then Sentinel security/regression gate. |
| `/smoke-test` | Headless suite plus applicable local browser assertions; unavailable required checks block. |
| `/playtest` | Designer-authored scenario, Sentinel gate, observed-vs-expected report. |
| `/deploy` | Currently blocked; see below. |

## 7. Deploy protocol

`origin` is `https://github.com/eytancohen5-sudo/grid.git`, and `main` tracks `origin/main`. GitHub Pages and 10seconds are observed live surfaces, but this repository does not document:

- a staging lane;
- verified hosting ownership and exact release mechanics;
- the separate repository/file-copy procedure used for `10seconds.com/grid`.

Therefore `/deploy` must return `BLOCK` and must not push or publish until Atlas documents those items and Scribe records the hosting decision. Never infer that pushing `main` is an authorized release procedure. Never deploy the 10seconds mirror from this repository.

Once configured, the gate is: commit → tests → Reviewer clear → Sentinel clear → automatic staging deploy → report exact staging URL → wait for Eytan's explicit production approval → production deploy → verify exact production URL → push the committed release if not already pushed. Never force-push.

## 8. Security and stewardship

- Never commit `.env*`, credentials, tokens, API keys, or service-account files.
- No dependencies are currently allowed; any proposal to add one must amend ADR-0002 and follow the global supply-chain policy.
- High-scrutiny gameplay files: `js/config.js`, `js/vec.js`, `js/physics.js`, and `js/rules.js`. Changes require the full test suite and Sentinel review.
- If persistence, accounts, networking, leaderboards, or backend services are introduced, Atlas defines the data/access model and Sentinel updates this section before release.

## 9. Current workstream

GRID v1 is playable. The active product loop is playtest → designer ruling → challenged implementation → browser/headless verification. Do not add AI opponents, online play, progression, accounts, sound, persistence, or native tooling unless Eytan opens that workstream.
