p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/README.md'
s = open(p).read()
def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b, 1)
sub("""

  A forwarder that dies later takes the PR app's port with it: the pane goes down rather than open.
""", """
- **A forwarder that dies later** takes the PR app's port with it: the pane goes down rather than open.
""")
sub("""so no name outside the network resolves for them ([its limits](#the-pr-pane-on-an-internal-network): DNS).""",
    """so no name outside the network resolves for them (DNS, under its limits below).""")
sub("""CVE-2024-29018 ([DNS](#the-pr-pane-on-an-internal-network), above)""", """CVE-2024-29018 (DNS, under its limits above)""")
open(p, 'w').write(s)
print('ok')
