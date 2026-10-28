
// An idle cut resets the host's side too, not only the PR's.
test('a tunnel cut for idleness reaches the host as ECONNRESET too', BOUNDED, async (t) => {
  let settle
  const outcome = new Promise(resolve => { settle = resolve })
  const host = net.createServer(socket => {
    socket.on('data', () => {})
    socket.on('error', err => settle(err.code))
    socket.on('end', () => settle('a clean end'))
  })
  const hostPort = await listening(host)
  t.after(() => host.close())
  const w = await world(t, { allow: ['api.example.com'], timeouts: { idleMs: 100 }, connect: () => net.connect({ port: hostPort, host: '127.0.0.1' }) })
  const ok = await connectVia(w.proxyPort, 'api.example.com:443')
  assert.equal(ok.status, 200)
  ok.socket.on('error', () => {})
  assert.equal(await outcome, 'ECONNRESET')
})
