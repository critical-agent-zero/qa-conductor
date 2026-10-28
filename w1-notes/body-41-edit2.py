import json
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
s = open(N + 'body-41-live2.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""`git diff 5d2df65..1aa07c5`, 5 files (`.github/workflows/ci.yml`, CHANGELOG, README, `test/docs.test.mjs`, `test/package.test.mjs`), +268 −3.""",
    """`git diff 5d2df65..db5bfec`, 5 files (`.github/workflows/ci.yml`, CHANGELOG, README, `test/docs.test.mjs`, `test/package.test.mjs`).""")
sub("""round 2, with owner decision B, in comment 6342538062.""",
    """round 2, with owner decision B, in comment 6342538062; round 3 in comment 6346171688.""")
sub("""**What closing #32 leaves to do by hand is tracked in #43:** the internal network on Docker Desktop and Podman machine (#32's first acceptance criterion), which needs the owner's machines. #43 has its commands and what they must print. The rest is now in CI:
- `sandbox-exec` on macOS 14 and 15 (#32's step 3): this PR's `macos-sandbox` job;
- the internal network on Linux, against Docker Engine and Podman: #40's `docker-integration` job.""",
    """**What closing #32 leaves to do is tracked in #43:**
- the internal network on Docker Desktop and Podman machine (#32's first acceptance criterion), which needs the owner's machines;
- `sandbox-exec` on macOS 14 (#32's step 3): CI's `macos-14` runner let a named port through over `localhost` in 2 of 5 runs with the profile's earlier form. #43 is done for it after 10 clean runs in a row of the job, 30 rounds each, or the steps by hand.

#43 has the commands and what they must print. The rest is in CI:
- `sandbox-exec` on macOS 15: this PR's advisory `macos-sandbox` job;
- the internal network on Linux, against Docker Engine and Podman: #40's `docker-integration` job.""")
sub("""- **B. The `sandbox-exec` profile names the ports to shut, not the ones to open.** On macOS 12, an allow for one port after `(deny network-outbound (remote ip "localhost:*"))` didn't reopen it. After a bare `(deny network-outbound)` it did, as the review found. A shut-all-then-open profile would depend on that form, so the profile denies:
  - the conductor's three ports;
  - the base pane's service and database ports.""",
    """- **B. The `sandbox-exec` profile names the ports to shut, not the ones to open, on any address (`*:<port>`).** On macOS 12, an allow for one port after `(deny network-outbound (remote ip "localhost:*"))` didn't reopen it. After a bare `(deny network-outbound)` it did, as the review found. A shut-all-then-open profile would depend on that form, so the profile denies:
  - the conductor's three ports;
  - the base pane's service and database ports.

  **Any address, since round 3:** a deny on `localhost:<port>` let an IPv4-mapped IPv6 address (`::ffff:127.0.0.1`) through to every named port on macOS 12. The trade-off, stated in the README: those port numbers are refused on remote hosts too.""")
sub("""  - It covers TCP to those loopback ports, nothing else.""",
    """  - It covers TCP to those port numbers, nothing else.""")
sub("""  - **The profile:** checked on macOS 12.7.6 (this machine), using the README's own profile text. It got `EPERM` for every named port over `127.0.0.1`, `::1` and `localhost`, and connected to another port.""",
    """  - **The profile:** checked on macOS 12.7.6 (this machine), using the README's own profile text. It got `EPERM` for every named port over `127.0.0.1`, `::1`, `localhost`, `::ffff:127.0.0.1`, `::ffff:7f00:1`, `127.1` and `0.0.0.0`, and connected to another port over each.""")
sub("""A docs test repeats this on any Mac: all five ports over both families and `localhost`, and the profile's parameters tied to the README's wiring and its check.""",
    """A docs test repeats this on any Mac: all five ports in those seven forms, `QA_SANDBOX_ROUNDS` times (30 in CI), and the profile's parameters tied to the README's wiring and its check.""")
sub("""  - **macOS 14 and 15** (owner decision B, round 2): CI's `macos-sandbox` job runs that docs test on GitHub's `macos-14` and `macos-15` runners with `QA_REQUIRE_SANDBOX=1`, and fails if it was skipped. One `macos-14` run of 3 connected over `localhost` to a named port, where `127.0.0.1` and `::1` got `EPERM`. `macos-15` and this Mac never have. A failure now names the address reached and what `localhost` resolves to; I'm re-running to find out which (comment 6342538062).""",
    """  - **macOS 15** (owner decision B, round 2): CI's `macos-sandbox` job runs that docs test on GitHub's `macos-15` runner with `QA_REQUIRE_SANDBOX=1`, and fails if it was skipped. The job is advisory, not a required check, until it runs reliably.
  - **macOS 14: not claimed, tracked in #43** (round 3). The same job runs on `macos-14`.
    - **With the earlier `localhost:<port>` form,** it connected over `localhost` to a named port in 2 of 5 runs, through Node's fallback to `127.0.0.1`, while the literal `127.0.0.1` got `EPERM`.
    - **With the `*:<port>` form,** its runs so far are clean (comment 6346171688).
    - **A failure now records,** for each odd try, the address and port it reached, the addresses Node tried in turn, and its round.""")
sub("""- **CI:** the `macos-sandbox` job, on `macos-14` and `macos-15`, pinned in `test/package.test.mjs`.""",
    """- **CI:** the `macos-sandbox` job, on `macos-14` and `macos-15`, with `QA_SANDBOX_ROUNDS=30`, pinned in `test/package.test.mjs`. It is advisory.""")
sub("""CI is green on `1aa07c5`, `macos-sandbox` included.""", """CI is green on `db5bfec`, `macos-sandbox` included.""")
sub("""Round 2's: `HARNESS` made IPv4-only, and a parameter renamed in""",
    """Round 3's: the `localhost:` form put back for one port, and a port narrowed to `127.0.0.1:`, are killed by the mapped-address tries. Round 2's: `HARNESS` made IPv4-only, and a parameter renamed in""")
json.dump({'body': s}, open(N + 'body-41-new2.json', 'w'))
print('ok')
