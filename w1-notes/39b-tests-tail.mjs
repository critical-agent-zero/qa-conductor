
// The same, made certain: the client stops reading, the forwarder's socket to
// it has bytes queued past a full kernel buffer, and only then does the
// listed host close. Every queued byte must still arrive.
// open(t) → { client (paused, past any head; `pre` bytes of data already
// read), serverSide() (the forwarder's socket to the client), peer (the
// listed host's or the app's side, writable) }
async function tailAtClose(open) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const { client, serverSide, peer, pre = 0 } = await open()
  let received = pre
  let sent = 0
  const send = n => { peer.write(Buffer.alloc(n, 0x62)); sent += n }
  // fill the kernel's buffers until the forwarder has to queue
  for (let i = 0; serverSide().writableLength === 0; i++) {
    if (i > 2_000) throw new Error('the kernel buffers never filled')
    send(64 * 1024)
    await sleep(5)
  }
  // read until nothing is queued anywhere on the way
  for (let stable = 0; stable < 3;) {
    for (let chunk; (chunk = client.read()) !== null;) received += chunk.length
    await sleep(15)
    stable = serverSide().writableLength === 0 && peer.writableLength === 0 && client.readableLength === 0 ? stable + 1 : 0
  }
  // then a little at a time, until a few bytes are queued (fewer than the
  // high-water mark, so nothing holds the end back)
  for (let i = 0; serverSide().writableLength === 0; i++) {
    if (i > 2_000) throw new Error('nothing queued')
    send(2 * 1024)
    await sleep(15)
  }
  assert.ok(serverSide().writableLength < 16 * 1024, String(serverSide().writableLength))
  peer.end()
  await sleep(150) // the forwarder sees the end, and the close
  await new Promise((resolve, reject) => {
    client.on('data', chunk => { received += chunk.length })
    client.on('end', resolve)
    client.on('error', reject)
    client.resume()
  }).catch(() => {})
  return { sent, received }
}

test('when the listed host closes with bytes still queued for a client that isn\'t reading, every byte still arrives: tunnel and forward', { timeout: 30_000 }, async (t) => {
  // the tunnel
  let peerOf = null
  const peerServer = net.createServer({ allowHalfOpen: true }, socket => { socket.on('error', () => {}); peerOf = socket })
  const peerPort = await listening(peerServer)
  t.after(() => peerServer.close())
  const w = await world(t, { allow: ['api.example.com'], connect: () => net.connect({ port: peerPort, host: '127.0.0.1' }) })
  let tunnelSide = null
  w.fwd.servers[1].prependListener('connect', (req, socket) => { tunnelSide = socket })
  const tunnel = await tailAtClose(async () => {
    const client = net.connect(w.proxyPort, '127.0.0.1', () => client.write('CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\n\r\n'))
    client.on('error', () => {})
    let head = Buffer.alloc(0)
    await new Promise(resolve => {
      const onData = chunk => {
        head = Buffer.concat([head, chunk])
        if (!head.includes('\r\n\r\n')) return
        client.off('data', onData)
        client.pause()
        resolve()
      }
      client.on('data', onData)
    })
    while (peerOf === null) await new Promise(resolve => setTimeout(resolve, 5))
    return { client, serverSide: () => tunnelSide, peer: peerOf, pre: head.length - head.indexOf('\r\n\r\n') - 4 }
  })
  assert.equal(tunnel.received, tunnel.sent, `tunnel: ${tunnel.sent - tunnel.received} bytes lost`)

  // the forward, its client half-closed
  let appOf = null
  const app = net.createServer({ allowHalfOpen: true }, socket => { socket.on('error', () => {}); appOf = socket })
  const appPort = await listening(app)
  t.after(() => app.close())
  const fwd = await createForwarder({ host: '127.0.0.1', forward: { listen: await free(), to: `127.0.0.1:${appPort}` } })
  t.after(() => fwd.close())
  let forwardSide = null
  fwd.servers[0].prependListener('connection', socket => { forwardSide = socket })
  const forward = await tailAtClose(async () => {
    const client = net.connect({ port: fwd.servers[0].address().port, host: '127.0.0.1', allowHalfOpen: true }, () => client.end('GET / HTTP/1.0\r\n\r\n'))
    client.on('error', () => {})
    client.pause()
    while (appOf === null) await new Promise(resolve => setTimeout(resolve, 5))
    return { client, serverSide: () => forwardSide, peer: appOf }
  })
  assert.equal(forward.received, forward.sent, `forward: ${forward.sent - forward.received} bytes lost`)
})
