p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/README.md'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""- `tailscale serve` can proxy to a `unix:` target, from Tailscale 1.94 on, but [issue #32](https://github.com/critical-labs/qa-conductor/issues/32) records two catches:""",
    """- `tailscale serve` can proxy to a `unix:` target. [Issue #32](https://github.com/critical-labs/qa-conductor/issues/32) records that this takes Tailscale 1.94 or later, and two catches:""")
sub("""-e "require('net').connect(3100, '127.0.0.1').on('connect', () => console.log('connected')).on('error', e => console.log(e.code))\"""",
    """-e "require('net').connect(3100, '127.0.0.1').on('connect', function () { console.log('connected'); this.destroy() }).on('error', e => console.log(e.code))\"""")
sub("""In tailscale mode the [identity gate](#security) and the capability still turn such a request away.""",
    """The [capability](#security) still turns such a request away, and on a tagged node (below) the identity gate does first.""")
open(p, 'w').write(s)
print('ok')
