R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:120], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('test/docker.test.mjs', [
    ("""// A wedged daemon must not hold the boot at the probe for ever.""",
     """// Behind the podman-docker shim, `docker context inspect` is Podman's,
// which has no Docker context: it prints nothing, or fails on the template.
// The daemon's endpoint is then Podman's own connection.
test('endpoint under the podman-docker shim: CONTAINER_HOST, the connection CONTAINER_CONNECTION names, the default one, else local', async () => {
  const contextFails = dockerFailure('Error: template: inspect:1:12: executing "inspect" at <.Endpoints.docker.Host>: can\\'t evaluate field Endpoints in type config.Connection\\n')
  const list = JSON.stringify([
    { Name: 'machine', URI: 'ssh://core@127.0.0.1:50000/run/user/1000/podman/podman.sock', Identity: '/x', Default: true },
    { Name: 'here', URI: 'unix:///run/podman/podman.sock', Identity: '', Default: false },
  ])
  const at = (answers, env = {}) => createDocker({ execFileFn: recordingExec(answers), env })
  assert.equal(await at(['\\n', '[]\\n']).endpoint({ podman: true }), 'local')
  assert.equal(await at([contextFails, 'null\\n']).endpoint({ podman: true }), 'local')
  assert.equal(await at(['', '']).endpoint({ podman: true }), 'local')
  assert.equal(await at(['', list]).endpoint({ podman: true }), 'ssh://core@127.0.0.1:50000/run/user/1000/podman/podman.sock')
  assert.equal(await at(['', list], { CONTAINER_CONNECTION: 'here' }).endpoint({ podman: true }), 'unix:///run/podman/podman.sock')
  await assert.rejects(at(['', list], { CONTAINER_CONNECTION: 'gone' }).endpoint({ podman: true }), /CONTAINER_CONNECTION names "gone", which podman doesn't list/)
  assert.equal(await at([''], { CONTAINER_HOST: 'tcp://10.0.0.5:8888' }).endpoint({ podman: true }), 'tcp://10.0.0.5:8888')
  await assert.rejects(at(['', '{"Name":"x"}']).endpoint({ podman: true }), /gave no list/)
  // the docker CLI against Podman's socket has a context, and that is it
  assert.equal(await at(['unix:///run/podman/podman.sock\\n'], { CONTAINER_HOST: 'ssh://elsewhere' }).endpoint({ podman: true }), 'unix:///run/podman/podman.sock')
  // Docker's own CLI: a failure is still one, and nothing is asked of Podman
  await assert.rejects(at([contextFails]).endpoint(), e => e === contextFails)
  const exec = recordingExec(['', '[]'])
  await createDocker({ execFileFn: exec, env: {} }).endpoint({ podman: true })
  assert.deepEqual(exec.calls, [
    ['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    ['docker', 'system', 'connection', 'list', '--format', 'json'],
  ])
})

// A wedged daemon must not hold the boot at the probe for ever."""),
])

