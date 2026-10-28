
// --- #40's review ------------------------------------------------------------------------

const failWith = text => Object.assign(new Error('docker: Command failed'), { stderr: `${text}\n` })
const logged = () => {
  const lines = []
  return { lines, log: { log: line => lines.push(line), error: line => lines.push(line), warn: line => lines.push(line) } }
}

// The review's first medium: on Linux, a topology that fell back left the
// verdict isolated, with no reason and no log, and the allowlist silently
// dropped. Now the verdict is never better than unknown, says why, and the
// fallback is logged.
test('with internal set, a topology that falls back is never isolated: the verdict says egress isn\'t restricted, and it is logged', async () => {
  const pullFails = args => (args.join(' ').endsWith('node:22-alpine') && /^(image inspect|pull)/.test(args.join(' ')) ? failWith('Error response from daemon: toomanyrequests: You have reached your pull rate limit') : null)
  for (const [probe, verdict] of [['self 172.20.0.3:5432\nprobe done\n', 'unknown'], ['open 172.19.0.2:5432\nself 172.20.0.3:5432\nprobe done\n', 'reachable']]) {
    const { lines, log } = logged()
    const answers = probeDocker({ probe })
    const s = makeSession({ provisionerOptions: { ...INTERNAL, log }, answer: (args, opts) => pullFails(args) ?? answers(args, opts) })
    await bootSession(s.deps, 7)
    const out = await s.provisioner.isolation({ canary: CANARY })
    assert.equal(out.verdict, verdict)
    assert.equal(out.internal, undefined)
    assert.match(out.reasons.at(-1), /^egress isn't restricted: the PR pane's internal network couldn't be set up \(pull node:22-alpine failed after 3 attempts.*\)$/)
    assert.ok(lines.some(line => /^\[qa\] the PR pane's internal network couldn't be set up \(.+\): it runs on an ordinary network, and its egress isn't restricted$/.test(line)), lines.join('\n'))
  }
})

// The review's second medium: on some Docker Engines, DNS from an internal
// network reaches the host's resolver (CVE-2024-29018). The PR pane's
// containers get an unroutable DNS server instead, so no name outside the
// network resolves; names on it still do, through the runtime's own DNS.
test('with the topology up on Docker, the PR pane\'s containers get an unroutable DNS server; not the base pane\'s, not on Podman, not after a fallback', async () => {
  const dnsOf = (exec, name) => valueOf(runs(exec).find(c => (valueOf(c.args, '--name') ?? valueOf(c.args, '--env-file')).endsWith(name)).args, '--dns')
  const s = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ probe: refusedAll() }) })
  s.deps.checkIsolation = async ({ stage, signal }) => { if (stage === 'panes') await s.provisioner.isolation({ signal, canary: CANARY }) }
  await bootSession(s.deps, 7)
  for (const name of ['qa-pg-pr', 'qa-migrate-pr', 'qa-app-pr', 'qa-probe-pr']) assert.equal(dnsOf(s.exec, name), '192.0.2.1', name)
  for (const name of ['qa-pg-base', 'qa-migrate-base', 'qa-app-base', 'qa-fwd-pr']) assert.equal(dnsOf(s.exec, name), null, name)
  // Podman: its DNS answers nothing outside the network, and a --dns there
  // would replace it
  const podman = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ version: 'Client: Podman Engine\nServer: Podman Engine\n', probe: refusedAll() }) })
  await bootSession(podman.deps, 7)
  assert.equal(runs(podman.exec).some(c => c.args.includes('--dns')), false)
  // fallen back: no --dns either
  const down = makeSession({ provisionerOptions: INTERNAL, answer: args => (args.join(' ').startsWith('run -d --name qa-fwd-pr') ? failWith('port is already allocated') : null) })
  await bootSession(down.deps, 7)
  assert.equal(runs(down.exec).some(c => c.args.includes('--dns')), false)
})

