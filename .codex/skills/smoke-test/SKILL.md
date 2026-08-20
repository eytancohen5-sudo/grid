---
name: smoke-test
description: Run Akh Sheli's headless and local-browser smoke checks. Use for `/smoke-test`, release gates, or gameplay regression verification.
---

# Smoke test

## Required checks

1. Run `node test.js`; every assertion must pass.
2. When the diff affects UI, input, rendering, or gameplay wiring, serve the repo with `python3 -m http.server 8000` and verify in a real browser:
   - the match loads without console errors or missing assets;
   - the intended pointer/touch target wins hit-testing (`elementFromPoint` or a real pointer action), not merely `element.click()`;
   - one representative flick resolves correctly;
   - wall move, remove, rotate, confirm, and cancel behavior affected by the diff works on the owning player's turn;
   - a 375px-wide viewport remains playable when layout is affected.
3. Record required checks that could not run as `BLOCK`, not silent skips.

Output:

```text
SMOKE TEST — [environment]
[assertion] — PASS | FAIL | BLOCK — [evidence]
OVERALL — SENTINEL CLEAR | SENTINEL BLOCK
```

This workflow verifies a local or named deployed artifact; it does not authorize deployment.
