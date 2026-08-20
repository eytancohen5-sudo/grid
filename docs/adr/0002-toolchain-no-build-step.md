# ADR-0002: Toolchain — no build step, no dependencies

**Date:** 2026-08-19
**Status:** Accepted
**Deciders:** Eytan

## Context

ADR-0001's Decision line bundled two separate things: a **platform roadmap** (web first, native ports later) and a **toolchain** (TypeScript + Vite + HTML5 Canvas). Only the roadmap was a considered decision. ADR-0001's own Context says the only scope Eytan had given at the time was "gaming" — the toolchain half was a bootstrap default, picked to have something to scaffold `forge`/`atlas` around before any concept existed, not a decision made against real requirements.

The project now has a real spec. `BUILD_SPEC.md` §1 (Stack) mandates plain HTML + ES modules + Canvas 2D — zero dependencies, no build step, no framework, run with `python3 -m http.server 8000` and tested on a phone over the LAN. It rejects Unity and Godot directly (project scaffolding, binary scene files, and an export step slow down AI-assisted iteration) and rejects a physics library like matter.js or planck (the whole sim is ~150 lines of collision code; hand-rolling it keeps it deterministic and debuggable, which BUILD_SPEC.md §5 requires — identical inputs must produce identical outcomes). Vite is a build step and pulls in npm — it has no place in a zero-dependency stack, so the toolchain clause of ADR-0001 is dead.

The platform roadmap is unaffected: BUILD_SPEC.md §1 keeps the native path open the same way ADR-0001 already did ("If this ships to app stores later, wrap it in Capacitor; the game code does not change"). Eytan's instruction was explicit: supersede the toolchain clause only — what ADR-0001 decided about platform "is still right and is not in conflict."

## Decision

ADR-0002 partially supersedes ADR-0001 — **the toolchain clause only.** The build toolchain for GRID is plain HTML + ES modules + Canvas 2D: zero dependencies, no build step, no framework, served with `python3 -m http.server 8000`. ADR-0001's platform roadmap (web first, then iOS/Android via a wrapper) stands unchanged and is not in conflict.

## Options considered

### Option A — Plain HTML + ES modules + Canvas 2D
Pros: zero install step, runs from a static file server, no npm supply chain to audit, matches BUILD_SPEC.md §1 exactly, trivial to test on a phone over LAN, keeps the physics hand-rolled and deterministic.
Cons: no compiler-enforced type checking; no bundler, so every module is a separate HTTP request (irrelevant at this project's size — eight small files).

### Option B — Keep TypeScript + Vite (ADR-0001's original clause)
Pros: type safety, dev-server niceties, a bundled build.
Cons: introduces npm and its supply-chain surface where BUILD_SPEC.md requires zero dependencies; a build step BUILD_SPEC.md explicitly rejects; solves problems (bundling, HMR) this project's size doesn't have.

Eytan chose Option A.

## Consequences

**Positive:** No npm supply chain to audit for the game client. Nothing between "edit a file" and "see it on the phone" except a page refresh. `forge` now has one source of truth (BUILD_SPEC.md) instead of two disagreeing ones.

**Negative:** No npm means no Vitest. Determinism verification (BUILD_SPEC.md §5) uses a plain `node test.js` assert harness — no framework, no runner. That forces a hard constraint: **nothing under the sim module (`js/vec.js`, `js/physics.js`, `js/rules.js`) may import from the DOM or canvas**, so the exact shipping physics runs headless in Node for that harness to work at all.

Dropping TypeScript costs type safety on a physics solver — exactly the code where a silent type error is most expensive. Recovered without a build step via `// @ts-check` plus JSDoc types on `js/vec.js`, `js/physics.js`, and `js/rules.js`. This is a real but partial fix, stated plainly: `// @ts-check` is read by the editor's language service only. There is no CI or commit-time enforcement without running `tsc`, which would reintroduce npm — this is editor-time safety, not a gate.

**Risks:** A type error can ship if the editor isn't open to catch it, or a contributor's editor doesn't surface `// @ts-check` warnings. Mitigation: `reviewer`/`sentinel` treat diffs to the three sim modules as higher-scrutiny reads, since there's no automated backstop. If this proves insufficient, the escalation path is a `tsc --noEmit` step in a pre-commit hook — an npm devDependency only, not a runtime dependency or a shipping build step — and should go back to Eytan as a proposed amendment rather than being added unilaterally.

## Related

`BUILD_SPEC.md` §1 (Stack) and §5 (Physics — determinism requirement). Supersedes the toolchain clause of `docs/adr/0001-platform-web-first-then-mobile.md`; that ADR's platform roadmap stands. Same sweep updated `.claude/agents/forge.md`, `.claude/agents/atlas.md`, `.claude/agents/champ.md`, and `CLAUDE.md` §7 to match the confirmed stack.
