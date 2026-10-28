import sys
# usage: 41-readme.py <issue number>
N = sys.argv[1]
L = f'[#{N}](https://github.com/critical-labs/qa-conductor/issues/{N})'
p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/README.md'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


# routes around the profile
sub("""**What it doesn't:**
- The PR pane still runs as you. It can read and write your files (your browser's profile, which holds the capability, included), signal your processes, and use Unix sockets and every loopback port the profile doesn't name.
- So the verdict stays `shared-host`, and the trust gate is still the boundary.
""", """**What it doesn't:**
- The PR pane still runs as you. It can read and write your files (your browser's profile, which holds the capability, included), signal your processes, and use Unix sockets and every loopback port the profile doesn't name.
- **Routes around it:**
  - A BuildConvention's install step runs the PR's code before the PR pane starts, outside the profile.
  - `tailscale serve`'s ports on the node's tailnet address front the conductor too, and the profile names only loopback ports. In tailscale mode the [identity gate](#security) and the capability still turn such a request away.
  - A file the PR pane writes can change what an unsandboxed process runs later: a script, a config, a shell profile, the profile itself if it can write it.
- So the verdict stays `shared-host`, and the trust gate is still the boundary.
""")

# the allow-after-deny claim, narrowed
sub("""**The profile** denies each port it is given. `sandbox-exec` checks a deny that names a port, but an allow after a broader deny doesn't reopen anything, so the profile names what to shut rather than what to open:""",
    """**The profile** denies each port it is given, so it names what to shut rather than what to open. On macOS 12, `sandbox-exec` honoured a deny that names a port. An allow for one port after `(deny network-outbound (remote ip "localhost:*"))` didn't reopen it, although after a bare `(deny network-outbound)` it did. A profile that shuts everything and opens a list would depend on which form it used.""")

# root-owned path, -D parameters, deprecation
sub("""      args: [...params, '-f', '/var/lib/qa-conductor/pr-pane.sb', server.cmd, ...server.args],""",
    """      args: [...params, '-f', '/usr/local/etc/qa-conductor/pr-pane.sb', server.cmd, ...server.args],""")
sub("""With more than one base service, note each port and add a line per port to the profile.
""", """- **Keep the profile where PR code can't write it:** the PR pane runs as you, so a profile in a directory you own can be rewritten before the next boot. For example, `sudo mkdir -p /usr/local/etc/qa-conductor`, then `sudo cp pr-pane.sb /usr/local/etc/qa-conductor/`: both stay root's.
- **Every parameter the profile names must be passed.** One missing, such as `BASE_DB` with no database, makes the profile fail to load: `sandbox-exec` exits 65 (`string-append: argument 2 must be: string`), and the pane doesn't start. Drop that line from the profile instead.
- With more than one base service, note each port and add a line per port to the profile.
""")

# the check, with EPERM shown
sub("""**Checked:**
- On macOS 12, a process under this profile got `EPERM` for each named port, over `127.0.0.1`, `::1` and `localhost`, and connected to the others.
- It isn't checked here on macOS 14 or 15, where Apple still ships `sandbox-exec` but calls it deprecated. Check yours while a session runs: `sandbox-exec -D HARNESS=3100 -D BASE_PROXY=3101 -D PR_PROXY=3102 -D BASE_APP=<port> -D BASE_DB=<port> -f pr-pane.sb /usr/bin/curl -sS http://127.0.0.1:3100/qa/` must fail with "Operation not permitted", and the same `curl` without `sandbox-exec` must answer.""",
    f"""**Checked:**
- On macOS 12.7.6, a process under this profile got `EPERM` for each named port, over `127.0.0.1`, `::1` and `localhost`, and connected to the others.
- Apple already marks `sandbox-exec` deprecated on macOS 12, and still ships it on 14 and 15.
- It isn't checked here on macOS 14 or 15: that is tracked in {L}, with the steps. Check yours while a session runs, with the ports you use:
  - `sandbox-exec -D HARNESS=3100 -D BASE_PROXY=3101 -D PR_PROXY=3102 -D BASE_APP=<port> -D BASE_DB=<port> -f /usr/local/etc/qa-conductor/pr-pane.sb "$(command -v node)" -e "require('net').connect(3100, '127.0.0.1').on('connect', () => console.log('connected')).on('error', e => console.log(e.code))"` must print `EPERM`, and the same `node -e` without `sandbox-exec` must print `connected`. A closed port would print `ECONNREFUSED`.
  - Or with `curl -sv` in place of `node -e`: `Immediate connect fail for 127.0.0.1: Operation not permitted`, where `curl -sS` alone says only that it couldn't connect.""")

# the tag check: print the refusal header
sub("""**Checked:** not here: nothing in this repository runs `tailscale`. Check it from the conductor's host while it runs: `curl -sS -o /dev/null -w '%{http_code}\\n' https://<machine>.<tailnet>.ts.net:8444/qa/api/state` should print `403`, and the response should carry `X-QA-Refusal: identity`. Untagged, it gets past the gate (and is then refused for want of a capability).""",
    """**Checked:** not here: nothing in this repository runs `tailscale`. Check it from the conductor's host while it runs: `curl -sS -o /dev/null -D - https://<machine>.<tailnet>.ts.net:8444/qa/api/state | grep -i '^x-qa-refusal'`. Both a tagged and an untagged node answer `403`, so read the header:
- `X-QA-Refusal: identity` when the node is tagged: the identity gate refused a request with no login;
- `X-QA-Refusal: capability` when it isn't: the owner's login got past the gate, and only the capability refused it.""")

# Unix sockets: #42, the 1.94 note
sub("""- `tailscale serve` can proxy to a `unix:` target, but [issue #32](https://github.com/critical-labs/qa-conductor/issues/32) records two catches:
  - since Tailscale v1.100, a socket target needs root or an operator who can use sudo;
  - the backend then gets `Host: localhost`.""", """- `tailscale serve` can proxy to a `unix:` target, from Tailscale 1.94 on, but [issue #32](https://github.com/critical-labs/qa-conductor/issues/32) records two catches:
  - since Tailscale v1.100, a socket target needs root or an operator who can use sudo;
  - the backend then gets `Host: localhost`.""")
sub("""- So supporting it means more than a socket. The conductor would need to take the harness and pane origins from its config, rather than the `Host` header, for its [same-origin](#security) and pane request checks.
""", """- So supporting it means more than a socket. The conductor would need to take the harness and pane origins from its config, rather than the `Host` header, for its [same-origin](#security) and pane request checks.
- Tracked in [#42](https://github.com/critical-labs/qa-conductor/issues/42).
""")

# hedge the internal network's claim
sub("""**Today:** the Docker Provisioner's [internal network](#the-pr-pane-on-an-internal-network) closes the same path for container panes. The PR pane then can't reach the host's loopback at all.""",
    f"""**Today:** the Docker Provisioner's [internal network](#the-pr-pane-on-an-internal-network) is meant to close the same path for container panes: it gives the PR pane no route to the host's loopback. Each session's probe checks that it doesn't reach the conductor or the base pane there. Its check by hand on Docker Desktop and Podman machine is tracked in {L}.""")

# the internal network's own check by hand
sub("""- **Check it by hand, once per runtime.** The tests run no real Docker. Boot a PR, then while it runs:""",
    f"""- **Check it by hand, once per runtime.** The tests run no real Docker, and Docker Desktop and Podman machine are tracked in {L}. Boot a PR, then while it runs:""")
open(p, 'w').write(s)
print('ok')
