
// A reader keeps a cursor: `log` tells it when the log under the cursor is
// another session's, whose seq started again.
test('every read names its log, the same for one log and another for the next', () => {
  const a = createActionLog({ now: () => 1 })
  const b = createActionLog({ now: () => 1 })
  assert.match(a.read(0).log, /^[0-9a-f]{16}$/)
  assert.equal(a.read(0).log, a.read(5).log)
  assert.notEqual(a.read(0).log, b.read(0).log)
})

// Two new marks between reads: the earlier one can claim a request read
// before either.
test('a regroup counts from the earliest of the new marks', () => {
  const c = clock(900)
  const log = createActionLog({ now: c.now })
  log.record('base', { at: 900, method: 'POST', path: '/save', status: 303 })
  const first = log.read(0)
  c.tick(100)
  const click = log.mark('base', 'click') // at 1000
  c.tick(1_000)
  log.mark('base', 'submit') // at 2000
  const next = log.read(first.seq)
  assert.deepEqual(next.requests.map(r => [r.path, r.mark]), [['/save', click.seq]])
})

// A read is bounded: at most `limit` new requests and `limit` regrouped
// ones. More regrouped than that, and `resync` says to read again from 0.
test('a read gives again only the requests whose mark changed, at most `limit` of them, else says to read again from 0', () => {
  const c = clock(1_000)
  const log = createActionLog({ now: c.now })
  const before = log.mark('base', 'click') // at 1000
  c.tick(1_000)
  log.record('base', { at: 1_500, method: 'GET', path: '/near-old', status: 200 }) // the click's, and stays so
  for (let i = 0; i < 6; i++) log.record('pr', { at: 1_900, method: 'GET', path: `/p${i}`, status: 200 })
  const first = log.read(0)
  assert.deepEqual(first.requests.map(r => r.mark), Array(7).fill(before.seq))
  c.tick(0)
  const submit = log.mark('pr', 'submit') // at 2000: the nearer for the 1900s, and the PR pane's own
  const small = log.read(first.seq, { limit: 5 })
  assert.deepEqual([small.resync, small.seq, small.requests, small.marks, small.log], [true, 0, [], [], first.log])
  const page = log.read(first.seq, { limit: 6 })
  assert.equal(page.resync, false)
  assert.deepEqual(page.requests.map(r => [r.path, r.mark]), [0, 1, 2, 3, 4, 5].map(i => [`/p${i}`, submit.seq]), '/near-old is not given again')
  // from 0, every request comes with its mark as it stands, in pages
  const again = log.read(0, { limit: 4 })
  assert.deepEqual([again.requests.length, again.more, again.resync], [4, true, false])
})

// Marks group both panes' requests: a mirrored action is reported by the
// pane it happened in only. A pane's own mark wins when it is that close.
test('grouping prefers a mark from the request\'s own pane within the window', () => {
  const c = clock(1_000)
  const log = createActionLog({ now: c.now })
  const baseClick = log.mark('base', 'click') // at 1000
  c.tick(10)
  const prClick = log.mark('pr', 'click') // at 1010
  log.record('base', { at: 1_020, method: 'GET', path: '/b', status: 200 })
  log.record('pr', { at: 1_020, method: 'GET', path: '/p', status: 200 })
  c.tick(1_000)
  const prLater = log.mark('pr', 'submit') // at 2010
  log.record('base', { at: 2_000, method: 'GET', path: '/mirrored', status: 200 }) // no base mark near: the PR pane's
  log.record('base', { at: 1_200, method: 'GET', path: '/tie-own', status: 200 }) // its own pane's, 200 ms back
  assert.deepEqual(log.read(0).requests.map(r => [r.path, r.mark]), [
    ['/b', baseClick.seq], ['/p', prClick.seq], ['/mirrored', prLater.seq], ['/tie-own', baseClick.seq],
  ])
})

// The marks no request can belong to go, so a long session's refills don't
// pile up.
test('marks older than every request in the rings, but the last of them, are let go', () => {
  const c = clock(0)
  const log = createActionLog({ now: c.now, maxEntries: 2, maxMarks: 3, markRefillMs: 1 })
  const marks = []
  for (let i = 0; i < 20; i++) { c.tick(1_000); marks.push(log.mark('base', 'click')) } // at 1000 ... 20000
  for (const at of [17_100, 18_100]) log.record('base', { at, method: 'GET', path: '/x', status: 200 })
  c.tick(1_000)
  marks.push(log.mark('base', 'click')) // the 21st: past 4 × maxMarks, a prune
  const out = log.read(0)
  assert.deepEqual(out.marks.map(m => m.at), [17_000, 18_000, 19_000, 20_000, 21_000], 'the 17000 mark is the last before the earliest request\'s window')
  assert.deepEqual(out.requests.map(r => r.mark), [marks[16].seq, marks[17].seq])
})

// One clock that only goes forward: a step back of the system clock stops
// no mark and puts no request before its mark.
test('the default clock is monotonic: a step back of the wall clock changes nothing', async (t) => {
  const log = createActionLog()
  assert.ok(log.mark('base', 'click'))
  let wall = Date.now()
  t.mock.method(Date, 'now', () => (wall -= 3_600_000))
  await new Promise(r => setTimeout(r, 120))
  assert.ok(log.mark('base', 'click'), 'a mark 120 ms later is recorded')
  const at = monotonicNow()
  assert.ok(Math.abs(at - (performance.timeOrigin + performance.now())) < 5)
  log.record('base', { at, method: 'GET', path: '/x', status: 200 })
  const out = log.read(0)
  assert.equal(out.requests[0].mark, out.marks[1].seq)
})
