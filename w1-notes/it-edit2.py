p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/test/integration/docker-internal.test.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""  // The canary, on every address of the host: so the base pane's ordinary
  // network can reach it (the control), and the PR pane's must not.
  const canary = { path: '/__qa/canary/it', expect: 'qa-canary it' }
  const host = http.createServer((req, res) => res.end(req.url === canary.path ? canary.expect : 'not the canary'))
  await new Promise(resolve => host.listen(0, '0.0.0.0', resolve))
  t.after(() => host.close())
  canary.port = host.address().port""", """  // Two canaries on the host. One on its loopback, as the conductor listens
  // by default: the PR pane must not reach it. One on every address, as a
  // conductor off loopback listens: whether the PR pane reaches it is
  // found out directly, and the probe must say the same.
  const canaryOn = async (address, name) => {
    const canary = { path: `/__qa/canary/${name}`, expect: `qa-canary ${name}` }
    const server = http.createServer((req, res) => res.end(req.url === canary.path ? canary.expect : 'not the canary'))
    await new Promise(resolve => server.listen(0, address, resolve))
    t.after(() => server.close())
    return { ...canary, port: server.address().port }
  }
  const canary = await canaryOn('127.0.0.1', 'loopback')
  const wide = await canaryOn('0.0.0.0', 'wide')""")

sub("""  // The host, at every gateway: the base pane gets the canary, the PR pane
  // nothing.
  const gateways = [...new Set([...await gatewayOf('qa-session-base'), ...await gatewayOf('qa-session-pr'), ...(PODMAN ? [] : ['172.17.0.1'])])]
  const fetchIn = (role, ip) => direct(role, `wget -q -T 3 -O - http://${ip}:${canary.port}${canary.path}`)
  const [baseGateway] = await gatewayOf('qa-session-base')
  assert.equal(await fetchIn('base', baseGateway), true, `the control: the base pane reaches the host's canary at ${baseGateway}`)
  for (const ip of gateways) assert.equal(await fetchIn('pr', ip), false, `the PR pane reached the host at ${ip}`)""", """  // The host's loopback, at every gateway: the PR pane gets nothing.
  const prGateways = await gatewayOf('qa-session-pr')
  const gateways = [...new Set([...await gatewayOf('qa-session-base'), ...prGateways, ...(PODMAN ? [] : ['172.17.0.1'])])]
  const fetchIn = (role, ip, c) => direct(role, `wget -q -T 3 -O - http://${ip}:${c.port}${c.path}`)
  for (const ip of gateways) assert.equal(await fetchIn('pr', ip, canary), false, `the PR pane reached the host's loopback at ${ip}`)

  // The host's every address: the base pane reaches it at its gateway (the
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
  }""")
open(p, 'w').write(s)
print('ok')
