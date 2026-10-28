**Round 3 (comment 6346864438), item by item: in `102bc63`,** one commit on `5d2df65`. `git diff --name-status 561bd84..102bc63` lists only this PR's files. CI is green on it: `test (22)`, `test (24)`, and `docker-integration` on Docker Engine 28.0.4 and Podman 4.9.3.

**1. High: under the podman-docker shim on Podman before 5.1, teardown left the PR's containers.** Fixed.
- **`rmForce` removes one name at a time.** It tries every name, and rejects with the first failure that isn't a name already gone. `sweepQaContainers` uses it, so the sweep does the same, including a container gone between its list and its `rm`.
- I chose one call per name over a batch-then-check, because no output tells a Podman-before-5.1 no-op from a success. Teardown now makes at most five `rm` calls a pane.
- **Test:** a fake `docker` with Podman before 5.1's semantics: `rm -f a b c` with any name missing removes nothing and exits 0.
  - The old batch, on `qa-app-pr qa-migrate-pr qa-fwd-pr qa-pg-pr`, leaves all three present containers.
  - `rmForce` on the pane's five names removes them all.
  - The sweep, with one container gone between its `ps` and its `rm`, removes the rest.
- **Mutants:** the batch put back, and throwing at the first failure (which skips the other names), are both killed.

**2. Medium: the 0.0.0.0 gap on Docker Engine 28 and later.** Closed there.
- **Docker Engine 28 and later:** `qa-session-pr` is created with `--internal -o com.docker.network.bridge.gateway_mode_ipv4=isolated -o com.docker.network.bridge.gateway_mode_ipv6=isolated`.
- **Older Engines and Podman:** `docker version`'s Server section decides, and these get a plain `--internal` network. The new `dockerEngineMajor(version)`, exported, gives `null` for Podman or no server.
- **An Engine that refuses the option** gets a plain internal network, never the unrestricted-egress fallback, and nothing is logged as a fallback.
- **The reuse path:** a leftover internal network without the isolated gateway, where it could have one, is removed and made again (`networkGatewayIsolated(name)` is new in `createDocker`). One with it is reused.
- **The README's limit** now says what holds where. Closed on Docker Engine 28 and later; on Podman and older Engines the bridge keeps the host's address, and the limit stands. The CHANGELOG says the same.
- **CI pins it:**
  - **Docker leg:** "docker version says Engine 28; the internal network's IPv4 gateway mode: isolated". The 0.0.0.0 canary is reached nowhere, and the verdict is `isolated`.
  - **Podman leg:** it is reached at the PR network's own gateway alone (`10.89.2.1`), and the verdict is `reachable`.
- **Unit tests:**
  - Engine 28 and 29 isolate, and 27 and Podman don't;
  - an option refused leaves a plain internal network that is up and `isolated`, with no fallback;
  - a leftover without the option is made again, and one with it is reused;
  - `dockerEngineMajor`'s cases.

  The mutants on the version threshold, the refusal path, the reuse check and the Server section are all killed.

**3. Medium: the real-runtime test didn't check for a direct route out.** Fixed as proposed.
- **No direct route out:**
  - `nc -z -w 3 1.1.1.1 443` succeeds from the base pane (the control) and fails from the PR pane;
  - the same with `2606:4700:4700::1111` where the base pane has IPv6. GitHub's runners have none, which the test says in a diagnostic.
- **The 0.0.0.0 canary's reach is pinned:** on Podman, every address it was reached at must be one of the PR network's own gateways, so reaching the base gateway or `172.17.0.1` fails the test. On Docker 28, as in 2, it must be reached nowhere.

**Low, the README and the test comment.**
- README:557 now says "the host's loopback".
- The checked list adds the direct-route pair and the 0.0.0.0 canary per runtime.
- The probe's bullet says it reports this for the conductor's own port only: each session's probe tries the harness port, not other host services.
- The test comment is rewritten for both runtimes.

**Low, the metadata check couldn't fail, and "listed allowed" took a 502.** Fixed.
- **Metadata:** `nc -z -w 3 169.254.169.254 80`, with the base pane as its control. If the base pane can't reach it either, the test says so in a diagnostic. On CI the base pane reached it, and the PR pane didn't.
- **The listed address:** the proxy's answer for it is logged, and on CI (`CI=true`) only `200 Connection Established` passes. Both legs got 200.
- **`nslookup`:** its output must show it ran (`Server:`, or a timeout) before the test asserts it found no answer.

**Low, README:591.** Qualified: a slow reader still reading isn't idle as long as each `idleMs` it frees some room. A plain-HTTP answer's PR side is timed on its own, and the kernel's buffers can hide a very slow reader's progress for longer, so such a reader can be cut.

**Nits:**
- **The leftovers check:**
  - its positive control lists the pane containers (five or more) and all three networks while the panes are up;
  - the test checks for no leftovers right after the two teardowns, before `sweep()`, and again after it.
- **The noise-regex mutant:** a failure whose line ends in `exit status 125` (`Error: OCI runtime error: crun: kill: exit status 125`) must reject, and a line that is nothing but `exit status 1` stays noise. The `/exit status/` mutant is killed.
- **`ℹ todo 0`:** the job's last step checks it too, pinned in `test/package.test.mjs`. The third test is retitled "never better than unknown".
- **A host that never answers:** a new forwarder test has a listed host take the request and never answer. The PR gets `502` with `X-QA-Egress: failed` after `idleMs`, never a reset, so arming the PR-side timer before `req.pipe` (your P4) is killed.

**Owner note:** the PR body now says `docker-integration` isn't a required check. Making both legs required is a repository setting for after this lands.

**Tests:** 818 passed and 0 failed on Node 24 and on Node 22 (`node --test --test-force-exit`); the 3 integration tests skip without `QA_DOCKER_IT=1`. Mutation: 9 hand mutants of this round's code, all killed.
