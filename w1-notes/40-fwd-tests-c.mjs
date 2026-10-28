
// The other way: a PR uploading to a slow host is waiting on the host's
// backpressure, not idle, so its side of the tunnel isn't cut either. The
// host reads slowly for a second, then all it can: the upload is far more
// than the kernel's buffers hold, so the forwarder is still handing bytes
// over when the host speeds up. (Bytes already in those buffers move where
// no timer sees them: a host that reads them slower than one idle period
// can still be cut.)
test('a PR uploading to a slow but steady host isn\'t cut by the idle timer: every byte arrives', { timeout: 30_000 }, async (t) => {
  const BIG = 16 * 1024 * 1024
  let received
  const got = new Promise(resolve => { received = resolve })
  const host = net.createServer({ allowHalfOpen: true }, socket => {
    socket.on('error', () => {})
    // one chunk every 100 ms for a second, then all it can
    const start = Date.now()
    let total = 0
    socket.on('data', chunk => {
      total += chunk.length
      if (total >= BIG) return received(total)
      if (Date.now() - start > 1000) return
      socket.pause()
      setTimeout(() => socket.resume(), 100)
    })
    socket.on('close', () => received(total))
  })
  const hostPort = await listening(host)
  t.after(() => host.close())
  const w = await world(t, { allow: ['api.example.com'], timeouts: { idleMs: 300 }, connect: () => net.connect({ port: hostPort, host: '127.0.0.1' }) })
  const ok = await connectVia(w.proxyPort, 'api.example.com:443')
  assert.equal(ok.status, 200)
  ok.socket.on('error', () => {})
  ok.socket.on('data', () => {})
  ok.socket.write(Buffer.alloc(BIG, 0x75))
  assert.equal(await got, BIG)
  ok.socket.destroy()
})
