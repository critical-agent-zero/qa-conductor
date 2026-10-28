R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('test/integration/docker-internal.test.mjs', [
    ("""import { createDockerProvisioner } from '../../lib/adapters/provisioner-docker.mjs'""",
     """import { createDockerProvisioner, dockerEngineMajor } from '../../lib/adapters/provisioner-docker.mjs'"""),
    ("""const PODMAN = answers && /podman/i.test(version)""",
     """const PODMAN = answers && /podman/i.test(version)
// Docker Engine 28 and later: the PR pane's internal network has an
// isolated gateway, so the host's 0.0.0.0 services aren't reachable either
const ISOLATED_GATEWAY = answers && (dockerEngineMajor(version) ?? 0) >= 28"""),
    # the positive control for leftovers, while the panes are up
    ("""  // the PR app, on the host's loopback, through the forwarder
  const health = await fetch(`http://127.0.0.1:${hostPorts.pr}/`).then(r => r.text())
  assert.equal(health, 'app pr')""",
     """  // the PR app, on the host's loopback, through the forwarder
  const health = await fetch(`http://127.0.0.1:${hostPorts.pr}/`).then(r => r.text())
  assert.equal(health, 'app pr')
  // the leftovers check's positive control: it sees the panes while they're up
  const up = await leftovers()
  assert.ok(up.containers.length >= 5, `the labelled containers: ${up.containers.join(', ')}`)
  assert.deepEqual([...up.networks].sort(), ['qa-session-base', 'qa-session-pr', 'qa-session-pr-edge'])
  // the gateway mode the runtime gave the internal network
  const gatewayMode = PODMAN ? '' : (await cli('network', 'inspect', '--format', '{{index .Options "com.docker.network.bridge.gateway_mode_ipv4"}}', 'qa-session-pr')).trim()
  t.diagnostic(`docker version says Engine ${dockerEngineMajor(version) ?? 'none'}; the internal network's IPv4 gateway mode: ${gatewayMode || 'unset'}`)
  assert.equal(gatewayMode === 'isolated', ISOLATED_GATEWAY)"""),
    ("""  // The probe's positive control. A host service on every address (0.0.0.0)
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
  assert.ok(reached.some(ip => wideVerdict.reasons.some(r => r.includes(`${ip}:${wide.port}`))), JSON.stringify(wideVerdict.reasons))""",
     """  // A host service on every address (0.0.0.0). The base pane reaches it
  // (the method works). On Docker Engine 28 and later the PR pane's
  // internal network has an isolated gateway, so the PR pane reaches it
  // nowhere, and the probe says isolated. Elsewhere (Podman, older Engines)
  // the bridge keeps the host's address: the PR pane reaches it there, at
  // its own network's gateway and nowhere else, and the probe must find it
  // and name it.
  const [baseGateway] = await gatewayOf('qa-session-base')
  assert.equal(await fetchIn('base', baseGateway, wide), true, `the control: the base pane reaches the host's every-address canary at ${baseGateway}`)
  const reached = []
  for (const ip of gateways) if (await fetchIn('pr', ip, wide)) reached.push(ip)
  const wideVerdict = await provisioner.isolation({ signal, canary: wide })
  t.diagnostic(`a host service on every address, from the PR pane: reached at ${reached.join(', ') || 'none'}; the probe says ${wideVerdict.verdict}`)
  if (ISOLATED_GATEWAY) {
    assert.deepEqual(reached, [], 'the isolated gateway: no host address to reach')
    assert.deepEqual(wideVerdict, { verdict: 'isolated', reasons: [], internal: true })
  } else {
    assert.ok(reached.length > 0 && reached.every(ip => prGateways.includes(ip)), `the PR pane reached the every-address canary at its own gateway (${prGateways.join(', ')}) only: ${reached.join(', ') || 'nowhere'}`)
    assert.equal(wideVerdict.verdict, 'reachable', JSON.stringify(wideVerdict))
    assert.equal(wideVerdict.internal, true)
    assert.ok(reached.some(ip => wideVerdict.reasons.some(r => r.includes(`${ip}:${wide.port}`))), JSON.stringify(wideVerdict.reasons))
  }"""),
    ("""  // Cloud metadata, directly
  assert.equal(await direct('pr', 'wget -q -T 3 -O - http://169.254.169.254/'), false, 'the PR pane reached 169.254.169.254')""",
     """  // No direct route out: a public address the base pane reaches (the
  // control) the PR pane doesn't, over IPv4, and over IPv6 where the
  // runner has it
  assert.equal(await inPane('base', 'nc', '-z', '-w', '3', '1.1.1.1', '443'), true, 'the control: the base pane reaches 1.1.1.1:443 directly')
  assert.equal(await inPane('pr', 'nc', '-z', '-w', '3', '1.1.1.1', '443'), false, 'the PR pane reached 1.1.1.1:443 directly')
  if (await inPane('base', 'nc', '-z', '-w', '3', '2606:4700:4700::1111', '443')) {
    assert.equal(await inPane('pr', 'nc', '-z', '-w', '3', '2606:4700:4700::1111', '443'), false, 'the PR pane reached [2606:4700:4700::1111]:443 directly')
  } else t.diagnostic('no IPv6 route from the base pane: the IPv6 direct check proves nothing here')

  // Cloud metadata, directly, with the base pane as its control
  if (await inPane('base', 'nc', '-z', '-w', '3', '169.254.169.254', '80')) {
    assert.equal(await inPane('pr', 'nc', '-z', '-w', '3', '169.254.169.254', '80'), false, 'the PR pane reached 169.254.169.254:80')
  } else t.diagnostic('169.254.169.254:80 is out of the base pane\\'s reach too: the metadata check proves nothing here')"""),
    ("""  const asked = await outOf('pr', 'sh', '-c', 'nslookup example.com 2>&1; true')
  assert.doesNotMatch(asked, /Name:\\s+example\\.com/, `nslookup resolved an outside name from the PR pane:\\n${asked}`)""",
     """  const asked = await outOf('pr', 'sh', '-c', 'nslookup example.com 2>&1; true')
  assert.match(asked, /Server:|timed out|no servers could be reached/i, `nslookup ran:\\n${asked}`)
  assert.doesNotMatch(asked, /Name:\\s+example\\.com/, `nslookup resolved an outside name from the PR pane:\\n${asked}`)"""),
    ("""  // The proxy: a host off the list, and metadata, are refused; a listed
  // address is let through (200 with the internet, 502 `failed` without).
  assert.equal(await connectVia('example.com:443'), 'HTTP/1.1 403 Forbidden | refused')
  assert.equal(await connectVia('169.254.169.254:80'), 'HTTP/1.1 403 Forbidden | refused')
  const listed = await connectVia('1.1.1.1:443')
  assert.match(listed, /^HTTP\\/1\\.1 (200 Connection Established \\| -|502 Bad Gateway \\| failed)$/, listed)""",
     """  // The proxy: a host off the list, and metadata, are refused; a listed
  // address is let through (200 with the internet, as CI has, 502 `failed`
  // without).
  assert.equal(await connectVia('example.com:443'), 'HTTP/1.1 403 Forbidden | refused')
  assert.equal(await connectVia('169.254.169.254:80'), 'HTTP/1.1 403 Forbidden | refused')
  const listed = await connectVia('1.1.1.1:443')
  t.diagnostic(`the listed address through the proxy: ${listed}`)
  assert.match(listed, process.env.CI === 'true' ? /^HTTP\\/1\\.1 200 Connection Established \\| -$/ : /^HTTP\\/1\\.1 (200 Connection Established \\| -|502 Bad Gateway \\| failed)$/, listed)"""),
    ("""  // Teardown and sweep leave nothing.
  for (const role of ['base', 'pr']) await provisioner.teardown({ paneRef: { role } })
  await provisioner.sweep()
  assert.deepEqual(await leftovers(), { containers: [], networks: [] })
})""",
     """  // Teardown leaves nothing, before any sweep; and the sweep after it is fine.
  for (const role of ['base', 'pr']) await provisioner.teardown({ paneRef: { role } })
  assert.deepEqual(await leftovers(), { containers: [], networks: [] })
  await provisioner.sweep()
  assert.deepEqual(await leftovers(), { containers: [], networks: [] })
})"""),
    ("""test('a topology that can\\'t be set up falls back, and QA_REQUIRE_ISOLATION=1 refuses the session: unknown, egress not restricted', { skip, ...LONG }, async (t) => {""",
     """test('a topology that can\\'t be set up falls back, and QA_REQUIRE_ISOLATION=1 refuses the session: never better than unknown, egress not restricted', { skip, ...LONG }, async (t) => {"""),
])

edit('.github/workflows/ci.yml', [
    ("""      - run: grep -qx 'ℹ skipped 0' it.log\n""",
     """      - run: grep -qx 'ℹ skipped 0' it.log && grep -qx 'ℹ todo 0' it.log\n"""),
])
edit('test/package.test.mjs', [
    ("""    "      - run: grep -qx 'ℹ skipped 0' it.log",\n""",
     """    "      - run: grep -qx 'ℹ skipped 0' it.log && grep -qx 'ℹ todo 0' it.log",\n"""),
])
print('ok')
