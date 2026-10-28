import sys
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
REPLY = sys.argv[1]
s = open(N + 'body-40-live.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""**Draft.** It is on `main` (`561bd84`), which has #39 merged, and follows `main` by merging, never by rebasing. `git diff --name-status 561bd84..20f945b` lists only this PR's files: 12 files, +1442 −175. Round 2 (the review in comment 6199021907, and #39's carried-over round-3 items from comment 6322524628) is answered item by item in comment 6324232708.""",
    f"""**Draft.** It is on `main` (`561bd84`), which has #39 merged, and follows `main` by merging, never by rebasing. `git diff --name-status 561bd84..8a03d2d` lists only this PR's files: 15 files. Round 2 (the review in comment 6199021907, and #39's carried-over round-3 items from comment 6322524628) is answered item by item in comment 6324232708. Round 3 (round 2's lows and nits, comment 6341612759, and owner decision A, CI on a real runtime) is answered item by item in comment {REPLY}.""")
sub("""  Lifting the floors rests on this probe plus the README's check by hand per runtime. Nothing here runs real Docker.""",
    """  Lifting the floors rests on this probe, on CI's `docker-integration` job (P), and on the README's check by hand for Docker Desktop and Podman machine (#43).
  - Under the podman-docker shim (new in round 3), the endpoint is Podman's own connection, and a network's gateways are read in Podman's format, so the probe decides there too. Teardown under the shim is a follow-up (S).""")
sub("""- **L. No DNS out, on Docker** (new in round 2).
  - The PR pane's containers run with `--dns 192.0.2.1`, which isn't loopback and which nothing answers. This is CVE-2024-29018's workaround, which covers every Engine version.
  - Podman gets none: its DNS answers nothing outside an internal network, and a `--dns` there would replace it.
  - The forwarder and the base pane get none.""",
    """- **L. No DNS out, on Docker and on Podman** (new in round 2, corrected in round 3).
  - The PR pane's containers run with `--dns 192.0.2.1`, which isn't loopback and which nothing answers. This is CVE-2024-29018's workaround, which covers every Engine version.
  - **Corrected:** round 2 gave Podman none, on round 1's review's word that Podman's DNS answers nothing outside an internal network. CI disproved that: Podman 4.9 forwards outside names. So Podman's PR containers get `--dns 192.0.2.1` too. A `--dns` there replaces Podman's own DNS, so the names the pane needs (`qa-pg-pr`, `qa-egress`) go in its hosts files (`--add-host`).
  - The forwarder and the base pane get none.""")
sub("""- **O. The end-to-end idle tests run at `idleMs` 1000, not the review's 300.** At 300, macOS's loopback buffers sometimes hid a steady reader's progress for more than 550 ms (2 of 45 runs under load). The timer's rules are pinned at 100–200 ms with stand-in sockets.""",
    """- **O. The end-to-end idle tests run at `idleMs` 1000, not the review's 300, with a reader that takes a chunk every 300 ms.** At 300, macOS's loopback buffers sometimes hid a steady reader's progress for more than 550 ms (2 of 45 runs under load). Reading every 300 ms (round 3) is slow enough that `main`'s timers fail the tests. The timer's rules are pinned at 100–200 ms with stand-in sockets.
- **P. CI on a real runtime** (owner decision A, round 3). A `docker-integration` job runs `test/integration/docker-internal.test.mjs` on Linux, against Docker Engine and against Podman through its Docker-compatible socket.
  - It boots both panes on the topology. It checks the probe's `isolated`, that nothing leaves the PR pane but through the allowlist, DNS, a fallback refused under `QA_REQUIRE_ISOLATION=1`, and that teardown and sweep leave nothing.
  - It runs only when `QA_DOCKER_IT=1` asks, and the job fails on any skip.
  - Its first runs found a sweep that failed on a clean host (the CLI's `exit status 1` line), Podman's DNS (L), and Q. All three are pinned in the job.
- **Q. A host service listening on `0.0.0.0` is reachable from the PR pane** (a limit CI found). It is reached at the PR network's gateway, the host's own address on that bridge. The probe reports it as `reachable`, naming the address, and the README states the limit: keep host services the PR pane mustn't reach off `0.0.0.0`.
- **R. A plain-HTTP answer's PR side is bounded from its headers on** (round 3). `res.setTimeout(idleMs)` cuts a PR side where nothing moves, so a PR that stops reading near the end of an answer the host has finished can't hold it. It is armed at the headers: before them, the host side's timer decides, and a host that never answers still gets a `502`.
- **S. Teardown under the podman-docker shim is a follow-up, and fails closed.** Podman's own `rm -f`, given a name that doesn't exist, exited 0 but removed none of the containers in a scratch CI run. So the pane's `network rm` fails and `teardown` rejects; `sweep` then removes the containers by id. A fix, and a CI leg for the shim, come in a follow-up.""")
sub("""- **`lib/docker.mjs`:**
  - `createNetwork(name, { internal })`, `networkInternal`, `containerRunning`, `runForwarder` and `connectNetwork`;
  - `runApp` with a `null` port;
  - a `dns` option on `runPg`, `runMigrate`, `runApp` and `runProbe`.""",
    """- **`lib/docker.mjs`:**
  - `createNetwork(name, { internal })`, `networkInternal`, `containerRunning`, `runForwarder`, `connectNetwork` and `addressOn`;
  - `runApp` with a `null` port;
  - `dns` and `hosts` options on `runPg`, `runMigrate`, `runApp` and `runProbe`;
  - the CLI's `exit status N` line counted as noise;
  - an `env` option and `endpoint({ podman })`, and `networkGateways` in Podman's format too, for the podman-docker shim.""")
sub("""  - #39's carried-over round-3 items:
    - idle as nothing moved: one timer per tunnel, a grace for a stalled event loop, and a listener that outlives a re-arm;
    - resets, not clean ends, on the failure and idle paths;
    - whitespace refused in `forward.to`;
    - lookalike slashes refused;
    - two comments.""",
    """  - #39's carried-over round-3 items:
    - idle as nothing moved: one timer per tunnel, a grace for a stalled event loop, and a listener that outlives a re-arm;
    - resets, not clean ends, on the failure and idle paths;
    - whitespace refused in `forward.to`;
    - lookalike slashes refused;
    - two comments;
  - round 3: a plain-HTTP answer's PR side bounded from its headers on (R), and the container entry logging every line to stdout, so triage's tail shows refusals.
- **CI:** the `docker-integration` job in `.github/workflows/ci.yml`, pinned in `test/package.test.mjs`, and `test/integration/docker-internal.test.mjs` (P).""")
sub("""- **Tests:** 803/803 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). New here:""",
    """- **Tests:** 811 passed and 0 failed on Node 24 and on Node 22 (`node --test --test-force-exit`); the 3 integration tests skip without `QA_DOCKER_IT=1`, and CI's `docker-integration` job runs them. New here:""")
sub("""      - the proxy answering for every target;
      - the fallback's undo;
      - the base pane's teardown.""",
    """      - the proxy answering for every target;
      - the fallback's undo;
      - the base pane's teardown;
    - **round 3:**
      - Podman's `--dns` and hosts entries;
      - the shim's endpoint and context;
      - readiness polled until ready, and an abort while polling;
      - a `docker version` that fails after readiness;
      - an aborted boot beside the next one.""")
sub("""  - `test/docker.test.mjs`: the new argv, `dns` and `containerRunning`.""",
    """  - `test/docker.test.mjs`: the new argv, `dns`, `hosts` and `containerRunning`, the `exit status` noise, `endpoint` under the shim, and `networkGateways` in Podman's format.""")
sub("""      - a host's clean close, and a PR leaving mid-answer;
      - more must-throw entries.""",
    """      - a host's clean close, and a PR leaving mid-answer;
      - more must-throw entries;
    - round 3:
      - a finished answer to a PR that never reads, swept over 24 sizes;
      - a host that resets or stalls after the headers;
      - a client reset through the inbound forward;
      - the container entry's refusals on stdout;
      - the e2e idle tests reading every 300 ms.""")
sub("""  - round 2: 47, 45 killed. One survivor is equivalent; the other, plain HTTP's `waiting` predicate, is masked by the grace (comment 6324232708 has both).""",
    f"""  - round 2: 47, 45 killed. One survivor is equivalent; the other, plain HTTP's `waiting` predicate, is masked by the grace (comment 6324232708 has both);
  - round 3: 22, 20 killed. The survivors put a naive timer on the tunnel's PR side, or the idle timer on its host side, which loopback's buffers don't tell apart (comment {REPLY}).""")
open(N + 'body-40-new.md', 'w').write(s)
print('ok')
