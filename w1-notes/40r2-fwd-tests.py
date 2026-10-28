R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:120], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('test/forwarder.test.mjs', [
    # container entry: stdout for every line, a refusal included
    ("""// As the container runs it: the file as given to node -e, its config in
// PANE_FORWARDER. A bad config exits 1, so the Provisioner finds no forwarder.
test('run as the container runs it: ready from its config, and a bad config exits 1', BOUNDED, async () => {
  const source = readFileSync(SOURCE, 'utf8')
  const run = env => spawn(process.execPath, ['--input-type=module', '-e', source], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const app = http.createServer((req, res) => res.end('pr app'))
  const appPort = await listening(app)
  const s = net.createServer()
  const port = await listening(s)
  s.close()
  const child = run({ PANE_FORWARDER: JSON.stringify({ host: '127.0.0.1', forward: { listen: port, to: `127.0.0.1:${appPort}` }, proxy: null }) })
  try {
    let out = ''
    child.stdout.on('data', c => { out += c })
    for (let i = 0; i < 200 && !out.includes('qa-forwarder ready'); i++) await new Promise(r => setTimeout(r, 25))
    assert.match(out, /qa-forwarder ready/)
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'pr app')
  } finally { child.kill(); app.close() }""",
     """// As the container runs it: the file as given to node -e, its config in
// PANE_FORWARDER. A bad config exits 1, so the Provisioner finds no forwarder.
// Every line goes to stdout, a refusal's too: triage's tail (`docker logs`
// through logsTail) reads stdout only.
test('run as the container runs it: ready from its config, its refusals and a bad config\\'s error on stdout, and a bad config exits 1', BOUNDED, async () => {
  const source = readFileSync(SOURCE, 'utf8')
  const run = env => spawn(process.execPath, ['--input-type=module', '-e', source], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const app = http.createServer((req, res) => res.end('pr app'))
  const appPort = await listening(app)
  const [port, proxyPort] = [await free(), await free()]
  const child = run({ PANE_FORWARDER: JSON.stringify({ host: '127.0.0.1', forward: { listen: port, to: `127.0.0.1:${appPort}` }, proxy: { listen: proxyPort, allow: [] } }) })
  try {
    let out = ''
    let err = ''
    child.stdout.on('data', c => { out += c })
    child.stderr.on('data', c => { err += c })
    for (let i = 0; i < 200 && !out.includes('qa-forwarder ready'); i++) await new Promise(r => setTimeout(r, 25))
    assert.match(out, /qa-forwarder ready/)
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'pr app')
    const refused = await connectVia(proxyPort, 'evil.example:443')
    refused.socket.destroy()
    assert.equal(refused.status, 403)
    for (let i = 0; i < 200 && !out.includes('qa-egress refused'); i++) await new Promise(r => setTimeout(r, 25))
    assert.match(out, /^qa-egress refused evil\\.example:443: evil\\.example:443 is not on the allowlist$/m)
    assert.equal(err, '')
  } finally { child.kill(); app.close() }"""),
    ("""    const bad = run(env)
    let err = ''
    bad.stderr.on('data', c => { err += c })
    const code = await exited(bad)
    assert.equal(code, 1, err)
    assert.match(err, re)""", """    const bad = run(env)
    let out = ''
    bad.stdout.on('data', c => { out += c })
    const code = await exited(bad)
    assert.equal(code, 1, out)
    assert.match(out, re)"""),
    # e2e idle: one chunk every 300 ms
    ("""// Backpressure from a slow reader is no idleness: a tunnel that keeps
// moving, however slowly, isn't cut by the idle timer. Its idle period is a
// second: the kernel's buffers can hold a steady reader's bytes out of the
// forwarder's sight for longer than 300 ms. The timer's own rules are
// tested with stand-ins, below.
test('a slow but steady reader isn\\'t cut by the idle timer: a tunnel and a plain-HTTP answer deliver every byte', { timeout: 30_000 }, async (t) => {""",
     """// Backpressure from a slow reader is no idleness: a tunnel that keeps
// moving, however slowly, isn't cut by the idle timer. Its idle period is a
// second: the kernel's buffers can hold a steady reader's bytes out of the
// forwarder's sight for longer than 300 ms. The reader takes a chunk every
// 300 ms, slow enough that a timer which ignores backpressure (as main's
// did) cuts it, or ends it short. The timer's own rules are tested with
// stand-ins, below.
test('a slow but steady reader isn\\'t cut by the idle timer: a tunnel and a plain-HTTP answer deliver every byte', { timeout: 60_000 }, async (t) => {"""),
    ("""  assert.equal(await readSlowly(socket, { skipHeader: true }), MiB2, 'the tunnel')
  const plain = net.connect(w.proxyPort, '127.0.0.1', () => plain.write('GET http://api.example.com/big HTTP/1.1\\r\\nHost: api.example.com\\r\\nConnection: close\\r\\n\\r\\n'))
  assert.equal(await readSlowly(plain, { skipHeader: true }), MiB2, 'the plain-HTTP answer')""",
     """  assert.equal(await readSlowly(socket, { skipHeader: true, gapMs: 300 }), MiB2, 'the tunnel')
  const plain = net.connect(w.proxyPort, '127.0.0.1', () => plain.write('GET http://api.example.com/big HTTP/1.1\\r\\nHost: api.example.com\\r\\nConnection: close\\r\\n\\r\\n'))
  assert.equal(await readSlowly(plain, { skipHeader: true, gapMs: 300 }), MiB2, 'the plain-HTTP answer')"""),
])

