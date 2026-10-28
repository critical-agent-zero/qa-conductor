R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'

# docker.test.mjs additions
p = R + 'test/docker.test.mjs'
s = open(p).read()
s += r"""
// --- Round 3 of #40's review ---------------------------------------------------------

// Podman before 5.1 (Ubuntu 24.04's 4.9.3, Debian 12's 4.3.1, as the
// podman-docker shim drives it): `rm -f a b c` stops at the first name
// that is gone, removes none of the rest, and exits 0.
function oldPodmanRm(present) {
  const calls = []
  const fn = async (file, args) => {
    calls.push(args.join(' '))
    if (args[0] === 'rm') {
      const names = args.slice(3)
      if (names.some(n => !present.has(n))) return { stdout: '' }
      for (const n of names) present.delete(n)
      return { stdout: `${names.join('\n')}\n` }
    }
    if (args[0] === 'ps') return { stdout: `${[...present].join('\n')}\n` }
    return { stdout: '' }
  }
  fn.calls = calls
  return fn
}

test('rmForce and the sweep remove every container under Podman before 5.1, whose batched rm stops at a name already gone', async () => {
  // what the batch did there: nothing removed, exit 0
  const batch = new Set(['qa-app-pr', 'qa-fwd-pr', 'qa-pg-pr'])
  await createDocker({ execFileFn: oldPodmanRm(batch) }).run(['rm', '-f', '-v', 'qa-app-pr', 'qa-migrate-pr', 'qa-fwd-pr', 'qa-pg-pr'])
  assert.equal(batch.size, 3, 'the old batch removed nothing')
  // one name at a time removes them all
  const present = new Set(['qa-app-pr', 'qa-fwd-pr', 'qa-pg-pr'])
  await createDocker({ execFileFn: oldPodmanRm(present) }).rmForce(['qa-app-pr', 'qa-migrate-pr', 'qa-probe-pr', 'qa-fwd-pr', 'qa-pg-pr'])
  assert.deepEqual([...present], [])
  // the sweep too, with a container gone between its list and its rm
  const swept = new Set(['c1', 'c2', 'c3'])
  const exec = oldPodmanRm(swept)
  const docker = createDocker({ execFileFn: async (file, args) => { const out = await exec(file, args); if (args[0] === 'ps') swept.delete('c2'); return out } })
  await docker.sweepQaContainers()
  assert.deepEqual([...swept], [])
})

// A real failure whose last line ends in "exit status N" is no noise: only
// a line that is nothing but that is.
test('a failure line that only ends in "exit status N" is a failure, never noise', async () => {
  const err = dockerFailure('Error response from daemon: No such container: a\nError: OCI runtime error: crun: kill: exit status 125\n')
  await assert.rejects(createDocker({ execFileFn: recordingExec([err]) }).rmForce(['a']), e => e === err)
  const gone = dockerFailure('Error response from daemon: No such container: a\nexit status 1\n')
  await createDocker({ execFileFn: recordingExec([gone]) }).rmForce(['a'])
})

test('createNetwork can isolate an internal network\'s gateway, and networkGatewayIsolated reads it back', async () => {
  const exec = recordingExec(['', 'isolated\n', '\n'])
  const docker = createDocker({ execFileFn: exec })
  await docker.createNetwork('qa-session-pr', { internal: true, isolatedGateway: true })
  assert.equal(await docker.networkGatewayIsolated('qa-session-pr'), true)
  assert.equal(await docker.networkGatewayIsolated('qa-session-pr'), false)
  assert.deepEqual(exec.calls, [
    ['docker', 'network', 'create', '--label', 'qa-conductor-session', '--internal', '-o', 'com.docker.network.bridge.gateway_mode_ipv4=isolated', '-o', 'com.docker.network.bridge.gateway_mode_ipv6=isolated', 'qa-session-pr'],
    ['docker', 'network', 'inspect', '--format', '{{index .Options "com.docker.network.bridge.gateway_mode_ipv4"}}', 'qa-session-pr'],
    ['docker', 'network', 'inspect', '--format', '{{index .Options "com.docker.network.bridge.gateway_mode_ipv4"}}', 'qa-session-pr'],
  ])
})
"""
open(p, 'w').write(s)

