**Round 2, item by item: all fixed in `20f945b`** (on `main` at `561bd84`, which has #39 merged).

**Also needed: merge `main`.** Done by merging, never rebasing: `264a400` merges `561bd84` in.
- The conflicts with #38 in the Docker Provisioner and its tests are resolved, keeping both.
- `lib/forwarder.mjs` is #39's final version (`6d055a8`), plus this PR's 3-line `node -e` guard and the carried-over items below.
- `git diff --name-status 561bd84..20f945b` lists only this PR's own files: 12 files, +1442 −175.

**Medium 1, a fallback silently restored full egress.** Fixed as you proposed; it's judgment call G in the body.
- With `internal` set and the topology fallen back, the check's result is never better than `unknown`. An `isolated` probe becomes `unknown`, and `reachable` stays `reachable`. The result ends with the reason `egress isn't restricted: the PR pane's internal network couldn't be set up (…)`. So `QA_REQUIRE_ISOLATION=1` refuses, and the chip shows why.
- The fallback is always logged, through a new `log` option (default `console`): `[qa] the PR pane's internal network couldn't be set up (…): it runs on an ordinary network, and its egress isn't restricted`.
- The README heading "It fails closed" is now "If it can't be set up". It says all of the above.
- **The new test** runs on a Linux runtime, so there's no Docker Desktop reason. The `node:22-alpine` pull fails with a rate limit. A clean probe gives `unknown`, a probe that hit stays `reachable`, and both give the reason and the log line.

**Medium 2, DNS (CVE-2024-29018).** Fixed.
- On Docker, the PR pane's containers run with `--dns 192.0.2.1` (TEST-NET-1: not loopback, and nothing answers there). That covers postgres, migrate, the app and the probe.
  - With a custom `--dns`, dockerd resolves outside names from the container's own namespace, which on an internal network has no route. Names on the network still resolve through the embedded DNS.
  - The base pane and the forwarder get no `--dns`, and neither does anything without `internal` or after a fallback.
- **Podman gets none (a judgment call):** aardvark-dns already answers NXDOMAIN for outside names on an internal network, and a `--dns` there would replace it.
- **The README** has the limit: the affected versions, the workaround, and that a container you start on `qa-session-pr` yourself has no `--dns`.
- **The check by hand** adds both commands:
  - `docker run --rm --network qa-session-pr --dns 192.0.2.1 busybox nslookup example.com` (as the PR pane resolves; on Podman, without `--dns`) must fail;
  - `docker run --rm --network qa-session-pr busybox nslookup example.com` must fail too. I didn't write a bare "must fail" for that one: on an affected Engine it answers, which is the CVE, and the README says so and to upgrade.
- **Tests:** `test/docker.test.mjs` covers the argv. `test/provisioner-docker.test.mjs` checks which containers get `--dns` with the topology up, and that none do on Podman or after a fallback.

**Low, "up" was decided from exit codes alone.** Fixed.
- The fresh network is read back with `networkInternal`.
- Then the forwarder must be running (the new `docker.containerRunning`) and must have logged `qa-forwarder ready`, within `forwarderReadyMs` (new option, default 10 s).
- Any of these failing falls back, with its reason.
- Triage for the PR app adds `qa-fwd-pr`'s log tail under `[qa-fwd-pr]`, with the topology up only.
- The comment in `forwarder.mjs` now says what happens: the Provisioner falls back, and the verdict says egress isn't restricted.
- **Tests:** a network that reads back not internal, a forwarder that exited, and one that never says ready, each falling back. Plus a triage test.

**Low, the podman-docker shim's failing `info`.** Fixed. `osError` is skipped when `docker version` names Podman. Test: the shim's banner and its failing template `info`, with the topology up, give `isolated` with `internal: true`.

**Low, the proxy control needed an answer for every target.** Fixed.
- A `proxied` or `refused` line is required for every via target, or the result is `unknown`.
- The reason names up to 5 silent targets and counts the rest: "the forwarder's proxy at qa-egress:3128 didn't answer the probe for N of M targets (…), so it can't say what the proxy lets through there".
- No answer at all keeps the old reason. Test: 1 of the targets answered gives `unknown`, naming the others.

**Low, the fallback's undo ignored a failed `network rm`.** Fixed.
- When the undo can't remove the internal network, the boot fails with "the PR pane's internal network couldn't be set up (X), nor removed: Y".
- When it finds an internal network still there as it makes the ordinary one, it fails with "… and a network qa-session-pr is still there, and internal". It never reuses it.
- Tests cover both.

**Nit, the teardown gap.** A new test checks the base pane's teardown: `rm -f -v qa-app-base qa-migrate-base qa-pg-base` and `network rm qa-session-base`, nothing of the forwarder or the edge network.

**Nit, the README's sweep text.** Fixed.
- The internal-network section now says `sweep` removes the edge network only while `internal` is on. One left by an earlier run stays until `docker network rm qa-session-pr-edge`. The forwarder is swept by its label.
- The general `sweep` bullet adds the forwarder and, only while `internal` is on, the edge network. The `teardown` bullet says the PR pane's removes the forwarder and the edge network, and the base pane's leaves them alone.

**Carried over from #39's round 3 (comment 6322524628):**
1. **The idle timer counted backpressure as idle.** Fixed for plain HTTP and for tunnels. The inbound forward has no idle timer. Idle now means nothing moved through the connection: `idleTimer` in `lib/forwarder.mjs`.
   - **A tunnel now has one timer, on the PR's side,** in place of one per side. Every byte either way is read or written there, and the host's side counts as its peer.
   - **The trigger is unchanged:** a socket's own timer fires after `idleMs` with no I/O on it.
   - **It is then spared, and re-armed, when either holds:**
     - it is only waiting on the other side (paused by backpressure, or the other side's socket has `writableNeedDrain`), and that side has moved since the last look. "Moved" means its bytes read, its bytes queued or still queued, or its libuv write queue changed;
     - either side moves within a short grace (`min(idleMs, 250 ms)`).
   - **Why the grace:** a stalled event loop fires timers before the I/O that was due, which then looks like idleness.
   - **So:**
     - a tunnel with nothing moving is cut within `idleMs` plus the grace;
     - a tunnel where each side waits on the other is cut within twice `idleMs` plus the grace;
     - one waiting on a slow but steady reader isn't cut.
   - **A bug I hit on the way:** `socket.setTimeout(ms, cb)` adds `cb` with `once`, so the first re-arm in my first version dropped the listener, and the socket was never cut afterwards. Now the listener is added once with `on`, and re-arms only reset the timer. A test re-arms many times and then checks the cut still comes.
   - **Tests:**
     - **The timer's rules, at 100–200 ms with stand-in sockets on real timers, deterministic:**
       - nothing moving is cut after `ms` and the grace;
       - a socket waiting on a peer that moved since the last look is spared, then cut;
       - a paused socket whose peer keeps moving survives about ten re-arms, then is cut once the peer stops;
       - each side waiting on the other is still cut;
       - a stalled event loop (a 200 ms busy-wait past the deadline) is spared by I/O that lands in the grace;
       - a socket gone during the grace isn't cut.
     - **End to end, your scenario:** a host sends 2 MiB and closes, and a client reads one chunk every 100 ms. Every byte arrives through a tunnel and through plain HTTP.
     - **The other direction:** a PR uploads 16 MiB to a host that reads one chunk every 100 ms for 2 s, and every byte arrives.
   - **Judgment call: the end-to-end tests use `idleMs` 1000, not 300.**
     - On this Mac, the loopback's kernel buffers sometimes held a steady reader's bytes out of the forwarder's sight for more than 550 ms: no byte read, queued or handed to the kernel on either socket. The reader was reading one chunk every 100 ms.
     - At 300 ms, that cut 2 of 45 runs under load, with the fix in place.
     - What the forwarder can see, it handles. The rules are pinned at 100–200 ms by the deterministic tests above.
   - **Limit:** bytes already in the kernel's buffers move where no timer sees them. A reader that drains them slower than one idle period can still be cut at the tail. At the 5-minute default, that means a reader slower than the kernel's buffers per 5 minutes.
2. **A reset or idle cut reached the other side as a clean FIN.** Fixed with `reset()`. It uses `resetAndDestroy()` where the socket has a handle, and `destroy()` while it's still connecting. It's used on the failure and idle paths:
   - the forward's error handlers;
   - plain HTTP's failure after the headers, and its cut answer;
   - CONNECT's PR-side error, its idle cut (both sides), and the upstream's error after the `200`.

   Clean closes keep `destroySoon()`. Tests:
   - a host that resets mid-stream gives the PR `ECONNRESET`, through a tunnel and through the forward;
   - a PR that resets mid-tunnel gives the host `ECONNRESET`;
   - a plain-HTTP answer cut partway gives an HTTP/1.0 client, whose answer is close-delimited, `ECONNRESET` rather than a clean end;
   - an idle cut, and an upstream error after the `200`, give `ECONNRESET`. The two existing tests now expect it.
3. **Untested teardowns.** Two tests added:
   - a host's clean close ends the forwarder's side of the tunnel even while the PR keeps its own side open (D2c, D2b). This covers the tunnel only, because the plain forward is half-open by design;
   - a PR that leaves partway through a plain-HTTP answer frees its upstream (H5).

**#39's nits:**
- The CONNECT comment is reworded: one that resets during the lookup gets nothing dialled, and one that leaves with a FIN is dialled, then torn down at once.
- `forward.to` with whitespace is rejected in `checkConfig`.
- The must-throw lists add `@evil.org`, `/evil.org`, `//evil.org`, `\evil.org`, `api.example.com%2e`, `api.exa\nmple.com`, and the CONNECT target `@api.example.com`.
- The lookalike slashes U+2044, U+2215 and U+29F5 are refused, with tests.
- A comment says CONNECT targets get no percent-decoding.

**Mutation:** 47 hand mutants of the new code, 45 killed.
- **Provisioner and `createDocker`:** 25 of 25 killed. They cover:
  - the cap at `unknown`;
  - the log line;
  - each `--dns` site, and Podman's exception;
  - the read-back, the running check and the readiness wait;
  - triage;
  - the shim's `osError`;
  - every proxy target;
  - the undo's two refusals;
  - the base pane's teardown.
- **Forwarder:** 20 of 22 killed. They cover:
  - each `reset()` site;
  - whitespace in `forward.to`;
  - the lookalike slashes;
  - your D2b, D2c and H5;
  - ten of the idle timer's eleven. Those are `once` for `on`, no peer check, waiting alone re-arming, no grace, a grace that ignores movement, a coarser `movedOn`, no destroyed check, no idle timer on plain HTTP or on a tunnel, and a cut that leaves the host's side.
- **Two survive:**
  - **CONNECT's `socket.on('close', () => upstream?.destroySoon())` removed.** I read this one as equivalent: the CONNECT socket is half-open. It closes only after an error, whose handler already resets the upstream, or after both sides have ended, by which point the pipe has already ended the upstream.
  - **Plain HTTP's `waiting` predicate always false.** The grace masks it in every test I can run deterministically: the client's next read lands within 250 ms. It matters only for a client whose reads come further apart than the grace but within `idleMs`. The same rule is pinned for the tunnel by the stand-in tests.

**Tests:** 803/803 on Node 24 and on Node 22, `node --test --test-force-exit`. The forwarder file passed 5 of 5 runs on Node 22. CI is green on Node 22 and 24 at `20f945b`.
