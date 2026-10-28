
// --- The review of #39 ---------------------------------------------------------------

// CGNAT addresses other than the placeholder are built here, so no file
// holds one (test/hygiene.test.mjs).
const cgnat = (b, c, d) => [100, b, c, d].join('.')

const waitUntil = async (check, ms = 3_000) => {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

// A request through the proxy: its status, headers and body, or a rejection
// when the answer is cut.
function viaProxy(proxyPort, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: url, headers }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('error', reject)
      res.on('aborted', () => reject(new Error('aborted')))
      res.on('end', () => (res.complete ? resolve({ status: res.statusCode, headers: res.headers, body }) : reject(new Error('aborted'))))
    })
    req.on('error', reject)
    req.end()
  })
}

// From the review's extra tests: each kills a mutant that would open egress.
test('an exact host is no suffix, every DNS answer is checked, a wildcard keeps its port, and ranges hold at their far edges', async () => {
  const rules = parseAllowlist(['api.example.com', '*.example.net'])
  const lookup = lookupOf({ 'evilapi.example.com': ['1.1.1.1'], 'x.api.example.com': ['1.1.1.1'], 'a.example.net': ['1.1.1.1'], 'first.example.net': ['10.0.0.5', '1.1.1.1'], 'last.example.net': ['1.1.1.1', '10.0.0.5'] })
  for (const [h, p] of [['evilapi.example.com', 443], ['x.api.example.com', 443], ['a.example.net', 22], ['first.example.net', 443], ['last.example.net', 443]]) {
    assert.ok((await checkTarget(rules, h, p, lookup)).refused, `${h}:${p}`)
  }
  assert.throws(() => parseAllowlist(['example.com:65536']), /bad port/)
  for (const ip of [
    cgnat(127, 255, 255), cgnat(100, 100, 100), '0.1.2.3', '0.255.255.255', '192.0.0.170', '192.0.0.255', '192.88.99.1', '192.0.2.255', '198.51.100.7', '203.0.113.7',
    '198.19.255.255', '240.0.0.1', '255.255.255.254',
    '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:1ff:ffff::1', '1::1', '1fff:ffff::1', '4000::1', 'fe80::1', 'febf::1', 'fec0::1', 'fdff::1', '64:ff9b::1.2.3.4', '2002:808:808::1', '100::1',
  ]) {
    assert.notEqual(blockedAddress(ip), null, ip)
  }
  // just outside: public
  for (const ip of ['100.63.255.254', '100.128.0.1', '1.0.0.0', '192.0.1.1', '192.88.98.255', '198.17.255.255', '198.20.0.1', '223.255.255.254', '2001:200::1', '2000::1', '3ffe::1', '2404:6800::1']) {
    assert.equal(blockedAddress(ip), null, ip)
  }
})

// What canonical means: an entry or a target as the URL parser has it, so a
// private address in another form is still refused, and so is a name that
// only this host or its network has.
test('entries and targets are compared as the URL parser has them: hex IPv4, names only this host has, IPv6 in brackets', async () => {
  for (const [bad, re] of [
    [['0x7f.0x0.0x0.0x1'], /127\.0\.0\.1 is loopback, which is always refused/],
    [['0x7f.1'], /127\.0\.0\.1 is loopback/],
    [['foo.localhost'], /foo\.localhost is a name only this host or its network has/],
    [['*.localhost'], /localhost is a name only this host or its network has|must be a host name/],
    [['host.docker.internal'], /host\.docker\.internal is a name only this host or its network has/],
    [['metadata.google.internal'], /is a name only this host or its network has/],
    [['printer.local'], /is a name only this host or its network has/],
    [['2606:4700::1111'], /an IPv6 address goes in brackets/],
    [['2606:4700::1111:443'], /an IPv6 address goes in brackets/],
    [['[fe80::1%eth0]'], /must be a host name/],
  ]) assert.throws(() => parseAllowlist(bad), re, JSON.stringify(bad))
  assert.deepEqual(parseAllowlist(['[2606:4700:0:0:0:0:0:1111]', 'Ünïcode.example']).map(r => r.host), ['2606:4700::1111', new URL('http://Ünïcode.example/').hostname])
  const rules = parseAllowlist(['[2606:4700::1111]:443'])
  assert.deepEqual(await checkTarget(rules, '[2606:4700:0::1111]', 443, async () => []), { address: '2606:4700::1111' })
  assert.deepEqual(await checkTarget(rules, '0x7f.1', 443, async () => []), { refused: '127.0.0.1 is loopback' })
})

// The review's medium: a tunnel the idle timeout ends must end on the PR's
// side too, or each one held a connection open.
test('a CONNECT tunnel that goes idle is closed on both sides, and no connection is left', BOUNDED, async (t) => {
  const w = await world(t, { allow: ['api.example.com'], timeouts: { idleMs: 100 } })
  const proxy = w.fwd.servers[1]
  for (let i = 0; i < 3; i++) {
    const ok = await connectVia(w.proxyPort, 'api.example.com:443')
    assert.equal(ok.status, 200)
    await once(ok.socket, 'close')
  }
  await waitUntil(async () => (await new Promise(resolve => proxy.getConnections((_, n) => resolve(n)))) === 0)
  // and closed from either side: the client's end ends the upstream
  const ok = await connectVia(w.proxyPort, 'api.example.com:443')
  ok.socket.end()
  await waitUntil(async () => (await new Promise(resolve => proxy.getConnections((_, n) => resolve(n)))) === 0)
})