# provisioner-docker.test.mjs additions
p = R + 'test/provisioner-docker.test.mjs'
s = open(p).read()
a = "import { createDockerProvisioner"
assert s.count(a) == 1, 'import'
s = s.replace(a, "import { dockerEngineMajor, createDockerProvisioner", 1)
s += r"""
// --- Round 3 of #40's review ---------------------------------------------------------

const ENGINE = major => `Client: Docker Engine - Community\n Version:           ${major}.0.4\n\nServer: Docker Engine - Community\n Engine:\n  Version:          ${major}.0.4\n`

test('dockerEngineMajor reads the server\'s Engine version, and none for Podman or no server', () => {
  assert.equal(dockerEngineMajor(ENGINE(28)), 28)
  assert.equal(dockerEngineMajor(ENGINE(27)), 27)
  assert.equal(dockerEngineMajor(`Client: Docker Engine - Community\n Version:           28.0.4\n`), null, 'no server')
  assert.equal(dockerEngineMajor('Client: Podman Engine\nVersion: 5.2.0\nServer: Podman Engine\nVersion: 5.2.0\n'), null)
  assert.equal(dockerEngineMajor(undefined), null)
})

// On Docker Engine 28 and later, the PR pane's internal network gets no
// address of the host's on its bridge (gateway mode isolated), so a host
// service on 0.0.0.0 isn't reachable from it either.
test('on Docker Engine 28 and later the internal network\'s gateway is isolated; on older Engines and Podman, or where refused, it is a plain internal network, never the fallback', async () => {
  const createOf = exec => argvOf(exec).find(c => c.startsWith('network create') && c.endsWith(' qa-session-pr') && c.includes('--internal'))
  const gw = '-o com.docker.network.bridge.gateway_mode_ipv4=isolated -o com.docker.network.bridge.gateway_mode_ipv6=isolated'
  for (const [version, isolated] of [[ENGINE(28), true], [ENGINE(29), true], [ENGINE(27), false], ['Client: Podman Engine\nServer: Podman Engine\n', false]]) {
    const { lines, log } = logged()
    const s = makeSession({ provisionerOptions: { ...INTERNAL, log }, answer: probeDocker({ version, probe: refusedAll() }) })
    await s.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
    assert.equal(createOf(s.exec), `network create --label qa-conductor-session --internal ${isolated ? `${gw} ` : ''}qa-session-pr`, version)
    assert.deepEqual(lines, [], 'no fallback')
  }
  // an Engine that refuses the option: a plain internal network, up
  const { lines, log } = logged()
  const answers = probeDocker({ version: ENGINE(28), probe: refusedAll() })
  const refused = makeSession({ provisionerOptions: { ...INTERNAL, log }, answer: (args, opts) => (args.join(' ').includes('gateway_mode_ipv4=isolated') ? failWith('Error response from daemon: invalid option') : answers(args, opts)) })
  await refused.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
  const creates = argvOf(refused.exec).filter(c => c.startsWith('network create') && c.endsWith(' qa-session-pr'))
  assert.deepEqual(creates, [`network create --label qa-conductor-session --internal ${gw} qa-session-pr`, 'network create --label qa-conductor-session --internal qa-session-pr'])
  assert.deepEqual(lines, [])
  assert.deepEqual(await refused.provisioner.isolation({ canary: CANARY }), { verdict: 'isolated', reasons: [], internal: true })
})

test('a left-over internal network without an isolated gateway is made again on Engine 28 and later; one with it is reused', async () => {
  const exists = failWith('Error response from daemon: network with name qa-session-pr already exists')
  for (const [mode, remade] of [['\n', true], ['isolated\n', false]]) {
    let made = false
    const answers = probeDocker({ version: ENGINE(28), probe: refusedAll() })
    const s = makeSession({ provisionerOptions: INTERNAL, answer: (args, opts) => {
      const c = args.join(' ')
      if (c.startsWith('network create') && c.endsWith(' qa-session-pr') && c.includes('--internal')) { if (made) return ''; made = true; return exists }
      if (c === 'network inspect --format {{.Name}} qa-session-pr') return 'qa-session-pr\n'
      if (c.startsWith('network inspect --format {{index .Options')) return mode
      return answers(args, opts)
    } })
    await s.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
    const calls = argvOf(s.exec)
    assert.equal(calls.includes('network rm qa-session-pr'), remade, mode)
    assert.equal(calls.filter(c => c.startsWith('network create') && c.endsWith(' qa-session-pr')).length, remade ? 2 : 1, mode)
  }
})
"""
open(p, 'w').write(s)

# forwarder.test.mjs: a host that never answers gets a 502
p = R + 'test/forwarder.test.mjs'
s = open(p).read()
s += r"""
// A listed host that takes the request and never answers: after idleMs the
// PR gets a 502 `failed`, never a reset (the PR-side timer is armed only
// once the answer's headers are written).
test('a plain-HTTP host that accepts the request but never answers gets the PR a 502 failed after idleMs', BOUNDED, async (t) => {
  const silent = net.createServer(socket => { socket.on('error', () => {}); socket.on('data', () => {}) })
  const silentPort = await listening(silent)
  t.after(() => silent.close())
  const w = await world(t, { allow: ['api.example.com'], timeouts: { idleMs: 300 }, connect: () => net.connect({ port: silentPort, host: '127.0.0.1' }) })
  const out = await viaProxy(w.proxyPort, 'http://api.example.com/slow')
  assert.deepEqual([out.status, out.headers['x-qa-egress']], [502, 'failed'])
})
"""
open(p, 'w').write(s)
print('ok')
