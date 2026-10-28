
// --- #32: the PR pane on an internal network -------------------------------------
// With `internal`, the PR pane's containers join a network with no route off
// itself. A forwarder (lib/forwarder.mjs), on an ordinary network and joined
// to the internal one as `qa-egress`, publishes the PR app on the host's
// loopback and is its only way out: an HTTP proxy that lets it out only to
// hosts on the allowlist. If any of that can't be set up, the PR pane runs as
// it would without `internal`.

const FORWARDER_SOURCE = readFileSync(new URL('../lib/forwarder.mjs', import.meta.url), 'utf8')
const INTERNAL = { internal: { egress: ['api.example.com', '*.stripe.com'] } }
const PROXY_ENV = {
  HTTP_PROXY: 'http://qa-egress:3128', HTTPS_PROXY: 'http://qa-egress:3128', http_proxy: 'http://qa-egress:3128', https_proxy: 'http://qa-egress:3128',
  NO_PROXY: 'localhost,127.0.0.1,::1,qa-pg-pr,qa-app-pr', no_proxy: 'localhost,127.0.0.1,::1,qa-pg-pr,qa-app-pr', NODE_USE_ENV_PROXY: '1',
}
const envOf = text => Object.fromEntries(text.trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
const argvOf = exec => docker(exec).map(c => c.args.join(' '))
const fwdRun = exec => runs(exec).find(c => valueOf(c.args, '--name') === 'qa-fwd-pr')

test('with internal, the PR pane joins an internal network, and a forwarder on an ordinary one publishes its app and is its only way out', async () => {
  const s = makeSession({ provisionerOptions: INTERNAL })
  // the EnvTransform's own proxy: the forwarder's wins in the PR pane alone
  const derive = s.deps.adapters.envTransform.derivePaneEnv
  s.deps.adapters.envTransform.derivePaneEnv = args => ({ app: { ...derive(args).app, HTTPS_PROXY: 'http://corp-proxy:8080' } })
  assert.equal(s.provisioner.internal, true)
  await bootSession(s.deps, 7)
  const calls = argvOf(s.exec)
  const at = start => {
    const i = calls.findIndex(c => c.startsWith(start))
    assert.ok(i !== -1, `${start}\n${calls.join('\n')}`)
    return i
  }
  // the edge network, the internal one, the forwarder's image, the forwarder,
  // then the forwarder joins the internal network: all before the PR pane's
  // database
  const order = [
    'network create --label qa-conductor-session qa-session-pr-edge',
    'network create --label qa-conductor-session --internal qa-session-pr',
    'image inspect node:22-alpine',
    'run -d --name qa-fwd-pr',
    'network connect --alias qa-egress qa-session-pr qa-fwd-pr',
    'run -d --name qa-pg-pr',
  ].map(at)
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'in that order')
  assert.equal(calls.filter(c => c.startsWith('network create')).length, 3, 'the base pane\'s, the edge and the internal one')

  const fwd = fwdRun(s.exec)
  assert.equal(valueOf(fwd.args, '--network'), 'qa-session-pr-edge')
  assert.equal(valueOf(fwd.args, '-p'), '127.0.0.1:3112:3000')
  assert.deepEqual(JSON.parse(valueOf(fwd.args, '-e').replace(/^PANE_FORWARDER=/, '')), {
    host: '0.0.0.0', forward: { listen: 3000, to: 'qa-app-pr:3000' }, proxy: { listen: 3128, allow: ['api.example.com', '*.stripe.com'] },
  })
  assert.equal(fwd.args.at(-1), FORWARDER_SOURCE, 'the forwarder\'s file, as it is')
  for (const flag of ['--env-file', '-v', '--volume', '--mount', '--privileged']) assert.equal(fwd.args.includes(flag), false, flag)

  // every other container of the PR pane is on the internal network alone,
  // and its app publishes nothing: the forwarder publishes its port
  for (const { args } of runs(s.exec).filter(c => roleOf(c.args) === 'pr' && valueOf(c.args, '--name') !== 'qa-fwd-pr')) {
    assert.equal(valueOf(args, '--network'), 'qa-session-pr', args.join(' '))
  }
  const app = role => runs(s.exec).find(c => valueOf(c.args, '--name') === `qa-app-${role}`).args
  assert.equal(app('pr').includes('-p'), false)
  assert.equal(valueOf(app('base'), '-p'), '127.0.0.1:3111:3000')

  // the proxy's settings, in the PR pane's env for its migrate run and its app
  const writes = s.fsx.writes.filter(([path]) => path.endsWith('.env.qa-pr'))
  assert.equal(writes.length, 2)
  for (const [, text] of writes) {
    const env = envOf(text)
    for (const [key, value] of Object.entries(PROXY_ENV)) assert.equal(env[key], value, key)
    assert.match(env.DATABASE_URL, /^postgresql:\/\/qa:[0-9a-f]{48}@qa-pg-pr:5432$/)
  }
  const base = envOf(s.fsx.files.get(`${WORK}/.env.qa-base`).text)
  assert.equal(base.HTTPS_PROXY, 'http://corp-proxy:8080')
  for (const key of ['HTTP_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY']) assert.equal(base[key], undefined, key)

  // the base pane is as it was
  assert.deepEqual(runs(s.exec).filter(c => roleOf(c.args) === 'base').map(c => valueOf(c.args, '--network')), ['qa-session-base', 'qa-session-base', 'qa-session-base'])
})

