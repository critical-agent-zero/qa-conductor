
// --- Carried from #39's round 3 ----------------------------------------------------------

// Reads a socket slowly: a chunk, then `gapMs` paused; resolves to the bytes
// read past any head, at its end.
function readSlowly(socket, { gapMs = 100, skipHeader = false } = {}) {
  return new Promise((resolve, reject) => {
    let total = 0
    let header = skipHeader ? '' : null
    socket.on('data', chunk => {
      if (header !== null) {
        header += chunk.toString('latin1')
        const end = header.indexOf('\r\n\r\n')
        if (end !== -1) { total += Buffer.byteLength(header.slice(end + 4), 'latin1'); header = null }
      } else total += chunk.length
      socket.pause()
      setTimeout(() => socket.resume(), gapMs)
    })
    socket.on('end', () => resolve(total))
    socket.on('error', reject)
  })
}

// Backpressure from a slow reader is no idleness: a tunnel that keeps
// moving, however slowly, isn't cut by the idle timer.
test('a slow but steady reader isn\'t cut by the idle timer: a tunnel and a plain-HTTP answer deliver every byte', { timeout: 30_000 }, async (t) => {
  const MiB2 = 2 * 1024 * 1024
  const upstream = await sender(t, MiB2)
  const w = await world(t, {
    allow: ['api.example.com'],
    timeouts: { idleMs: 300 },
    connect: (port, address, { appPort }) => net.connect({ port: port === 80 ? appPort : upstream.port, host: '127.0.0.1' }),
    app: (req, res) => { res.writeHead(200, { 'content-length': String(MiB2) }); res.end(Buffer.alloc(MiB2, 0x63)) },
  })
  const socket = net.connect(w.proxyPort, '127.0.0.1', () => socket.write('CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\n\r\n'))
  assert.equal(await readSlowly(socket, { skipHeader: true }), MiB2, 'the tunnel')
  const plain = net.connect(w.proxyPort, '127.0.0.1', () => plain.write('GET http://api.example.com/big HTTP/1.1\r\nHost: api.example.com\r\nConnection: close\r\n\r\n'))
  assert.equal(await readSlowly(plain, { skipHeader: true }), MiB2, 'the plain-HTTP answer')
})

// A reset on one side reaches the other as a reset, never a clean end: a
// close-delimited stream would read as complete.
test('a host or an app that resets mid-stream gives the PR ECONNRESET, through a tunnel and through the forward', BOUNDED, async (t) => {
  const resetter = net.createServer(socket => {
    socket.on('error', () => {})
    socket.write(Buffer.alloc(64 * 1024, 0x64), () => setTimeout(() => socket.resetAndDestroy(), 50))
  })
  const resetterPort = await listening(resetter)
  t.after(() => resetter.close())
  const errorOf = socket => new Promise(resolve => {
    socket.on('data', () => {})
    socket.on('error', err => resolve(err.code))
    socket.on('end', () => resolve('a clean end'))
  })
  const w = await world(t, { allow: ['api.example.com'], connect: () => net.connect({ port: resetterPort, host: '127.0.0.1' }) })
  const tunnel = net.connect(w.proxyPort, '127.0.0.1', () => tunnel.write('CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\n\r\n'))
  assert.equal(await errorOf(tunnel), 'ECONNRESET')
  const fwd = await createForwarder({ host: '127.0.0.1', forward: { listen: await free(), to: `127.0.0.1:${resetterPort}` } })
  t.after(() => fwd.close())
  const client = net.connect(fwd.servers[0].address().port, '127.0.0.1')
  assert.equal(await errorOf(client), 'ECONNRESET')
})

// A host that closes cleanly ends the PR's side too, even a PR that keeps its
// own side open: the forwarder holds nothing for it.
test('a host or an app that closes cleanly ends the forwarder\'s side, even when the PR keeps its own side open', BOUNDED, async (t) => {
  const upstream = await sender(t, 1024)
  const connections = server => new Promise(resolve => server.getConnections((_, n) => resolve(n)))
  const w = await world(t, { allow: ['api.example.com'], connect: () => net.connect({ port: upstream.port, host: '127.0.0.1' }) })
  const tunnel = net.connect({ port: w.proxyPort, host: '127.0.0.1', allowHalfOpen: true }, () => tunnel.write('CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\n\r\n'))
  tunnel.on('data', () => {})
  await once(tunnel, 'end')
  await waitUntil(async () => (await connections(w.fwd.servers[1])) === 0)
  tunnel.destroy()
  const fwd = await createForwarder({ host: '127.0.0.1', forward: { listen: await free(), to: `127.0.0.1:${upstream.port}` } })
  t.after(() => fwd.close())
  const client = net.connect({ port: fwd.servers[0].address().port, host: '127.0.0.1', allowHalfOpen: true })
  client.on('data', () => {})
  await once(client, 'end')
  await waitUntil(async () => (await connections(fwd.servers[0])) === 0)
  client.destroy()
})

// A PR that leaves partway through a plain-HTTP answer frees the upstream.
test('a PR that leaves partway through a plain-HTTP answer frees its upstream', BOUNDED, async (t) => {
  let appSockets = 0
  const w = await world(t, {
    allow: ['api.example.com'],
    app: (req, res) => { appSockets++; res.writeHead(200, { 'content-length': '100000' }); res.write('x'.repeat(1000)) }, // and never more
  })
  const connections = () => new Promise(resolve => w.fwd.servers[1].getConnections((_, n) => resolve(n)))
  const socket = net.connect(w.proxyPort, '127.0.0.1', () => socket.write('GET http://api.example.com/part HTTP/1.1\r\nHost: api.example.com\r\n\r\n'))
  await once(socket, 'data')
  socket.destroy()
  await waitUntil(async () => (await connections()) === 0)
  // the app's side of it is gone too
  const appConnections = () => new Promise(resolve => w.appServer.getConnections((_, n) => resolve(n)))
  await waitUntil(async () => (await appConnections()) === 0)
  assert.equal(appSockets, 1)
})

test('more entries and targets that must be refused: a bare userinfo, slashes, an escape, a newline, lookalike slashes; and forward.to with whitespace', BOUNDED, async () => {
  for (const entry of ['@evil.org', '/evil.org', '//evil.org', '\\evil.org', 'api.example.com%2e', 'api.exa\nmple.com', 'github.com⁄myorg', 'github.com∕myorg', 'github.com⧵myorg']) {
    assert.throws(() => parseAllowlist([entry]), /must be a host name/, JSON.stringify(entry))
  }
  const rules = parseAllowlist(['api.example.com'])
  assert.deepEqual(await checkTarget(rules, '@api.example.com', 443, async () => [{ address: '93.184.216.34', family: 4 }]), { refused: 'not a host name' })
  for (const to of [' 127.0.0.1:3000', '127.0.0.1:3000 ', '127.0.0.1 :3000']) {
    await assert.rejects(createForwarder({ host: '127.0.0.1', forward: { listen: await free(), to } }), /forward needs listen/, JSON.stringify(to))
  }
})