s = open(R + 'test/forwarder.test.mjs').read()
s += """
// --- Round 2 of #40's review ---------------------------------------------------------

// The PR's side of a plain-HTTP answer had no timer once the host was done:
// a PR that stopped reading near the end held it for ever, at answer sizes
// where the last of it no longer fits the kernel's buffers (around 850 KB on
// loopback). A sweep of sizes there, every one let go once nothing moves.
test('a plain-HTTP answer the host has finished, to a PR that never reads, is closed once nothing moves: no connection is held', { timeout: 30_000 }, async (t) => {
  const w = await world(t, {
    allow: ['api.example.com'],
    timeouts: { idleMs: 300 },
    app: (req, res) => {
      const size = Number(req.url.split('/').at(-1))
      res.writeHead(200, { 'content-length': String(size) })
      res.end(Buffer.alloc(size, 0x62))
    },
  })
  const sizes = Array.from({ length: 24 }, (_, i) => 800_000 + i * 8_192)
  const clients = await Promise.all(sizes.map(async size => {
    const c = net.connect(w.proxyPort, '127.0.0.1')
    c.on('error', () => {})
    await once(c, 'connect')
    c.pause() // never reads
    c.write(`GET http://api.example.com/${size} HTTP/1.1\\r\\nHost: api.example.com\\r\\nConnection: close\\r\\n\\r\\n`)
    return c
  }))
  t.after(() => { for (const c of clients) c.destroy() })
  const connections = server => new Promise(resolve => server.getConnections((_, n) => resolve(n)))
  // every answer is done on the host's side well before the PR's is let go
  await waitUntil(async () => (await connections(w.appServer)) === 0, 10_000)
  await waitUntil(async () => (await connections(w.fwd.servers[1])) === 0, 10_000)
})

// A host that fails after the headers: a close-delimited answer (HTTP/1.0)
// would read a clean end as complete, so the PR gets a reset. Both ways it
// fails: a reset from the host, and a host that stalls past idleMs.
test('a plain-HTTP host that resets or stalls after the headers gives an HTTP/1.0 client ECONNRESET, never a clean end', BOUNDED, async (t) => {
  const w = await world(t, {
    allow: ['api.example.com'],
    timeouts: { idleMs: 300 },
    app: (req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('x'.repeat(1000))
      if (req.url.endsWith('/reset')) setTimeout(() => res.socket.resetAndDestroy(), 50)
      // else: never another byte
    },
  })
  for (const path of ['reset', 'stall']) {
    const client = net.connect(w.proxyPort, '127.0.0.1', () => client.write(`GET http://api.example.com/${path} HTTP/1.0\\r\\nHost: api.example.com\\r\\n\\r\\n`))
    let got = ''
    const outcome = await new Promise(resolve => {
      client.on('data', chunk => { got += chunk })
      client.on('error', err => resolve(err.code))
      client.on('end', () => resolve('a clean end'))
    })
    assert.match(got, /^HTTP\\/1\\.1 200/, path)
    assert.doesNotMatch(got, /transfer-encoding|content-length/i, `${path}: close-delimited`)
    assert.equal(outcome, 'ECONNRESET', path)
  }
})

// The inbound forward, the other way round from the app's reset: a client
// that resets partway through its request reaches the app as a reset too.
test('a client that resets mid-request through the inbound forward reaches the app as ECONNRESET, never a clean end', BOUNDED, async (t) => {
  let settle
  const outcome = new Promise(resolve => { settle = resolve })
  const app = net.createServer(socket => {
    socket.on('data', () => {})
    socket.on('error', err => settle(err.code))
    socket.on('end', () => settle('a clean end'))
  })
  const appPort = await listening(app)
  t.after(() => app.close())
  const fwd = await createForwarder({ host: '127.0.0.1', forward: { listen: await free(), to: `127.0.0.1:${appPort}` } })
  t.after(() => fwd.close())
  const client = net.connect(fwd.servers[0].address().port, '127.0.0.1')
  client.on('error', () => {})
  await once(client, 'connect')
  client.write('POST /upload HTTP/1.1\\r\\nHost: app\\r\\nContent-Length: 100000\\r\\n\\r\\n')
  client.write('y'.repeat(1000), () => setTimeout(() => client.resetAndDestroy(), 50))
  assert.equal(await outcome, 'ECONNRESET')
})
"""
open(R + 'test/forwarder.test.mjs', 'w').write(s)
print('ok')