test('without internal nothing changes, and internal: true means no egress at all', async () => {
  const off = makeSession()
  assert.equal(off.provisioner.internal, false)
  await bootSession(off.deps, 7)
  assert.equal(argvOf(off.exec).some(c => /qa-fwd-pr|--internal|-edge|network connect/.test(c)), false)
  assert.equal(envOf(off.fsx.files.get(`${WORK}/.env.qa-pr`).text).HTTPS_PROXY, undefined)
  const empty = makeSession({ provisionerOptions: { internal: true } })
  await bootSession(empty.deps, 7)
  assert.deepEqual(JSON.parse(valueOf(fwdRun(empty.exec).args, '-e').replace(/^PANE_FORWARDER=/, '')).proxy, { listen: 3128, allow: [] })
  // another image for the forwarder
  const own = makeSession({ provisionerOptions: { internal: { image: 'registry.example.com/node:22-alpine' } } })
  await bootSession(own.deps, 7)
  assert.equal(fwdRun(own.exec).args.at(-4), 'registry.example.com/node:22-alpine')
})

test('internal\'s options are checked as the Provisioner is made, so a typo never opens more than meant', () => {
  const make = internal => createDockerProvisioner({ docker: makeDocker(recordingExec()), fsx: recordingFs(), workDir: WORK, internal })
  for (const off of [undefined, null, false]) assert.equal(make(off).internal, false)
  for (const [internal, re] of [
    [{ egress: 'api.example.com' }, /^internal: the egress allowlist must be an array of hosts$/],
    [{ egress: ['127.0.0.1'] }, /^internal: egress\[0\]: 127\.0\.0\.1 is loopback, which is always refused$/],
    [{ egress: ['localhost'] }, /^internal: egress\[0\] must be a host name/],
    [{ egress: ['api.example.com:http'] }, /^internal: egress\[0\] has a bad port/],
    [{ image: '' }, /^internal\.image must be an image name/],
    [{ image: 'node 22' }, /^internal\.image must be an image name/],
    [{ egres: [] }, /^internal has no option "egres": egress or image$/],
    ['yes', /^internal must be true, or \{ egress, image \}$/],
    [['api.example.com'], /^internal must be true, or \{ egress, image \}$/],
  ]) assert.throws(() => make(internal), re, JSON.stringify(internal))
  // its edge network can't be the base pane's
  assert.throws(() => createDockerProvisioner({ docker: makeDocker(recordingExec()), fsx: recordingFs(), workDir: WORK, network: { base: 'n-pr-edge', pr: 'n-pr' }, internal: true }), /the PR pane's edge network, n-pr-edge, is the base pane's/)
})

