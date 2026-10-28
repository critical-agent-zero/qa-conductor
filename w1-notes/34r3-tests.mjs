// One sequence numbers requests and marks alike, and a read gives the next
// of them, at most `limit`: a reader that reads on until `more` is false has
// had everything, in order, and nothing is ever given again.
test('a read gives the requests and marks after a sequence number, in order, at most `limit` together', () => {
  const c = clock(0)
  const log = createActionLog({ now: c.now })
  log.record('base', { at: 0, method: 'GET', path: '/', status: 200 }) // 1
  c.tick(1_000)
  const click = log.mark('base', 'click') // 2
  log.record('base', { at: 800, method: 'POST', path: '/cart/clear', status: 303 }) // 3
  log.record('pr', { at: 650, method: 'POST', path: '/cart/clear', status: 303 }) // 4
  c.tick(2_000)
  const submit = log.mark('pr', 'submit') // 5
  const all = log.read(0)
  assert.deepEqual([all.seq, all.more], [5, false])
  assert.deepEqual(all.requests.map(r => [r.seq, r.pane, r.path]), [[1, 'base', '/'], [3, 'base', '/cart/clear'], [4, 'pr', '/cart/clear']])
  assert.deepEqual(all.marks, [click, submit])
  assert.equal(all.requests.some(r => 'mark' in r), false, 'which action a request came from is the reader\'s to work out')
  const page = log.read(0, { limit: 2 })
  assert.deepEqual([page.requests.map(r => r.seq), page.marks.map(m => m.seq), page.seq, page.more], [[1], [2], 2, true])
  const rest = log.read(page.seq, { limit: 2 })
  assert.deepEqual([rest.requests.map(r => r.seq), rest.marks.map(m => m.seq), rest.seq, rest.more], [[3, 4], [], 4, true])
  const last = log.read(rest.seq, { limit: 2 })
  assert.deepEqual([last.requests, last.marks.map(m => m.seq), last.seq, last.more], [[], [5], 5, false])
  // nothing new: the cursor stays
  assert.deepEqual([log.read(5).seq, log.read(5).requests, log.read(5).marks, log.read(9).seq], [5, [], [], 9])
  for (const bad of [undefined, 'x', -1, 1.5]) assert.equal(log.read(bad).requests.length, 3, String(bad))
  // the default and the most: 2,000
  for (let i = 0; i < 2_500; i++) log.record('pr', { at: 10, method: 'GET', path: '/x', status: 200 })
  assert.equal(log.read(0).requests.length + log.read(0).marks.length, 2_000)
  assert.equal(log.read(0, { limit: 9_999 }).requests.length + log.read(0, { limit: 9_999 }).marks.length, 2_000)
})

// The review's case: 2 × limit + 1 requests in one mark's window, the mark
// after them. Reading on from 0 reaches the end, and has everything.
test('a reader that reads on from 0 until `more` is false gets everything once, however the marks fall', () => {
  for (const limit of [5, 2_000]) {
    const c = clock(1_000)
    const log = createActionLog({ now: c.now })
    for (let i = 0; i < 2 * limit + 1; i++) log.record('pr', { at: 1_000, method: 'GET', path: `/p${i}`, status: 200 })
    c.tick(100)
    log.mark('pr', 'click')
    for (let i = 0; i < limit; i++) log.record('base', { at: 1_100, method: 'GET', path: `/b${i}`, status: 200 })
    let cursor = 0
    let reads = 0
    const seen = []
    for (;;) {
      const page = log.read(cursor, { limit })
      reads++
      seen.push(...page.requests.map(r => r.seq), ...page.marks.map(m => m.seq))
      cursor = page.seq
      if (!page.more) break
      assert.ok(reads < 100, 'it ends')
    }
    assert.equal(reads, Math.ceil((3 * limit + 2) / limit))
    assert.deepEqual(seen.sort((a, b) => a - b), Array.from({ length: 3 * limit + 2 }, (_, i) => i + 1), `limit ${limit}`)
  }
})

// Marks are bounded however long the session: a ring per pane.
test('each pane keeps its last keptMarks marks, counting the ones it let go in marksDropped', () => {
  const c = clock()
  const log = createActionLog({ now: c.now, keptMarks: 3, maxMarks: 100 })
  for (let i = 0; i < 5; i++) { log.mark('pr', 'click'); c.tick(1_000) }
  log.mark('base', 'click')
  const out = log.read(0)
  assert.deepEqual(out.marks.map(m => [m.pane, m.seq]), [['pr', 3], ['pr', 4], ['pr', 5], ['base', 6]])
  assert.deepEqual(out.marksDropped, { base: 0, pr: 2 })
  // by default four times the budget: 8,000 a pane
  const d = clock()
  const dflt = createActionLog({ now: d.now })
  for (let i = 0; i < 8_100; i++) { dflt.mark('pr', 'click'); d.tick(1_000) }
  let kept = 0
  for (let cursor = 0, page; (page = dflt.read(cursor)) && (kept += page.marks.length, page.more); cursor = page.seq);
  assert.deepEqual([kept, dflt.read(0).marksDropped.pr], [8_000, 100])
})

// Marks stay in time order: a clock that steps back is held at the last
// mark's time.
test('a mark is never earlier than the one before it', () => {
  const c = clock(1_000)
  const log = createActionLog({ now: c.now })
  log.mark('base', 'click')
  c.tick(-200)
  assert.equal(log.mark('pr', 'click').at, 1_000)
  c.tick(500)
  assert.equal(log.mark('pr', 'submit').at, 1_300)
})

// A reader keeps a cursor: `log` tells it when the log under the cursor is
// another session's, whose seq started again.
test('every read names its log, the same for one log and another for the next', () => {
  const a = createActionLog({ now: () => 1 })
  const b = createActionLog({ now: () => 1 })
  assert.match(a.read(0).log, /^[0-9a-f]{16}$/)
  assert.equal(a.read(0).log, a.read(5).log)
  assert.notEqual(a.read(0).log, b.read(0).log)
})

// One clock that only goes forward: a step back of the system clock stops
// no mark and puts no request before its mark.
test('the default clock is monotonic: a step back of the wall clock changes nothing', async (t) => {
  let wall = Date.now()
  t.mock.method(Date, 'now', () => (wall -= 3_600_000)) // an hour back at every look
  const log = createActionLog()
  assert.ok(log.mark('base', 'click'))
  await new Promise(r => setTimeout(r, 120))
  assert.ok(log.mark('base', 'click'), 'a mark 120 ms later is recorded')
  const at = monotonicNow()
  assert.ok(Math.abs(at - (performance.timeOrigin + performance.now())) < 5)
  log.record('base', { at, method: 'GET', path: '/x', status: 200 })
  const out = log.read(0)
  assert.ok(out.requests[0].at >= out.marks[1].at, 'the request after the mark it followed')
})
