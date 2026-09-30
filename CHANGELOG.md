# Changelog

## 0.2.1

- **Boots wait for the startup sweep.** `startConductor` ran `provisioner.sweep()` at startup without waiting for it, so a session booted right after a conductor restart could race it. With the Docker Provisioner, the sweep could then remove the new session's containers and network mid-boot. A boot now waits for the sweep before `ensureBuilt`, and the harness shows `waiting for startup cleanup…` while it does. The wait counts in the first step's time and the boot's: a boot sends its `ensuring-image` step event once (0.2.0 sent it twice). A failed sweep, including one that throws synchronously or rejects with something other than an `Error`, is logged and doesn't block boots. A teardown or takeover during the wait cancels the boot as before.

## 0.2.0

- Built-in `adapters/provisioner-process` (panes as local process groups) and `adapters/build-worktree` (PR checkout and install behind a trust gate).
- A harness that is safe on a laptop: loopback binding by default, a `Host` allowlist (`421`), same-origin (`403`) and JSON-only (`415`) writes, frame-locked panes and inert rendering of adapter text.
- Core: cancellation threaded through every seam, display labels, failure log tails, build progress messages, `blocked` readiness and a graceful `shutdown()`.
- Demo mode (`npm run demo`) and self-QA of this repo's own PRs (`npm run qa`).
