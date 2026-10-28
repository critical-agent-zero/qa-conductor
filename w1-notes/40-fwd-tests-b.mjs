
// A plain-HTTP answer cut partway through: a client whose answer is
// close-delimited (HTTP/1.0, so no chunks) would read a clean end as the
// whole answer, so it gets a reset.
test('a plain-HTTP answer cut partway reaches an HTTP/1.0 client as ECONNRESET, never a clean end', BOUNDED, async (t) => {
  const w = await world(t, {
    allow: ['api.example.com'],
    app: (req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.write('x'.repeat(1000)); setTimeout(() => res.socket.destroy(), 50) },
  })
  const client = net.connect(w.proxyPort, '127.0.0.1', () => client.write('GET http://api.example.com/cut HTTP/1.0\r\nHost: api.example.com\r\n\r\n'))
  let got = ''
  const outcome = await new Promise(resolve => {
    client.on('data', chunk => { got += chunk })
    client.on('error', err => resolve(err.code))
    client.on('end', () => resolve('a clean end'))
  })
  assert.doesNotMatch(got, /transfer-encoding|content-length/i, 'close-delimited')
  assert.equal(outcome, 'ECONNRESET')
})

// The other way: a PR that resets its side of a tunnel reaches the host as a
// reset too, never as a clean end of what it sent.
test('a PR that resets mid-tunnel reaches the host as ECONNRESET, never a clean end', BOUNDED, async (t) => {
  let settle
  const outcome = new Promise(resolve => { settle = resolve })
  const host = net.createServer(socket => {
    socket.on('data', () => {})
    socket.on('error', err => settle(err.code))
    socket.on('end', () => settle('a clean end'))
  })
  const hostPort = await listening(host)
  t.after(() => host.close())
  const w = await world(t, { allow: ['api.example.com'], connect: () => net.connect({ port: hostPort, host: '127.0.0.1' }) })
  const ok = await connectVia(w.proxyPort, 'api.example.com:443')
  assert.equal(ok.status, 200)
  ok.socket.write('partway')
  await new Promise(resolve => setTimeout(resolve, 50))
  ok.socket.resetAndDestroy()
  assert.equal(await outcome, 'ECONNRESET')
})
