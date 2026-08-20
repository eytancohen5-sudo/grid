---
name: deploy
description: Run Akh Sheli's gated release workflow. Use for `/deploy` or any request to publish GRID.
---

# Deploy

## Current contract: BLOCK

Two live surfaces were verified on 2026-08-20:

- `https://eytancohen5-sudo.github.io/grid/`
- `https://10seconds.com/grid/`

They are observations, not release authorization. This repository does not yet document a staging lane, hosting ownership, exact publish commands, or the separate repository/file-copy procedure for the 10seconds mirror.

Return:

```text
DEPLOY BLOCK — Atlas must document staging, hosting ownership, exact release and rollback commands, and the 10seconds repository boundary; Scribe must record the hosting decision.
```

Do not push or publish as part of resolving this block. Never infer that a push to `main` deploys GitHub Pages, and never deploy the 10seconds mirror from this repository.

## Contract once Atlas activates the protocol

1. Fetch and rebase on `origin/main`; never force-push.
2. Commit the exact release diff.
3. Require `node test.js`, Reviewer clear, and Sentinel clear.
4. Deploy staging automatically with the documented command.
5. Verify the affected behavior at the exact staging URL and report it.
6. Stop for Eytan's explicit production approval.
7. Deploy production with the documented command, verify the exact URL, then push the committed release if needed.

Any missing command, target, rollback, clearance, or verification is `DEPLOY BLOCK`.
