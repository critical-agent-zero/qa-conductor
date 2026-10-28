
// --- #29: the isolation probe ----------------------------------------------------
// Once both panes' databases exist, before anything of the PR's runs, a
// container on the PR pane's network tries to reach this conductor at every
// address a runtime gives the host's loopback (the harness answers a canary
// path with a nonce), and the base pane's database by address.

const CANARY = { port: 3100, path: '/__qa/canary/n0nce', expect: 'qa-canary n0nce' }

// The docker CLI the probe meets; each value may be an Error to fail with.
function probeDocker({ version = 'Server: Docker Engine - Community\n', os = 'Ubuntu 24.04.1 LTS\n', gateway = '172.20.0.1 \n', base = '172.19.0.2 \n', probe = 'probe done\n' } = {}) {
  return args => {
    if (args[0] === 'version') return version
    if (args[0] === 'info') return os
    if (args[0] === 'network' && args[1] === 'inspect') return gateway
    if (args[0] === 'inspect') return base
    if (args[0] === 'run' && args.includes('qa-probe-pr')) return probe
    return null
  }
}

const probeRun = exec => runs(exec).find(c => valueOf(c.args, '--name') === 'qa-probe-pr')
// The probe's own arguments: port, path, expected body, the host addresses,
// `--`, then the addresses it only connects to.
const probeArgs = call => call.args.slice(call.args.indexOf('probe') + 1)

test('the probe runs on the PR network once both databases exist and before any migrate, gone when done, with no ports, mounts or capabilities', async () => {
  const s = makeSession({ answer: probeDocker() })
  const verdicts = []
  s.deps.checkIsolation = async ({ stage, signal }) => {
    if (stage === 'panes') verdicts.push(await s.provisioner.isolation({ signal, canary: CANARY }))
  }
  await bootSession(s.deps, 7)
  assert.deepEqual(verdicts, [{ verdict: 'isolated', reasons: [] }])
  const calls = docker(s.exec).map(c => c.args.join(' '))
  const at = calls.findIndex(c => c.startsWith('run ') && c.includes('--name qa-probe-pr'))
  for (const before of ['network create --label qa-conductor-session qa-session-pr', 'run -d --name qa-pg-base', 'run -d --name qa-pg-pr']) {
    const i = calls.findIndex(c => c.startsWith(before))
    assert.ok(i !== -1 && i < at, `${before} (${i}) before the probe (${at})`)
  }
  const firstMigrate = calls.findIndex(c => c.includes('--name qa-migrate-'))
  assert.ok(firstMigrate > at, `the probe (${at}) before any migrate (${firstMigrate})`)

  const { args } = probeRun(s.exec)
  assert.equal(args[1], '--rm')
  assert.equal(valueOf(args, '--network'), 'qa-session-pr')
  assert.equal(valueOf(args, '--label'), 'qa-conductor-session')
  assert.equal(valueOf(args, '--cap-drop'), 'ALL')
  for (const flag of ['-p', '--publish', '-v', '--volume', '--mount', '--env-file', '-e', '--privileged']) assert.equal(args.includes(flag), false, flag)
  const own = probeArgs(probeRun(s.exec))
  assert.deepEqual(own.slice(0, 3), ['3100', '/__qa/canary/n0nce', 'qa-canary n0nce'])
  const sep = own.indexOf('--')
  const hosts = own.slice(3, sep)
  for (const host of ['host.docker.internal', 'gateway.docker.internal', 'host.containers.internal', '192.168.65.254', '192.168.127.254', '10.0.2.2', '172.20.0.1']) assert.ok(hosts.includes(host), host)
  assert.deepEqual(own.slice(sep + 1), ['172.19.0.2:5432'], 'the base pane\'s database, by address')
})

