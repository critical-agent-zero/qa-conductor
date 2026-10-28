
// More of the abandoned cases: a plain-HTTP client gone during the lookup
// gets nothing dialled; a PR that resets with bytes still queued for the
// host ends the upstream at once; one that closes while the upstream is
// still connecting ends it once it connects.
test('a PR gone during the lookup, a reset with bytes queued for the host, and a close before the host answered the connect each end the upstream', BOUNDED, async (t) => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  // plain HTTP, gone during a 150 ms lookup
  const slowLookup = async () => { await sleep(150); return [{ address: '93.184.216.34', family: 4 }] }
  const w = await world(t, { allow: ['api.example.com'], lookup: slowLookup })
  for (let i = 0; i < 3; i++) {
    const req = http.request({ host: '127.0.0.1', port: w.proxyPort, path: 'http://api.example.com/x' })
    req.on('error', () => {})
    req.end()
    await sleep(30)
    req.destroy()
  }
  await sleep(300)
  assert.equal(w.connects.length, 0, 'never dialled')

  // CONNECT, reset with bytes queued for a host that isn't reading
  const holder = net.createServer(socket => { socket.on('error', () => {}) }) // never reads
  const holderPort = await listening(holder)
  t.after(() => holder.close())
  let upstreamSocket = null
  const r = await world(t, { allow: ['api.example.com'], connect: () => (upstreamSocket = net.connect({ port: holderPort, host: '127.0.0.1' })) })
  const ok = await connectVia(r.proxyPort, 'api.example.com:443')
  assert.equal(ok.status, 200)
  for (let i = 0; i < 400 && upstreamSocket.writableLength === 0; i++) { ok.socket.write(Buffer.alloc(64 * 1024)); await sleep(2) }
  assert.ok(upstreamSocket.writableLength > 0, 'bytes queued for the host')
  ok.socket.resetAndDestroy()
  await waitUntil(() => upstreamSocket.destroyed, 1_000)

  // CONNECT, closed while the host's connect is still pending
  const echo = net.createServer(socket => { socket.on('error', () => {}); socket.pipe(socket) })
  const echoPort = await listening(echo)
  t.after(() => echo.close())
  const late = await world(t, {
    allow: ['api.example.com'],
    connect: () => {
      const socket = new net.Socket()
      setTimeout(() => socket.connect({ port: echoPort, host: '127.0.0.1' }), 200)
      return socket
    },
  })
  const gone = net.connect(late.proxyPort, '127.0.0.1', () => gone.write('CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\n\r\n'))
  gone.on('error', () => {})
  await sleep(50)
  gone.destroy()
  await sleep(400) // the host's connect has come and gone
  await waitUntil(async () => (await new Promise(resolve => echo.getConnections((_, n) => resolve(n)))) === 0, 1_000)
})
