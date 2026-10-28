Fixes #32.

**Draft. Depends on #40; review only what is past #40's head, `5d2df65`:** `git diff 5d2df65..db5bfec`, 5 files (`.github/workflows/ci.yml`, CHANGELOG, README, `test/docs.test.mjs`, `test/package.test.mjs`). The rest of the diff is #40. This branch follows #40 by merging, never by rebasing. Round 1 (comment 6199022777) is answered item by item in comment 6324314767; round 2, with owner decision B, in comment 6342538062; round 3 in comment 6346171688.

This is the last of three PRs for #32, per its design (comment 6195734695):
- **1, #39 (merged):** the forwarder and its egress allowlist.
- **2, #40:** the Docker Provisioner's opt-in internal network.
- **3, this PR:** the docs-only opt-ins, steps 2–4, each with a stated guarantee. It completes the issue.

**What closing #32 leaves to do is tracked in #43:**
- the internal network on Docker Desktop and Podman machine (#32's first acceptance criterion), which needs the owner's machines;
- `sandbox-exec` on macOS 14 (#32's step 3): CI's `macos-14` runner let a named port through over `localhost` in 2 of 5 runs with the profile's earlier form. #43 is done for it after 10 clean runs in a row of the job, 30 rounds each, or the steps by hand.

#43 has the commands and what they must print. The rest is in CI:
- `sandbox-exec` on macOS 15: this PR's advisory `macos-sandbox` job;
- the internal network on Linux, against Docker Engine and Podman: #40's `docker-integration` job.

**Unix-socket listeners are tracked in #42.**

## Judgment calls (conservative defaults; say if you want another)

- **A. Unix-socket listeners are documented as not yet supported,** as the design said they would be.
  - The conductor listens only on TCP, so no recipe can take this step today.
  - What it documents:
    - what the step would guarantee;
    - what #32 records: a `unix:` target takes Tailscale 1.94 or later, and has two catches. Since v1.100 it needs root or a sudo-capable operator, and the backend gets `Host: localhost`;
    - what supporting it would take: the conductor would have to take its origins from config, not from `Host`, for its same-origin and pane request checks;
    - that the Docker Provisioner's internal network (#40) is meant to close the same path for container panes, checked by each session's probe;
    - that support is tracked in #42.
  - I couldn't confirm the version facts from Tailscale's docs, so they are attributed to #32, not stated as fact.
- **B. The `sandbox-exec` profile names the ports to shut, not the ones to open, on any address (`*:<port>`).** On macOS 12, an allow for one port after `(deny network-outbound (remote ip "localhost:*"))` didn't reopen it. After a bare `(deny network-outbound)` it did, as the review found. A shut-all-then-open profile would depend on that form, so the profile denies:
  - the conductor's three ports;
  - the base pane's service and database ports.

  **Any address, since round 3:** a deny on `localhost:<port>` let an IPv4-mapped IPv6 address (`::ffff:127.0.0.1`) through to every named port on macOS 12. The trade-off, stated in the README: those port numbers are refused on remote hosts too.

  The base pane's ports aren't known until its processes launch. The boot launches the base pane first, so the `command` example notes them and passes them as `-D` parameters. Every parameter must be passed: one missing fails to load (exit 65).
- **C. The profile's guarantee is narrow, and says so.**
  - It covers TCP to those port numbers, nothing else.
  - The PR pane still runs as you: files, signals, Unix sockets and other ports.
  - It names the routes around it: the install step, `tailscale serve`'s tailnet ports, and files that unsandboxed processes run later.
  - The verdict stays `shared-host`.
  - The example keeps the profile at a root-owned path.
- **D. What was checked, and where:**
  - **The profile:** checked on macOS 12.7.6 (this machine), using the README's own profile text. It got `EPERM` for every named port over `127.0.0.1`, `::1`, `localhost`, `::ffff:127.0.0.1`, `::ffff:7f00:1`, `127.1` and `0.0.0.0`, and connected to another port over each. A missing parameter exits 65. `sandbox-exec` keeps the server's pid, so teardown's process groups hold. A docs test repeats this on any Mac: all five ports in those seven forms, `QA_SANDBOX_ROUNDS` times (30 in CI), and the profile's parameters tied to the README's wiring and its check.
  - **macOS 15** (owner decision B, round 2): CI's `macos-sandbox` job runs that docs test on GitHub's `macos-15` runner with `QA_REQUIRE_SANDBOX=1`, and fails if it was skipped. The job is advisory, not a required check, until it runs reliably.
  - **macOS 14: not claimed, tracked in #43** (round 3). The same job runs on `macos-14`.
    - **With the earlier `localhost:<port>` form,** it connected over `localhost` to a named port in 2 of 5 runs, through Node's fallback to `127.0.0.1`, while the literal `127.0.0.1` got `EPERM`.
    - **With the `*:<port>` form,** its runs so far are clean (comment 6346171688).
    - **A failure now records,** for each odd try, the address and port it reached, the addresses Node tried in turn, and its round.
  - **Nested sandboxes:** `sandbox-exec` can't nest (exit 71). The test skips there unless `QA_REQUIRE_SANDBOX=1`, and the README says so.
  - **The tag:** not checked here, since nothing here runs `tailscale`. The README's check reads the `X-QA-Refusal` header and the body: `no Tailscale identity` means tagged; `<login> is not in QA_ALLOWED_LOGINS` or `"refusal":"capability"` means untagged.
  - **The internal network on Docker Desktop and Podman machine:** not checked here. Tracked in #43.
- **E. The tag's guarantee follows Tailscale's docs:** `tailscale serve` sets no identity headers for traffic from a tagged device. The README doesn't claim which paths from this host or a container reach `serve` at all. It says that depends on the platform and wasn't checked.

## What changes

- **README:**
  - a new section under Security, [Hardening opt-ins](README.md#hardening-opt-ins), with the three opt-ins. Each says what it guarantees, what it doesn't, how to take it, and how it was checked, naming #43 and #42;
  - a link from the Contents, and from the process Provisioner's Isolation bullet;
  - #43 named in the internal network's check by hand.
- **CHANGELOG:** the three, under `## [Unreleased]`, with #43 and #42.
- **`test/docs.test.mjs`:** the README's profile run through `sandbox-exec` on macOS.
- **CI:** the `macos-sandbox` job, on `macos-14` and `macos-15`, with `QA_SANDBOX_ROUNDS=30`, pinned in `test/package.test.mjs`. It is advisory.

## Tests and review

- **Tests:** 812 passed and 0 failed on Node 24 and on Node 22 (`node --test --test-force-exit`); the 3 integration tests skip without `QA_DOCKER_IT=1`. CI is green on `db5bfec`, `macos-sandbox` included.
- **The docs tests** check:
  - the new links;
  - the example's imports;
  - that no file names a real tailnet or a home path;
  - on a Mac, that the profile does what the README says.
- **Mutation:** 3 README mutants of the profile are killed by the new test: a deny dropped, `localhost:` narrowed to `127.0.0.1:`, and a bare deny added. Round 3's: the `localhost:` form put back for one port is killed by the mapped-address tries. A port narrowed to `127.0.0.1:` is killed too, but not by them: SBPL rejects the `127.0.0.1:` host when the profile loads (exit 65), so the test fails there. Round 2's: `HARNESS` made IPv4-only, and a parameter renamed in the profile alone, are killed too.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MkcLhvB2oguJrgFNRVqAxy



