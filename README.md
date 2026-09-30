# qa-conductor

A side-by-side PR-QA harness. For a pull request it boots two copies of your app: **base** (what's live now) and **PR** (the branch). Each runs against its own clone of real data, behind proxies that mirror scrolling and navigation between the two panes. A reviewer drives both at once and posts a verdict (a comment plus a label) back to the PR.

The conductor owns the choreography: session state, cancellation, the harness UI and API, the pane proxies and the verdict. Everything about *your* app and infrastructure comes from five adapters you supply.

> **Status: 0.x, pre-release.** The interface may still change while a second consumer is integrated. Install from git; nothing is published to npm yet.

## Install

```sh
npm install github:critical-labs/qa-conductor#v0.2.0
```

Node ≥ 22. There are no runtime dependencies.

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
  adapters: { provisioner, build, seed, envTransform, auth },
  readBaseEnv: async () => ({ /* the env the pane env is derived from */ }),
})

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => conductor.shutdown().then(() => process.exit(0)))
}
```

`startConductor` serves the harness on `cfg.ports.harness` and one proxy per pane on `cfg.ports.base` / `cfg.ports.pr`, all on `cfg.host` (**`127.0.0.1` by default**). It returns `{ servers, stop(), shutdown() }`:
- `shutdown()` is the graceful exit. It stops the idle reaper, refuses harness writes from then on (`503`, so no new boot can start), tears the session down (aborting an in-flight boot and tearing down both panes), ends the progress streams, closes every connection and resolves once all three servers are closed. Call it from your signal handlers; calling it again is a no-op.
- `stop()` only stops the reaper and asks the servers to close.

`cfg.paneOrigins` must be the URLs viewers actually reach the panes at. To reach the harness from anywhere but the machine it runs on, put your own TLS/auth front door in front of these ports (homefree uses `tailscale serve`) and read [Security](#security) first.

## Security

**The trust gate is the only real boundary between a PR's code and the reviewer's machine.** Booting a PR runs its code. A BuildConvention that checks out and installs PRs must refuse untrusted ones in `ensureBuilt`, before any git call. **Env scrubbing and loopback binding are defence in depth**, not a boundary.

The conductor's own defences in depth:
- **Loopback by default.** All three servers listen on `QA_BIND_HOST`, default `127.0.0.1`. Anything other than loopback exposes an unauthenticated API that returns pane login URLs and posts verdicts with `GITHUB_QA_TOKEN`. A pane proxy *is* an authenticated pane session, because the proxy holds the pane's cookie jar. Widen the bind only behind a firewall or an authenticating front door.
- **Host allowlist.** Every server checks the `Host` header before routing (the harness does so before it even parses the request target) and answers `421` unless its hostname (port ignored, `[]` stripped) is `127.0.0.1`, `localhost`, `::1`, `QA_PUBLIC_HOST`, the hostname of either pane origin, or an entry in `QA_ALLOWED_HOSTS`. This defeats DNS rebinding. A front door must pass the viewer's `Host` through, or its hostname must be allowed.
- **SameSite for the pane jar.** Loopback and the Host allowlist don't stop a site the reviewer visits from sending requests to a pane through the reviewer's own browser, and the proxy, not the browser, holds the pane's cookies. So the proxy applies each pane cookie's `SameSite` as a browser would. A cross-site request (by `sec-fetch-site`, else by an `Origin` outside the allowlist) gets only `SameSite=None` jar cookies, plus `Lax` ones on a top-level GET navigation. A missing `SameSite` counts as `Lax`, and `None` without `Secure` counts as `Lax`. The browser's own `Cookie` header passes through unchanged.
- **Same-site harness and panes.** Serve the harness and the panes with the same scheme and host (ports may differ), and don't mix `localhost` with `127.0.0.1`. Otherwise the harness's load of each pane is cross-site and gets no `Lax` or `Strict` jar cookies. A magic-link `landingUrl` still signs in, because it carries its own token.
- **Frame lock.** Every proxied pane response carries a `frame-ancestors` policy (added alongside the app's own CSP) that allows only the pane itself, loopback, `QA_PUBLIC_HOST`, the pane origin hosts and `QA_ALLOWED_HOSTS`, on any port. IPv6 literals can't be listed. The mirror bridge trusts the `qa=` origin only when the pane is framed, applies replays only from its parent at that origin, and posts only to that origin. So a page elsewhere can neither frame a signed-in pane nor drive it through the bridge. An authenticating front door must serve the harness from one of the allowed hosts.
- **Same-origin writes.** Every harness `/api/*` request other than GET/HEAD is refused with `403` when `sec-fetch-site` is present and isn't `same-origin` or `none`, or, absent that, when `Origin` is present and its host isn't the request's `Host`. Browsers always send one of the two on a POST, so a request with neither comes from a non-browser client and is allowed.
- **JSON bodies.** `POST /api/session`, `/api/verdict` and `/api/teardown` require `content-type: application/json` (else `415`). A cross-site form can't send that type, and a cross-site `fetch()` with it needs a CORS preflight the harness never grants.
- **Inert rendering.** The harness UI renders PR titles, build messages, blocked reasons, errors and log tails as text, and links a build run only when its URL is `https://`.

## The five seams

A boot runs these seams in order: `ensureBuilt` → per pane (`provisionDatabase` → `seedPane` → `reserveServices`) → `derivePaneEnv` (+ `runMigrate`) → `launchServices` → `waitHealthy` → `establishSession`.

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
- **Startup sweep.** The conductor calls `sweep()` once, at startup. A boot started before it settles waits for it before `ensureBuilt`, so the sweep can't remove the new session's panes. While it waits, the harness shows `waiting for startup cleanup…` under the first boot step, then `startup cleanup done`. There is no timeout. A failed sweep, even one that throws synchronously, is logged and doesn't block boots. A teardown or takeover during the wait cancels the waiting boot, as it would at any other point.
- **Build progress.** `subscribeBuild(cb)` payloads are `{runUrl?, runStatus?, message?}`. The harness shows `message` (plain text, e.g. `installing dependencies for #12 (abc1234)…`) under the first boot step, else a summary of the run's status, and links the run when `runUrl` is `https://`. `/api/state` returns the latest as `buildRun: {url, status, message}`.
- **`blocked`.** `describePrs` may report a PR as `blocked`, with a plain-text `reason` (for example, an untrusted author or a head branch in someone else's fork). The picker shows it as `can't boot: <reason>`. Opening the PR is still allowed, because `ensureBuilt` is the real gate. `describePrs` receives `listOpenPrs()` items, or for `/api/build-status` an item built from `github.prInfo(pr)` (`{number, headSha, author, authorAssociation, headRepo, headOwner}`), falling back to `{number, headSha}` from `prHead` when `github` has no `prInfo`.
- **Display `label`.** `resolveBaseImages` / `resolvePrImages` may return a `label` string, used as the pane's tag instead of the primary service's ref (`app`, else the first service). The label appears in the harness header and in the **public** verdict comment. Consumers whose service refs are local paths or objects must set one, so no path or object leaks into the PR. It must not contain `:`.
- **Failure log tails.** When a boot fails at a pane stage (`cloning`, `migrating`, `starting`), the core calls `logs({paneRef: {role}, stage, lines: 40})` for the failing pane *before* tearing the panes down, and attaches the result to the error as `err.logTail` (with the pane's role as `err.failedRole`). An error that already carries a string `logTail` keeps it, so a BuildConvention can attach its own tail to an `ensuring-image` failure (for example, installer output). The harness shows the tail under the error.
- **The `#qa=` fragment (AuthBootstrap).** The harness appends `qa=<encoded harness origin>` to each `landingUrl`'s fragment before loading it in a pane: `#qa=…` when there's no fragment, `&qa=…` after an existing one, and nothing when the fragment already has a `qa` param. The pane's mirror bridge reads it, only while the pane is framed, to know which window to talk to. So adapter fragments must be `&`-separated `key=value` pairs, and the app must keep the hash through redirects until its first HTML load.

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

**Security.** A PR's code runs as your user, on your machine. The trust gate is the only real boundary between a PR's code and the reviewer's machine: the BuildConvention must refuse to build a PR it doesn't trust. Env scrubbing and loopback binding are defence in depth.

## Configuration

`loadConfig(path, { defaults, required = [] })` reads `KEY=value` lines. File values override `defaults`, and the raw map is returned as `cfg.env` so a platform can read its own keys. `required` lists extra keys the platform insists on (homefree re-requires `QA_OPERATOR_EMAIL`); it can't waive the core's.

| Key | Default | |
|---|---|---|
| `GITHUB_QA_TOKEN` | *(required)* | PR list, head and trust lookups, verdict comment + label |
| `QA_REPO` | *(required)* | `owner/name` |
| `QA_OPERATOR_EMAIL` | `null` | the reviewer, passed to `establishSession` |
| `QA_PUBLIC_HOST` | *(required unless both pane origins are set)*, else `null` | default host for the pane origins; always an allowed `Host` |
| `QA_BIND_HOST` | `127.0.0.1` | the address all three servers listen on (see [Security](#security)) |
| `QA_ALLOWED_HOSTS` | *(none)* | extra comma-separated hostnames (no ports) the servers answer to |
| `QA_HARNESS_PORT` / `QA_BASE_PROXY_PORT` / `QA_PR_PROXY_PORT` | `3100` / `3101` / `3102` | listen ports |
| `QA_BASE_ORIGIN` / `QA_PR_ORIGIN` | `https://<host>:8443` / `:10000` | public pane origins |
| `QA_LABEL_ACCEPT` / `QA_LABEL_REJECT` | `qa-approved` / `qa-changes-requested` | verdict label pair |
| `QA_IDLE_MINUTES` | `30` | idle sessions are torn down |

A platform that builds `cfg` in code instead can leave out `host` (loopback is the default) and `allowedHosts`. The core reads `cfg.paneOrigins` per request, so it may be assigned once the proxies are listening.

**Migrating homefree to the package:** its RC app reaches the harness over the Docker bridge, so it will need `QA_BIND_HOST=0.0.0.0`, plus the hostname it uses for the host (for example `host.docker.internal`) in `QA_ALLOWED_HOSTS`.

## HTTP API (harness port)

| | |
|---|---|
| `GET /` | harness UI |
| `GET /api/state` | session status, tags, `buildRun: {url, status, message}`, pane login URLs + origins |
| `GET /api/prs` | open PRs with build readiness (`imageStatus`, `runUrl`, `reason`) |
| `GET /api/build-status?pr=N` | `{pr, status, exists, runUrl}`, plus `reason` when `status` is `blocked` |
| `GET /api/progress` | server-sent boot progress (`step`, `build`, `ready`, `error` with `logTail`, `torn-down`) |
| `POST /api/session` `{pr, takeover?}` | boot a session (one at a time; `takeover` replaces the current one) |
| `GET /api/verdict/preview?verdict=accept\|reject&notes=` | the comment + labels that would be posted |
| `POST /api/verdict` `{verdict, notes}` | post the verdict comment and set the label |
| `POST /api/teardown` `{}` | tear down the session (cancels an in-flight boot) |

Every path also answers under a `/qa` prefix. POSTs must be same-origin and `application/json` (`403` / `415`), and a request to any of the three ports with an unrecognised `Host` gets `421`. A request target the harness can't parse as a URL gets `400`, and once `shutdown()` has begun every harness write gets `503`. While no session is ready, the pane proxies answer `503`.

## Demo

```sh
npm run demo            # then open http://127.0.0.1:4100/
```

Demo mode runs the real conductor with fixture PRs and fake adapters, so you can try the whole harness with no GitHub, containers or databases. Everything listens on `127.0.0.1`: the harness on `PORT` (default `4100`), and the pane proxies and the two in-process pane apps on free ports. `QA_DEMO_SPEED` scales the fake build and boot delays (default `1`; `0` makes them instant). Ctrl-C (or SIGTERM/SIGHUP) stops it.

- **#101, #102** are built and open in seconds. **#103** is mid-build. **#104** builds, then its app crashes at *starting*, with a log tail. **#105** is refused by the trust gate (its head is in someone else's fork).
- The PR pane is visibly different from the base: a new heading, a purple accent and an extra sort control on *Products*. Both panes have several pages, forms and long pages, for trying mirroring.
- Verdicts go to an in-memory GitHub fake and are printed to the console. Nothing leaves the machine.

`demo/` is not published with the package. From code, `startDemo({ port, speed, log })` in `demo/index.mjs` returns `{ stop(), ports }`.

## QA this repo's own pull requests

```sh
echo 'GITHUB_QA_TOKEN=<token>' > .env.qa   # read PRs, comment and label on this repo
npm run qa                                  # then open http://127.0.0.1:3100/
```

qa-conductor QAs its own PRs with its own built-in adapters (`qa/self.mjs`):
- **Panes.** Each pane is a git worktree of this repo, base (`main`) and the PR head, running demo mode (`node demo/server.mjs`). A UI change shows up side by side before it merges.
- **Builds.** `build-worktree` checks a PR out only after the trust gate passes: the author has write access, and the head lives in this repo or the author's own fork. There is no install step, because the package has no dependencies.
- **Processes.** `provisioner-process` runs each pane on `127.0.0.1` with only `PATH`, `PORT` and `QA_DEMO_SPEED` in its environment.
- **Where things live.** Builds and the pidfile are under `$XDG_CACHE_HOME/qa-conductor/critical-labs-qa-conductor`, defaulting to `~/.cache/...`.
- **Stopping.** Ctrl-C tears the panes down before exiting.

`.env.qa` accepts the usual configuration keys, plus `QA_BASE_REF`, the branch the base pane runs (default `main`). `QA_ENV_FILE` points at a different file.

## Develop

```sh
npm test
```

The suite runs on `node:test` with injected effects, so it needs no Docker, network or GitHub.

## License

[MIT](LICENSE)
