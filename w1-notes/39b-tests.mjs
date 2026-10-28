
// --- Round 2 of #39's review -----------------------------------------------------------

const MiB4 = 4 * 1024 * 1024
// A server that sends `bytes` to each connection, then closes it.
async function sender(t, bytes) {
  const payload = Buffer.alloc(bytes, 0x61)
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    socket.on('error', () => {})
    socket.end(payload)
  })
  const port = await listening(server)
  t.after(() => { server.close() })
  return { port }
}
// Reads a socket to its end, pausing first; resolves to the bytes read, past
// `skip` bytes of header.
function readAll(socket, { pauseMs = 500, skipHeader = false } = {}) {
  return new Promise((resolve, reject) => {
    let total = 0
    let header = skipHeader ? '' : null
    socket.pause()
    setTimeout(() => socket.resume(), pauseMs)
    socket.on('data', chunk => {
      if (header !== null) {
        header += chunk.toString('latin1')
        const end = header.indexOf('\r\n\r\n')
        if (end === -1) return
        total += Buffer.byteLength(header.slice(end + 4), 'latin1')
        header = null
        return
      }
      total += chunk.length
    })
    socket.on('end', () => resolve(total))
    socket.on('error', reject)
  })
}

// The review's medium: the upstream's close destroyed the client socket,
// dropping what was still queued for a slow reader, which then saw a clean
// end with the tail missing.
test('a slow reader gets every byte an upstream sends before it closes, through a tunnel and through the half-closed forward', { timeout: 30_000 }, async (t) => {
  const upstream = await sender(t, MiB4)
  // the tunnel
  const w = await world(t, { allow: ['api.example.com'], connect: () => net.connect({ port: upstream.port, host: '127.0.0.1' }) })
  for (let i = 0; i < 3; i++) {
    const socket = net.connect(w.proxyPort, '127.0.0.1', () => socket.write('CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\n\r\n'))
    assert.equal(await readAll(socket, { skipHeader: true }), MiB4, `tunnel run ${i}`)
  }
  // the inbound forward, its client half-closed as soon as it sent
  const fwd = await createForwarder({ host: '127.0.0.1', forward: { listen: await free(), to: `127.0.0.1:${upstream.port}` } })
  t.after(() => fwd.close())
  const port = fwd.servers[0].address().port
  for (let i = 0; i < 3; i++) {
    const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true }, () => socket.end('GET / HTTP/1.0\r\n\r\n'))
    assert.equal(await readAll(socket), MiB4, `forward run ${i}`)
  }
})

// The review's second medium: the URL parse turned malformed entries into
// other hosts. Anything the parse would do more than normalise is refused,
// for entries and CONNECT targets alike.
test('an entry or a CONNECT target with userinfo, a path, a query, a fragment, a backslash or whitespace is refused, never rewritten', async () => {
  for (const entry of [
    'api.example.com@evil.org', '*.example.com@evil.org', '93.184.216.34@evil.org', 'evil.org\\@api.example.com', 'a.example.com@b.evil.org:8443',
    'user@example.com', 'user@', 'github.com/myorg', 'registry.npmjs.org/@myscope', 'example.com/', 'api.example.com#prod', 'api.example.com?x=1', '#', '?',
    '93.184.216.0/24', '8.8.8.8/32', 'api.example.com\t', '\tapi.example.com', 'api .example.com', 'api.example.com\\x',
  ]) {
    assert.throws(() => parseAllowlist([entry]), /must be a host name|bad port/, JSON.stringify(entry))
  }
  const rules = parseAllowlist(['api.example.com', 'evil.org'])
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }]
  for (const host of ['user@api.example.com', 'api.example.com@evil.org', 'evil.org\\@api.example.com', 'api.example.com/x', 'api.example.com#x', 'api.example.com?x']) {
    assert.deepEqual(await checkTarget(rules, host, 443, lookup), { refused: 'not a host name' }, host)
  }
})

// Abandoned requests: a PR that goes away during the lookup, or before any
// answer, takes nothing with it to the listed host.
test('a request the PR abandons, during the lookup or before an answer, leaves no connection to the listed host', BOUNDED, async (t) => {
  const holder = net.createServer(socket => { socket.on('error', () => {}) }) // accepts, never answers
  const holderPort = await listening(holder)
  t.after(() => holder.close())
  const held = () => new Promise(resolve => holder.getConnections((_, n) => resolve(n)))
  const slowLookup = async () => { await new Promise(resolve => setTimeout(resolve, 150)); return [{ address: '93.184.216.34', family: 4 }] }
  const w = await world(t, { allow: ['api.example.com'], lookup: slowLookup, connect: () => net.connect({ port: holderPort, host: '127.0.0.1' }) })
  // CONNECT: the PR resets while the name is looked up
  for (let i = 0; i < 5; i++) {
    const socket = net.connect(w.proxyPort, '127.0.0.1', () => {
      socket.write('CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\n\r\n')
      setTimeout(() => socket.resetAndDestroy(), 30)
    })
    socket.on('error', () => {})
    await once(socket, 'close')
  }
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.deepEqual([w.connects.length, await held()], [0, 0], 'never dialled')
  // plain HTTP: the PR goes away before the host answers
  for (let i = 0; i < 5; i++) {
    const req = http.request({ host: '127.0.0.1', port: w.proxyPort, path: 'http://api.example.com/x' })
    req.on('error', () => {})
    req.end()
    await new Promise(resolve => setTimeout(resolve, 250)) // past the lookup: dialled, waiting
    req.destroy()
  }
  await waitUntil(async () => (await held()) === 0)
})

// Paths round 2's tests left out.
test('CONNECT: a connect that never completes is a 502 failed; a PR reset after the 200 ends the upstream', BOUNDED, async (t) => {
  const echo = net.createServer(socket => { socket.on('error', () => {}); socket.pipe(socket) })
  const echoPort = await listening(echo)
  t.after(() => echo.close())
  const w = await world(t, {
    allow: ['api.example.com', 'stuck.example.com'],
    lookup: async host => [{ address: host === 'stuck.example.com' ? '93.184.216.35' : '93.184.216.34', family: 4 }],
    timeouts: { connectMs: 150 },
    connect: (port, address) => {
      if (address !== '93.184.216.35') return net.connect({ port: echoPort, host: '127.0.0.1' })
      const stuck = new net.Socket()
      stuck.connecting = true
      return stuck
    },
  })
  const stuck = await connectVia(w.proxyPort, 'stuck.example.com:443')
  assert.equal(stuck.status, 502)
  assert.match(stuck.head, /X-QA-Egress: failed/)
  stuck.socket.destroy()
  const ok = await connectVia(w.proxyPort, 'api.example.com:443')
  assert.equal(ok.status, 200)
  await waitUntil(async () => (await new Promise(resolve => echo.getConnections((_, n) => resolve(n)))) === 1)
  ok.socket.resetAndDestroy()
  await waitUntil(async () => (await new Promise(resolve => echo.getConnections((_, n) => resolve(n)))) === 0)
})

test('a forwarder whose proxy port is taken rejects, and frees the forward port it had listened on', BOUNDED, async () => {
  const busy = net.createServer()
  const busyPort = await listening(busy)
  const forwardPort = await free()
  try {
    await assert.rejects(createForwarder({ host: '127.0.0.1', forward: { listen: forwardPort, to: '127.0.0.1:1' }, proxy: { listen: busyPort, allow: [] } }), /EADDRINUSE/)
    const again = net.createServer()
    await new Promise((resolve, reject) => { again.once('error', reject); again.listen(forwardPort, '127.0.0.1', resolve) })
    again.close()
  } finally { busy.close() }
})