// If the internal network or the forwarder can't be set up, the PR pane runs
// as it would without `internal`: on an ordinary network, its app published,
// no proxy. Its isolation result says why, and carries no `internal`.
test('a step of the internal topology that fails leaves the PR pane on an ordinary network, as without internal, and the verdict says why', async () => {
  const fail = (match, text) => args => (match(args.join(' ')) ? Object.assign(new Error(`docker ${args[0]}: Command failed`), { stderr: `${text}\n` }) : null)
  const steps = [
    ['the edge network', fail(c => c === 'network create --label qa-conductor-session qa-session-pr-edge', 'Error response from daemon: could not find an available, non-overlapping IPv4 address pool')],
    ['the internal network', fail(c => c.includes('--internal'), 'Error response from daemon: internal networks are not supported')],
    ['the forwarder\'s image', fail(c => c.endsWith('node:22-alpine') && /^(image inspect|pull)/.test(c), 'Error response from daemon: pull access denied')],
    ['the forwarder', fail(c => c.startsWith('run -d --name qa-fwd-pr'), 'Error response from daemon: port is already allocated')],
    ['joining the networks', fail(c => c.startsWith('network connect'), 'Error response from daemon: network qa-session-pr not found')],
  ]
  for (const [step, answer] of steps) {
    const probe = probeDocker({ os: 'Docker Desktop\n' })
    const s = makeSession({ provisionerOptions: INTERNAL, answer: (args, opts) => answer(args) ?? probe(args, opts) })
    await bootSession(s.deps, 7)
    const calls = argvOf(s.exec)
    const ordinary = calls.lastIndexOf('network create --label qa-conductor-session qa-session-pr')
    assert.ok(ordinary !== -1, `${step}: an ordinary network\n${calls.join('\n')}`)
    assert.deepEqual(calls.slice(ordinary - 3, ordinary), ['rm -f -v qa-fwd-pr', 'network rm qa-session-pr', 'network rm qa-session-pr-edge'], `${step}: undone first`)
    assert.ok(ordinary < calls.findIndex(c => c.startsWith('run -d --name qa-pg-pr')), step)
    const app = runs(s.exec).find(c => valueOf(c.args, '--name') === 'qa-app-pr').args
    assert.equal(valueOf(app, '-p'), '127.0.0.1:3112:3000', step)
    assert.equal(envOf(s.fsx.files.get(`${WORK}/.env.qa-pr`).text).HTTPS_PROXY, undefined, step)
    const out = await s.provisioner.isolation({ canary: CANARY })
    assert.equal(out.internal, undefined, step)
    assert.equal(out.verdict, 'reachable', step)
    assert.match(out.reasons[0], /^Docker Desktop forwards/, step)
    assert.match(out.reasons.at(-1), /^the PR pane's internal network couldn't be set up \(Error response from daemon: .+\), so it runs on an ordinary network$/, step)
    // and the probe went without the proxy's part
    assert.equal(probeArgs(probeRun(s.exec)).filter(a => a === '--').length, 2, step)
  }
})

// A network of that name left over: reused only when it is internal.
test('an internal network left over is reused only when it is internal', async () => {
  for (const [internal, up] of [['true\n', true], ['false\n', false]]) {
    const s = makeSession({
      provisionerOptions: INTERNAL,
      answer: args => {
        const c = args.join(' ')
        if (c.startsWith('network create') && c.includes('--internal')) return Object.assign(new Error('docker network: Command failed'), { stderr: 'Error response from daemon: network with name qa-session-pr already exists\n' })
        if (c === 'network inspect --format {{.Name}} qa-session-pr') return 'qa-session-pr\n'
        if (c === 'network inspect --format {{.Internal}} qa-session-pr') return internal
        return null
      },
    })
    await bootSession(s.deps, 7)
    const app = runs(s.exec).find(c => valueOf(c.args, '--name') === 'qa-app-pr').args
    assert.equal(app.includes('-p'), !up, internal)
    assert.equal(argvOf(s.exec).includes('network connect --alias qa-egress qa-session-pr qa-fwd-pr'), up, internal)
  }
})