edit('test/provisioner-docker.test.mjs', [
    # logged() records only what goes through log.error, as the README promises
    ("""  return { lines, log: { log: line => lines.push(line), error: line => lines.push(line), warn: line => lines.push(line) } }""",
     """  // only error: the README promises the fallback goes through log.error
  return { lines, log: { log() {}, error: line => lines.push(line), warn() {} } }"""),
    # the shim test answers context inspect as the shim does
    ("""// Under the podman-docker shim, `docker info` fails; with the topology up the
// probe still decides.
test('under the podman-docker shim, whose info fails, the topology up still lets the probe decide', async () => {
  const shimInfo = Object.assign(new Error('docker info: Command failed'), { stderr: 'Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.\\nError: template: info:1:2: executing "info" at <.OperatingSystem>: can\\'t evaluate field OperatingSystem in type *define.Info\\n' })
  const s = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ version: 'Client: Podman Engine\\nVersion: 5.2.0\\n', os: shimInfo, probe: refusedAll() }) })
  await s.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
  assert.deepEqual(await s.provisioner.isolation({ canary: CANARY }), { verdict: 'isolated', reasons: [], internal: true })
})""",
     """// Under the podman-docker shim, `docker info` fails, and `docker context
// inspect` is Podman's, which has no Docker context: it prints nothing, or
// fails on the template. With the topology up the probe still decides,
// where Podman's own connection is this host.
test('under the podman-docker shim, whose info and context fail, the topology up still lets the probe decide where Podman runs here', async () => {
  const shimInfo = Object.assign(new Error('docker info: Command failed'), { stderr: 'Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.\\nError: template: info:1:2: executing "info" at <.OperatingSystem>: can\\'t evaluate field OperatingSystem in type *define.Info\\n' })
  const shimContext = Object.assign(new Error('docker context: Command failed'), { stderr: 'Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.\\nError: template: inspect:1:12: executing "inspect" at <.Endpoints.docker.Host>: can\\'t evaluate field Endpoints in type config.Connection\\n' })
  const machine = JSON.stringify([{ Name: 'podman-machine-default', URI: 'ssh://core@127.0.0.1:50000/run/user/1000/podman/podman.sock', Identity: '/x', Default: true }])
  for (const [context, connections, want] of [
    [shimContext, '[]\\n', { verdict: 'isolated', reasons: [], internal: true }],
    ['\\n', '[]\\n', { verdict: 'isolated', reasons: [], internal: true }],
    // a default connection that isn't this host: the probe can't speak for it
    [shimContext, machine, { verdict: 'unknown', reasons: ['the Docker daemon is at ssh://127.0.0.1, which may not be this host, so the probe can\\'t speak for this host\\'s loopback'], internal: true }],
  ]) {
    const answers = probeDocker({ version: 'Client: Podman Engine\\nVersion: 5.2.0\\n', os: shimInfo, endpoint: context, probe: refusedAll() })
    const s = makeSession({ provisionerOptions: INTERNAL, answer: (args, opts) => (args.join(' ') === 'system connection list --format json' ? connections : answers(args, opts)) })
    await s.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
    assert.deepEqual(await s.provisioner.isolation({ canary: CANARY }), want, connections)
  }
})

// --- Round 2 of #40's review ---------------------------------------------------------

// The forwarder's readiness is polled: one still starting at the first look
// is up once it says so, and an abort while it is polled stops the boot.
test('the forwarder\\'s readiness is polled until it says so, and an abort while polling stops the boot with no fallback', async () => {
  let looks = 0
  const later = makeSession({ provisionerOptions: INTERNAL, answer: (args, opts) => (args[0] === 'logs' && args.at(-1) === 'qa-fwd-pr' ? (++looks < 3 ? 'starting\\n' : 'qa-forwarder ready\\n') : probeDocker({ probe: refusedAll() })(args, opts)) })
  await later.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
  assert.equal(looks, 3)
  assert.deepEqual(await later.provisioner.isolation({ canary: CANARY }), { verdict: 'isolated', reasons: [], internal: true })

  const { lines, log } = logged()
  const ac = new AbortController()
  const stopped = makeSession({ provisionerOptions: { ...INTERNAL, log }, answer: args => {
    if (args[0] === 'logs' && args.at(-1) === 'qa-fwd-pr') { ac.abort(); return 'starting\\n' }
    return null
  } })
  await assert.rejects(stopped.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [], signal: ac.signal }), { name: 'AbortError' })
  const calls = argvOf(stopped.exec)
  const at = calls.findIndex(c => c.startsWith('logs') && c.endsWith('qa-fwd-pr'))
  // nothing undone, nothing made after the abort, nothing logged
  assert.deepEqual(calls.slice(at + 1).filter(c => !c.startsWith('inspect --format {{.State.Running}}')), [])
  assert.deepEqual(lines, [])
})

// The DNS server is the PR pane's whatever `docker version` says at the end
// of the setup: one that fails there is taken for Docker, whose own DNS
// still serves the network's names, so no hosts entries.
test('a docker version that fails once the forwarder is ready still gives the PR pane\\'s containers --dns 192.0.2.1, and no hosts entries', async () => {
  let ready = false
  const s = makeSession({ provisionerOptions: INTERNAL, answer: args => {
    if (args[0] === 'logs' && args.at(-1) === 'qa-fwd-pr') { ready = true; return 'qa-forwarder ready\\n' }
    if (args[0] === 'version' && ready) return failWith('Cannot connect to the Docker daemon')
    return null
  } })
  await bootSession(s.deps, 7)
  for (const name of ['qa-pg-pr', 'qa-migrate-pr', 'qa-app-pr']) assert.equal(dnsOf(s.exec, name), '192.0.2.1', name)
  assert.equal(runs(s.exec).some(c => c.args.includes('--add-host')), false)
})

// A boot aborted while its topology was being set up must leave the next
// boot's alone: it never assigns the shared topology, and never undoes
// names the next session may own by now.
test('an aborted boot\\'s topology setup neither overwrites the next boot\\'s topology nor undoes its names', async () => {
  // Boot A is held in its last docker call, the `docker version` after
  // readiness; it is aborted, and boot B falls back (its forwarder's name
  // is taken); then A's call answers
  let phase = 'A'
  let release = null
  let held = null
  const holding = new Promise(resolve => { held = resolve })
  const { lines, log } = logged()
  const answers = probeDocker({ probe: 'self 172.20.0.3:5432\\nprobe done\\n' })
  const s = makeSession({ provisionerOptions: { ...INTERNAL, log }, answer: async (args, opts) => {
    if (phase === 'A' && args[0] === 'version' && !release) { held(); await new Promise(resolve => { release = resolve }) }
    if (phase === 'B' && args.join(' ').startsWith('run -d --name qa-fwd-pr')) return failWith('Error response from daemon: Conflict. The container name "/qa-fwd-pr" is already in use')
    return answers(args, opts)
  } })
  const a = new AbortController()
  const bootA = s.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [], signal: a.signal }).then(() => 'resolved', err => err.name)
  await holding
  a.abort()
  phase = 'B'
  await s.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [], signal: new AbortController().signal })
  assert.equal(lines.length, 1, 'B fell back, and said so')
  release()
  assert.equal(await bootA, 'AbortError')
  const out = await s.provisioner.isolation({ canary: CANARY })
  assert.equal(out.internal, undefined)
  assert.match(out.reasons.at(-1), /^egress isn't restricted: the PR pane's internal network couldn't be set up \\(.*already in use.*\\)$/)

  // Boot C is held in joining the forwarder to the internal network, and
  // aborted; then the join fails. C undoes nothing: no forwarder or network
  // is removed after the abort
  let joined = null
  let fail = null
  const joining = new Promise(resolve => { joined = resolve })
  const c = makeSession({ provisionerOptions: { ...INTERNAL, log: logged().log }, answer: async (args, opts) => {
    if (args[0] === 'network' && args[1] === 'connect') { joined(); await new Promise(resolve => { fail = resolve }); return failWith('Error response from daemon: network qa-session-pr not found') }
    return answers(args, opts)
  } })
  const ac = new AbortController()
  const bootC = c.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [], signal: ac.signal }).then(() => 'resolved', err => err.name)
  await joining
  ac.abort()
  const before = argvOf(c.exec).length
  fail()
  assert.equal(await bootC, 'AbortError')
  assert.deepEqual(argvOf(c.exec).slice(before), [])
})"""),
])
print('ok')
