# ADR-0001: Platform roadmap — web first, then iOS/Android

**Date:** 2026-08-19
**Status:** Accepted
**Superseded in part by:** ADR-0002 (toolchain only; platform roadmap stands)
**Deciders:** Eytan

## Context

Akh Sheli started as a completely empty project — no code, no README, no stated platform. The team bootstrap needed a stack to scaffold `forge`/`atlas` around, and the only scope Eytan had given was "gaming."

## Decision

Build a web version first (TypeScript + Vite + HTML5 Canvas). iOS and Android ports come later, once the web version exists. Platform-specific agents and tooling for iOS/Android are **not** created now — they get added when that phase actually starts, not speculatively.

## Options considered

### Option A — Web first, then native ports
Pros: fastest to prototype, previewable directly in-browser right now, validates the game concept before committing to native/cross-platform tooling.
Cons: the eventual iOS/Android port is separate work, not automatic — depends on how the web version is built (wrapped vs. rewritten).

### Option B — Cross-platform from day one (React Native / Unity / etc.)
Pros: one build target for all three platforms eventually.
Cons: heavier toolchain commitment before the actual game concept (genre, core loop) even exists — premature investment.

Eytan chose Option A.

## Consequences

**Positive:** Fast iteration on the actual game concept before any platform-specific investment. Matches the tooling already available (in-browser preview).
**Negative:** Porting to iOS/Android later may require rework depending on how the web build is structured — not yet decided.
**Risks:** If the web prototype leans on browser-only APIs, the later port gets harder. `designer` and `forge` should keep game logic reasonably decoupled from rendering where it's free to do so, without over-engineering for a port that isn't scheduled yet.

## Related

Team bootstrap session, 2026-08-19. See `project_bootstrap.md` in the project memory directory.
