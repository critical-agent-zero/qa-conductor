Part of #32. This is the second of three PRs, per the design in #32 (comment 6195734695):
- **1, #39 (merged):** `lib/forwarder.mjs`, the forwarder and its egress allowlist.
- **2, this PR:** the Docker Provisioner's opt-in `internal` topology, which runs that file in a container. It also adds the probe's check through the proxy, the floors, and the README (topology, guarantees, a check by hand for each runtime).
- **3, #41:** the docs-only opt-ins (Unix-socket listeners, a `sandbox-exec` recipe, tagging the node). Only PR 3 is marked as completing issue 32.

**Draft.** It is on `main` (`561bd84`), which has #39 merged, and follows `main` by merging, never by rebasing. `git diff --name-status 561bd84..5d2df65` lists only this PR's files: 15 files. Round 2 (the review in comment 6199021907, and #39's carried-over round-3 items from comment 6322524628) is answered item by item in comment 6324232708. Round 3 (round 2's lows and nits, comment 6341612759, and owner decision A, CI on a real runtime) is answered item by item in comment 6342340538.

## Judgment calls (conservative defaults; say if you want another)

- **A. Opt-in, off by default** (`internal: true`, or `{ egress, image }`). It pulls a Node image and runs one more container, and its effect on Docker Desktop and Podman machine can only be checked by hand. Without `internal`, nothing changes: the same argv, env, teardown and sweep as before.
- **B. Only the PR pane is internal.** The base pane isn't PR code.
- **C. The Provisioner sets the proxy env, not the EnvTransform,** since the topology is the Provisioner's.
  - The PR pane's env gets `HTTP_PROXY`, `HTTPS_PROXY`, their lowercase forms, `NO_PROXY` and `NODE_USE_ENV_PROXY=1`, over the EnvTransform's values.
  - The base pane's env is unchanged, so the panes' envs differ in those keys.
  - An app that ignores them reaches nothing outside its network.
- **D. No per-boot proxy token.** Only the PR pane's own containers can reach `qa-egress`.
- **E. The macOS floor is lifted only by the check's result.**
  - A Provisioner's `internal: true` says it *means* to use an internal network. That defers the macOS floor to its check, so strict mode doesn't refuse at start.
  - Only a result that says `internal: true` (the topology is up) leaves the floor out.
  - If the topology fell back, the floor applies at the check, and `QA_REQUIRE_ISOLATION=1` refuses there, before any PR code runs.
- **F. With the topology up, the runtime's own reasons give way to the probe.** Those are Docker Desktop's forwarding, Podman's networks, and a `docker info` that fails under the podman-docker shim: the very things the internal network is for.
  - The probe tries the same addresses as ever, from the internal network.
  - It also sends each of them through the forwarder's proxy as a `CONNECT`. A `200` is a hit.
  - The proxy must answer for every target, `proxied` or `refused`. One it is silent on makes the verdict `unknown`, naming it.

  Lifting the floors rests on this probe, on CI's `docker-integration` job (P), and on the README's check by hand for Docker Desktop and Podman machine (#43).
  - Under the podman-docker shim (new in round 3), the endpoint is Podman's own connection, and a network's gateways are read in Podman's format, so the probe decides there too. Teardown under the shim is a follow-up (S).
- **G. If the topology can't be set up, the verdict is never better than `unknown`** (new in round 2).
  - Any failing step undoes the rest: the edge network, the internal network, the forwarder's image, the forwarder, the join, or its readiness. The PR pane then runs as it would without `internal`: on an ordinary network, its app published, no proxy.
  - The operator asked for an egress allowlist that isn't in force, so:
    - the check's result carries no `internal` and is capped at `unknown`, with the reason "egress isn't restricted: the PR pane's internal network couldn't be set up (…)". `QA_REQUIRE_ISOLATION=1` then refuses;
    - the fallback is always logged, through a new `log` option (default `console`).
  - The undo must remove the internal network. If it can't, or finds an internal one still there as it makes the ordinary one, the boot fails.
  - An internal network left over is reused only when it is internal.
  - A forwarder that dies later takes the PR app's port with it.
- **H. The forwarder runs only when given to `node -e`.** The conductor imports `lib/forwarder.mjs` to check the allowlist when the Provisioner is made, so a `PANE_FORWARDER` in the conductor's own env must not start one. This adds 3 lines and a test to #39's file.
- **I. The forwarder:**
  - **The image:** `node:22-alpine`, configurable, pulled through `ensureImage`. The registry login is GHCR's only, so an image elsewhere needs the daemon's own credentials.
  - **How it runs:** `--entrypoint node`, with no capabilities, a read-only root, `no-new-privileges`, user `node` and no mounts.
  - **What it gets:** its source and its config go in argv and one env var. Neither holds a secret, and both show in `docker inspect`.
- **J. The forwarder listens on IPv4,** as its `host: '0.0.0.0'`.
- **K. `sweep` removes the edge network only while `internal` is on.** A run with it on, then off, leaves an empty, labelled network until `docker network rm qa-session-pr-edge`. Its forwarder is swept by its label. The README says so.
- **L. No DNS out, on Docker and on Podman** (new in round 2, corrected in round 3).
  - The PR pane's containers run with `--dns 192.0.2.1`, which isn't loopback and which nothing answers. This is CVE-2024-29018's workaround, which covers every Engine version.
  - **Corrected:** round 2 gave Podman none, on round 1's review's word that Podman's DNS answers nothing outside an internal network. CI disproved that: Podman 4.9 forwards outside names. So Podman's PR containers get `--dns 192.0.2.1` too. A `--dns` there replaces Podman's own DNS, so the names the pane needs (`qa-pg-pr`, `qa-egress`) go in its hosts files (`--add-host`).
  - The forwarder and the base pane get none.
- **M. "Up" means read back, not just exit codes** (new in round 2).
  - The fresh network must read back as internal.
  - The forwarder must be running and must have logged that it is ready, within `forwarderReadyMs` (new option, default 10 s).
  - Triage adds the forwarder's log tail to the PR app's.
- **N. The forwarder's idle means nothing moved through the connection** (#39's carried-over item).
  - A tunnel has one timer, on the PR's side.
  - A side only waiting on the other isn't idle while that side moves.
  - A short grace (`min(idleMs, 250 ms)`) lets I/O that a stalled event loop delayed show up before anything is cut.
  - Each side waiting on the other is still cut, within twice `idleMs`.
