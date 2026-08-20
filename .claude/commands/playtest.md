# /playtest — Structured Playtest Session

## Steps

1. Define scope: which build, which feature/level/mechanic is under test
2. `designer` reviews: does the build match the intended mechanics/rules/balance?
3. Sentinel confirms: no known blocking bugs before the session starts
4. Execute: run the build, log bugs and balance feedback as they occur
5. Report to Eytan: what was tested, bugs found, balance notes, anomalies

## Hard stops — do NOT proceed if:
- Sentinel has an open BLOCK on the build
- `designer` flags the build as not matching the intended mechanics
- The build doesn't actually run (report the failure instead of testing around it)