// An upstream's status outside 100–999 crashed the forwarder; now it is a 502.
test('a listed upstream answering with a status outside 100–999 gets a 502, and the forwarder stays up', BOUNDED, async (t) => {
  const bad = net.createServer(socket => socket.once('data', () => socket.end('HTTP/1.1 000 Nope\r\nContent-Length: 0\r\n\r\n')))
  const badPort = await listening(bad)
  t.after(() => bad.close())
  const w = await world(t, { allow: ['api.example.com'], connect: () => net.connect({ port: badPort, host: '127.0.0.1' }) })
  const res = await viaProxy(w.proxyPort, 'http://api.example.com/x')
  assert.deepEqual([res.status, res.headers['x-qa-egress']], [502, 'failed'])
  const again = await fetch(`http://127.0.0.1:${w.forwardPort}/`)
  assert.equal(again.status, 200, 'the inbound forward still answers')
})

// A socket test with the production connect and lookup: only the address
// checked is dialled.
test('with the production lookup and connect, the forwarder dials the address it checked, and only that', BOUNDED, async (t) => {
  const dnsPromises = (await import('node:dns/promises')).default
  const echo = net.createServer(socket => socket.pipe(socket))
  const echoPort = await listening(echo)
  t.after(() => echo.close())
  const looked = []
  t.mock.method(dnsPromises, 'lookup', async (host, opts) => { looked.push([host, opts]); return [{ address: '93.184.216.34', family: 4 }] })
  const realConnect = net.connect
  const dialled = []
  t.mock.method(net, 'connect', (opts, ...rest) => {
    if (opts?.host === '93.184.216.34') { dialled.push([opts.host, opts.port]); return realConnect({ host: '127.0.0.1', port: echoPort }) }
    return realConnect(opts, ...rest)
  })
  const proxyPort = await free()
  const fwd = await createForwarder({ host: '127.0.0.1', proxy: { listen: proxyPort, allow: ['api.example.com'] } }, { log: () => {} })
  t.after(() => fwd.close())
  const ok = await connectVia(proxyPort, 'api.example.com:443')
  assert.equal(ok.status, 200)
  ok.socket.destroy()
  assert.deepEqual(looked, [['api.example.com', { all: true, verbatim: true }]])
  assert.deepEqual(dialled, [['93.184.216.34', 443]])
})

// The plain-HTTP path, as a proxy: the Host its target names, no
// connection-only header either way, and bounded waits.
test('plain http: the target\'s Host, no connection-only header either way, a bounded connect and idle, and a cut answer cut', BOUNDED, async (t) => {
  let seen = null
  const w = await world(t, {
    allow: ['api.example.com', 'slow.example.com', 'cut.example.com', 'never.example.com'],
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    timeouts: { connectMs: 150, idleMs: 150 },
    app: (req, res) => {
      seen = req.headers
      if (req.url === '/slow') { res.writeHead(200, { 'content-length': '10' }); res.write('12345'); return }
      if (req.url === '/cut') { res.writeHead(200, { 'content-length': '10' }); res.write('12345'); setTimeout(() => res.socket.destroy(), 20); return }
      res.writeHead(200, { connection: 'x-up', 'x-up': 'secret', 'keep-alive': 'timeout=5', 'proxy-authenticate': 'Basic', 'x-kept': 'yes' })
      res.end('ok')
    },
    // port 81: a connect that never completes
    connect: (port, address, { appPort }) => {
      if (port !== 81) return net.connect({ port: appPort, host: '127.0.0.1' })
      const stuck = new net.Socket()
      stuck.connecting = true
      return stuck
    },
  })
  const ok = await viaProxy(w.proxyPort, 'http://api.example.com/x', { host: 'evil.example', connection: 'x-custom, keep-alive', 'x-custom': 'drop me', te: 'trailers', 'proxy-authorization': 'Basic x', 'x-end': 'kept' })
  assert.equal(ok.status, 200)
  assert.equal(seen.host, 'api.example.com')
  for (const name of ['x-custom', 'te', 'proxy-authorization']) assert.equal(seen[name], undefined, name)
  assert.equal(seen['x-end'], 'kept')
  for (const name of ['x-up', 'keep-alive', 'proxy-authenticate']) assert.equal(ok.headers[name], undefined, name)
  assert.equal(ok.headers['x-kept'], 'yes')
  // a connect that never completes
  const never = await viaProxy(w.proxyPort, 'http://never.example.com:81/')
  assert.deepEqual([never.status, never.headers['x-qa-egress']], [502, 'failed'])
  // an answer that stops coming, and one cut partway: the client's ends too
  for (const path of ['/slow', '/cut']) {
    const host = path === '/slow' ? 'slow' : 'cut'
    await assert.rejects(viaProxy(w.proxyPort, `http://${host}.example.com${path}`), /aborted|socket hang up|ECONNRESET/, path)
  }
})

