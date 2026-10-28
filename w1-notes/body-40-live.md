Part of #32. This is the second of three PRs, per the design in #32 (comment 6195734695):
- **1, #39 (merged):** `lib/forwarder.mjs`, the forwarder and its egress allowlist.
- **2, this PR:** the Docker Provisioner's opt-in `internal` topology, which runs that file in a container. It also adds the probe's check through the proxy, the floors, and the README (topology, guarantees, a check by hand for each runtime).
- **3, #41:** the docs-only opt-ins (Unix-socket listeners, a `sandbox-exec` recipe, tagging the node). Only PR 3 is marked as completing issue 32.

**Draft.** It is on `main` (`561bd84`), which has #39 merged, and follows `main` by merging, never by rebasing. `git diff --name-status 561bd84..20f945b` lists only this PR's files: 12 files, +1442 −175. Round 2 (the review in comment 6199021907, and #39's carried-over round-3 items from comment 6322524628) is answered item by item in comment 6324232708.

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

  Lifting the floors rests on this probe plus the README's check by hand per runtime. Nothing here runs real Docker.
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
- **L. No DNS out, on Docker** (new in round 2).
  - The PR pane's containers run with `--dns 192.0.2.1`, which isn't loopback and which nothing answers. This is CVE-2024-29018's workaround, which covers every Engine version.
  - Podman gets none: its DNS answers nothing outside an internal network, and a `--dns` there would replace it.
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
- **O. The end-to-end idle tests run at `idleMs` 1000, not the review's 300.** At 300, macOS's loopback buffers sometimes hid a steady reader's progress for more than 550 ms (2 of 45 runs under load). The timer's rules are pinned at 100–200 ms with stand-in sockets.

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
  - `createNetwork(name, { internal })`, `networkInternal`, `containerRunning`, `runForwarder` and `connectNetwork`;
  - `runApp` with a `null` port;
  - a `dns` option on `runPg`, `runMigrate`, `runApp` and `runProbe`.
- **`lib/isolation.mjs` and `lib/server.mjs`:** `floors` takes `internal`. The core reads the Provisioner's intent at the start, and the check's `internal` at the panes.
- **`lib/forwarder.mjs`:**
  - the `node -e` guard (H);
  - #39's carried-over round-3 items:
    - idle as nothing moved: one timer per tunnel, a grace for a stalled event loop, and a listener that outlives a re-arm;
    - resets, not clean ends, on the failure and idle paths;
    - whitespace refused in `forward.to`;
    - lookalike slashes refused;
    - two comments.
- **Docs:**
  - README:
    - the `internal`, `forwarderReadyMs` and `log` options;
    - a section on the topology, the allowlist (per address, not per host), the verdict, readiness, the fallback, cleanup, the limits (DNS included) and the check by hand;
    - a row in the runtime table;
    - the floors, the seams contract, and `createDocker`'s members.
  - The CHANGELOG.

## Tests and review

- **Tests:** 803/803 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). New here:
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
      - the base pane's teardown.
  - `test/docker.test.mjs`: the new argv, `dns` and `containerRunning`.
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
      - more must-throw entries.
- **Mutation:**
  - round 1: 32 hand mutants, all killed;
  - round 2: 47, 45 killed. One survivor is equivalent; the other, plain HTTP's `waiting` predicate, is masked by the grace (comment 6324232708 has both).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MkcLhvB2oguJrgFNRVqAxy