test('a boot aborted while the internal topology is set up stops there, and makes no ordinary network after it', async () => {
  const ac = new AbortController()
  const s = makeSession({ provisionerOptions: INTERNAL, answer: args => { if (args[0] === 'run' && args.includes('qa-fwd-pr')) ac.abort(); return null } })
  await assert.rejects(s.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: ['app'], signal: ac.signal }), err => err.name === 'AbortError')
  const calls = argvOf(s.exec)
  assert.equal(calls.at(-1).startsWith('run -d --name qa-fwd-pr'), true, calls.join('\n'))
  assert.equal(calls.some(c => c === 'network create --label qa-conductor-session qa-session-pr'), false)
})

test('with internal, teardown and sweep remove the forwarder and the edge network too', async () => {
  const s = makeSession({ provisionerOptions: INTERNAL })
  await bootSession(s.deps, 7)
  const before = docker(s.exec).length
  await s.provisioner.teardown({ paneRef: { role: 'pr' } })
  assert.deepEqual(argvOf(s.exec).slice(before), [
    'rm -f -v qa-app-pr qa-migrate-pr qa-probe-pr qa-fwd-pr qa-pg-pr',
    'network rm qa-session-pr',
    'network rm qa-session-pr-edge',
  ])
  const swept = recordingExec()
  await createDockerProvisioner({ docker: makeDocker(swept), fsx: recordingFs(), workDir: WORK, ...INTERNAL }).sweep()
  assert.deepEqual(argvOf(swept), [
    'ps -aq --filter label=qa-conductor-session',
    'network rm qa-session-base',
    'network rm qa-session-pr',
    'network rm qa-session-pr-edge',
    'network ls --filter label=qa-conductor-session --format {{.Name}}',
  ])
  // a failure removing the edge network fails the teardown, after every step
  const stuck = makeSession({ provisionerOptions: INTERNAL, answer: args => (args.join(' ') === 'network rm qa-session-pr-edge' ? Object.assign(new Error('docker network: Command failed'), { stderr: 'Error response from daemon: error while removing network: network qa-session-pr-edge has active endpoints\n' }) : null) })
  await assert.rejects(stuck.provisioner.teardown({ paneRef: { role: 'pr' } }), /docker network/)
  assert.ok(stuck.fsx.removed.includes(`${WORK}/.env.qa-pr`))
})

// With the topology up, the verdict is the probe's: the runtime's own
// reasons, Docker Desktop's forwarding and Podman's networks, are what the
// internal network is for, and the probe checks them. It also asks the
// forwarder's proxy for every address it tries directly.
test('with internal up, the probe also tries every address through the forwarder\'s proxy, and the verdict is the probe\'s, marked internal', async () => {
  const s = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ base: '172.19.0.2 fd00:19::2 \n', pr: '172.20.0.3 fd00:20::3 \n', probe: 'self 172.20.0.3:5432\nself fd00:20::3:5432\nrefused 172.19.0.2:5432\nprobe done\n' }) })
  await s.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
  const out = await s.provisioner.isolation({ canary: CANARY })
  assert.deepEqual(out, { verdict: 'isolated', reasons: [], internal: true })
  const args = probeArgs(probeRun(s.exec))
  const parts = args.join('\u0000').split('\u0000--\u0000').map(part => part.split('\u0000'))
  assert.equal(parts.length, 4)
  const [proxy, ...vias] = parts[3]
  assert.equal(proxy, 'qa-egress:3128')
  for (const via of ['host.docker.internal:3100', '192.168.65.254:3100', '172.20.0.1:3100', '172.19.0.2:5432', '[fd00:19::2]:5432']) assert.ok(vias.includes(via), via)
  assert.equal(vias.length, parts[0].length - 3 + 2, 'every host at the harness port, and every base database address')

  const verdict = async (opts, probe) => {
    const t = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ ...opts, probe }) })
    await t.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
    return t.provisioner.isolation({ canary: CANARY })
  }
  const clean = 'self 172.20.0.3:5432\nrefused host.docker.internal:3100\nprobe done\n'
  // Docker Desktop and Podman: the probe decides
  assert.deepEqual(await verdict({ os: 'Docker Desktop\n' }, clean), { verdict: 'isolated', reasons: [], internal: true })
  assert.deepEqual(await verdict({ version: 'Client: Podman Engine\nServer: Podman Engine\n' }, clean), { verdict: 'isolated', reasons: [], internal: true })
  // a CONNECT the proxy let through is a hit
  assert.deepEqual(await verdict({}, 'self 172.20.0.3:5432\nproxied 172.19.0.2:5432\nprobe done\n'), {
    verdict: 'reachable', reasons: ['the PR pane got through the forwarder\'s proxy to 172.19.0.2:5432'], internal: true,
  })
  // no answer from the proxy at all: its misses prove nothing
  assert.deepEqual(await verdict({}, 'self 172.20.0.3:5432\nprobe done\n'), {
    verdict: 'unknown', reasons: ['the probe got no answer from the forwarder\'s proxy at qa-egress:3128, so it can\'t say what the proxy lets through'], internal: true,
  })
  // a direct hit still counts
  assert.equal((await verdict({}, 'listener host.docker.internal\nself 172.20.0.3:5432\nrefused 172.19.0.2:5432\nprobe done\n')).verdict, 'reachable')
})

