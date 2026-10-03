# STATE — Akh Sheli

Read first, update last (AGENTS.md, "How a session works"). Written 2026-10-03 by the lean-setup session
from the project files, git and the waiting list; nothing was checked against the live sites today.

## Live now
- Two surfaces and no deploy command (AGENTS.md §1, §7): GitHub Pages https://eytancohen5-sudo.github.io/grid/
  and the 10seconds mirror https://10seconds.com/grid/. `/deploy` returns BLOCK; never treat a push to `main`
  as a release; never deploy the 10seconds mirror from this repository.
- Serving commit: unknown — the next session fills this in. The waiting list (2026-09-19, a note, not
  re-checked) says GitHub Pages serves the polish pass `e3589c7` and 10seconds.com/grid still serves the
  2026-08-20 build. `main` is now `d54c781`, which changed one agent file only, so the game files equal `e3589c7`.
- This project has no `.claude/state/live-prod-sha` and no deploy record.

## Current task
- Paused since 2026-09-21 at Eytan's request ("pause properly all agents for now"); it restarts on his word
  "resume" (waiting list).
- Last finished: the lean setup (branch `lean-setup-2026-10-03`, not merged): six roles archived, no
  coordinator step; the main window runs `node test.js` and the real pointer/hit-test check itself.

## Next
1. On "resume": the restart steps are in memory, `project_grid_feedback_build_plan.md` ("PAUSED 2026-09-21").
   It names an independent review and security gate; under the lean setup the main window runs the checks.
2. Three finished pieces from 2026-09-20 (freeze fix, board colour plus big clock, identical results on every
   phone) were never committed. Their `/tmp` working folders are gone (checked 2026-10-03); the copies are
   backup patches in `~/.claude/projects/-Users-esmacbookprom2-Claude-Projects-Akh-Sheli/backups/`
   (`2026-09-21-steps-1-2/` and `2026-09-21-attempts/`).
3. Then Eytan's rulings below: board look, wall rule, online play, a 10seconds copy.

## Waiting on Eytan (top 3 — the full list is `waiting_on_eytan.md` in the project's memory folder)
1. Say "resume" to restart the paused work (added 2026-09-21).
2. Pick the board look (A violet or B grey-slate), keep or revert the amber clock fix, and say "commit" for the
   three finished pieces (added 2026-09-20).
3. Six rulings on the stakeholder feedback and online play, starting with who plays whom online
   (added 2026-09-19).
