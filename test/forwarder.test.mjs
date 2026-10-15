// The PR pane's forwarder (lib/forwarder.mjs, #32): the inbound forward to
// the PR app, and the egress proxy that lets the PR pane out only to hosts on
// its allowlist, at public addresses. Run here on loopback, with the DNS
// lookup and the outgoing connection faked: a public address the check
// passes is then routed to a local server, so nothing leaves this machine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import http from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { blockedAddress, checkTarget, createForwarder, parseAllowlist } from '../lib/forwarder.mjs'

const SOURCE = fileURLToPath(new URL('../lib/forwarder.mjs', import.meta.url))
// What a test on sockets or a child may take before it fails, rather than
// hang the run: a broken forwarder can leave a connection, or a child, open.
const BOUNDED = { timeout: 10_000 }

test('blockedAddress: only public addresses pass; every address a runtime gives the host is refused', () => {
  // just outside the CGNAT block (100.64.0.0/10) on either side: public
  for (const ip of ['100.63.255.254', '100.128.0.1', '8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8', '[2606:4700::1111]']) {
    assert.equal(blockedAddress(ip), null, ip)
  }
  const refused = [
    ['127.0.0.1', 'loopback'], ['127.255.0.9', 'loopback'], ['::1', 'unspecified, loopback or IPv4-compatible'], ['::', 'unspecified, loopback or IPv4-compatible'],
    ['10.1.2.3', 'private'], ['172.17.0.1', 'private'], ['172.31.255.255', 'private'], ['192.168.65.254', 'private'], ['192.168.127.254', 'private'],
    ['169.254.169.254', 'link-local (cloud metadata)'], ['100.64.0.1', 'shared (CGNAT, Tailscale)'],
    ['0.0.0.0', 'unspecified'], ['224.0.0.1', 'multicast'], ['255.255.255.255', 'reserved'], ['192.0.2.1', 'documentation'],
    ['198.18.0.1', 'benchmarking'], ['fd00:20::3', 'unique local'], ['fe80::1', 'link-local'], ['fe80::1%eth0', 'link-local'],
    ['ff02::1', 'multicast'], ['2001:db8::1', 'documentation'], ['64:ff9b::7f00:1', 'NAT64'], ['2002:7f00:1::', '6to4'],
    ['::ffff:127.0.0.1', 'loopback'], ['::ffff:7f00:1', 'loopback'], ['::ffff:169.254.169.254', 'link-local (cloud metadata)'],
    ['::ffff:192.168.65.254', 'private'], ['0:0:0:0:0:ffff:10.0.0.1', 'private'], ['::127.0.0.1', 'unspecified, loopback or IPv4-compatible'],
    ['3fff::1', 'documentation'], ['4000::1', 'not global unicast'], ['host.docker.internal', 'not an IP address'], ['1.2.3', 'not an IP address'], [undefined, 'not an IP address'],
  ]
  for (const [ip, kind] of refused) assert.equal(blockedAddress(ip), kind, String(ip))
})

test('parseAllowlist: host names, *.domains and public addresses, each with an optional port; anything else throws', () => {
  assert.deepEqual(parseAllowlist(undefined), [])
  assert.deepEqual(parseAllowlist(['API.Example.com.', '*.example.net:8443', '93.184.216.34', '[2606:4700::1111]:443']), [
    { host: 'api.example.com', wildcard: false, ports: [80, 443] },
    { host: 'example.net', wildcard: true, ports: [8443] },
    { host: '93.184.216.34', wildcard: false, ports: [80, 443] },
    { host: '2606:4700::1111', wildcard: false, ports: [443] },
  ])
  for (const [bad, re] of [
    ['api.example.com', /must be an array/],
    [[7], /egress\[0\] must be a string/],
    [['*'], /must be a host name/],
    [['*.com'], /must be a host name/],
    [['localhost'], /must be a host name/],
    [['exa mple.com'], /must be a host name/],
    [['example.com:0'], /bad port/],
    [['example.com:99999'], /bad port/],
    [['example.com:http'], /bad port/],
    [['http://example.com'], /bad port|must be a host name/],
    [['127.0.0.1'], /127\.0\.0\.1 is loopback, which is always refused/],
    [['192.168.65.254:3100'], /is private, which is always refused/],
    [['*.10.0.0.1'], /takes no wildcard|must be a host name/],
    [['1.2.3.4.5'], /must be a host name/],
  ]) assert.throws(() => parseAllowlist(bad), re, JSON.stringify(bad))
})

const lookupOf = table => async host => {
  if (!Object.hasOwn(table, host)) throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' })
  return table[host].map(address => ({ address, family: net.isIP(address) }))
}

