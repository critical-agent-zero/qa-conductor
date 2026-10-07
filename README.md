# qa-conductor

A side-by-side PR-QA harness. For a pull request it boots two copies of your app: **base** (what's live now) and **PR** (the branch). Each runs against its own clone of real data, behind proxies that mirror scrolling and navigation between the two panes. A reviewer drives both at once and posts a verdict (a comment plus a label) back to the PR.

The conductor owns the choreography: session state, cancellation, the harness UI and API, the pane proxies and the verdict. Everything about *your* app and infrastructure comes from five adapters you supply, plus an optional sixth, [Exposure](#exposure-optional), through which the conductor publishes itself on a front door such as `tailscale serve`.

> **Status: 0.x.** The interface may still change while a second consumer is integrated, and a 0.x minor version may break it: read the migration notes in [CHANGELOG.md](CHANGELOG.md) before upgrading.

## Install

```sh
npm install @critical-labs/qa-conductor
```

Consumers that pin a git tag may keep doing so:

```sh
npm install github:critical-labs/qa-conductor#v0.3.0
```

Node ≥ 22. There are no runtime dependencies.

### Entry points

| Import | Exports | |
|---|---|---|
| `@critical-labs/qa-conductor` | `startConductor` | the conductor: harness, pane proxies, sessions, the exposure loop ([Use](#use)) |
| `@critical-labs/qa-conductor/config` | `loadConfig`, `parseEnvFile`, `defaultExposure`, `defaultHarnessOrigin`, `isExposureInterval`, `EXPOSURE_MODES`, `EXPOSURE_INTERVAL_RULE`, `MAX_EXPOSURE_INTERVAL_MINUTES`, `HARNESS_PATH` | reading `.env.qa` into `cfg` ([Configuration](#configuration)), and the rules it checks |
| `@critical-labs/qa-conductor/session` | `bootSession`, `teardownSession`, `createSession`, `reduce`, `touch`, `isIdle`, `ROLES`, `PANE_STAGES`, `parseEnv`, `renderEnv`, `migrateImageFor` | the boot sequence and session state the conductor runs, and helpers for adapters: parsing and rendering env file text, and the `migrate-<tag>` image beside an app image |
| `@critical-labs/qa-conductor/github` | `createGithub` | the GitHub effect wrapper |
| `@critical-labs/qa-conductor/docker` | `createDocker` | the Docker effect wrapper |
| `@critical-labs/qa-conductor/exec` | `makeExecFileFn` | the `execFile` effect wrapper |
| `@critical-labs/qa-conductor/identity` | `normalizeLogins`, `refusalReason`, `isAllowed`, `identityGate` | the [Tailscale identity gate](#security) |
| `@critical-labs/qa-conductor/exposure` | `mountsFor`, `reconcileExposure`, `runExpose` | one [exposure](#exposure-optional) pass, outside a conductor |
| `@critical-labs/qa-conductor/proxy` | `createPaneProxy`, `panePolicy`, `parseSetCookie`, `isAllowedHost`, `requestHostname`, `misdirected` | the pane proxy, and the [Host allowlist](#security) check every server runs |
| `@critical-labs/qa-conductor/verdict` | `formatVerdict`, `postVerdict` | the verdict comment and label |
| `@critical-labs/qa-conductor/adapters/provisioner-docker` | `createDockerProvisioner` | a Provisioner for docker-sibling deployments |
| `@critical-labs/qa-conductor/adapters/provisioner-process` | `createProcessProvisioner` | a Provisioner for local process groups |
| `@critical-labs/qa-conductor/adapters/build-worktree` | `createWorktreeBuild`, `trustDecision` | a BuildConvention that runs PRs from git worktrees, behind a trust gate |
| `@critical-labs/qa-conductor/adapters/exposure-tailscale` | `createTailscaleExposure` | an Exposure adapter on `tailscale serve` |
| `@critical-labs/qa-conductor/package.json` | *(the manifest)* | |

Each row lists every name its entry point exports, and no other entry point is exported. The package also installs one bin, `qa-conductor-expose`, the [expose CLI](#expose-cli), for operators.

## Use

```js
import fs from 'node:fs'
import { startConductor } from '@critical-labs/qa-conductor'
import { loadConfig } from '@critical-labs/qa-conductor/config'
import { createGithub } from '@critical-labs/qa-conductor/github'

const cfg = loadConfig('/path/to/.env.qa', { defaults: { QA_REPO: 'acme/widget' } })
const github = createGithub({ token: cfg.githubToken, repo: cfg.repo, qaLabels: [cfg.verdictLabels.accept, cfg.verdictLabels.reject] })

const conductor = startConductor({
  cfg,
  github,
  fsx: { readFile: p => fs.promises.readFile(p) },   // serves the harness UI files
  adapters: { provisioner, build, seed, envTransform, auth },   // and optionally exposure
  readBaseEnv: async () => ({ /* the env the pane env is derived from */ }),
})

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => conductor.shutdown().then(() => process.exit(0)))
}
```

`startConductor` serves the harness on `cfg.ports.harness` and one proxy per pane on `cfg.ports.base` / `cfg.ports.pr`, all on `cfg.host` (**`127.0.0.1` by default**). It returns `{ servers, stop(), shutdown(), exposure }`:
- `shutdown()` is the graceful exit. It stops the idle reaper and the [exposure loop](#exposure-optional), refuses harness writes from then on (`503`, so no new boot can start), tears the session down (aborting an in-flight boot and tearing down both panes), ends the progress streams, closes every connection and resolves once all three servers are closed. Call it from your signal handlers; calling it again is a no-op.
- `stop()` only stops the reaper and the exposure loop, and asks the servers to close.
- `exposure` is the exposure loop's handle, `{ ready, state(), reconcile() }`. `ready` resolves with the state after the first pass, or as it stands when `stop()` or `shutdown()` begins first (at once with no Exposure adapter). `state()` is the last pass, as `GET /api/exposure` reports it. `reconcile()` runs a pass now, or joins the one in flight; before all three servers listen there are no targets to mount yet, so it returns `ready`.

`cfg.paneOrigins` must be the URLs viewers actually reach the panes at, and `cfg.harnessOrigin` the one they open the harness at (see [Configuration](#configuration)). To reach the harness from anywhere but the machine it runs on, read [Security](#security) first, then either:
- put `tailscale serve` on the same host in front of these ports, in tailscale mode (`QA_EXPOSURE=tailscale`, the default for any layout that isn't loopback throughout): every server then answers only the Tailscale logins in `QA_ALLOWED_LOGINS`, and listens on loopback. Pass an [Exposure adapter](#exposure-optional) and the conductor sets up and keeps those mounts itself; or
- put another TLS front door that authenticates viewers in front of them, and set `QA_EXPOSURE=none`.

## Security

**The trust gate is the only real boundary between a PR's code and the reviewer's machine.** Booting a PR runs its code. A BuildConvention that checks out and installs PRs must refuse untrusted ones in `ensureBuilt`, before any git call. **Env scrubbing and loopback binding are defence in depth**, not a boundary.

The conductor's own defences in depth:
- **Tailscale identity gate.** In tailscale mode (`QA_EXPOSURE=tailscale`), the harness and both pane proxies answer `403` to any request whose `Tailscale-User-Login` isn't in `QA_ALLOWED_LOGINS` (matched ignoring case), before anything else runs. The gate wraps each whole server, so no route, present or future, runs for such a request, upgrades included, and the `403` still carries the harness frame lock or the pane's frame policy. `tailscale serve` sets that header from the device the request came from, strips any copy the client sent, and sets none for tagged devices, which are refused. An empty allowlist refuses everyone, so `loadConfig` refuses one in tailscale mode (`startConductor` only logs an error). The pane proxies drop every `Tailscale-*` header before the pane app sees the request. Other front-door headers pass through, such as `X-Forwarded-For`, which `tailscale serve` sets to the viewer's tailnet address: the pane app, PR code included, still sees which device is viewing.

  `QA_EXPOSURE` defaults to `tailscale` when anything the conductor answers to or listens on is off loopback: the harness origin, either pane origin, `QA_PUBLIC_HOST`, a `QA_ALLOWED_HOSTS` entry or `QA_BIND_HOST` (see [Configuration](#configuration)). Loopback layouts, such as `npm run qa` and the demo, stay ungated with no config.

  **The gate trusts the header from anything that can reach loopback on this host.** That is why tailscale mode requires a loopback bind: on any other address, a client could send its own login. It also means the gate keeps out other devices, not code on this one. With `provisioner-process`, the pane processes run PR code on the same host, as the same user, so they can reach loopback and send any login they like: in tailscale mode the gate does not protect against PR code, and only the BuildConvention's trust gate does. Container panes that aren't on the host network can't reach the host's loopback.
- **Loopback by default.** All three servers listen on `QA_BIND_HOST`, default `127.0.0.1`, and tailscale mode refuses any other address (`loadConfig` and `startConductor` throw). In none mode, anything other than loopback exposes an unauthenticated API that returns pane login URLs and posts verdicts with `GITHUB_QA_TOKEN`. A pane proxy *is* an authenticated pane session, because the proxy holds the pane's cookie jar. Widen the bind only in none mode, behind a firewall or an authenticating front door, and have viewers reach the harness and the panes over https (a plain-http origin must be loopback, see the pane request guard below).
- **Host allowlist.** Every server checks the `Host` header before routing (the harness does so before it even parses the request target) and answers `421` unless its hostname (port ignored, `[]` stripped) is `127.0.0.1`, `localhost`, `::1`, `QA_PUBLIC_HOST`, the hostname of the harness origin or of either pane origin, or an entry in `QA_ALLOWED_HOSTS`. This defeats DNS rebinding. A front door must pass the viewer's `Host` through, or rewrite it to a loopback `Host`. A rewritten `Host` that is allowed but not loopback (`qa-conductor:3100` behind nginx, say) clears this check, but every browser `/api/*` call then gets `403 not the harness origin` (see [Same-origin API](#security)).
- **Pane request guard.** The proxy holds each pane's cookie jar, so every request that reaches a pane acts as the reviewer, and the reviewer's browser sends requests for any page they have open. Loopback and the Host allowlist don't stop that. So a pane answers `403` to:
  - a write, a preflight, a CORS read or a WebSocket that doesn't come from the pane's own pages (`sec-fetch-site` `same-origin` or `none`, else an `Origin` whose host is the request's `Host`);
  - a subresource load (`<img>`, `<script>`, a no-cors fetch) from another site;
  - a navigation from another site, into a frame or top-level, unless its `Referer` is the harness origin, as it is for the harness's own iframes and "Open in new tab" links. A redirect the app answers such a navigation with keeps that `Referer` for the next hop, unless the redirect's own `Referrer-Policy` drops it, so the proxy removes that header from a redirect that stays on the pane.

  `same-site` counts as another site: on loopback every other port is same-site, and so is every host in a tailnet. A request the guard admits gets the whole jar.

  The guard works from Fetch Metadata (`sec-fetch-site`, `sec-fetch-mode`, `sec-fetch-dest`), which browsers send only to https and loopback origins. A request without it (curl, an older browser) is judged by its `Origin` alone, and another page's `<img>`, `<iframe>` or link sends no `Origin`. Over plain http on any other host, the guard couldn't tell those from curl, so `loadConfig` and `startConductor` refuse an `http:` harness or pane origin whose host isn't loopback (`127.0.0.0/8`, `::1`, `localhost`).

  **The guard keeps out other pages, not the panes' own apps.** A pane's app sees the harness's navigations, and when it answers one with a redirect, the next hop keeps the harness `Referer` wherever it goes. So the PR pane's app can redirect the harness's frame, or a new tab, to any URL of the base pane, which serves it with the reviewer's session. The trust gate is the boundary against PR code.
- **Pane frame lock.** Every pane response, the proxy's own `403`, `421`, `502` and `503` included, carries `Content-Security-Policy: frame-ancestors 'self' <harness origin> <QA_FRAME_ANCESTORS…>` and `X-Content-Type-Options: nosniff`. The policy replaces the app's own `frame-ancestors` directive (its other directives are kept), and the app's `X-Frame-Options` is dropped. A value that isn't an http(s) origin is left out, and so is an IPv6 literal, which a CSP source can't express.
- **The mirror bridge talks only to the harness.** The proxy puts the harness origin on the script tag it injects (`data-harness`). The bridge posts only to its parent frame at that origin, applies replays only from its parent at that origin, and does nothing without one. So a page that frames a pane, the PR pane included, can neither hear nor drive its bridge. **The PR pane's code can still drive the base pane through the harness**, as mirroring does: while the mirror is on, the harness replays in the base pane every interaction the PR pane posts to it (a click, a key or a value on any selector), and PR code can post those itself.
- **Harness frame lock.** Every harness response, errors and refusals included, carries `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN` and `Referrer-Policy: strict-origin-when-cross-origin`. No other page can frame the harness to trick a click that starts a session or posts a verdict, and the harness's frame loads and new tabs always send its origin as the `Referer` the panes check.
- **Open the harness at its origin.** The panes trust exactly one harness origin, `QA_HARNESS_ORIGIN`, which startup logs as `[qa] harness at <origin>/qa/`. Opened anywhere else that reaches it (`localhost` for `127.0.0.1`, or another front-door port), the harness shows a banner linking to that origin, and the panes answer `403`. The harness and the panes may still use different hosts: only the URL the harness itself is opened at must match. An IPv6 literal can't be that origin, since a CSP source can't name one: with a `::1` bind, set `QA_HARNESS_ORIGIN=http://localhost:<port>` (startup logs an error until you do).
- **Same-origin API.** Every harness `/api/*` request, reads and the progress stream included, gets `403 cross-site request refused` when `sec-fetch-site` is present and isn't `same-origin` or `none`, or, absent that, when `Origin` is present and its host isn't the request's `Host`. Another page can't read the answers, but its writes would run, and each read of `/api/prs` spends GitHub API calls. A browser (a request with either header) must also reach the API at the harness origin's host and port, else it gets `403 not the harness origin` (its body names `harnessOrigin`, for the banner): a page served by another front-door handler that proxies to the harness, such as a stale `tailscale serve` mount on another port, is same-origin with that handler. Loopback `Host`s are exempt from that second check, and non-browser clients, which send neither header, from both. Like the pane guard, this needs Fetch Metadata: over plain http off loopback, another page's `<script src>` GET sends neither header and passes as a non-browser client.
- **JSON bodies.** `POST /api/session`, `/api/verdict` and `/api/teardown` require `content-type: application/json` (else `415`). A cross-site form can't send that type, and a cross-site `fetch()` with it needs a CORS preflight the harness never grants.
- **Inert rendering.** The harness UI renders PR titles, build messages, blocked reasons, errors and log tails as text, and links a build run only when its URL is `https://`.

## The seams

A boot runs these five seams in order: `ensureBuilt` → per pane (`provisionDatabase` → `seedPane` → `reserveServices`) → `derivePaneEnv` (+ `runMigrate`) → `launchServices` → `waitHealthy` → `establishSession`. A sixth, [Exposure](#exposure-optional), is optional and outside the boot: it publishes the conductor itself.

| Seam | Members | Owns |
|---|---|---|
| **Provisioner** | `provisionDatabase({paneRef, databases, signal}) → {dsn, db}`, `reserveServices({paneRef, services, signal}) → {name: {url, port}}`, `launchServices({paneRef, services, env, reserved, signal})`, `waitHealthy({services, signal})`, `teardown({paneRef})`; optional `runMigrate({paneRef, migrate, env, signal})`, `sweep()`, `logs({paneRef, stage, lines}) → string` (or a promise of one) | Where panes run: databases, processes or containers, ports, env at rest, cleanup |
| **BuildConvention** | `migrationStrategy` (`'one-shot-image' \| 'on-boot' \| 'none'`), `ensureBuilt(pr, {signal})`, `resolvePrImages(pr)`, `resolveBaseImages()` → `{services: {name: ref}, migrate?, label?}`; optional `subscribeBuild(cb)` with `cb({runUrl?, runStatus?, message?})`, `describePrs(prs) → [{number, status: 'built'\|'building'\|'none'\|'blocked', runUrl, reason?}]` | What gets run for base and PR, whether it's ready, and whether it may run at all |
| **Seed** | `databases`, `seedPane({paneRef, db, databases})` | Where each pane's data comes from and how it moves |
| **EnvTransform** | `derivePaneEnv({prodEnv, pane}) → {service: env}` (pure) | Pointing a pane at its own DB and origin, and neutralizing side effects (email, payments, storage) |
| **AuthBootstrap** | `requiresDb`, `establishSession({pane, operator, db?}) → {landingUrl, cookies?, replay?}`; optional `envContributions()` | Getting the reviewer logged in to each pane |

The optional members degrade gracefully when absent:
- With no `sweep`, nothing is cleaned up at startup.
- With no `logs`, failures show no log tail.
- With no `describePrs`, every PR shows as `none`.

The one exception: a build that declares `one-shot-image` migrations with a Provisioner that can't `runMigrate` fails the boot with a clear error.

### Contracts between the seams

- **`db` is opaque to the core.** Whatever `provisionDatabase` returns as `db` is passed unchanged to `seedPane` and (when `requiresDb`) to `establishSession`. Its shape is a contract among a consumer's own adapters.
- **Cancellation (`signal`).** Teardown and takeover abort the in-flight boot. The core checks the signal between stages, at the top of each pane's provisioning, before each `launchServices` and before the `waitHealthy` loop. It also passes the signal to `ensureBuilt` and to every Provisioner call above, so a long wait can stop early. Provisioners may ignore it (the Docker one does). An aborted boot never tears anything down, even when the abort lands while its failure log tail is being read: whoever aborted it already did.
- **Startup sweep.** The conductor calls `sweep()` once, at startup. A boot started before it settles waits for it before `ensureBuilt`, so the sweep can't remove the new session's panes. While it waits, the harness shows `waiting for startup cleanup…` under the first boot step, then `startup cleanup done`, and counts the wait in that step's time and the boot's. There is no timeout. A failed sweep is logged and doesn't block boots, even one that throws synchronously or rejects with something other than an `Error`. A teardown or takeover during the wait cancels the waiting boot, as it would at any other point.
- **Build progress.** `subscribeBuild(cb)` payloads are `{runUrl?, runStatus?, message?}`. The harness shows `message` (plain text, e.g. `installing dependencies for #12 (abc1234)…`) under the first boot step, else a summary of the run's status, and links the run when `runUrl` is `https://`. `/api/state` returns the latest as `buildRun: {url, status, message}`.
- **`blocked`.** `describePrs` may report a PR as `blocked`, with a plain-text `reason` (for example, an untrusted author or a head branch in someone else's fork). The picker shows it as `can't boot: <reason>`. Opening the PR is still allowed, because `ensureBuilt` is the real gate. `describePrs` receives `listOpenPrs()` items, or for `/api/build-status` an item built from `github.prInfo(pr)` (`{number, headSha, author, authorAssociation, headRepo, headOwner}`), falling back to `{number, headSha}` from `prHead` when `github` has no `prInfo`.
- **Display `label`.** `resolveBaseImages` / `resolvePrImages` may return a `label` string, used as the pane's tag instead of the primary service's ref (`app`, else the first service). The label appears in the harness header and in the **public** verdict comment. Consumers whose service refs are local paths or objects must set one, so no path or object leaks into the PR. It must not contain `:`.
- **Failure log tails.** When a boot fails at a pane stage (`cloning`, `migrating`, `starting`), the core calls `logs({paneRef: {role}, stage, lines: 40})` for the failing pane *before* tearing the panes down, and attaches the result to the error as `err.logTail` (with the pane's role as `err.failedRole`). An error that already carries a string `logTail` keeps it, so a BuildConvention can attach its own tail to an `ensuring-image` failure (for example, installer output). The harness shows the tail under the error.
- **Landing flows stay on the pane origin (AuthBootstrap).** The harness loads each `landingUrl` as given; the bridge learns the harness origin from the proxy, not from the URL. A pane serves a navigation from another site only when its `Referer` is the harness origin, so a sign-in step on another site, such as an external identity provider's form, comes back with that site's `Referer` and is refused. Keep landing flows on the pane origin. Redirects within it are fine, whatever their `Referrer-Policy`: the proxy drops that header from a redirect that stays on the pane, so the next hop still carries the harness `Referer`.

**Built in:** `adapters/provisioner-docker` is a Provisioner for docker-sibling deployments. It creates the pane postgres containers, one app container per pane, `0600` env files under `workDir`, registry login and a labelled-orphan sweep. The `docker`, `github` and `exec` modules are the effect wrappers it and the reference adapters use.

**Effect wrappers:**
- `github`: `listOpenPrs()` items are `{number, title, headSha, headRef, author, authorAssociation, headRepo, headOwner}`. `prInfo(num)` returns `{number, headSha, author, authorAssociation, isDraft, headRepo, headOwner}`, where `headRepo` (`owner/name`) and `headOwner` are `null` when the head repository was deleted. `authorPermission(login)` returns the login's `admin|write|read|none` permission on the repo and throws on a non-2xx response. `author_association` alone is no access check: `COLLABORATOR` includes read-only outside collaborators.
- `exec`: `makeExecFileFn()` resolves `{stdout}` and rejects with an Error whose message is unchanged and which also carries `stdout`, `stderr` and the exit `code`.

**Reference consumer:** homefree's platform adapters (Docker + GHCR + `pg_dump` from the prod database + a magic-link login).

### Built in: `adapters/build-worktree` (git-worktree BuildConvention)

A BuildConvention for apps that run a PR from its source rather than from CI-built images. It fetches the base branch and the PR head into a bare repository, checks each SHA out into its own git worktree, optionally installs dependencies, and hands each worktree directory to your Provisioner through `servicesFor`.

```js
import os from 'node:os'
import path from 'node:path'
import { createWorktreeBuild } from '@critical-labs/qa-conductor/adapters/build-worktree'

const build = createWorktreeBuild({
  repo: 'acme/widget',
  cacheDir: path.join(os.homedir(), '.cache/qa-conductor/acme-widget'),
  github,                                          // needs prInfo(num) and authorPermission(login)
  servicesFor: (dir, { role, sha }) => ({ app: dir }),
  install: { cmd: 'pnpm', args: ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile'] },
})
```

| Option | Default | |
|---|---|---|
| `cloneUrl` | `https://github.com/<repo>.git` | must not contain credentials (construction throws); for a private repo, configure a git credential helper |
| `install` | `null` (no install) | `{ cmd, args, env? }`, run in the worktree |
| `baseRef` | `'main'` | the branch the base pane runs |
| `trust` | `{ logins: [], associations: ['OWNER', 'MEMBER', 'COLLABORATOR'], requirePush: true, allowForks: true }` | see below; omitted keys keep their defaults. `logins` and `associations` must be arrays of strings (split a comma-separated env value first); anything else throws at construction |
| `keep` | `6` | the newest `keep` builds survive pruning; the two SHAs just built are never removed, even when they fall outside that number |
| `migrationStrategy` | `'on-boot'` | |

How it works:
- **Layout under `cacheDir`.** The bare repository is `repo.git`, created on first use, and each checkout is `worktrees/<sha>`. Markers live at `built/<sha>.json`, outside the checkouts, so a PR's committed files can't supply one. A marker records a fingerprint of the install command, args and env keys. If it doesn't match, or the checkout is gone, the marker is dropped and the SHA is rebuilt from a clean checkout.
- **The cache must be yours alone.** `cacheDir`, `built/` and `worktrees/` are created `0700`. Each build refuses to run unless each of them is a real directory (not a symlink), owned by the current user, and not writable by group or others: anyone who can write there can plant a marker and a tree for the base SHA.
- **One build at a time** per instance. A second caller waits, then runs its own build, re-checking the markers.
- **Progress** goes to `subscribeBuild` as `{ message }` (`fetching acme/widget…`, `installing dependencies for #12 (1a2b3c4)…`, `#12 (1a2b3c4) already built`). Each `ensureBuilt` reports to the subscriber that was current when it was called, and says nothing more once its signal aborts. An install failure's error carries a `logTail`: the last 40 lines of its output, at most 8 KB.
- **`resolvePrImages` / `resolveBaseImages`** return `servicesFor(dir, …)`, `migrate: null`, and a `label` such as `#12@1a2b3c4` or `main@9f8e7d6`, which never contains a path.
- **`describePrs`** reports `blocked` (with a reason) for a PR that fails the trust gate, then `building`, `built` or `none`.
- **Pruning** runs after each build and is best-effort. The newest `keep` builds are kept, and the two SHAs just built are never removed, even when they fall outside that number. Every other checkout is removed, including ones whose build never finished.

**Security.** This adapter checks out and installs a PR's code on the reviewer's machine, as the reviewer, and your Provisioner then runs it. **The trust gate is the only real boundary between a PR's code and the reviewer's machine. Env scrubbing and loopback binding are defence in depth.**
- **The trust gate.** `ensureBuilt` refuses a PR, before any git call, unless all of these hold:
  - its author is in `trust.logins`, or has an association in `trust.associations` **and**, when `requirePush` is set (the default), `write` or `admin` permission on the repo;
  - its head repository still exists;
  - its head branch is in the repo itself or in the author's own fork, not in someone else's fork. With `allowForks: false`, only the repo itself.
- **Association isn't access.** `author_association` alone is not an access check. `COLLABORATOR` includes read-only outside collaborators, and `MEMBER` includes org members with no push access. That's why `requirePush` defaults on.
- **The gate vouches for the author, not for every commit.** It checks who opened the PR and where its head lives, not who pushed the head commit. Anyone with push access to the author's fork (collaborators they added, bots or Actions with write access to it) can move the head, and the moved head passes as the author's. Set `allowForks: false` to require heads in the repo itself, where everyone who can push has write access to the repo.
- **Only the gated SHA runs.** Only the exact SHA that passed the gate is ever checked out or installed. If the head moves between the check and the fetch, the new SHA is gated again, or the build fails with `head moved during fetch; retry`.
- **It fails closed.** Any error while checking (a GitHub error, a missing field) refuses the PR, and a malformed `trust` config throws at construction.
- **Defence in depth, not a sandbox.**
  - The installer's environment is exactly `PATH`, `HOME` and `install.env`, so credentials in environment variables (such as `GITHUB_QA_TOKEN`) don't reach it. Files under `HOME` do: it can read `~/.npmrc` tokens, `~/.config/gh`, `~/.git-credentials` and `~/.ssh`.
  - git runs with hooks disabled and prompts off.
  - A PR that passes the gate still runs with the reviewer's full user access. Code it runs (install scripts, a package manager it selects, the server your Provisioner launches) can rewrite this cache, including markers and other checkouts such as the base, like anything else the reviewer can write.
- **Skip install scripts.** Install with `--ignore-scripts` (with pnpm, also `--ignore-pnpmfile`) so dependency lifecycle scripts and pnpmfiles don't run.

### Built in: `adapters/provisioner-process` (process Provisioner)

A Provisioner for local processes. It runs each pane's services, and optionally a per-pane database, as process groups on `127.0.0.1`, with a scrubbed env, a pidfile and a start-time-checked orphan sweep. Its launch contract is below.

```js
import { createProcessProvisioner } from '@critical-labs/qa-conductor/adapters/provisioner-process'

const provisioner = createProcessProvisioner({
  stateDir: path.join(os.homedir(), '.cache/qa-conductor/acme-widget'),  // holds pids.json
  // `ref` is the service's entry from the BuildConvention, e.g. a checkout directory
  command: ({ name, ref, port, env, paneRef }) => ({
    cmd: path.join(ref, 'node_modules/.bin/tsx'),
    args: ['packages/api/src/dev.ts'],
    cwd: ref,
    env: { HOST: '127.0.0.1', PORT: String(port) },
  }),
  database: {                                  // optional: one per pane
    command: ({ paneRef, port }) => ({ cmd: '/usr/bin/java', args: ['-jar', 'DynamoDBLocal.jar', '-inMemory', '-port', String(port)], cwd: ddbDir }),
    ready: ({ port, signal }) => waitForPort(port, { signal }),
    handle: ({ paneRef, port }) => ({ dsn: `http://127.0.0.1:${port}`, db: { endpoint: `http://127.0.0.1:${port}` } }),
  },
  healthPath: '/ui/',                          // or (serviceName) => path; default '/'
  healthy: status => status === 200,           // default: status < 500
})
```

The other options are `healthTimeoutMs` (60000, per service), `host` (`127.0.0.1`: the address in reserved urls, health checks and the free-port lookup), `graceMs` (5000, from SIGTERM to SIGKILL), `logLines` (200 per pane) and `log` (`console`). Every effect is injectable: `spawnFn`, `killFn`, `freePortFn`, `fetchFn`, `fsx`, `psFn`, `pgroupFn`, `bootIdFn`, `sleepFn`, `nowFn`, `onExitFn` and `baseEnv`.

**Launch contract.** `command` and `database.command` must start the server binary **directly**, never through a package manager (`pnpm dev`, `pnpm exec`, `npm run`, `npx`). The child has no TTY and only `PATH` plus the env you declare, and the package manager on that `PATH` may not be the one that ran `install`: pnpm 10 and later verify dependencies before run/exec and, with no TTY, fail or reinstall. So use, for example, `{ cmd: join(dir, 'node_modules/.bin/tsx'), args: ['packages/api/src/dev.ts'], cwd: dir }` or `{ cmd: process.execPath, args: ['demo/server.mjs'], cwd: dir }`. The process you start is the server: if it exits, the pane has failed.

- **Env.** A service gets exactly `{ PATH, ...env[name], ...spec.env }`: the conductor's `PATH`, the pane env from your EnvTransform, then the command's own `env`. The database gets `{ PATH, ...spec.env }`. Nothing else is inherited: no credentials, and no `HOME` unless you declare it.
- **Ports.** `reserveServices` picks a free port per service on `host`, and never hands out a port another pane or service still holds. Nothing starts until `launchServices`. Your command must make the server listen on that port, bound to `host`.
- **Health.** `waitHealthy` polls `<url><healthPath>` until `healthy(status)`, for up to `healthTimeoutMs`. A process that exits first fails the boot at once, with its log tail. `healthy(status)` gets the service's own response status: redirects aren't followed (an app often redirects to its public origin, the pane proxy, which answers `503` until the boot is done), so under the default `status < 500` a `3xx` counts as up. A strict predicate such as `status === 200` needs a `healthPath` that doesn't redirect.
- **Logs.** Each pane keeps its last `logLines` lines of stdout and stderr, prefixed `[name]`, and `logs()` returns the tail. The buffer survives teardown, and resets when the pane's next boot starts.
- **Teardown** signals process **groups**, never bare pids, because a wrapper may exit at once while its server lives on. Services go first, then the database: SIGTERM, then SIGKILL after `graceMs`. A group that survives SIGKILL is logged and left for the next sweep. Once a leader has exited, its pid can be reissued, so teardown checks it with `ps` first: a pid held by another process means our group is gone, and it isn't signalled.
- **Crash cleanup.** Each process is recorded in `<stateDir>/pids.json` with its start time from `ps` and the boot it ran in. The directory must be a real directory owned by you and not writable by group or others (it's created `0700`; one that others could write to is refused, since its contents may be planted), and `pids.json` must be a regular file owned by you (written `0600`). `sweep()`, which the conductor runs at startup, kills the groups a previous run left behind. It skips any pid that now belongs to another process, drops entries from an earlier boot without signalling anything, and leaves in place entries it can't check (no start time). Give each conductor its own `stateDir`. A `process.on('exit')` hook SIGKILLs every live group; signals don't run it, so call the conductor's `shutdown()` from your signal handlers.
- There's no `runMigrate`: process consumers migrate on boot.

**Security.** A PR's code runs as your user, on your machine. The trust gate is the only real boundary between a PR's code and the reviewer's machine: the BuildConvention must refuse to build a PR it doesn't trust. Env scrubbing and loopback binding are defence in depth. The Tailscale identity gate is no boundary against PR code either: a pane process can reach the conductor on loopback and send any `Tailscale-User-Login` it likes (see [Security](#security)).

### Exposure (optional)

An Exposure adapter publishes the conductor's three servers on a front door, such as `tailscale serve`, and reports when they drift. It is optional, and **the core never constructs one**: a platform builds it and passes it as `adapters.exposure`, as it does the other adapters. Only a gated conductor may have one: in none mode, `startConductor` throws `adapters.exposure needs QA_EXPOSURE=tailscale: an ungated conductor must not publish itself`.

```js
import { createTailscaleExposure } from '@critical-labs/qa-conductor/adapters/exposure-tailscale'
import { makeExecFileFn } from '@critical-labs/qa-conductor/exec'

const conductor = startConductor({
  cfg,                                                  // in tailscale mode
  github, fsx, readBaseEnv,
  adapters: { provisioner, build, seed, envTransform, auth, exposure: createTailscaleExposure({ execFileFn: makeExecFileFn() }) },
})
const state = await conductor.exposure.ready          // { mode, managed, ok, checkedAt, drift, added, error }
```

**The reconcile loop.** With an adapter, the conductor owns its mounts:
- It reconciles once all three servers listen, so the targets are the bound ports, then every `QA_EXPOSURE_INTERVAL_MINUTES` (`cfg.exposureIntervalMinutes`, default 5) on an `unref()`ed timer. Each pass derives the mounts afresh with `mountsFor`, since `cfg.paneOrigins` may be assigned after start, then runs `reconcileExposure`.
- One pass runs at a time. A tick while a pass is still running, on a hung CLI say, starts nothing, so CLI processes never stack.
- Once `stop()` or `shutdown()` begins, no pass runs and the timer is cleared. Neither waits for a pass in flight. Nothing ever removes a mount, so after a stop the front door answers `502` until the conductor is back.
- Nothing a pass does takes the conductor down. Each mount it writes is logged as `[qa] exposure mounted <port><path> -> <target>`, or `restored` when this conductor had it in place before. `[qa] exposure failed: …`, `[qa] exposure drift remains: <port><path>, …` and `[qa] exposure ok` are logged only when they change.
- `GET /api/exposure` and `conductor.exposure.state()` report the last pass as `{ mode, managed, ok, checkedAt, drift, added, error }`. Neither calls the front door. The mounts in `drift` and `added` are copied from what the adapter returned, keeping only the Mount type's values: a field that isn't a string (for `port`, an integer), such as a `URL` object as the `target`, is reported as `null`.
- So a deploy needn't touch the mounts: the restarted conductor's first pass restores any that are missing or wrong.

In tailscale mode without an adapter, the mounts are someone else's, such as a deploy script's: startup logs `[qa] exposure: tailscale serve mounts are managed outside the conductor`, and `/api/exposure` reports `managed: false`. In none mode it reports `managed: false` too.

To run a pass yourself, outside a conductor, use the [expose CLI](#expose-cli) from a shell, or from code:

```js
import { mountsFor, reconcileExposure } from '@critical-labs/qa-conductor/exposure'

const exposure = createTailscaleExposure({ execFileFn: makeExecFileFn() })
const result = await reconcileExposure(exposure, mountsFor(cfg), { checkOnly: true })   // { ok, checkedAt, drift, added, error }
```

The contract:
- **`Mount = { name, host, port, path, target }`**, one each for `harness`, `base` and `pr`.
  - `host` and `port` are the mount's public side: the hostname and port of its own origin (`cfg.harnessOrigin`, or the pane's in `cfg.paneOrigins`). A port-less https origin means `443`.
  - **`host` is not `cfg.host`.** `cfg.host` is the address the conductor binds, and only `target` uses it.
  - `path` is `/qa` for the harness and `/` for each pane.
  - `target` is `http://<cfg.host>:<listen port>`, with brackets for IPv6.
- **`Drift = { mount, actual }`**: `actual` is the proxy target the front door serves at that mount over https now, or `null` when there is none: nothing at that path, no https on the port, or a handler that isn't a proxy. A mount also drifts once for each other handler that takes some of its requests, and `actual` then names that handler, as `<path> -> <target>` or `<path> (not a proxy)`.
- **`ensure(mounts) → Promise<{ added, ok }>`** creates the missing or mismatched mounts, and only those. **`check(mounts) → Promise<{ ok, drift }>`** changes nothing. Either rejects on failure. An `ensure` that fails part way may list the mounts it did write on its error, as `added`.
- **An adapter owns exactly the `(port, path)` pairs it is given**, and never touches another handler.

`mountsFor(cfg, { ports = cfg.ports })` derives the mounts from the origins viewers open, so the URL a viewer sees and the mount behind it can't disagree. Pass the bound ports when `cfg.ports` holds `0`. It throws on a layout no front door can publish:
- no harness origin;
- a missing or unparseable pane origin;
- an origin that isn't https, or is on port `0`;
- two mounts on one port, which would share an origin;
- a listen port that isn't an integer from 1 to 65535.

`reconcileExposure(exposure, mounts, { checkOnly })` runs `ensure` then `check`, or only `check` with `checkOnly`. It resolves `{ ok, checkedAt, drift, added, error }` and never rejects, whatever the adapter throws: a failure comes back as `ok: false` with its message in `error`, and `added` still lists what `ensure` wrote.

`runExpose({ cfg, exposure, checkOnly = false, log = console })` is the [expose CLI](#expose-cli)'s pass: `mountsFor(cfg)` then `reconcileExposure`, printed through `log`, resolving the CLI's exit code (`0`, `1` or `2`). A `cfg` without `exposure` or `harnessOrigin` resolves both as `startConductor` does.

**Built in: `adapters/exposure-tailscale`.** `createTailscaleExposure({ execFileFn, bin = 'tailscale', socket = null, timeoutMs = 30000 })` drives `tailscale serve` on the host it runs on:
- `check` runs `tailscale serve status --json`. A mount is in place when its port serves https and its path proxies to its target (one trailing `/` ignored). It reads the status entry for the mount's `host:port`, else the first entry on that port.
- tailscaled hands a request to the deepest handler path that holds it, so a handler under a mount's path takes some of its requests: `/qa/` or `/qa/api` beside the harness's `/qa`, or any other path on a pane's port. `check` reports each one that doesn't proxy to the mount's target as drift.
- `ensure` reads the same status, then runs `tailscale serve --bg --https=<port> [--set-path=<path>] <target>` for each mount whose own handler is missing or points elsewhere, and only those. `--set-path` is left out for `/`. A handler that shadows a mount stays drift until you remove it: `ensure` never writes or removes it. A mount that fails doesn't stop the others, and `ensure` then rejects, naming each failure, with the mounts it did write as the error's `added`.
- Every call goes through `execFileFn` (`makeExecFileFn()` from `./exec`) with a `timeoutMs` timeout. With `socket` set, `--socket=<socket>` comes before the subcommand, for a CLI whose daemon's socket is somewhere else, such as one mounted into a container.
- `bin` is the CLI to run, and it should be no older than the daemon. On macOS, the `tailscale` on `PATH` may lag behind the app's daemon: use the app's bundled CLI, `/Applications/Tailscale.app/Contents/MacOS/Tailscale`.

**What it never touches.** It never runs `tailscale serve reset` or `off`, so it never removes a handler, and it never changes one at a `(port, path)` it wasn't given:
- Another app's `/` handler on the harness's port stays beside the harness's `/qa`, since `tailscale serve` keeps a port's other paths. Give the harness a port of its own all the same: that app's pages would share the harness origin, so the panes and the harness API would take them for the harness.
- The flip side: a declared `(port, path)` is the conductor's. A pane origin on a port where another app serves `/` replaces that app's handler.
- **A changed origin or port leaves the old handler behind.** It keeps proxying to the conductor until you remove it with `tailscale serve --https=<old port> [--set-path=<path>] off`. Until then, browsers that reach the harness through it get `403 not the harness origin` from its API (see [Same-origin API](#security)), but the old URL still answers.

## Configuration

`loadConfig(path, { defaults, required = [] })` reads `KEY=value` lines. File values override `defaults`, and the raw map is returned as `cfg.env` so a platform can read its own keys. `required` lists extra keys the platform insists on (homefree re-requires `QA_OPERATOR_EMAIL`); it can't waive the core's.

| Key | Default | |
|---|---|---|
| `GITHUB_QA_TOKEN` | *(required)* | PR list, head and trust lookups, verdict comment + label |
| `QA_GHCR_TOKEN` | `GITHUB_QA_TOKEN` | `cfg.ghcrToken`, for `createGithub({ packagesToken })`: the GHCR package version listing, which a fine-grained token can't call (use a classic PAT with `read:packages`), and a platform's registry login |
| `QA_REPO` | *(required)* | `owner/name` |
| `QA_OPERATOR_EMAIL` | `null` | the reviewer, passed to `establishSession` |
| `QA_PUBLIC_HOST` | *(required unless both pane origins are set)*, else `null` | default host for the pane origins; always an allowed `Host` |
| `QA_BIND_HOST` | `127.0.0.1` | the address all three servers listen on (`[::1]` is read as `::1`); must be loopback in tailscale mode (see [Security](#security)) |
| `QA_ALLOWED_HOSTS` | *(none)* | extra comma-separated hostnames (no ports) the servers answer to |
| `QA_EXPOSURE` | `tailscale` if any address the conductor answers to or listens on is off loopback (see below), else `none` | `tailscale`: fronted by `tailscale serve` on this host, so the identity gate is on and the bind must be loopback. `none`: no gate (0.2's behaviour), for loopback or another authenticating front door. Anything else throws |
| `QA_ALLOWED_LOGINS` | *(none)* | comma-separated Tailscale logins (as `tailscale whois` shows them, e.g. `alice@github`) allowed in when the gate is on; trimmed and lowercased. Required in tailscale mode |
| `QA_EXPOSURE_INTERVAL_MINUTES` | `5` | minutes between [exposure](#exposure-optional) reconcile passes, when the platform passes an Exposure adapter. Above `0` and at most `35791`, the longest a timer can wait (above it, Node would fire every millisecond); fractions are fine |
| `QA_TAILSCALE_BIN` | `tailscale` | the tailscale CLI the [expose CLI](#expose-cli) and self-QA run, for an env file they read. On macOS, use the app's `/Applications/Tailscale.app/Contents/MacOS/Tailscale` when the one on `PATH` is older than the daemon. The conductor never reads it: a platform passes `bin` to `createTailscaleExposure` |
| `QA_HARNESS_PORT` / `QA_BASE_PROXY_PORT` / `QA_PR_PROXY_PORT` | `3100` / `3101` / `3102` | listen ports |
| `QA_HARNESS_ORIGIN` | `https://<QA_PUBLIC_HOST>:8444`, else `http://<QA_BIND_HOST>:<QA_HARNESS_PORT>` on a loopback bind | the origin viewers open the harness at (any path dropped); the page is under `/qa/`. Required on a non-loopback bind with no public host. On port `0` the conductor derives it from the bound port. Not an IPv6 literal: on a `::1` bind, set `http://localhost:<port>` |
| `QA_BASE_ORIGIN` / `QA_PR_ORIGIN` | `https://<host>:8443` / `:10000` | public pane origins |
| `QA_FRAME_ANCESTORS` | *(none)* | extra comma-separated origins allowed to frame the panes, for a harness nested in a pane (self-QA's inner demos). CSP only: they pass no `Referer` check, and the bridge never talks to them |
| `QA_FORWARD_CLIENT_COOKIES` | *(none)* | `cfg.forwardClientCookies`: comma-separated names of the browser's own cookies the pane proxies pass to the pane apps, beside each pane's jar, whose value wins on a name both have. Unset, the apps get only the jar's cookies (see [Security](#security)). Each must be a cookie name (an RFC 6265 token); `*` and other wildcards throw. Any page on the panes' hostname can set these cookies, the other pane's scripts included |
| `QA_LABEL_ACCEPT` / `QA_LABEL_REJECT` | `qa-approved` / `qa-changes-requested` | verdict label pair |
| `QA_IDLE_MINUTES` | `30` | idle sessions are torn down |

Every origin key must be an http(s) URL with a plain hostname. It is normalized to an origin (lowercased, a default port and any path dropped), and anything else throws. An `http:` harness or pane origin must be loopback (`127.0.0.0/8`, `::1`, `localhost`): browsers send the `Sec-Fetch-*` headers the request guards rely on only to https and loopback origins (see [Security](#security)). The harness and the two panes must be three different origins: a page that is same-origin with another could act for the reviewer there.

Unset, `QA_EXPOSURE` is `none` only when all of these are loopback, and `tailscale` otherwise: the harness origin (as derived above; when none can be derived, on a loopback bind on port `0` with no `QA_HARNESS_ORIGIN` or `QA_PUBLIC_HOST`, it adds nothing), both pane origins, `QA_PUBLIC_HOST` and every `QA_ALLOWED_HOSTS` entry (both widen the `Host` allowlist), and `QA_BIND_HOST`. So a non-loopback bind alone makes the mode `tailscale`, which then refuses that bind: behind another authenticating front door, set `QA_EXPOSURE=none`. In tailscale mode, `loadConfig` throws on a non-loopback `QA_BIND_HOST` and on an empty `QA_ALLOWED_LOGINS`, and each error says why the mode is `tailscale`.

A platform that builds `cfg` in code instead can leave out `host` (loopback is the default), `allowedHosts`, `harnessOrigin` (derived as above), `frameAncestors`, `forwardClientCookies` (none: `false` or an array of cookie names), `exposure`, `allowedLogins` and `exposureIntervalMinutes` (`5`). Without `exposure`, `startConductor` resolves the mode as `loadConfig` does, with `defaultExposure({ harnessOrigin, paneOrigins, publicHost, allowedHosts, host })` from `./config`, where a missing or unparseable pane origin counts as off loopback. The mode is fixed at start, so a `cfg` whose non-loopback origins are assigned after start must set `exposure` itself. `startConductor` refuses an unknown `exposure`, a `host` in brackets (write `::1`, not `[::1]`), tailscale mode on a non-loopback `host`, a `harnessOrigin` or `frameAncestors` entry that isn't an http(s) origin, an `http:` harness origin or pane origin (set at start) whose host isn't loopback, a harness origin equal to a pane origin, an `exposureIntervalMinutes` that isn't a number above `0` and at most `35791`, a `forwardClientCookies` that isn't `false` or an array of cookie names, and an `adapters.exposure` in none mode. Startup logs whether the gate is on and, for a defaulted mode, what made it `tailscale`. In tailscale mode with no `allowedLogins` it logs an error, and every request is refused. The core reads `cfg.paneOrigins` per request, so it may be assigned once the proxies are listening.

## HTTP API (harness port)

| | |
|---|---|
| `GET /` | harness UI |
| `GET /api/state` | session status, tags, `buildRun: {url, status, message}`, pane login URLs + origins, `harnessOrigin` |
| `GET /api/prs` | open PRs with build readiness (`imageStatus`, `runUrl`, `reason`) |
| `GET /api/build-status?pr=N` | `{pr, status, exists, runUrl}`, plus `reason` when `status` is `blocked` |
| `GET /api/exposure` | the last [exposure](#exposure-optional) reconcile pass: `{mode, managed, ok, checkedAt, drift, added, error}`. Read-only: it never calls the front door. With no adapter, `managed` is `false` and `ok` and `checkedAt` are `null` |
| `GET /api/progress` | server-sent boot progress (`step`, `build`, `ready`, `error` with `logTail`, `torn-down`) |
| `POST /api/session` `{pr, takeover?}` | boot a session (one at a time; `takeover` replaces the current one) |
| `GET /api/verdict/preview?verdict=accept\|reject&notes=` | the comment + labels that would be posted |
| `POST /api/verdict` `{verdict, notes}` | post the verdict comment and set the label |
| `POST /api/teardown` `{}` | tear down the session (cancels an in-flight boot) |

Every path also answers under a `/qa` prefix. In tailscale mode, a request to any of the three ports without an allowed `Tailscale-User-Login` gets `403` before anything else, a plain `curl` from the host included: a script on the host can't read `/api/exposure`, so it runs the [expose CLI](#expose-cli) with `--check` instead. Every `/api/*` request must come from the harness page itself, and a browser must reach it at the harness origin's host and port (`403`, see [Security](#security)). POSTs must be `application/json` (`415`), and a request to any of the three ports with an unrecognised `Host` gets `421`. A request target the harness can't parse as a URL gets `400`, and once `shutdown()` has begun every harness write gets `503`. While no session is ready, the pane proxies answer `503`.

## Expose CLI

```sh
npx qa-conductor-expose --check   # report drift on the conductor's tailscale serve mounts; change nothing
npx qa-conductor-expose           # put any missing or wrong mount back now
npm run expose -- --check        # in this repo: self-QA's .env.qa, through self-QA's loader
```

`qa-conductor-expose` runs one [exposure](#exposure-optional) pass from a shell, through the built-in tailscale adapter. **It is a tool for operators and debugging.** The conductor's reconcile loop owns the mounts: it sets them once its servers listen and restores them every `QA_EXPOSURE_INTERVAL_MINUTES`. So a deploy only restarts the conductor, and runs neither this CLI nor `tailscale serve`. Use the CLI to see drift, or to restore a mount now instead of at the next pass.

**Run it without `--check` only while the conductor is running.** The CLI never removes a mount, and self-QA removes its own only as it stops, so a mount written with no conductor behind it stays. Until someone removes it, it publishes whatever listens on its loopback port next, such as a later loopback self-QA, with no identity gate: that is why self-QA removes its mounts when it stops. With the conductor stopped, use `--check`.

```
qa-conductor-expose [--check] [--env FILE] [--config MODULE[#export]] [--tailscale BIN] [--socket PATH] [--help|-h]
```

- **One code path.** It runs `runExpose({ cfg, exposure, checkOnly, log })` from `./exposure`, which is the conductor loop's own pass: `mountsFor(cfg)` on the configured ports, then `reconcileExposure`, which runs `ensure` then `check` (`check` alone with `--check`). So the CLI and the loop can't disagree about what should be mounted. Like the loop, it never removes a handler. It targets `cfg.ports`, so a conductor on port `0` can only be mounted by its own loop.
- **`--env FILE`** is the conductor's own env file: by default `$QA_ENV_FILE`, else `./.env.qa`. The CLI loads it with `loadConfig`, as the conductor does, so the file needs `GITHUB_QA_TOKEN` and `QA_REPO` even though exposure ignores them.
- **`--config MODULE[#export]`** loads `cfg` with a platform's own loader instead, for an env file that leans on the platform's `defaults`. It imports `MODULE`, a file path from the working directory, and calls `export` (by default, the default export) with the env file's path. For example, `--config qa/self.mjs#loadSelfQaConfig` reads this repo's self-QA `.env.qa`, and a platform's container can pass its own loader the same way. In this repo, `npm run expose` passes self-QA's loader, since self-QA is the repo's only conductor; a `--config` after `--` overrides it, since the last one wins.
- **`--tailscale BIN`** is the CLI to run: by default `QA_TAILSCALE_BIN` in the env file, else `tailscale` on `PATH`. On macOS, use the app's `/Applications/Tailscale.app/Contents/MacOS/Tailscale` when the one on `PATH` is older than the daemon. **`--socket PATH`** passes `--socket=PATH` before the subcommand, for a daemon whose socket is elsewhere, such as one mounted into a container.
- **`--help`** or **`-h`** prints the usage and exits `0` before loading anything.

It prints a line for each mount it writes (`qa exposure: mounted <port><path> -> <target>`), and one for each mount still wrong (`qa exposure: drift <port><path>: want <target>, have <actual|nothing>`). A handler under a mount's path that takes some of its requests is named as one to remove, since the CLI never removes it. Then it prints any tailscale error, and finally `qa exposure: ok (harness <origin>/qa/)` once all three mounts are in place. In none mode it prints `qa exposure: QA_EXPOSURE=none, nothing to do`, since an ungated conductor must not publish itself. Drift and errors go to stderr, everything else to stdout.

| Exit | |
|---|---|
| `0` | every mount is in place (after writing any that weren't), or `QA_EXPOSURE=none`, or `--help` |
| `1` | drift remains, or tailscale failed |
| `2` | a bad flag or a config that doesn't load, with the usage on stderr; or, as one `qa exposure:` line, a mode, bind host or mount layout the conductor can't publish, such as an unknown `QA_EXPOSURE` from a `--config` loader, tailscale mode on a bind host that isn't loopback, an `http:` origin, two mounts on one port or a listen port `0` |

## Demo

```sh
npm run demo            # then open http://127.0.0.1:4100/
```

Open it at `127.0.0.1`: the panes trust only the harness origin, so at `localhost` the harness shows a banner and the panes stay blank.

Demo mode runs the real conductor with fixture PRs and fake adapters, so you can try the whole harness with no GitHub, containers or databases. Everything listens on `127.0.0.1`: the harness on `PORT` (default `4100`), and the pane proxies and the two in-process pane apps on free ports. The demo is always ungated (`exposure: 'none'`), whatever its harness origin: it binds loopback, and nested in self-QA it sits behind the outer conductor's gate. `QA_DEMO_SPEED` scales the fake build and boot delays (default `1`; `0` makes them instant). Ctrl-C (or SIGTERM/SIGHUP) stops it.

- **#101, #102** are built and open in seconds. **#103** is mid-build. **#104** builds, then its app crashes at *starting*, with a log tail. **#105** is refused by the trust gate (its head is in someone else's fork).
- The PR pane is visibly different from the base: a new heading, a purple accent and an extra sort control on *Products*. Both panes have several pages, forms and long pages, for trying mirroring.
- Verdicts go to an in-memory GitHub fake and are printed to the console. Nothing leaves the machine.

`demo/` is not published with the package. From code, `startDemo({ port, speed, log, harnessOrigin, frameAncestors })` in `demo/index.mjs` returns `{ stop(), ports }`. Without a `harnessOrigin` the core derives `http://127.0.0.1:<port>`. `QA_HARNESS_ORIGIN` and `QA_FRAME_ANCESTORS` set the last two from `npm run demo`.

## QA this repo's own pull requests

```sh
echo 'GITHUB_QA_TOKEN=<token>' > .env.qa   # read PRs, comment and label on this repo
npm run qa                                  # then open http://127.0.0.1:3100/qa/
```

qa-conductor QAs its own PRs with its own built-in adapters (`qa/self.mjs`):
- **Panes.** Each pane is a git worktree of this repo, base (`main`) and the PR head, running demo mode (`node demo/server.mjs`). A UI change shows up side by side before it merges.
- **Builds.** `build-worktree` checks a PR out only after the trust gate passes: the author has write access, and the head lives in this repo or the author's own fork. There is no install step, because the package has no dependencies.
- **Processes.** `provisioner-process` runs each pane on `127.0.0.1` with only `PATH`, `PORT`, `QA_DEMO_SPEED`, `QA_HARNESS_ORIGIN` and `QA_FRAME_ANCESTORS` in its environment.
- **Nested harnesses.** Each pane's demo harness is seen at the outer pane's origin, inside the outer harness, and CSP `frame-ancestors` checks every ancestor. So each inner demo gets `QA_HARNESS_ORIGIN=<the pane's origin>` and `QA_FRAME_ANCESTORS=<the outer harness origin>`, and its own panes render and mirror inside the outer pane. On `QA_HARNESS_PORT=0` the outer origin is the bound port's, read when a pane boots.
- **Where things live.** Builds and the pidfile are under `$XDG_CACHE_HOME/qa-conductor/critical-labs-qa-conductor`, defaulting to `~/.cache/...`.
- **Stopping.** Ctrl-C tears the panes down before exiting, and on a tailnet then removes the `tailscale serve` mounts (below).
- **On a tailnet.** To open self-QA from your other devices, set these in `.env.qa`, for a machine whose MagicDNS name is `<machine>.ts.net`:
  - `QA_PUBLIC_HOST=<machine>.ts.net`;
  - `QA_BASE_ORIGIN=https://<machine>.ts.net:8443` and `QA_PR_ORIGIN=https://<machine>.ts.net:10000` (self-QA defaults both to loopback, so set both);
  - `QA_ALLOWED_LOGINS=<your Tailscale login>`.

  That layout is tailscale mode, so self-QA passes the conductor the built-in tailscale [Exposure](#exposure-optional) adapter. The conductor mounts the harness at `https://<machine>.ts.net:8444/qa/` and the panes at `:8443` and `:10000` with `tailscale serve`, and restores them every `QA_EXPOSURE_INTERVAL_MINUTES`. `QA_TAILSCALE_BIN` names the CLI (default `tailscale`; on macOS, use the app's `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, since the one on `PATH` may be older than the daemon). To see drift from a shell, run `npm run expose -- --check`: the script passes `--config qa/self.mjs#loadSelfQaConfig`, which reads `.env.qa` with self-QA's defaults, such as `QA_REPO`, that the core `loadConfig` lacks (see [Expose CLI](#expose-cli)). A plain `npm run expose` restores them now, but only while self-QA runs: once it has stopped, it would put back the mounts self-QA just removed.

  From another device, the outer harness and each pane's demo harness render, but a demo's own panes are on this machine's loopback (`http://127.0.0.1:<port>`), so they render only in a browser on this machine.

  **Self-QA removes its mounts when it stops**, unlike the conductor itself. On Ctrl-C (or SIGTERM or SIGHUP), once the panes are down, it runs `tailscale serve --https=8444 --set-path=/qa off`, `tailscale serve --https=8443 off` and `tailscale serve --https=10000 off`, skipping any handler that no longer proxies to self-QA. A second Ctrl-C, a crash or a kill leaves them in place, and so does a command that fails, which is logged with the command to run: then remove them yourself with those commands. **Until the mounts are gone, whatever listens on the loopback ports they point at (`3100`–`3102` by default), such as a later loopback self-QA, is reachable from the tailnet with no identity gate.** `tailscale serve` picks the handler by the TLS server name and passes the client's `Host` through, so a tailnet device can send a loopback `Host`, which the `Host` allowlist and the API guard admit.

  **The identity gate is no boundary against the PR here.** The PR's demo runs as you, on this host, so it can reach the conductor on loopback and send any `Tailscale-User-Login` it likes. Only the trust gate keeps untrusted PR code out (see [Security](#security)).

`.env.qa` accepts the usual configuration keys, plus `QA_BASE_REF`, the branch the base pane runs (default `main`), and `QA_TAILSCALE_BIN`. `QA_ENV_FILE` points at a different file.

## Develop

```sh
npm test
```

The suite runs on `node:test` with injected effects, so it needs no Docker, network or GitHub.

## Releasing

1. Bump `version` in `package.json`, turn the CHANGELOG's `Unreleased` heading into that version, and move the git-tag example under [Install](#install) to its tag. `test/package.test.mjs` fails until all three agree.
2. Once that is on `main`, tag it `vX.Y.Z` and push the tag.
3. The [publish workflow](.github/workflows/publish.yml) refuses a tag that isn't `v` plus the `package.json` version. Then it runs the tests and `npm pack --dry-run`, and stages the version on npm with provenance (`npm stage publish`).
4. A maintainer approves the staged version on npmjs.com. Only then does it go live.

Nothing publishes directly: the workflow's npm token can only stage, and only the stage step gets it. `test/package.test.mjs` pins the workflow's trigger and steps. It fails on any npm or npx command other than the four the workflow runs (npm expands abbreviations such as `npm pub`), on a gate that could be skipped or allowed to fail, and on the token anywhere but the stage step. It reads the file as text, so it catches mistakes, not every way a shell can spell a command: the stage-only token is what refuses a plain publish.

## License

[MIT](LICENSE)
