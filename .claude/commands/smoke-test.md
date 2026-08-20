# /smoke-test — Production Smoke Test Protocol

**Placeholder.** No build exists yet, so priorities below are generic game-app defaults — sentinel should rewrite Priority 1 once the actual core loop (from `designer`) is known.

## Priority 1 — Core feature (must PASS before any deploy)
[TBD once the core game loop is defined — e.g. "a full play session can be started and completed without a crash"]
- Confirm it loads without error
- Confirm a representative play session completes successfully
- Confirm error states are handled, not silently swallowed

## Priority 2 — Save/state integrity (must PASS, once persistence exists)
- Progress/save data survives a reload
- No data corruption on interrupted sessions

## Priority 3 — Build health (should PASS)
- No console errors on load
- No 404s for static assets
- Styles/assets render correctly

## Priority 4 — Mobile / small-screen (should PASS if the confirmed platform includes it)
- Playable on small screens (375px) if web-based and mobile is in scope

## Output format
```
SMOKE TEST RUN — [date]
[TEST NAME] — PASS / FAIL / SKIP + reason

OVERALL: SENTINEL CLEAR / SENTINEL BLOCK
```
Priority 1–2 FAIL → SENTINEL BLOCK.