test('checkTarget: a listed host at public addresses only, on a listed port; it names the address it checked', async () => {
  const rules = parseAllowlist(['api.example.com', '*.example.net', 'hooks.example.org:8443', '93.184.216.34'])
  const lookup = lookupOf({
    'api.example.com': ['93.184.216.34', '2606:4700::1111'],
    'a.example.net': ['1.1.1.1'],
    'b.example.net': ['1.1.1.1', '10.0.0.5'], // one private answer refuses all
    'hooks.example.org': ['8.8.8.8'],
    'rebound.example.net': ['127.0.0.1'],
  })
  const cases = [
    [['api.example.com', 443], { address: '93.184.216.34' }],
    [['API.EXAMPLE.COM.', 80], { address: '93.184.216.34' }],
    [['a.example.net', 443], { address: '1.1.1.1' }],
    [['hooks.example.org', 8443], { address: '8.8.8.8' }],
    [['93.184.216.34', 443], { address: '93.184.216.34' }],
    [['api.example.com', 22], { refused: 'api.example.com:22 is not on the allowlist' }],
    [['hooks.example.org', 443], { refused: 'hooks.example.org:443 is not on the allowlist' }],
    [['example.net', 443], { refused: 'example.net:443 is not on the allowlist' }],
    [['evil.example', 443], { refused: 'evil.example:443 is not on the allowlist' }],
    [['b.example.net', 443], { refused: 'b.example.net resolves to 10.0.0.5, which is private' }],
    [['rebound.example.net', 443], { refused: 'rebound.example.net resolves to 127.0.0.1, which is loopback' }],
    [['c.example.net', 443], { refused: 'c.example.net does not resolve (ENOTFOUND)' }],
    [['127.0.0.1', 3100], { refused: '127.0.0.1 is loopback' }],
    [['host.docker.internal', 3100], { refused: 'host.docker.internal:3100 is not on the allowlist' }],
    [['192.168.65.254', 443], { refused: '192.168.65.254 is private' }],
    [['169.254.169.254', 80], { refused: '169.254.169.254 is link-local (cloud metadata)' }],
    [['[::1]', 443], { refused: '::1 is unspecified, loopback or IPv4-compatible' }],
    [['8.8.8.8', 443], { refused: '8.8.8.8:443 is not on the allowlist' }],
    [['api.example.com', NaN], { refused: 'no valid port' }],
    [['', 443], { refused: 'not a host name' }],
  ]
  for (const [[host, port], want] of cases) assert.deepEqual(await checkTarget(rules, host, port, lookup), want, `${host}:${port}`)
  // the empty list lets nothing out
  assert.deepEqual(await checkTarget([], 'api.example.com', 443, lookup), { refused: 'api.example.com:443 is not on the allowlist' })
  assert.deepEqual(await checkTarget(rules, 'api.example.com', 443, async () => []), { refused: 'api.example.com does not resolve' })
})

// --- On loopback --------------------------------------------------------------------

async function listening(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

// A forwarder whose outgoing connections go to `upstreamPort` on loopback,
// recording the address each was meant for.
async function world({ allow = [], lookup = lookupOf({ 'api.example.com': ['93.184.216.34'] }) } = {}) {
  const echo = net.createServer(socket => socket.pipe(socket))
  const app = http.createServer((req, res) => res.end(JSON.stringify({ url: req.url, host: req.headers.host, auth: req.headers['proxy-authorization'] ?? null, conn: req.headers['proxy-connection'] ?? null })))
  const [echoPort, appPort] = [await listening(echo), await listening(app)]
  const connects = []
  const logged = []
  const free = async () => { const s = net.createServer(); const p = await listening(s); s.close(); return p }
  const [forwardPort, proxyPort] = [await free(), await free()]
  const fwd = await createForwarder({
    host: '127.0.0.1',
    forward: { listen: forwardPort, to: `127.0.0.1:${appPort}` },
    proxy: { listen: proxyPort, allow },
    lookup,
    connect: (port, address) => { connects.push([address, port]); return net.connect({ port: port === 80 ? appPort : echoPort, host: '127.0.0.1' }) },
    log: line => logged.push(line),
  })
  return {
    forwardPort, proxyPort, connects, logged,
    close: async () => { await fwd.close(); echo.close(); app.close() },
  }
}

// A raw CONNECT: the status line, and the socket once it answered.
function connectVia(proxyPort, target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, '127.0.0.1', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`))
    let buf = ''
    socket.on('data', function first(chunk) {
      buf += chunk.toString()
      if (!buf.includes('\r\n\r\n')) return
      socket.off('data', first)
      resolve({ status: Number(buf.split(' ')[1]), head: buf, socket })
    })
    socket.on('error', reject)
  })
}

test('the inbound forward pipes each connection to the PR app', BOUNDED, async () => {
  const w = await world()
  try {
    const res = await fetch(`http://127.0.0.1:${w.forwardPort}/api/health?x=1`)
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(await res.text()).url, '/api/health?x=1')
  } finally { await w.close() }
})