// CONNECT: bytes sent with the request reach the host; a failure before the
// 200 is a 502 `failed`; after it, the tunnel just ends.
test('CONNECT: the bytes sent with it go through, a failure before the 200 is a 502 failed, and after it only ends the tunnel', BOUNDED, async (t) => {
  let upstreamOf = null
  const w = await world(t, {
    allow: ['api.example.com', 'down.example.com'],
    lookup: async host => [{ address: host === 'down.example.com' ? '93.184.216.35' : '93.184.216.34', family: 4 }],
    connect: (port, address, { echoPort }) => {
      if (address === '93.184.216.35') return net.connect({ port: 1, host: '127.0.0.1' }) // nothing listens there
      const socket = net.connect({ port: echoPort, host: '127.0.0.1' })
      upstreamOf = socket
      return socket
    },
  })
  const withHead = await new Promise((resolve, reject) => {
    const socket = net.connect(w.proxyPort, '127.0.0.1', () => socket.write('CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\n\r\nhello'))
    let buf = ''
    socket.on('data', chunk => { buf += chunk; if (buf.includes('hello')) resolve({ buf, socket }) })
    socket.on('error', reject)
  })
  assert.match(withHead.buf, /^HTTP\/1\.1 200 Connection Established\r\n\r\nhello$/)
  // the host goes away after the 200: no 502 written into the tunnel
  let after = ''
  withHead.socket.on('data', c => { after += c })
  upstreamOf.destroy(new Error('gone'))
  await once(withHead.socket, 'close')
  assert.equal(after, '')
  const down = await connectVia(w.proxyPort, 'down.example.com:443')
  assert.equal(down.status, 502)
  assert.match(down.head, /X-QA-Egress: failed/)
  down.socket.destroy()
})

// The inbound forward: a client that ends its side still gets the answer;
// an app that's down closes the client; close() ends what is open.
test('the inbound forward: a half-closed client still gets its answer, an app that is down closes it, and close() ends every connection', BOUNDED, async (t) => {
  const w = await world(t)
  const answer = await new Promise((resolve, reject) => {
    const socket = net.connect(w.forwardPort, '127.0.0.1', () => socket.end('GET /half HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'))
    let buf = ''
    socket.on('data', c => { buf += c })
    socket.on('end', () => resolve(buf))
    socket.on('error', reject)
  })
  assert.match(answer, /^HTTP\/1\.1 200/)
  assert.match(answer, /"url":"\/half"/)
  // the app down
  const downPort = await free()
  const lonely = await createForwarder({ host: '127.0.0.1', forward: { listen: await free(), to: `127.0.0.1:${downPort}` } })
  t.after(() => lonely.close())
  const port = lonely.servers[0].address().port
  const closed = await new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1')
    socket.on('close', () => resolve(true))
    socket.on('error', () => {})
  })
  assert.equal(closed, true)
  // close() with a tunnel and a forward connection open
  const w2 = await world(null, { allow: ['api.example.com'] })
  const tunnel = await connectVia(w2.proxyPort, 'api.example.com:443')
  const held = net.connect(w2.forwardPort, '127.0.0.1')
  await once(held, 'connect')
  const closing = w2.close()
  await Promise.race([closing, new Promise((_, reject) => setTimeout(() => reject(new Error('close() hung')), 2_000))])
  tunnel.socket.destroy()
  held.destroy()
})

test('a config is checked whole before anything listens: neither forward nor proxy, or a bad part, throws and listens nowhere', BOUNDED, async () => {
  for (const config of [{}, [], 'x', null, { forward: null, proxy: null }]) {
    await assert.rejects(createForwarder(config), /the config must be an object with forward, proxy or both/, JSON.stringify(config))
  }
  const port = await free()
  await assert.rejects(createForwarder({ host: '127.0.0.1', forward: { listen: port, to: '127.0.0.1:1' }, proxy: { listen: await free(), allow: ['127.0.0.1'] } }), /always refused/)
  // the forward's port was never taken
  const probe = net.createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve) })
  probe.close()
})

test('a refusal\'s log line brackets an IPv6 host, quotes a host it can\'t read, and is bounded', BOUNDED, async (t) => {
  const w = await world(t, { allow: ['api.example.com'] })
  for (const target of ['[::1]:443', `${'a'.repeat(400)}.example:443`, 'a%zz:443']) {
    const no = await connectVia(w.proxyPort, target)
    no.socket.destroy()
  }
  assert.equal(w.logged[0], 'qa-egress refused [::1]:443: ::1 is unspecified, loopback or IPv4-compatible')
  assert.ok(w.logged[1].length <= 301, String(w.logged[1].length))
  assert.match(w.logged[2], /^qa-egress refused "a%zz":443: not a host name$/)
})
