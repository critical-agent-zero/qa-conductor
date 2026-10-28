import sys
N = sys.argv[1]
p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/CHANGELOG.md'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""  - **a `sandbox-exec` profile for the process Provisioner on macOS**, which shuts the PR pane out of the conductor's and the base pane's loopback ports. It was checked on macOS 12, and gives a check to run on 14 and 15;""",
    f"""  - **a `sandbox-exec` profile for the process Provisioner on macOS**, which shuts the PR pane out of the conductor's and the base pane's loopback ports. It was checked on macOS 12, and gives a check to run on 14 and 15, which #{N} tracks;""")
sub("""  - **Unix-socket listeners behind `tailscale serve`**, which the conductor doesn't support yet: what they would guarantee, and what supporting them would take.""",
    """  - **Unix-socket listeners behind `tailscale serve`**, which the conductor doesn't support yet: what they would guarantee, and what supporting them would take. Tracked in #42.""")
sub("""has the details and a check by hand for each runtime.""",
    f"""has the details and a check by hand for each runtime. Running it on Docker Desktop and Podman machine is tracked in #{N}.""")
open(p, 'w').write(s)
print('ok')
