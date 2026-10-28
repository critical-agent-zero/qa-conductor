import json
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
raw = open(N + 'issue-43-live2.md').read()
title, s = raw.split('\n----\n', 1)


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""#32 asks for checks that its unit tests can't make. CI now makes most of them:
- **`sandbox-exec` on macOS 14 and 15** (#32's step 3): CI's `macos-sandbox` job (#41) runs the README's profile through `sandbox-exec` on GitHub's macOS 14 and macOS 15 runners, on every pull request, and fails if the test is skipped. Section 2 below is kept for the record, and is no longer needed by hand.
- **The internal network on Linux:** CI's `docker-integration` job (#40) runs it against Docker Engine, and against Podman through its Docker-compatible socket.

**What is left by hand:** the internal network on Docker Desktop and on Podman machine (#32's first acceptance criterion). GitHub's runners have neither, so it needs the owner's machines:
- a Mac with Docker Desktop;
- a Mac with Podman machine.

Section 1 has its exact commands and what they must print.""",
    """#32 asks for checks that its unit tests can't make. CI now makes some of them:
- **`sandbox-exec` on macOS 15** (#32's step 3): CI's `macos-sandbox` job (#41) runs the README's profile through `sandbox-exec` on GitHub's macOS 15 runner, 30 rounds of every try, on every pull request. The job is advisory, not a required check, until it runs reliably.
- **The internal network on Linux:** CI's `docker-integration` job (#40) runs it against Docker Engine, and against Podman through its Docker-compatible socket.

**What is left:**
- **The internal network on Docker Desktop and on Podman machine** (#32's first acceptance criterion). GitHub's runners have neither, so it needs the owner's machines: a Mac with Docker Desktop, and a Mac with Podman machine. Section 1.
- **`sandbox-exec` on macOS 14** (#32's step 3). The same CI job runs there, but with the profile's earlier `localhost:<port>` form its macOS 14 runner let a named port (`BASE_APP`) through, over `localhost`, in 2 of 5 runs, while `127.0.0.1` to the same port got `EPERM` in the same process. The cause is unproven: a quirk of GitHub's runner, or a Seatbelt miss. The profile now denies `*:<port>` (#41, round 3), which also shuts IPv4-mapped IPv6 (`::ffff:127.0.0.1`), which got past the old form on macOS 12. Section 2.

Each section has its exact commands and what they must print.""")
sub("""## 2. `sandbox-exec` on macOS 14 and 15: now in CI

No longer needed by hand: CI's `macos-sandbox` job (#41) runs this on macOS 14 and 15. The steps are kept for anyone checking their own Mac.

From #32's step 3: "check first that `sandbox-exec` still works on macOS 14 and 15". The profile in #41's README section, "A `sandbox-exec` profile for the process Provisioner (macOS)", was checked on macOS 12 only.

**Setup.** Save the README's `pr-pane.sb` where only root can write it:""",
    """## 2. `sandbox-exec` on macOS 14

From #32's step 3: "check first that `sandbox-exec` still works on macOS 14 and 15". The profile in #41's README section, "A `sandbox-exec` profile for the process Provisioner (macOS)", is checked on macOS 12 by hand and by its docs test, and on macOS 15 by CI. On macOS 14, CI's runner hasn't held reliably (above).

**Setup.** Save the README's `pr-pane.sb` (the `*:<port>` form, from #41's round 3) where only root can write it:""")
sub("""| 2c | `sandbox-exec "${S[@]}" "$(command -v node)" -e "$P" 3190 localhost` | `EPERM` |""",
    """| 2c | `sandbox-exec "${S[@]}" "$(command -v node)" -e "$P" 3190 localhost` | `EPERM` |
| 2c2 | `sandbox-exec "${S[@]}" "$(command -v node)" -e "$P" 3190 ::ffff:127.0.0.1` | `EPERM`: an IPv4-mapped IPv6 address, which got past the old `localhost:<port>` form |""")
sub("""**Where this was run.** On macOS 12.7.6, in zsh 5.8.1, 2a to 2g print exactly that. The profile was a scratch copy, not the root-owned path.""",
    """**Where this was run.** On macOS 12.7.6, in zsh 5.8.1, 2a to 2g print exactly that, and 2c2 with the `*:<port>` form. The profile was a scratch copy, not the root-owned path. Run 2a to 2d a few times: on CI's macOS 14 runner, the miss came in some runs and not others.""")
sub("""## Done when

- 1a to 1j hold on Docker Desktop and on Podman machine.""",
    """## Done when

- 1a to 1j hold on Docker Desktop and on Podman machine;
- on macOS 14, either 2a to 2g (with 2c2) hold by hand, run a few times, or CI's `macos-sandbox` job passes on `macos-14` in 10 runs in a row, 30 rounds each, with the `*:<port>` form.""")
s = s.replace("README's \"Where it is checked\" lines in #40's section are then updated", "README's \"Where it is checked\" lines in #40's section, and \"Checked\" in #41's, are then updated")
title = "Run #32's remaining checks: the internal network on Docker Desktop and Podman machine, and sandbox-exec on macOS 14"
json.dump({'title': title, 'body': s}, open(N + 'issue-43-new2.json', 'w'))
print('ok', 'Checked' in s)
