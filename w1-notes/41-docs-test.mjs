
// The README's sandbox-exec profile, run as written, on a Mac: each port it
// names is refused over IPv4, IPv6 and localhost, another port isn't, and a
// parameter left out keeps the profile from loading. Elsewhere it is skipped.
const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
test('the README\'s sandbox-exec profile shuts the ports it names and no other, and won\'t load with a parameter missing', { skip: process.platform !== 'darwin' || !existsSync(SANDBOX_EXEC), timeout: 30_000 }, async (t) => {
  const net = await import('node:net')
  const { execFile } = await import('node:child_process')
  const lines = section('#### A `sandbox-exec` profile for the process Provisioner (macOS)')
  const open = lines.indexOf('```scheme')
  assert.ok(open >= 0, 'the section has a scheme block')
  const profile = lines.slice(open + 1, lines.indexOf('```', open + 1)).join('\n')
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-sbx-'))
  const file = path.join(dir, 'pr-pane.sb')
  writeFileSync(file, profile)
  const { rmSync } = await import('node:fs')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const listen = host => new Promise(resolve => {
    const server = net.createServer(socket => { socket.on('error', () => {}); socket.end('hi') })
    server.listen(0, host, () => resolve(server))
  })
  const names = ['HARNESS', 'BASE_PROXY', 'PR_PROXY', 'BASE_APP', 'BASE_DB']
  const servers = {}
  for (const name of names) servers[name] = await listen('127.0.0.1')
  const v6 = await listen('::1')
  const other = await listen('127.0.0.1')
  t.after(() => { for (const server of [...Object.values(servers), v6, other]) server.close() })
  const port = server => server.address().port
  // BASE_DB names the IPv6 listener's port, so localhost and ::1 are tried too
  const params = { ...Object.fromEntries(names.map(name => [name, String(port(servers[name]))])), BASE_DB: String(port(v6)) }
  const tries = [
    ...['HARNESS', 'BASE_PROXY', 'PR_PROXY', 'BASE_APP'].map(name => [name, '127.0.0.1', port(servers[name])]),
    ['BASE_DB over ::1', '::1', port(v6)],
    ['BASE_DB over localhost', 'localhost', port(v6)],
    ['another port', '127.0.0.1', port(other)],
  ]
  const client = `
    const net = require('net')
    const tries = JSON.parse(process.argv[1])
    const out = {}
    let left = tries.length
    const done = () => { if (--left === 0) console.log(JSON.stringify(out)) }
    for (const [name, host, port] of tries) {
      const socket = net.connect({ host, port }, () => { out[name] = 'connected'; socket.destroy(); done() })
      socket.on('error', err => { out[name] = err.code; done() })
    }`
  const run = args => new Promise(resolve => execFile(SANDBOX_EXEC, args, { timeout: 15_000 }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr })))
  const flags = Object.entries(params).flatMap(([name, value]) => ['-D', `${name}=${value}`])
  const got = await run([...flags, '-f', file, process.execPath, '-e', client, JSON.stringify(tries)])
  assert.equal(got.code, 0, got.stderr)
  assert.deepEqual(JSON.parse(got.stdout), {
    HARNESS: 'EPERM', BASE_PROXY: 'EPERM', PR_PROXY: 'EPERM', BASE_APP: 'EPERM',
    'BASE_DB over ::1': 'EPERM', 'BASE_DB over localhost': 'EPERM',
    'another port': 'connected',
  })
  // a parameter left out: the profile doesn't load, and nothing runs
  const missing = await run([...flags.slice(0, -2), '-f', file, '/usr/bin/true'])
  assert.equal(missing.code, 65, missing.stderr)
  assert.match(missing.stderr, /string-append/)
})
