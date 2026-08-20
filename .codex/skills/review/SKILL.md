---
name: review
description: Run Akh Sheli's read-only quality, security, and regression review. Use for `/review` or before a release.
---

# Review

1. Identify the exact diff and affected behavior.
2. `reviewer` performs a read-only quality/correctness pass, including the headless-simulation boundary and focused test coverage.
3. `sentinel` performs a read-only security/regression pass and checks whether browser smoke coverage is required.
4. Reviewers report file-and-line evidence; Forge applies any fixes and resubmits.

Output both gates:

```text
REVIEWER CLEAR | REVIEWER BLOCK — [file:line evidence]
SENTINEL CLEAR | SENTINEL BLOCK — [file:line evidence]
```

Any blocking finding prevents release. Review agents do not edit production code.