// The script's proxy part, run with bash against a loopback stand-in for the
// forwarder: it lets one target through and refuses the rest.
test('the probe script asks the proxy for each address, and says which it let through and which it refused', async () => {
  const net = await import('node:net')
  const { execFile } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const s = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ probe: 'self 172.20.0.3:5432\nrefused x\nprobe done\n' }) })
  await s.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
  await s.provisioner.isolation({ canary: CANARY })
  const script = valueOf(probeRun(s.exec).args, '-c')
  const asked = []
  const proxy = net.createServer(socket => {
    let buf = ''
    socket.on('data', chunk => {
      buf += chunk
      if (!buf.includes('\r\n\r\n')) return
      const target = buf.split(' ')[1]
      asked.push(target)
      // a tunnel stays open; a refusal closes
      if (target === 'through.example:443') socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      else socket.end('HTTP/1.1 403 Forbidden\r\nX-QA-Egress: refused\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    })
    socket.on('error', () => {})
  })
  const open = net.createServer(socket => socket.end())
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
  const [proxyPort, openPort] = [await listen(proxy), await listen(open)]
  const shim = mkdtempSync(join(tmpdir(), 'qa-probe-'))
  writeFileSync(join(shim, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n')
  chmodSync(join(shim, 'timeout'), 0o755)
  const runScript = proxyAt => new Promise((resolve, reject) => {
    execFile('bash', ['-c', script, 'probe', '1', CANARY.path, CANARY.expect, '--', '--', `127.0.0.1:${openPort}`, '--', proxyAt, 'through.example:443', '10.0.0.5:3100', '[fd00::1]:5432'], {
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}` }, timeout: 20_000,
    }, (err, stdout) => (err ? reject(err) : resolve(stdout.split('\n').filter(Boolean))))
  })
  try {
    const lines = await runScript(`127.0.0.1:${proxyPort}`)
    assert.equal(lines.at(-1), 'probe done')
    assert.deepEqual(lines.sort(), ['probe done', 'proxied through.example:443', 'refused 10.0.0.5:3100', 'refused [fd00::1]:5432', `self 127.0.0.1:${openPort}`])
    assert.deepEqual(asked.sort(), ['10.0.0.5:3100', '[fd00::1]:5432', 'through.example:443'])
    // no proxy there: no line for it at all
    const gone = net.createServer()
    const gonePort = await listen(gone)
    await new Promise(resolve => gone.close(resolve))
    assert.deepEqual((await runScript(`127.0.0.1:${gonePort}`)).sort(), ['probe done', `self 127.0.0.1:${openPort}`])
  } finally {
    proxy.close()
    open.close()
    rmSync(shim, { recursive: true, force: true })
  }
})
