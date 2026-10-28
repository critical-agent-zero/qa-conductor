R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:100], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('test/integration/docker-internal.test.mjs', [
    ("""  // DNS: names on the network resolve, outside names don't (read from
  // what nslookup prints, not its exit code)
  const lookup = async name => outOf('pr', 'sh', '-c', `nslookup ${name} 2>&1; true`)
  assert.match(await lookup('qa-egress'), /Name:\\s+qa-egress/, 'qa-egress resolves on the internal network')
  const outside = await lookup('example.com')
  assert.doesNotMatch(outside, /Name:\\s+example\\.com/, `an outside name resolved from the PR pane:\\n${outside}`)
  if (!PODMAN) assert.equal((await cli('inspect', '--format', '{{json .HostConfig.Dns}}', 'qa-app-pr')).trim(), '["192.0.2.1"]')""",
     """  // DNS, as the app's own resolver does it: the names the pane needs
  // resolve, outside names don't
  const lookup = name => outOf('pr', 'node', '-e', `require('dns').lookup(${JSON.stringify(name)}, (e, a) => console.log(e ? 'error ' + e.code : 'address ' + a))`).then(out => out.trim())
  for (const name of ['qa-egress', 'qa-pg-pr']) assert.match(await lookup(name), /^address /, `${name} resolves in the PR pane`)
  const outside = await lookup('example.com')
  assert.match(outside, /^error /, `an outside name resolved from the PR pane: ${outside}`)
  assert.equal((await cli('inspect', '--format', '{{json .HostConfig.Dns}}', 'qa-app-pr')).trim(), '["192.0.2.1"]')"""),
])

edit('README.md', [
    ("""So on Docker the PR pane's containers run with `--dns 192.0.2.1`, the advisory's workaround: names on the network still resolve, through Docker's own DNS, and an outside one gets no answer. The forwarder resolves the hosts it lets through itself. Podman's DNS answers nothing outside an internal network, and a `--dns` would replace it, so there it gets none. A container you start on `qa-session-pr` yourself gets no `--dns`: upgrade an affected Engine anyway.""",
     """So the PR pane's containers run with `--dns 192.0.2.1`, the advisory's workaround: names on the network still resolve, and an outside one gets no answer. The forwarder resolves the hosts it lets through itself.
    - **On Docker,** the network's names resolve through Docker's own DNS, beside the `--dns`.
    - **On Podman,** its DNS also answers an internal network's outside names: CI found it on Podman 4.9. A `--dns` there replaces Podman's DNS, so the names the PR pane needs, `qa-pg-pr` and `qa-egress`, go in its containers' hosts files (`--add-host`).
    - **A container you start on `qa-session-pr` yourself** gets neither. Upgrade an affected Engine anyway."""),
    ("""     - an outside name, as the PR pane's containers resolve it: `docker run --rm --network qa-session-pr --dns 192.0.2.1 busybox nslookup example.com` (on Podman, without `--dns`);""",
     """     - an outside name, as the PR pane's containers resolve it: `docker run --rm --network qa-session-pr --dns 192.0.2.1 busybox nslookup example.com`;"""),
    ("""     - and as any container there resolves it: `docker run --rm --network qa-session-pr busybox nslookup example.com`. If this one answers, on Docker, the Engine has CVE-2024-29018 (DNS, under its limits above): the PR pane's own containers are covered by their `--dns`, but upgrade it.""",
     """     - and as any container there resolves it: `docker run --rm --network qa-session-pr busybox nslookup example.com`. If this one answers, the runtime's DNS forwards the internal network's names: on Docker, the Engine has CVE-2024-29018, and on Podman it is how its DNS works (DNS, under its limits above). The PR pane's own containers are covered by their `--dns`."""),
])
print('ok')
