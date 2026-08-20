# /review — Pre-Deploy Code Review

## Trigger when:
- forge has finished a feature
- A bug fix touches core game logic or any save/persisted state
- Any change to a file sentinel has flagged as protected (none on record yet — see sentinel.md)

## Step 1 — reviewer (code quality)
Idiomatic code, naming, complexity, dead code, test coverage.

## Step 2 — sentinel (security)
No new secrets, narrow access to any persisted state, OWASP Top 10 where applicable.

## Step 3 — regression risk
- Touches core gameplay? → Run Priority 1 smoke tests
- Touches save/state? → Run Priority 2 smoke tests

## Clearance required
`REVIEWER CLEAR` + `SENTINEL CLEAR` → atlas may deploy.
Either `BLOCK` → forge fixes, re-submits.
