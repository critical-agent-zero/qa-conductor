# Changelog

## Unreleased

- **Pane request guard** (from homefree #329). The proxy's jar signs every request in as the reviewer, so a pane now refuses what other pages make the reviewer's browser send: writes, preflights, CORS reads, WebSockets and subresource loads from anywhere but the pane's own pages, and navigations from another site that the harness didn't start (their `Referer` must be the harness origin). `same-site` counts as another site, since every loopback port and every tailnet host is same-site.
- **Pane framing.** Every pane response carries `frame-ancestors 'self' <harness origin> <QA_FRAME_ANCESTORS…>` in place of the app's own `frame-ancestors` and `X-Frame-Options`, plus `nosniff`, the proxy's own `403`, `421`, `502` and `503` included. 0.2.1 added a loopback-and-allowed-hosts policy on any port beside the app's, so any local page could frame a pane, and an app that denied framing couldn't be framed at all.
- **Harness frame lock.** Every harness response sends `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN` and `Referrer-Policy: strict-origin-when-cross-origin`.
- **Harness API guard.** Every `/api/*` request, reads and the progress stream included, must be same-origin (0.2.1 checked writes only). A browser must also reach the API at the harness origin's host and port (`403 not the harness origin`), so a stale front-door handler on another port can't hand it to the pages that share its origin. Loopback `Host`s and non-browser clients are exempt.
- **`data-harness` replaces `#qa=`.** The harness loads landing URLs unchanged; the proxy puts the harness origin on the injected bridge tag, and the bridge talks only to its parent frame at that origin. Anyone could write the fragment, so the PR pane could frame the base pane with its own origin and drive it. AuthBootstrap landing flows must now stay on the pane origin.
- **`QA_HARNESS_ORIGIN` and `QA_FRAME_ANCESTORS`** (`cfg.harnessOrigin`, `cfg.frameAncestors`). The harness origin defaults to `https://<QA_PUBLIC_HOST>:8444`, else the loopback listen address, and is derived from the bound port on port `0`. Open the harness there: anywhere else it shows a banner and the panes refuse it. Every origin key is validated and normalized, the harness and the two panes must be three different origins, and `startConductor` refuses a harness origin equal to a pane origin. `/api/state` reports `harnessOrigin`, and startup logs it.
- **The jar no longer filters by SameSite.** After the guard, it only filtered the harness's own cross-site iframe loads, which signed the pane out. `parseSetCookie` drops `sameSite`; `./proxy` drops `isCrossSite` and `frameAncestors`, and gains `panePolicy`; `createPaneProxy` gains `harnessOrigin` and `frameAncestors`, each a value or a function read per request.
- **Self-QA and the demo.** `startDemo` and `npm run demo` take the harness origin and frame ancestors, and self-QA passes its inner demos the pane's origin and the outer harness origin, so nested panes still render and mirror.

## 0.2.1

- **Boots wait for the startup sweep.** `startConductor` ran `provisioner.sweep()` at startup without waiting for it, so a session booted right after a conductor restart could race it. With the Docker Provisioner, the sweep could then remove the new session's containers and network mid-boot. A boot now waits for the sweep before `ensureBuilt`, and the harness shows `waiting for startup cleanup…` while it does. The wait counts in the first step's time and the boot's: a boot sends its `ensuring-image` step event once (0.2.0 sent it twice). A failed sweep, including one that throws synchronously or rejects with something other than an `Error`, is logged and doesn't block boots. A teardown or takeover during the wait cancels the boot as before.

## 0.2.0

- Built-in `adapters/provisioner-process` (panes as local process groups) and `adapters/build-worktree` (PR checkout and install behind a trust gate).
- A harness that is safe on a laptop: loopback binding by default, a `Host` allowlist (`421`), same-origin (`403`) and JSON-only (`415`) writes, frame-locked panes and inert rendering of adapter text.
- Core: cancellation threaded through every seam, display labels, failure log tails, build progress messages, `blocked` readiness and a graceful `shutdown()`.
- Demo mode (`npm run demo`) and self-QA of this repo's own PRs (`npm run qa`).
