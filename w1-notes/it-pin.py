p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/test/integration/docker-internal.test.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


# (1) a sweep on a clean host succeeds, and leaves nothing
sub("""  const signal = new AbortController().signal
  await provisioner.sweep()
  t.after(async () => {""", """  const signal = new AbortController().signal
  // A sweep on a clean host succeeds: "not found" is no failure, whatever
  // the CLI adds after it (the runners' docker CLI adds "exit status 1")
  await provisioner.sweep()
  await provisioner.sweep()
  assert.deepEqual(await leftovers(), { containers: [], networks: [] })
  t.after(async () => {""")

# (3) the probe's positive control, unconditional
sub("""  // The host's every address: the base pane reaches it at its gateway (the
  // control: the method works). The PR pane, at its own network's gateway,
  // may too: the host's bridge for an internal network can still have the
  // host's address. Whatever it finds directly, the probe must say.
  const [baseGateway] = await gatewayOf('qa-session-base')
  assert.equal(await fetchIn('base', baseGateway, wide), true, `the control: the base pane reaches the host's every-address canary at ${baseGateway}`)
  const reached = []
  for (const ip of gateways) if (await fetchIn('pr', ip, wide)) reached.push(ip)
  const wideVerdict = await provisioner.isolation({ signal, canary: wide })
  t.diagnostic(`a host service on every address, from the PR pane: reached at ${reached.join(', ') || 'none'}; the probe says ${wideVerdict.verdict}`)
  if (reached.length) {
    assert.equal(wideVerdict.verdict, 'reachable', JSON.stringify(wideVerdict))
    assert.ok(reached.some(ip => wideVerdict.reasons.some(r => r.includes(`${ip}:${wide.port}`))), JSON.stringify(wideVerdict.reasons))
  } else {
    assert.deepEqual(wideVerdict, { verdict: 'isolated', reasons: [], internal: true })
  }""", """  // The probe's positive control. A host service on every address (0.0.0.0)
  // is reachable from the PR pane at its own network's gateway: the host's
  // bridge for an internal network still has the host's address, on Docker
  // Engine and on Podman alike. The base pane reaches it too (the method
  // works), and the probe must find it and name it.
  const [baseGateway] = await gatewayOf('qa-session-base')
  assert.equal(await fetchIn('base', baseGateway, wide), true, `the control: the base pane reaches the host's every-address canary at ${baseGateway}`)
  const reached = []
  for (const ip of gateways) if (await fetchIn('pr', ip, wide)) reached.push(ip)
  const wideVerdict = await provisioner.isolation({ signal, canary: wide })
  t.diagnostic(`a host service on every address, from the PR pane: reached at ${reached.join(', ') || 'none'}; the probe says ${wideVerdict.verdict}`)
  assert.ok(reached.some(ip => prGateways.includes(ip)), `the PR pane reached the every-address canary at its gateway (${prGateways.join(', ')}): ${reached.join(', ') || 'nowhere'}`)
  assert.equal(wideVerdict.verdict, 'reachable', JSON.stringify(wideVerdict))
  assert.equal(wideVerdict.internal, true)
  assert.ok(reached.some(ip => wideVerdict.reasons.some(r => r.includes(`${ip}:${wide.port}`))), JSON.stringify(wideVerdict.reasons))
  // and with only loopback listeners, as the conductor binds by default, it
  // is isolated again
  assert.deepEqual(await provisioner.isolation({ signal, canary }), { verdict: 'isolated', reasons: [], internal: true })""")

# (2) DNS through nslookup too, and Podman's hosts entries
sub("""  for (const name of ['qa-egress', 'qa-pg-pr']) assert.match(await lookup(name), /^address /, `${name} resolves in the PR pane`)
  const outside = await lookup('example.com')
  assert.match(outside, /^error /, `an outside name resolved from the PR pane: ${outside}`)
  assert.equal((await cli('inspect', '--format', '{{json .HostConfig.Dns}}', 'qa-app-pr')).trim(), '["192.0.2.1"]')""",
    """  for (const name of ['qa-egress', 'qa-pg-pr']) assert.match(await lookup(name), /^address /, `${name} resolves in the PR pane`)
  const outside = await lookup('example.com')
  assert.match(outside, /^error /, `an outside name resolved from the PR pane: ${outside}`)
  // and as nslookup asks the configured server directly
  const asked = await outOf('pr', 'sh', '-c', 'nslookup example.com 2>&1; true')
  assert.doesNotMatch(asked, /Name:\\s+example\\.com/, `nslookup resolved an outside name from the PR pane:\\n${asked}`)
  assert.equal((await cli('inspect', '--format', '{{json .HostConfig.Dns}}', 'qa-app-pr')).trim(), '["192.0.2.1"]')
  // On Podman a --dns replaces its own DNS, so the names the pane needs are
  // in its hosts file
  if (PODMAN) {
    const extra = JSON.parse(await cli('inspect', '--format', '{{json .HostConfig.ExtraHosts}}', 'qa-app-pr'))
    for (const name of ['qa-pg-pr', 'qa-egress']) assert.ok(extra.some(entry => entry.startsWith(`${name}:`)), `${name} in ${JSON.stringify(extra)}`)
  }""")
open(p, 'w').write(s)
print('ok')
