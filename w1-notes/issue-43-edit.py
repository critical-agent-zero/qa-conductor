import json
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
raw = open(N + 'issue-43-live.md').read()
title, s = raw.split('\n----\n', 1)


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""#32 asks for two things that nothing in this repository can check: its tests run no real Docker and no `tailscale`, and its CI runs on Linux. #41 closes #32 with them tracked here instead.

**These checks need the owner's machines:**
- a Mac with Docker Desktop;
- a Mac with Podman machine;
- Macs on macOS 14 and 15.

Each check below has its exact commands and what they must print. Post the outputs here, or say which ones differ. The commands work in zsh, macOS's default shell, and in bash.""",
    """#32 asks for checks that its unit tests can't make. CI now makes most of them:
- **`sandbox-exec` on macOS 14 and 15** (#32's step 3): CI's `macos-sandbox` job (#41) runs the README's profile through `sandbox-exec` on GitHub's macOS 14 and macOS 15 runners, on every pull request, and fails if the test is skipped. Section 2 below is kept for the record, and is no longer needed by hand.
- **The internal network on Linux:** CI's `docker-integration` job (#40) runs it against Docker Engine, and against Podman through its Docker-compatible socket.

**What is left by hand:** the internal network on Docker Desktop and on Podman machine (#32's first acceptance criterion). GitHub's runners have neither, so it needs the owner's machines:
- a Mac with Docker Desktop;
- a Mac with Podman machine.

Section 1 has its exact commands and what they must print. Post the outputs here, or say which ones differ. The commands work in zsh, macOS's default shell, and in bash.""")
sub("""| 1e | `docker run --rm --network qa-session-pr --dns 192.0.2.1 busybox nslookup example.com; echo $?` (on Podman, leave out `--dns`) | no address for `example.com`, then a non-zero exit code |
| 1f | `docker run --rm --network qa-session-pr busybox nslookup example.com; echo $?` | as 1e. On Docker Desktop and Podman, an answer here would be new; say so |""",
    """| 1e | `docker run --rm --network qa-session-pr --dns 192.0.2.1 busybox nslookup example.com; echo $?`, as the PR pane's containers resolve it (on Docker and on Podman) | no address for `example.com`, then a non-zero exit code |
| 1f | `docker run --rm --network qa-session-pr busybox nslookup example.com; echo $?`, as a container without `--dns` resolves it | either is fine, but say which. An answer means the runtime's DNS forwards the internal network's outside names, as CI found Podman 4.9's does on Linux; the PR pane's own containers are covered by their `--dns` (1e, 1j) |""")
sub("""| 1j | `docker inspect -f '{{.HostConfig.Dns}}' qa-app-pr` | Docker Desktop: `[192.0.2.1]`. Podman: `[]` |""",
    """| 1j | `docker inspect -f '{{.HostConfig.Dns}}' qa-app-pr` | `[192.0.2.1]`, on both |""")
sub("""## 2. `sandbox-exec` on macOS 14 and 15

From #32's step 3:""",
    """## 2. `sandbox-exec` on macOS 14 and 15: now in CI

No longer needed by hand: CI's `macos-sandbox` job (#41) runs this on macOS 14 and 15. The steps are kept for anyone checking their own Mac.

From #32's step 3:""")
sub("""## Done when

- 1a to 1j hold on Docker Desktop and on Podman machine;
- 2a to 2g hold on macOS 14 and on macOS 15.

Where one doesn't hold, file what it printed here. The README's "Checked" lines in #40's and #41's sections are then updated to say what was run where.""",
    """## Done when

- 1a to 1j hold on Docker Desktop and on Podman machine.

Where one doesn't hold, file what it printed here. The README's "Where it is checked" lines in #40's section are then updated to say what was run where.""")
json.dump({'body': s}, open(N + 'issue-43-new.json', 'w'))
open(N + 'issue-43-new.md', 'w').write(s)
print(title)
