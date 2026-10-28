import json
import sys
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
REPLY = sys.argv[1]
s = open(N + 'body-41-live.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""**Draft. Depends on #40; review only the commits after `20f945b`** (#40's head): `20f945b..d908a01`. That is round 1's fix plus a merge of #40, 3 files (README, CHANGELOG, `test/docs.test.mjs`), +184 −4. The rest of the diff is #40. This branch follows #40 by merging, never by rebasing. Round 1 (comment 6199022777) is answered item by item in comment 6324314767.""",
    f"""**Draft. Depends on #40; review only what is past #40's head, `5d2df65`:** `git diff 5d2df65..1aa07c5`, 5 files (`.github/workflows/ci.yml`, CHANGELOG, README, `test/docs.test.mjs`, `test/package.test.mjs`), +268 −3. The rest of the diff is #40. This branch follows #40 by merging, never by rebasing. Round 1 (comment 6199022777) is answered item by item in comment 6324314767; round 2, with owner decision B, in comment {REPLY}.""")
sub("""**What closing #32 leaves to do by hand is tracked in #43.** Nothing here can run two of #32's checks:
- the internal network on Docker Desktop and Podman machine (#32's first acceptance criterion);
- `sandbox-exec` on macOS 14 and 15 (its step 3).

#43 has each check's commands and what they must print, and needs the owner's machines. **Unix-socket listeners are tracked in #42.**""",
    """**What closing #32 leaves to do by hand is tracked in #43:** the internal network on Docker Desktop and Podman machine (#32's first acceptance criterion), which needs the owner's machines. #43 has its commands and what they must print. The rest is now in CI:
- `sandbox-exec` on macOS 14 and 15 (#32's step 3): this PR's `macos-sandbox` job;
- the internal network on Linux, against Docker Engine and Podman: #40's `docker-integration` job.

**Unix-socket listeners are tracked in #42.**""")
sub("""  - **The profile:** checked on macOS 12.7.6 (this machine), using the README's own profile text. It got `EPERM` for every named port over `127.0.0.1`, `::1` and `localhost`, and connected to another port. A missing parameter exits 65. `sandbox-exec` keeps the server's pid, so teardown's process groups hold. A docs test now repeats this on any Mac and is skipped elsewhere.
  - **macOS 14 and 15:** not checked. Tracked in #43; the README gives the check, which prints `EPERM`.
  - **The tag:** not checked here, since nothing here runs `tailscale`. The README's check prints the `X-QA-Refusal` header: `identity` tagged, `capability` untagged.""",
    """  - **The profile:** checked on macOS 12.7.6 (this machine), using the README's own profile text. It got `EPERM` for every named port over `127.0.0.1`, `::1` and `localhost`, and connected to another port. A missing parameter exits 65. `sandbox-exec` keeps the server's pid, so teardown's process groups hold. A docs test repeats this on any Mac: all five ports over both families and `localhost`, and the profile's parameters tied to the README's wiring and its check.
  - **macOS 14 and 15** (owner decision B, round 2): CI's `macos-sandbox` job runs that docs test on GitHub's `macos-14` and `macos-15` runners with `QA_REQUIRE_SANDBOX=1`, and fails if it was skipped. One `macos-14` run of 3 connected over `localhost` to a named port, where `127.0.0.1` and `::1` got `EPERM`. `macos-15` and this Mac never have. A failure now names the address reached and what `localhost` resolves to; I'm re-running to find out which (comment {REPLY}).
  - **Nested sandboxes:** `sandbox-exec` can't nest (exit 71). The test skips there unless `QA_REQUIRE_SANDBOX=1`, and the README says so.
  - **The tag:** not checked here, since nothing here runs `tailscale`. The README's check reads the `X-QA-Refusal` header and the body: `no Tailscale identity` means tagged; `<login> is not in QA_ALLOWED_LOGINS` or `"refusal":"capability"` means untagged.""".replace('{REPLY}', REPLY))
sub("""- **`test/docs.test.mjs`:** the README's profile run through `sandbox-exec` on macOS.""",
    """- **`test/docs.test.mjs`:** the README's profile run through `sandbox-exec` on macOS.
- **CI:** the `macos-sandbox` job, on `macos-14` and `macos-15`, pinned in `test/package.test.mjs`.""")
sub("""- **Tests:** 804/804 on Node 24 and on Node 22 (`node --test --test-force-exit`). That is #40's 803 plus the profile test.""",
    """- **Tests:** 812 passed and 0 failed on Node 24 and on Node 22 (`node --test --test-force-exit`); the 3 integration tests skip without `QA_DOCKER_IT=1`. CI is green on `1aa07c5`, `macos-sandbox` included.""")
sub("""- **Mutation:** 3 README mutants of the profile are killed by the new test: a deny dropped, `localhost:` narrowed to `127.0.0.1:`, and a bare deny added.""",
    """- **Mutation:** 3 README mutants of the profile are killed by the new test: a deny dropped, `localhost:` narrowed to `127.0.0.1:`, and a bare deny added. Round 2's: `HARNESS` made IPv4-only, and a parameter renamed in the profile alone, are killed too.""")
json.dump({'body': s}, open(N + 'body-41-new.json', 'w'))
open(N + 'body-41-new.md', 'w').write(s)
print('ok')
