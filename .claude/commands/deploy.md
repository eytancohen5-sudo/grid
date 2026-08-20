# /deploy — Production Release Workflow

**Not yet usable.** Akh Sheli has no deploy target (no hosting choice, no staging/production URL) and no git remote. Before this command can run for real, atlas needs a confirmed hosting target and scribe should log the choice as an ADR. Treat any invocation of this command today as a prompt to go configure that first, not to fabricate a command.

## Pre-flight (once a target exists)
1. `cd .` (Akh Sheli root — single-app repo)
2. `git fetch && git pull --rebase origin main` (once a remote exists)
3. Test suite — must pass clean
4. Confirm SENTINEL CLEAR is in hand — if not, run /smoke-test first

## Deploy
5. Staging (automatic — no asking, once configured)
6. Report staging URL — **STOP and wait for Eytan's explicit go-ahead**
7. On Eytan's approval: production deploy
8. Report production URL

## Post-deploy
9. `git push origin main` (once a remote exists)
10. Ask sentinel to run /smoke-test to confirm production healthy
11. Report to Eytan: what shipped, any known caveats

## Safety rules
- Staging is automatic once configured — do NOT ask permission before running it
- Never deploy production without Eytan's explicit approval
- Never force-push to main
- Never skip or suppress build errors
- Never invent a deploy command that isn't actually wired up
