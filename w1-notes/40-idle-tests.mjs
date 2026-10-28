
// The idle timer's rules, with stand-in sockets on real timers: what moved is
// what the test says moved.
function fakeSocket() {
  const s = new EventEmitter()
  Object.assign(s, { bytesRead: 0, bytesWritten: 0, writableLength: 0, _handle: { writeQueueSize: 0 }, paused: false, writableNeedDrain: false, destroyed: false, timer: null })
  s.isPaused = () => s.paused
  s.setTimeout = ms => { clearTimeout(s.timer); s.timer = setTimeout(() => s.emit('timeout'), ms) }
  s.stop = () => { clearTimeout(s.timer); s.destroyed = true }
  return s
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function watched(ms, opts) {
  const [socket, peer] = [fakeSocket(), fakeSocket()]
  const cuts = []
  const start = Date.now()
  idleTimer(socket, peer, ms, () => { cuts.push(Date.now()); socket.stop() }, opts)
  return { socket, peer, cuts, start, stop: () => { socket.stop(); peer.stop() } }
}

test('idleTimer: a socket where nothing moves is cut once, after ms and the grace', async (t) => {
  const w = watched(100)
  t.after(w.stop)
  await sleep(450)
  assert.equal(w.cuts.length, 1)
  const at = w.cuts[0] - w.start
  assert.ok(at >= 195 && at < 400, `cut at ${at} ms`)
})

test('idleTimer: a socket waiting on a peer that moved since its last look is spared, and cut once the peer has stopped', async (t) => {
  // the peer moves once, before the first look and never in a grace
  const w = watched(200, { graceMs: 20, waiting: () => true })
  t.after(w.stop)
  await sleep(50)
  w.peer._handle.writeQueueSize -= 1000
  await sleep(700)
  assert.equal(w.cuts.length, 1, 'cut in the end: the listener outlasts the re-arm')
  const at = w.cuts[0] - w.start
  assert.ok(at >= 395 && at < 650, `spared at the first look, cut at the second: ${at} ms`)
})

test('idleTimer: a paused socket whose peer keeps moving is never cut, however many times it is re-armed', async (t) => {
  const w = watched(100, { graceMs: 20 })
  t.after(w.stop)
  w.socket.paused = true
  for (let i = 0; i < 16; i++) { await sleep(60); w.peer.bytesWritten += 1000 }
  assert.deepEqual(w.cuts, [], 'not cut while the peer moves')
  const stopped = Date.now()
  await sleep(500)
  assert.equal(w.cuts.length, 1, 'cut once the peer stopped')
  assert.ok(w.cuts[0] - stopped < 400, `within twice ms and the grace: ${w.cuts[0] - stopped} ms`)
})

test('idleTimer: each side waiting on the other, with nothing moving, is still cut', async (t) => {
  const w = watched(100, { waiting: () => true })
  t.after(w.stop)
  await sleep(500)
  assert.equal(w.cuts.length, 1)
})

test('idleTimer: a stalled event loop isn\'t idleness: I/O that was due when the timer fired, and lands in the grace, spares the socket', async (t) => {
  const w = watched(100)
  t.after(w.stop)
  await sleep(50)
  // the loop stalls past the timer's deadline; what moved meanwhile shows
  // only after the timer has fired, as I/O does
  const until = Date.now() + 200
  while (Date.now() < until);
  setImmediate(() => { w.socket.bytesRead += 1000 })
  await sleep(60)
  assert.deepEqual(w.cuts, [], 'spared')
  await sleep(500)
  assert.equal(w.cuts.length, 1, 'and cut once nothing moves')
})