test('CONNECT goes through to a listed host at the address checked, and nowhere else; refusals say why and are logged', BOUNDED, async () => {
  const w = await world({ allow: ['api.example.com'] })
  try {
    const ok = await connectVia(w.proxyPort, 'api.example.com:443')
    assert.equal(ok.status, 200)
    ok.socket.write('ping')
    const [echoed] = await once(ok.socket, 'data')
    assert.equal(echoed.toString(), 'ping')
    ok.socket.destroy()
    assert.deepEqual(w.connects, [['93.184.216.34', 443]])
    for (const target of ['evil.example:443', 'host.docker.internal:3100', '127.0.0.1:3100', '192.168.65.254:3100', '[::1]:3100', '169.254.169.254:80', 'api.example.com:22']) {
      const no = await connectVia(w.proxyPort, target)
      assert.equal(no.status, 403, target)
      assert.match(no.head, /X-QA-Egress: refused/, target)
      no.socket.destroy()
    }
    assert.equal(w.connects.length, 1, 'no refused target was connected to')
    assert.equal(w.logged.length, 7)
    assert.match(w.logged[0], /^qa-egress refused evil\.example:443: evil\.example:443 is not on the allowlist$/)
  } finally { await w.close() }
})

test('plain http goes through for a listed host, without the proxy\'s own headers; anything but an absolute http:// request is refused', BOUNDED, async () => {
  const w = await world({ allow: ['api.example.com'] })
  try {
    const via = (path, headers = {}) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: w.proxyPort, path, headers: { host: 'api.example.com', ...headers } }, res => {
        let body = ''
        res.on('data', c => { body += c })
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
      })
      req.on('error', reject)
      req.end()
    })
    const ok = await via('http://api.example.com/v1/things?a=1', { 'proxy-authorization': 'Basic c2VjcmV0', 'proxy-connection': 'keep-alive' })
    assert.equal(ok.status, 200)
    assert.deepEqual(JSON.parse(ok.body), { url: '/v1/things?a=1', host: 'api.example.com', auth: null, conn: null })
    assert.deepEqual(w.connects, [['93.184.216.34', 80]])
    for (const [path, status] of [['http://evil.example/', 403], ['http://127.0.0.1:3100/qa/api/state', 403], ['/qa/api/state', 400], ['https://api.example.com/', 400]]) {
      const no = await via(path)
      assert.equal(no.status, status, path)
      assert.equal(no.headers['x-qa-egress'], 'refused', path)
    }
    assert.equal(w.connects.length, 1)
  } finally { await w.close() }
})

test('a host that a second DNS answer would turn private is connected to at the address checked', BOUNDED, async () => {
  let answers = 0
  const flipping = async () => (answers++ === 0 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }])
  const w = await world({ allow: ['api.example.com'], lookup: flipping })
  try {
    const ok = await connectVia(w.proxyPort, 'api.example.com:443')
    assert.equal(ok.status, 200)
    ok.socket.destroy()
    assert.deepEqual([answers, w.connects], [1, [['93.184.216.34', 443]]])
  } finally { await w.close() }
})

// A child's exit code, or a failure once `ms` pass; the child is killed then.
function exited(child, ms = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`the child did not exit within ${ms} ms`)) }, ms)
    child.once('exit', code => { clearTimeout(timer); resolve(code) })
  })
}

// As the container runs it: the file as given to node -e, its config in
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
  } finally { child.kill(); app.close() }
  // a free port each bad config would listen on, were it taken as good
  const spare = net.createServer()
  const sparePort = await listening(spare)
  spare.close()
  for (const [env, re] of [
    [{ PANE_FORWARDER: 'not json' }, /PANE_FORWARDER is not JSON/],
    [{ PANE_FORWARDER: JSON.stringify({ host: '127.0.0.1', proxy: { listen: sparePort, allow: ['127.0.0.1'] } }) }, /127\.0\.0\.1 is loopback, which is always refused/],
    [{ PANE_FORWARDER: JSON.stringify({ host: '127.0.0.1', forward: { listen: sparePort, to: 'nowhere' } }) }, /forward needs listen/],
  ]) {
    const bad = run(env)
    let err = ''
    bad.stderr.on('data', c => { err += c })
    const code = await exited(bad)
    assert.equal(code, 1, err)
    assert.match(err, re)
  }
  // imported, as by these tests, it starts nothing
  assert.equal(process.env.PANE_FORWARDER, undefined)
})

// The conductor imports the file too (the Docker Provisioner checks the
// allowlist with it): a PANE_FORWARDER in the conductor's own env must not
// start a forwarder there. Only the file run as given to node -e runs.
test('imported, it runs nothing, even with PANE_FORWARDER set', BOUNDED, async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', 'await import(process.env.FORWARDER_URL); console.log("imported")'], {
    env: { PATH: process.env.PATH, FORWARDER_URL: new URL('../lib/forwarder.mjs', import.meta.url).href, PANE_FORWARDER: JSON.stringify({ proxy: { listen: 3128, allow: ['127.0.0.1'] } }) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  child.stdout.on('data', c => { out += c })
  child.stderr.on('data', c => { err += c })
  assert.equal(await exited(child), 0, err)
  assert.equal(out.trim(), 'imported')
  assert.doesNotMatch(err, /qa-forwarder/)
})
