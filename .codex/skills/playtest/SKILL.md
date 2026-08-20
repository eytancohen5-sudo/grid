---
name: playtest
description: Run a structured GRID playtest. Use for `/playtest` or when evaluating a mechanic, balance change, or player-facing interaction.
---

# Playtest

1. Name the exact environment/build and feature under test.
2. `designer` defines the scenario, expected rules, and what player behavior would support or weaken the design hypothesis.
3. `sentinel` requires a runnable build and no known blocker in the tested path.
4. Run the scenario. Record observations without converting them into rule changes on the fly.
5. Return:

```text
PLAYTEST — [environment / commit]
SCENARIO — [setup and actions]
EXPECTED — [designer-authored result]
OBSERVED — [what happened]
RESULT — PASS | FAIL | INCONCLUSIVE
ISSUES / BALANCE NOTES — [evidence]
NEXT RULING NEEDED — [designer or Eytan, if any]
```

A failed build, Sentinel block, or mismatch with the intended rule stops the playtest and is reported directly.
