p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/README.md'
s = open(p).read()
def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b, 1)
sub("""  - **Every wait is bounded:** a connect takes at most 10 s, and a tunnel or an answer idle for 5 minutes is closed.""",
    """  - **Every wait is bounded:** a connect takes at most 10 s, and a tunnel or an answer idle for 5 minutes is closed. One only waiting on a slow reader isn't idle.
  - **A cut reaches the app as one:** a host that fails, resets or idles out partway through gives the PR side a reset, never a clean end that could pass for a complete answer.""")
open(p, 'w').write(s)
print('ok')
