// The README's sandbox-exec profile, run as written, on a Mac: each port it
// names is refused over IPv4, IPv6 and localhost, another port isn't, and a
// parameter left out keeps the profile from loading. The profile's
// parameters are the ones the README's wiring passes and its check names.
// Elsewhere it is skipped, and so is it where sandbox-exec can't nest (this
// process already runs in a sandbox), unless QA_REQUIRE_SANDBOX=1 asks for
// it, as CI's macos-sandbox job does: then it fails instead.
const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
const REQUIRE_SANDBOX = process.env.QA_REQUIRE_SANDBOX === '1'
const runSandbox = async (args, opts = {}) => {
  const { execFile } = await import('node:child_process')
  return new Promise(resolve => execFile(SANDBOX_EXEC, args, { timeout: 15_000, ...opts }, (err, stdout, stderr) => resolve({ code: typeof err?.code === 'number' ? err.code : err ? -1 : 0, stdout, stderr })))
}
async function whyNoSandbox() {
  if (process.platform !== 'darwin') return 'not macOS'
  if (!existsSync(SANDBOX_EXEC)) return `no ${SANDBOX_EXEC}`
  // sandbox-exec can't nest: under a sandbox already, applying a profile
  // fails with exit 71
  const probe = await runSandbox(['-p', '(version 1)(allow default)', '/usr/bin/true'])
  if (probe.code === 71 && /sandbox_apply: Operation not permitted/.test(probe.stderr)) return 'sandbox-exec can\'t nest, and this process already runs in a sandbox'
  return null
}
const noSandbox = await whyNoSandbox()
test('the README\'s sandbox-exec profile shuts the ports it names, over IPv4, IPv6 and localhost, and no other; a parameter left out keeps it from loading', { skip: !REQUIRE_SANDBOX && noSandbox, timeout: 30_000 }, async (t) => {
  if (noSandbox) assert.fail(`QA_REQUIRE_SANDBOX=1, but ${noSandbox}`)
  const net = await import('node:net')
  const { rmSync } = await import('node:fs')
  const lines = section('#### A `sandbox-exec` profile for the process Provisioner (macOS)')
  const text = lines.join('\n')
  const open = lines.indexOf('```scheme')
  assert.ok(open >= 0, 'the section has a scheme block')
  const profile = lines.slice(open + 1, lines.indexOf('```', open + 1)).join('\n')
  // The profile's parameters, the wiring's and the check's: the same names
  const names = [...profile.matchAll(/\(param "([A-Z_]+)"\)/g)].map(m => m[1])
  assert.deepEqual(names, ['HARNESS', 'BASE_PROXY', 'PR_PROXY', 'BASE_APP', 'BASE_DB'])
  const conductorPorts = Object.keys(JSON.parse(/const conductorPorts = (\{[^}]*\})/.exec(text)[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":')))
  const basePorts = [...text.matchAll(/basePorts\.([A-Z_]+) =/g)].map(m => m[1])
  assert.deepEqual([...conductorPorts, ...basePorts].sort(), [...names].sort(), 'the wiring passes every parameter the profile names')
  const checked = [...text.matchAll(/-D ([A-Z_]+)=/g)].map(m => m[1])
  assert.deepEqual([...new Set(checked)].sort(), [...names].sort(), 'the check names every parameter')

  const dir = mkdtempSync(path.join(tmpdir(), 'qa-sbx-'))
  const file = path.join(dir, 'pr-pane.sb')
  writeFileSync(file, profile)
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // one port on both loopback addresses: IPv4 first, then the same on ::1
  const listen = (host, port) => new Promise((resolve, reject) => {
    const server = net.createServer(socket => { socket.on('error', () => {}); socket.end('hi') })
    server.once('error', reject)
    server.listen(port, host, () => resolve(server))
  })
  const servers = []
  t.after(() => { for (const server of servers) server.close() })
  const both = async () => {
    for (let i = 0; i < 20; i++) {
      const v4 = await listen('127.0.0.1', 0)
      const v6 = await listen('::1', v4.address().port).catch(() => null)
      if (v6) { servers.push(v4, v6); return v4.address().port }
      v4.close()
    }
    throw new Error('no port free on both 127.0.0.1 and ::1')
  }
  const ports = {}
  for (const name of [...names, 'OTHER']) ports[name] = await both()
  const tries = [...names, 'OTHER'].flatMap(name => ['127.0.0.1', '::1', 'localhost'].map(host => [`${name} over ${host}`, host, ports[name]]))
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
  const flags = names.flatMap(name => ['-D', `${name}=${ports[name]}`])
  const got = await runSandbox([...flags, '-f', file, process.execPath, '-e', client, JSON.stringify(tries)])
  assert.equal(got.code, 0, got.stderr)
  assert.deepEqual(JSON.parse(got.stdout), Object.fromEntries(tries.map(([name]) => [name, name.startsWith('OTHER') ? 'connected' : 'EPERM'])))
  // a parameter left out: the profile doesn't load, and nothing runs
  const missing = await runSandbox([...flags.slice(0, -2), '-f', file, '/usr/bin/true'])
  assert.equal(missing.code, 65, missing.stderr)
  assert.match(missing.stderr, /string-append/)
})