// The review's lows: "up" was decided from exit codes alone.
test('the topology is up only when the new network reads back internal and the forwarder runs and says it is ready; else it falls back', async () => {
  const cases = [
    ['the network isn\'t internal', args => (args.join(' ') === 'network inspect --format {{.Internal}} qa-session-pr' ? 'false\n' : null), /qa-session-pr was created but isn't internal/],
    ['the forwarder exited', args => (args.join(' ') === 'inspect --format {{.State.Running}} qa-fwd-pr' ? 'false\n' : null), /the forwarder qa-fwd-pr isn't running/],
    ['the forwarder never says ready', args => (args[0] === 'logs' && args.at(-1) === 'qa-fwd-pr' ? 'starting\n' : null), /the forwarder qa-fwd-pr wasn't ready within 150 ms/],
  ]
  for (const [name, answer, re] of cases) {
    const s = makeSession({ provisionerOptions: { ...INTERNAL, forwarderReadyMs: 150, log: logged().log }, answer: (args, opts) => answer(args) ?? probeDocker()(args, opts) })
    await bootSession(s.deps, 7)
    const app = runs(s.exec).find(c => valueOf(c.args, '--name') === 'qa-app-pr').args
    assert.equal(valueOf(app, '-p'), '127.0.0.1:3112:3000', `${name}: fell back`)
    const out = await s.provisioner.isolation({ canary: CANARY })
    assert.match(out.reasons.at(-1), re, name)
  }
})

test('triage with the topology up adds the forwarder\'s log tail to the PR app\'s', async () => {
  const s = makeSession({ provisionerOptions: INTERNAL, answer: args => (args[0] === 'logs' ? (args.at(-1) === 'qa-fwd-pr' ? 'qa-forwarder ready\nqa-egress refused evil.example:443: not on the allowlist\n' : 'app says hi\n') : null) })
  await bootSession(s.deps, 7)
  assert.equal(await s.provisioner.logs({ paneRef: { role: 'pr' }, stage: 'starting', lines: 40 }), 'app says hi\n[qa-fwd-pr]\nqa-forwarder ready\nqa-egress refused evil.example:443: not on the allowlist\n')
  assert.equal(await s.provisioner.logs({ paneRef: { role: 'base' }, stage: 'starting', lines: 40 }), 'app says hi\n')
})

// Under the podman-docker shim, `docker info` fails; with the topology up the
// probe still decides.
test('under the podman-docker shim, whose info fails, the topology up still lets the probe decide', async () => {
  const shimInfo = Object.assign(new Error('docker info: Command failed'), { stderr: 'Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.\nError: template: info:1:2: executing "info" at <.OperatingSystem>: can\'t evaluate field OperatingSystem in type *define.Info\n' })
  const s = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ version: 'Client: Podman Engine\nVersion: 5.2.0\n', os: shimInfo, probe: refusedAll() }) })
  await s.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
  assert.deepEqual(await s.provisioner.isolation({ canary: CANARY }), { verdict: 'isolated', reasons: [], internal: true })
})

// The proxy's control: an answer for every target it was asked, or its
// silence there proves nothing.
test('with the topology up, the proxy must answer for every target the probe asked it, else the verdict is unknown, naming the silent ones', async () => {
  const s = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ probe: 'self 172.20.0.3:5432\nrefused host.docker.internal:3100\nprobe done\n' }) })
  await s.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
  const out = await s.provisioner.isolation({ canary: CANARY })
  assert.equal(out.verdict, 'unknown')
  assert.match(out.reasons[0], /^the forwarder's proxy at qa-egress:3128 didn't answer the probe for \d+ of \d+ targets \(gateway\.docker\.internal:3100, .+ and \d+ more\), so it can't say what the proxy lets through there$/)
})

// The fallback's undo: an internal network that can't be removed, or one that
// is still there, fails the boot rather than pass for an ordinary one.
test('a fallback that can\'t remove the internal network, or finds one still there, fails the boot', async () => {
  const forwarderFails = c => (c.startsWith('run -d --name qa-fwd-pr') ? failWith('port is already allocated') : null)
  const stuck = makeSession({ provisionerOptions: INTERNAL, answer: args => forwarderFails(args.join(' ')) ?? (args.join(' ') === 'network rm qa-session-pr' ? failWith('Error response from daemon: error while removing network: network qa-session-pr has active endpoints') : null) })
  await assert.rejects(stuck.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] }), /the PR pane's internal network couldn't be set up \(port is already allocated\), nor removed: Error response from daemon: error while removing network/)
  let created = 0
  const still = makeSession({
    provisionerOptions: INTERNAL,
    answer: args => {
      const c = args.join(' ')
      if (forwarderFails(c)) return forwarderFails(c)
      if (c === 'network create --label qa-conductor-session qa-session-pr' && ++created) return failWith('Error response from daemon: network with name qa-session-pr already exists')
      if (c === 'network inspect --format {{.Name}} qa-session-pr') return 'qa-session-pr\n'
      return null
    },
  })
  await assert.rejects(still.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] }), /a network qa-session-pr is still there, and internal/)
})

test('the base pane\'s teardown leaves the PR pane\'s forwarder and edge network alone', async () => {
  const s = makeSession({ provisionerOptions: INTERNAL })
  await bootSession(s.deps, 7)
  const before = docker(s.exec).length
  await s.provisioner.teardown({ paneRef: { role: 'base' } })
  assert.deepEqual(argvOf(s.exec).slice(before), ['rm -f -v qa-app-base qa-migrate-base qa-pg-base', 'network rm qa-session-base'])
})
