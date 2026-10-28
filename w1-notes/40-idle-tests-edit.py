p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/test/forwarder.test.mjs'
c = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/40-idle-tests.mjs'
s = open(p).read()


def sub(a, b, n=1):
    global s
    assert s.count(a) == n, (a[:90], s.count(a))
    s = s.replace(a, b)


sub("import { once } from 'node:events'\n", "import { EventEmitter, once } from 'node:events'\n")
sub("import { blockedAddress, checkTarget, createForwarder, parseAllowlist } from '../lib/forwarder.mjs'",
    "import { blockedAddress, checkTarget, createForwarder, idleTimer, parseAllowlist } from '../lib/forwarder.mjs'")

# the end-to-end slow tests: an idle period the kernel's own buffering can't
# outlast; the timer's rules are tested with stand-ins at 100 ms
sub("""// Backpressure from a slow reader is no idleness: a tunnel that keeps
// moving, however slowly, isn't cut by the idle timer.
test('a slow but steady reader isn\\'t cut by the idle timer: a tunnel and a plain-HTTP answer deliver every byte', { timeout: 30_000 }, async (t) => {
  const MiB2 = 2 * 1024 * 1024
  const upstream = await sender(t, MiB2)
  const w = await world(t, {
    allow: ['api.example.com'],
    timeouts: { idleMs: 300 },""", """// Backpressure from a slow reader is no idleness: a tunnel that keeps
// moving, however slowly, isn't cut by the idle timer. A second, not less:
// the kernel's buffers can hold a steady reader's bytes out of the
// forwarder's sight for longer than 300 ms (the timer's own rules are
// tested with stand-ins, below).
test('a slow but steady reader isn\\'t cut by the idle timer: a tunnel and a plain-HTTP answer deliver every byte', { timeout: 30_000 }, async (t) => {
  const MiB2 = 2 * 1024 * 1024
  const upstream = await sender(t, MiB2)
  const w = await world(t, {
    allow: ['api.example.com'],
    timeouts: { idleMs: 1000 },""")
sub("""  const w = await world(t, { allow: ['api.example.com'], timeouts: { idleMs: 300 }, connect: () => net.connect({ port: hostPort, host: '127.0.0.1' }) })
  const ok = await connectVia(w.proxyPort, 'api.example.com:443')
  assert.equal(ok.status, 200)
  ok.socket.on('error', () => {})
  ok.socket.on('data', () => {})
  ok.socket.write(Buffer.alloc(BIG, 0x75))""", """  const w = await world(t, { allow: ['api.example.com'], timeouts: { idleMs: 1000 }, connect: () => net.connect({ port: hostPort, host: '127.0.0.1' }) })
  const ok = await connectVia(w.proxyPort, 'api.example.com:443')
  assert.equal(ok.status, 200)
  ok.socket.on('error', () => {})
  ok.socket.on('data', () => {})
  ok.socket.write(Buffer.alloc(BIG, 0x75))""")
sub("""    // one chunk every 100 ms for a second, then all it can
    const start = Date.now()""", """    // one chunk every 100 ms for two seconds, then all it can
    const start = Date.now()""")
sub("""      if (Date.now() - start > 1000) return""", """      if (Date.now() - start > 2000) return""")
sub("""// host reads slowly for a second, then all it can: the upload is far more""", """// host reads slowly for two seconds, then all it can: the upload is far more""")
s += open(c).read()
open(p, 'w').write(s)
print('ok')
