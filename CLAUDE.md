# CLAUDE.md — Akh Sheli

Source of truth for all agents and the main Claude Code session.

## 1. Project identity

- **Project:** Akh Sheli — a game. Concept, genre, and theme are not yet defined beyond "gaming."
- **Operator:** Eytan
- **Mission:** Build and ship Akh Sheli — a game. Platform roadmap is set (web first, then iOS/Android — see `docs/adr/0001`), but the core loop, genre, and theme still need to be pinned down with `designer`. That's the first real task for the team.
- **Live URL:** none yet — no deploy target configured
- **Apps in scope:**
  - `.` — the game itself (client, assets, game logic). Single-app repo.

## 2. Repository layout

Empty as of bootstrap — only `.claude/` and this file exist. No game code has been written yet.

## 3. Data sources

None yet. No save-data model, no backend, no external integrations.

## 4. Workstreams

None started. Roadmap: ship a web version first; iOS/Android ports come later (`docs/adr/0001`) — do not build platform-specific agents or tooling for mobile until that phase actually starts. First real workstream: `designer` and `artdirector` define the core game concept (genre, core loop, theme, visual style) with Eytan.

## 5. Team roster — Agents

All agents at `.claude/agents/`. Default entry point: **`champ`** (address as `@champ`).

| Agent | Role |
|---|---|
| `champ` | **Chief of Staff.** Mandatory first stop every session. Decomposes requests, emits routing plan. |
| `challenger` | **Adversarial plan reviewer.** Reviews champ's plan before forge builds. Read-only. |
| `forge` | **Fullstack builder.** Only agent that writes production code. |
| `reviewer` | **Code quality reviewer.** Idioms, naming, complexity — separate from sentinel. Read-only. |
| `sentinel` | **Security + QA guardian.** Block-deploy authority. Nothing ships without SENTINEL CLEAR. |
| `atlas` | **Infrastructure + data.** Save-state model, config, deploy pipeline. Runs releases after sentinel clears. |
| `designer` | **Game design.** Authors mechanics, progression, balance, and rules; engineering translates. |
| `artdirector` | **Art direction & player experience.** Authors visual style, UI/UX, and design specs. |
| `scribe` | **ADR writer.** Documents architecture-level decisions under `docs/adr/`. |

## 6. Command index

| Command | When to use |
|---|---|
| `/deploy` | Full release workflow — **not yet usable, no deploy target configured** |
| `/smoke-test` | Pre/post-deploy sentinel test protocol — placeholder until the core loop exists |
| `/review` | Pre-deploy code review: quality + security + regression risk |
| `/playtest` | Structured playtest session: scope → design check → sentinel gate → run → report |

## 7. Workflow conventions

### Standard build flow
```
champ → challenger → forge → reviewer → sentinel → atlas
```
Advisory/authoring: `designer`, `artdirector` in parallel when forge needs them.
scribe triggered for architecture-level decisions.

### Plan before code
champ emits routing plan → challenger reviews → forge builds. Never skip challenger.

### Business-led product work
Game concept, mechanics, and visual/UX vision are AUTHORED by `designer` / `artdirector`; forge and atlas translate requirements into code. These agents are never staffed as mere reviewers of engineering-authored concepts.

### Security loop — two agents, never one
sentinel audits (read-only) → forge fixes. reviewer handles code quality separately.

### Deploy = commit first (inseparable, once a remote and deploy target exist)
```
git fetch && git pull --rebase origin main
git add <relevant files>
git commit -m "..."
[deploy staging]
[await Eytan's approval]
[deploy production]
git push origin main
```

### Architecture decisions get ADRs
champ triggers scribe when a decision is architecture-level. The stack/platform default chosen at bootstrap (see Section 9) is the first thing that needs an ADR once confirmed.

### Test runner
`node test.js` — a plain assert harness, no framework, no runner (`docs/adr/0002`). Hard constraint: nothing under the sim module (`js/vec.js`, `js/physics.js`, `js/rules.js`) may import from the DOM or canvas, so the exact shipping physics runs headless in Node.

## 8. Champion — session rules (non-negotiable)

1. **@champ first, every session, no exceptions.** No files read, no commands run, no agents dispatched until champ has decomposed the request and emitted a routing plan.
2. **One app per session.** Akh Sheli is a single-app repo (`.`) — this matters once the repo grows.
3. **Rollback decisions → memory before session ends.** Any roll-back, removal, or cancellation of a feature must be persisted to a `project_*.md` memory file before the session closes. Future sessions are blind to anything not on disk.
4. **Champ emits the plan; the main thread executes.** Champ cannot call Agent/Task — it routes, the thread dispatches.

## 9. Deploy protocol

**Not active yet.** No staging or production target is configured, and there is no git remote — only a local repo (`git init` was run at bootstrap on 2026-08-19; no remote added). Do not fabricate deploy commands or URLs. Once Eytan picks a hosting target:

1. Run staging deploy automatically once configured — do NOT ask permission each time
2. Report staging URL — **STOP and wait for Eytan's explicit go-ahead**
3. On Eytan's approval: run production deploy
4. Report production URL

**Never:**
- Say "want me to deploy to staging?" once this is live — just run staging
- Deploy production without Eytan's explicit approval in the current conversation
- Push to a remote that doesn't exist

## 10. Security posture

**Protected files:** none on record — no code exists yet. Sentinel should populate this table with real files (save-data format, config, any auth surface) as soon as they exist.

**Never commit:** `.env*`, service-account credentials, session tokens, API keys in plaintext.

**Operational fragilities:**
- No git remote — local commits only until Eytan adds one
- No deploy target — atlas/sentinel must not invent one
- Stack is confirmed (web first; iOS/Android later — `docs/adr/0001`). Deploy target still isn't chosen — see Section 9.

## 11. Glossary

| Term | Definition |
|---|---|
| **champ** | Chief of Staff — mandatory session entry point |
| **challenger** | Adversarial plan reviewer — stress-tests routing plans before code |
| **sentinel** | Security + QA guardian — SENTINEL CLEAR or SENTINEL BLOCK |
| **atlas** | Infrastructure + data — owns save-state model and runs releases |
| **designer** | Game designer — authors mechanics, progression, balance, rules |
| **artdirector** | Art director — authors visual style, UI/UX, player experience |
| **scribe** | ADR writer — Context / Decision / Consequences |
| **SENTINEL CLEAR** | Formal deploy clearance from sentinel |
| **SENTINEL BLOCK** | Deploy veto — forge must fix before proceeding |
| **SPEC** | Task validation: Specific, Programmatically evaluable, Explicit scope, Constrained output |
| **ADR** | Architecture Decision Record |