test('the probe\'s verdict: reachable on any hit, unknown when it can\'t tell, isolated otherwise', async () => {
  const cases = [
    [{}, 'isolated', []],
    [{ probe: 'listener host.docker.internal\nprobe done\n' }, 'reachable', [/^the PR pane reached this conductor at host\.docker\.internal:3100, so it can reach the host's loopback, where the base app is published/]],
    [{ probe: 'open 172.19.0.2:5432\nprobe done\n' }, 'reachable', [/^the PR pane reached the base pane's database at 172\.19\.0\.2:5432/]],
    [{ probe: 'listener 10.0.2.2\nopen 172.19.0.2:5432\nprobe done\n' }, 'reachable', [/10\.0\.2\.2:3100/, /172\.19\.0\.2:5432/]],
    [{ probe: 'listener 10.0.2.2\n' }, 'unknown', [/^the probe didn't finish/]],
    [{ probe: '' }, 'unknown', [/^the probe didn't finish/]],
    [{ probe: new Error('docker run: Command failed: exec: "bash": executable file not found in $PATH') }, 'unknown', [/^the probe couldn't run: .*bash/]],
    [{ os: 'Docker Desktop\n' }, 'reachable', [/^Docker Desktop forwards host\.docker\.internal to the host's loopback/]],
    [{ version: 'Client: Podman Engine\nServer: Podman Engine\n' }, 'reachable', [/^Podman's networks don't keep one pane's containers from the other's/]],
    [{ os: new Error('Cannot connect to the Docker daemon') }, 'unknown', [/^could not tell the container runtime: Cannot connect/]],
    [{ gateway: new Error('No such network') }, 'unknown', [/^could not find the panes' addresses: No such network/]],
    [{ base: '\n' }, 'unknown', [/^could not find the panes' addresses: qa-pg-base has none/]],
  ]
  for (const [docker, verdict, reasons] of cases) {
    const s = makeSession({ answer: probeDocker(docker) })
    const out = await s.provisioner.isolation({ canary: CANARY })
    assert.equal(out.verdict, verdict, JSON.stringify(docker))
    assert.equal(out.reasons.length, reasons.length, `${JSON.stringify(docker)}: ${out.reasons.join(' | ')}`)
    reasons.forEach((re, i) => assert.match(out.reasons[i], re, JSON.stringify(docker)))
  }
})

test('the probe doesn\'t run once the boot is aborted, and a teardown removes one still running', async () => {
  const s = makeSession({ answer: probeDocker() })
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(s.provisioner.isolation({ signal: ac.signal, canary: CANARY }), err => err.name === 'AbortError')
  assert.equal(probeRun(s.exec), undefined)
  await s.provisioner.teardown({ paneRef: { role: 'pr' } })
  assert.deepEqual(docker(s.exec).map(c => c.args.join(' ')).at(-2), 'rm -f -v qa-app-pr qa-migrate-pr qa-probe-pr qa-pg-pr')
})

// The probe's script, run here with bash against loopback listeners: one that
// answers the canary, one that answers something else, a port that's open
// and one that's closed.
test('the probe script reports the listener that answers the canary and the address that accepts a connection, and finishes', async () => {
  const { createServer } = await import('node:http')
  const net = await import('node:net')
  const { execFile } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const s = makeSession({ answer: probeDocker() })
  await s.provisioner.isolation({ canary: CANARY })
  const call = probeRun(s.exec)
  const script = valueOf(call.args, '-c')

  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
  const canary = createServer((req, res) => res.end(req.url === CANARY.path ? `${CANARY.expect}\n` : 'nope'))
  const other = createServer((req, res) => res.end('some other server'))
  const open = net.createServer(socket => socket.end())
  const closed = net.createServer()
  const [canaryPort, otherPort, openPort, closedPort] = [await listen(canary), await listen(other), await listen(open), await listen(closed)]
  await new Promise(resolve => closed.close(resolve)) // nothing listens there now
  // `timeout` comes with the probe image's coreutils; macOS has none
  const shim = mkdtempSync(join(tmpdir(), 'qa-probe-'))
  writeFileSync(join(shim, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n')
  chmodSync(join(shim, 'timeout'), 0o755)
  const runScript = (port, targets) => new Promise((resolve, reject) => {
    execFile('bash', ['-c', script, 'probe', String(port), CANARY.path, CANARY.expect, '127.0.0.1', 'localhost', '--', ...targets], {
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}` }, timeout: 20_000,
    }, (err, stdout) => (err ? reject(err) : resolve(stdout.split('\n').filter(Boolean).sort())))
  })
  try {
    assert.deepEqual(await runScript(canaryPort, [`127.0.0.1:${openPort}`, `127.0.0.1:${closedPort}`]), [
      'listener 127.0.0.1', 'listener localhost', `open 127.0.0.1:${openPort}`, 'probe done',
    ])
    assert.deepEqual(await runScript(otherPort, []), ['probe done'], 'another server on the port is no hit')
    assert.deepEqual(await runScript(closedPort, [`127.0.0.1:${closedPort}`]), ['probe done'])
  } finally {
    for (const server of [canary, other, open]) server.close()
    rmSync(shim, { recursive: true, force: true })
  }
})