- **O. The end-to-end idle tests run at `idleMs` 1000, not the review's 300, with a reader that takes a chunk every 300 ms.** At 300, macOS's loopback buffers sometimes hid a steady reader's progress for more than 550 ms (2 of 45 runs under load). Reading every 300 ms (round 3) is slow enough that `main`'s timers fail the tests. The timer's rules are pinned at 100–200 ms with stand-in sockets.
- **P. CI on a real runtime** (owner decision A, round 3). A `docker-integration` job runs `test/integration/docker-internal.test.mjs` on Linux, against Docker Engine and against Podman through its Docker-compatible socket.
  - It boots both panes on the topology. It checks the probe's `isolated`, that nothing leaves the PR pane but through the allowlist, DNS, a fallback refused under `QA_REQUIRE_ISOLATION=1`, and that teardown and sweep leave nothing.
  - It runs only when `QA_DOCKER_IT=1` asks, and the job fails on any skip.
  - Its first runs found a sweep that failed on a clean host (the CLI's `exit status 1` line), Podman's DNS (L), and Q. All three are pinned in the job.
- **Q. A host service listening on `0.0.0.0` is reachable from the PR pane** (a limit CI found). It is reached at the PR network's gateway, the host's own address on that bridge. The probe reports it as `reachable`, naming the address, and the README states the limit: keep host services the PR pane mustn't reach off `0.0.0.0`.
- **R. A plain-HTTP answer's PR side is bounded from its headers on** (round 3). `res.setTimeout(idleMs)` cuts a PR side where nothing moves, so a PR that stops reading near the end of an answer the host has finished can't hold it. It is armed at the headers: before them, the host side's timer decides, and a host that never answers still gets a `502`.
- **S. Teardown under the podman-docker shim is a follow-up, and fails closed.** Podman's own `rm -f`, given a name that doesn't exist, exited 0 but removed none of the containers in a scratch CI run. So the pane's `network rm` fails and `teardown` rejects; `sweep` then removes the containers by id. A fix, and a CI leg for the shim, come in a follow-up.

## What changes

- **`lib/adapters/provisioner-docker.mjs`:**
  - the `internal` option, checked as the Provisioner is made, plus the `forwarderReadyMs` and `log` options;
  - `internal`, a member saying the option is on;
  - the topology in `provisionDatabase` for the PR pane: its read-backs, its fallback and that fallback's undo;
  - the proxy env;
  - `--dns` for the PR pane's containers;
  - the app with no host port;
  - teardown, sweep and triage of the forwarder and the edge network;
  - the probe's proxy part, and its result's `internal`, or a fallback's cap.
- **`lib/docker.mjs`:**
  - `createNetwork(name, { internal })`, `networkInternal`, `containerRunning`, `runForwarder`, `connectNetwork` and `addressOn`;
  - `runApp` with a `null` port;
  - `dns` and `hosts` options on `runPg`, `runMigrate`, `runApp` and `runProbe`;
  - the CLI's `exit status N` line counted as noise;
  - an `env` option and `endpoint({ podman })`, and `networkGateways` in Podman's format too, for the podman-docker shim.
- **`lib/isolation.mjs` and `lib/server.mjs`:** `floors` takes `internal`. The core reads the Provisioner's intent at the start, and the check's `internal` at the panes.
- **`lib/forwarder.mjs`:**
  - the `node -e` guard (H);
  - #39's carried-over round-3 items:
    - idle as nothing moved: one timer per tunnel, a grace for a stalled event loop, and a listener that outlives a re-arm;
    - resets, not clean ends, on the failure and idle paths;
    - whitespace refused in `forward.to`;
    - lookalike slashes refused;
    - two comments;
  - round 3: a plain-HTTP answer's PR side bounded from its headers on (R), and the container entry logging every line to stdout, so triage's tail shows refusals.
- **CI:** the `docker-integration` job in `.github/workflows/ci.yml`, pinned in `test/package.test.mjs`, and `test/integration/docker-internal.test.mjs` (P).
- **Docs:**
  - README:
    - the `internal`, `forwarderReadyMs` and `log` options;
    - a section on the topology, the allowlist (per address, not per host), the verdict, readiness, the fallback, cleanup, the limits (DNS included) and the check by hand;
    - a row in the runtime table;
    - the floors, the seams contract, and `createDocker`'s members.
  - The CHANGELOG.

## Tests and review

- **Tests:** 811 passed and 0 failed on Node 24 and on Node 22 (`node --test --test-force-exit`); the 3 integration tests skip without `QA_DOCKER_IT=1`, and CI's `docker-integration` job runs them. New here:
  - `test/provisioner-docker.test.mjs`, 17 tests:
    - **round 1:**
      - the topology and its order;
      - the forwarder's argv and config, and its source as it is;
      - the PR pane's containers on the internal network alone, and its env;
      - nothing changing without `internal`, and `internal: true` meaning no egress;
      - the options;
      - a fallback for each step, with the verdict's reason;
      - a left-over network reused only when internal;
      - an abort mid-setup;
      - teardown and sweep;
      - the verdict with the topology up: Docker Desktop and Podman giving way, `proxied`, no proxy answer, IPv6 targets bracketed;
      - the probe script's proxy part, run with bash against a loopback proxy.
    - **round 2:**
      - a fallback on a Linux runtime is never `isolated`, and is logged;
      - which containers get `--dns`;
      - the read-backs and readiness;
      - triage;
      - the podman-docker shim's failing `info`;
      - the proxy answering for every target;
      - the fallback's undo;
      - the base pane's teardown;
    - **round 3:**
      - Podman's `--dns` and hosts entries;
      - the shim's endpoint and context;
      - readiness polled until ready, and an abort while polling;
      - a `docker version` that fails after readiness;
      - an aborted boot beside the next one.
  - `test/docker.test.mjs`: the new argv, `dns`, `hosts` and `containerRunning`, the `exit status` noise, `endpoint` under the shim, and `networkGateways` in Podman's format.
  - `test/isolation.test.mjs`: `floors`' `internal`.
  - `test/server.test.mjs`, 2 tests, on macOS:
    - the floor lifts only on a result that says `internal`;
    - strict mode waits for the check, then refuses one that fell back.
  - `test/forwarder.test.mjs`:
    - the import guard;
    - #39's carried-over items:
      - the idle timer's rules, with stand-ins;
      - a slow, steady reader, and a slow host;
      - resets both ways, an idle cut reaching the host, and an answer cut for an HTTP/1.0 client;
      - a host's clean close, and a PR leaving mid-answer;
      - more must-throw entries;
    - round 3:
      - a finished answer to a PR that never reads, swept over 24 sizes;
      - a host that resets or stalls after the headers;
      - a client reset through the inbound forward;
      - the container entry's refusals on stdout;
      - the e2e idle tests reading every 300 ms.
- **Mutation:**
  - round 1: 32 hand mutants, all killed;
  - round 2: 47, 45 killed. One survivor is equivalent; the other, plain HTTP's `waiting` predicate, is masked by the grace (comment 6324232708 has both);
  - round 3: 22, 20 killed. The survivors put a naive timer on the tunnel's PR side, or the idle timer on its host side, which loopback's buffers don't tell apart (comment 6342340538).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MkcLhvB2oguJrgFNRVqAxy


