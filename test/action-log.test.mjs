// The session's action log (lib/action-log.mjs): what each pane's proxy
// forwarded, and the marks the harness posts for the actions each pane's
// bridge reports, mirrored or not. Value-free by construction: no header,
// cookie, body or query value ever enters it, and paths lose what looks like
// a token, an email address or a long number.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MARK_TYPES, createActionLog, monotonicNow, sanitizeMethod, sanitizePath } from '../lib/action-log.mjs'

test('sanitizePath keeps the shape of a path and drops every value in it', () => {
  const cases = [
    ['/', '/'],
    ['/cart', '/cart'],
    ['/orders/42/items', '/orders/42/items'],
    // query values go, keys that look like names stay
    ['/search?q=hello&page=2', '/search?q=…&page=…'],
    ['/login?token=abc123&next=/x', '/login?token=…&next=…'],
    ['/x?', '/x'],
    ['/x?=v&&b=2', '/x?b=…'],
    // a query part with no `=` is usually the value itself
    ['/x?a', '/x?…'],
    ['/x?SECRETBAREVALUE&page=2', '/x?…&page=…'],
    // a key that is itself a value is masked too
    ['/x?eyJhbGciOiJIUzI1NiJ9=1', '/x?…=…'],
    ['/x?a%20b=1', '/x?…=…'],
    // segments that look like values
    ['/reset/9f86d081884c7d659a2feaa0c55ad015', '/reset/:token'],
    ['/hex/deadbeefcafebabe', '/hex/:token'],
    ['/invite/AbC123xYz789QwErTy00', '/invite/:token'],
    ['/invite/aB3dE6gH9jK2mN5p', '/invite/:token'], // 16 characters
    ['/b64/AbCdEfGhIjKlMnOpQrSt', '/b64/:token'], // mixed case, no digit
    ['/users/jane.doe@example.org/edit', '/users/:email/edit'],
    ['/users/jane.doe%40example.org', '/users/:email'],
    ['/users/bob%40ex.io%zz', '/users/:email'], // an escape that doesn't decode
    ['/users/alice＠example.com', '/users/:email'], // a fullwidth @
    ['/session/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', '/session/:token'],
    ['/phone/5551234567', '/phone/:number'],
    ['/phone/+15551234567', '/phone/:number'],
    ['/phone/555-123-4567', '/phone/:number'],
    ['/card/4111-1111-1111-1111', '/card/:number'],
    ['/ssn/123-45-6789', '/ssn/:number'],
    ['/code/12345678', '/code/:number'], // 8 digits
    ['/code/1234567', '/code/:number'], // 7
    ['/orders/123456', '/orders/123456'], // 6: an id, kept
    ['/2026/10/15/post', '/2026/10/15/post'],
    ['/products/widget-classic', '/products/widget-classic'],
    ['/guide/internationalization-guide', '/guide/internationalization-guide'],
    // seven digits or more anywhere in a segment, with one separator at most between two
    ['/u/5551234567.json', '/u/:number'],
    ['/acct/ACCT9876543210', '/acct/:number'],
    ['/ssn/ssn-123-45-6789', '/ssn/:number'],
    ['/patients/MRN1234567', '/patients/:number'],
    ['/cards/4111_1111_1111_1111', '/cards/:number'],
    ['/cards/4111+1111+1111+1111', '/cards/:number'],
    ['/cards/4111%2F1111%2F1111%2F1111', '/cards/:number'],
    ['/phone/555,123,4567', '/phone/:number'],
    ['/phone/(555) 123-4567', '/phone/:number'],
    ['/phone/５５５１２３４５６７', '/phone/:number'], // fullwidth digits
    ['/v/12-34-56', '/v/12-34-56'], // six
    // decoded until it stops changing
    ['/u/bob%2540gmail.com', '/u/:email'],
    ['/u/a%252540b.co', '/u/:email'],
    ['/users/bob﹫gmail.com', '/users/:email'], // a small-form @
    ['/users/bob%EF%B9%ABgmail.com', '/users/:email'],
    ['/x/token%3Dabc123', '/x/token=…'],
    ['/x/token%253Dabc', '/x/token=…'], // twice
    ['/x/token%25253Dabc', '/x/token=…'], // three times
    ['/users/bob%25EF%25B9%25ABgmail.com', '/users/:email'],
    // a JWT with no digit, too short for the other rules
    ['/s/eyJhbGci.eyJz.abc', '/s/:token'],
    // 24 letters or more in a row: no word is that long
    ['/reset/xkcdcorrecthorsebatterystaple', '/reset/:token'],
    ['/api/keys/key_abcdefghijklmnopqrstuvwx', '/api/keys/:token'],
    ['/k/ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEF', '/k/:token'],
    // a key=value segment keeps the key
    ['/x/token=abc', '/x/token=…'],
    ['/x/apikey=sk_live_short;v=2', '/x/apikey=…'],
    ['/x/eyJhbGciOiJIUzI1NiJ9=1', '/x/…=…'],
    // an absolute-form target loses its userinfo, host and query values
    ['http://u:p@h.example/a?b=1', '/a?b=…'],
    // a fragment never reaches a server, but nothing of it is kept either
    ['/a#secret', '/a'],
  ]
  for (const [url, want] of cases) assert.equal(sanitizePath(url), want, url)
  // at most 200 characters
  const long = sanitizePath(`/${'ab/'.repeat(200)}`)
  assert.equal(long.length, 200)
  assert.ok(long.endsWith('…'))
  // anything not a string is the root
  for (const bad of [undefined, null, 42]) assert.equal(sanitizePath(bad), '/')
})

test('sanitizeMethod keeps a method of capitals, and nothing else', () => {
  for (const m of ['GET', 'POST', 'DELETE', 'PROPFIND']) assert.equal(sanitizeMethod(m), m)
  for (const m of ['get', 'GE T', 'X'.repeat(13), '', undefined, '<img>']) assert.equal(sanitizeMethod(m), 'OTHER', String(m))
})

function clock(start = 1_000) {
  let t = start
  return { now: () => t, tick: ms => { t += ms } }
}

test('record keeps only the value-free fields, sanitized, and numbers every entry in one sequence with the marks', () => {
  const c = clock()
  const log = createActionLog({ now: c.now })
  const entry = log.record('base', {
    at: 990, method: 'POST', path: '/cart/clear?csrf=s3cr3t', status: 303, ms: 12, bytes: 0, aborted: false,
    headers: { cookie: 'sid=1' }, body: 'x=1', authorization: 'Bearer abc',
  })
  assert.deepEqual(entry, { seq: 1, pane: 'base', at: 990, method: 'POST', path: '/cart/clear?csrf=…', status: 303, ms: 12, bytes: 0, aborted: false })
  const mark = log.mark('pr', 'click')
  assert.deepEqual(mark, { seq: 2, pane: 'pr', at: 1_000, type: 'click' })
  // numbers are numbers, whatever came in
  const odd = log.record('pr', { at: 'x', method: 'get', path: 7, status: '200', ms: -1, bytes: Infinity })
  assert.deepEqual(odd, { seq: 3, pane: 'pr', at: 1_000, method: 'OTHER', path: '/', status: 0, ms: 0, bytes: 0, aborted: false })
  // only the two panes
  assert.throws(() => log.record('qa', { at: 1, method: 'GET', path: '/' }), /pane must be base or pr/)
})

test('each pane keeps its last maxEntries requests, counting the ones it dropped', () => {
  const log = createActionLog({ now: () => 1, maxEntries: 3 })
  for (let i = 0; i < 5; i++) log.record('base', { at: i, method: 'GET', path: `/p${i}`, status: 200 })
  log.record('pr', { at: 9, method: 'GET', path: '/q', status: 200 })
  const out = log.read(0)
  assert.deepEqual(out.requests.map(r => r.path), ['/p2', '/p3', '/p4', '/q'])
  assert.deepEqual(out.dropped, { base: 2, pr: 0 })
})

// A click and the submit it sets off, or a change on blur and the click
// that caused it, come within milliseconds: each kind has its own 100 ms.
test('marks are value-free, one of each kind per pane per 100 ms, and at most maxMarks a pane', () => {
  const c = clock()
  const log = createActionLog({ now: c.now, maxMarks: 4 })
  assert.deepEqual(MARK_TYPES, ['click', 'submit', 'change', 'enter'])
  assert.ok(log.mark('base', 'change'))
  c.tick(60)
  assert.ok(log.mark('base', 'click'), 'another kind, 60 ms later')
  c.tick(1)
  assert.ok(log.mark('base', 'submit'), 'and the submit the click set off')
  assert.equal(log.mark('base', 'submit'), null, 'the same kind within 100 ms')
  assert.ok(log.mark('pr', 'submit'), 'the other pane has its own')
  c.tick(100)
  assert.ok(log.mark('base', 'enter'))
  c.tick(100)
  assert.equal(log.mark('base', 'click'), null, 'over maxMarks for the base pane')
  assert.deepEqual(log.read(0).marksDropped, { base: 2, pr: 0 })
  assert.throws(() => log.mark('base', 'keyup'), /type must be one of click, submit, change, enter/)
  assert.throws(() => log.mark('both', 'click'), /pane must be base or pr/)
})

// PR code can post bridge messages: it can use up the PR pane's marks for a
// while, never the base pane's, and never for the rest of the session.
test('each pane\'s marks come from a budget that refills: using up the PR pane\'s leaves the base pane\'s alone, and lasts a while only', () => {
  const c = clock()
  const log = createActionLog({ now: c.now, maxMarks: 3, markRefillMs: 1_000 })
  assert.deepEqual(MARK_TYPES.map(type => log.mark('pr', type) !== null), [true, true, true, false])
  assert.ok(log.mark('base', 'click'), 'the base pane has its own')
  c.tick(999)
  assert.equal(log.mark('pr', 'click'), null, 'not quite one mark refilled')
  c.tick(1)
  assert.ok(log.mark('pr', 'click'), 'one refilled')
  assert.equal(log.mark('pr', 'submit'), null)
  c.tick(10_000)
  assert.deepEqual(MARK_TYPES.map(type => log.mark('pr', type) !== null), [true, true, true, false], 'never more than maxMarks at once')
  assert.deepEqual(log.read(0).marksDropped, { base: 0, pr: 4 })
  // the default: 2,000, and one more a second
  const d = clock()
  const dflt = createActionLog({ now: d.now })
  let made = 0
  for (let i = 0; i < 2_100; i++) { if (dflt.mark('pr', MARK_TYPES[i % 4])) made++; if (i % 4 === 3) d.tick(100) }
  assert.equal(made, 2_000 + Math.floor((2_100 / 4 - 1) * 100 / 1_000))
})

test('refusals count per pane by reason, and nothing else of them is kept', () => {
  const log = createActionLog({ now: () => 1 })
  log.refused('base', 'cross-site framing refused')
  log.refused('base', 'cross-site framing refused')
  log.refused('pr', 'capability')
  log.refused('pr', 'something the PR made up <img src=x>')
  assert.deepEqual(log.read(0).refused, { base: { 'cross-site framing refused': 2 }, pr: { capability: 1, other: 1 } })
})

// A request belongs to the mark nearest it in time among those that came no
// more than 300 ms after it started: the mark a click posts can arrive just
// after the request the click set off. Requests before any mark are the
// landing.
test('read groups each request under the mark it most likely came from, and returns what came after a sequence number', () => {
  const c = clock(0)
  const log = createActionLog({ now: c.now })
  log.record('base', { at: 0, method: 'GET', path: '/', status: 200 }) // landing
  c.tick(1_000)
  const click = log.mark('base', 'click') // at 1000
  log.record('base', { at: 800, method: 'POST', path: '/cart/clear', status: 303 }) // 200 ms before the mark: its
  log.record('pr', { at: 650, method: 'POST', path: '/cart/clear', status: 303 }) // 350 ms before: the landing's
  log.record('base', { at: 1_500, method: 'GET', path: '/cart', status: 200 })
  c.tick(2_000)
  const submit = log.mark('pr', 'submit') // at 3000
  log.record('pr', { at: 2_900, method: 'POST', path: '/checkout', status: 200 })
  const all = log.read(0)
  assert.deepEqual(all.requests.map(r => [r.path, r.pane, r.mark]), [
    ['/', 'base', null],
    ['/cart/clear', 'base', click.seq],
    ['/cart/clear', 'pr', null],
    ['/cart', 'base', click.seq],
    ['/checkout', 'pr', submit.seq],
  ])
  assert.deepEqual(all.marks.map(m => m.seq), [click.seq, submit.seq])
  assert.equal(all.seq, 7)
  // after a sequence number: only what came later, still grouped against every mark
  const later = log.read(click.seq)
  assert.deepEqual(later.requests.map(r => [r.path, r.mark]), [['/cart/clear', click.seq], ['/cart/clear', null], ['/cart', click.seq], ['/checkout', submit.seq]])
  assert.deepEqual(later.marks.map(m => m.seq), [submit.seq])
  for (const bad of [undefined, 'x', -1, 1.5]) assert.equal(log.read(bad).requests.length, 5, String(bad))
  // a request whose seq is `after` is not after it
  assert.equal(log.read(all.seq).requests.length, 0)
})

test('grouping: the nearest mark in the window, and the window\'s edge', () => {
  const c = clock(10_000)
  const log = createActionLog({ now: c.now })
  const a = log.mark('base', 'click') // at 10000
  log.record('base', { at: 10_050, method: 'POST', path: '/a', status: 200 })
  c.tick(250)
  log.mark('base', 'submit') // at 10250: in the window, but further away
  log.record('pr', { at: 9_700, method: 'GET', path: '/edge', status: 200 }) // exactly 300 ms before a
  log.record('pr', { at: 9_699, method: 'GET', path: '/before', status: 200 }) // 301 ms before
  log.record('pr', { at: 10_125, method: 'GET', path: '/tie', status: 200 }) // 125 ms from each
  const r = log.read(0).requests
  assert.deepEqual(r.map(x => [x.path, x.mark]), [['/a', a.seq], ['/edge', a.seq], ['/before', null], ['/tie', a.seq]], 'a tie goes to the mark it started under')
})

// Marks stay in time order, which grouping relies on: a clock that steps
// back is held at the last mark's time.
test('a mark is never earlier than the one before it', () => {
  const c = clock(1_000)
  const log = createActionLog({ now: c.now })
  log.mark('base', 'click')
  c.tick(-200)
  assert.equal(log.mark('pr', 'click').at, 1_000)
  c.tick(500)
  assert.equal(log.mark('pr', 'submit').at, 1_300)
})

// A request is numbered when it ends, but a mark up to 300 ms later can
// claim it: a later read gives it again, regrouped.
test('a read after a sequence number gives again the earlier requests a newer mark claims', () => {
  const c = clock(900)
  const log = createActionLog({ now: c.now })
  log.record('base', { at: 900, method: 'POST', path: '/save', status: 303 })
  log.record('base', { at: 100, method: 'GET', path: '/old', status: 200 })
  log.record('base', { at: 700, method: 'GET', path: '/edge', status: 200 })
  const first = log.read(0)
  assert.deepEqual(first.requests.map(r => [r.path, r.mark]), [['/save', null], ['/old', null], ['/edge', null]])
  c.tick(100)
  const click = log.mark('base', 'click') // at 1000
  const next = log.read(first.seq)
  assert.deepEqual(next.requests.map(r => [r.path, r.mark]), [['/save', click.seq], ['/edge', click.seq]], 'given again, regrouped; /old is too old to be')
  assert.deepEqual(next.marks.map(m => m.seq), [click.seq])
})

// One read is bounded: `limit` new requests at most, `more` saying there
// are others, and `seq` the cursor to read on from.
test('read takes at most `limit` new requests, and says where to go on from', () => {
  const log = createActionLog({ now: () => 1 })
  for (let i = 0; i < 5; i++) log.record('base', { at: i, method: 'GET', path: `/p${i}`, status: 200 })
  const page = log.read(0, { limit: 2 })
  assert.deepEqual([page.requests.map(r => r.path), page.more, page.seq], [['/p0', '/p1'], true, 2])
  const rest = log.read(page.seq, { limit: 10 })
  assert.deepEqual([rest.requests.map(r => r.path), rest.more, rest.seq], [['/p2', '/p3', '/p4'], false, 5])
  // the default and the most: 2,000
  for (let i = 0; i < 2_500; i++) log.record('pr', { at: 10, method: 'GET', path: '/x', status: 200 })
  assert.equal(log.read(0).requests.length, 2_000)
  assert.equal(log.read(0, { limit: 9_999 }).requests.length, 2_000)
})

// A page groups only against the marks up to its `seq`, so a request never
// names a mark the reader hasn't had; the next page gives that mark and the
// request again, regrouped.
test('a page never groups a request under a mark it does not give', () => {
  const c = clock(1_000)
  const log = createActionLog({ now: c.now })
  log.record('base', { at: 900, method: 'POST', path: '/a', status: 200 }) // seq 1
  log.record('base', { at: 950, method: 'POST', path: '/b', status: 200 }) // seq 2
  const click = log.mark('base', 'click') // seq 3, at 1000: claims both
  const page = log.read(0, { limit: 1 })
  assert.deepEqual([page.requests.map(r => [r.path, r.mark]), page.marks, page.seq], [[['/a', null]], [], 1])
  const rest = log.read(page.seq)
  assert.deepEqual(rest.marks.map(m => m.seq), [click.seq])
  assert.deepEqual(rest.requests.map(r => [r.path, r.mark]), [['/a', click.seq], ['/b', click.seq]])
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
  c.tick(990)
  const early = log.mark('base', 'change') // at 3000
  c.tick(200)
  log.mark('base', 'enter') // at 3200
  log.record('base', { at: 3_100, method: 'GET', path: '/between', status: 200 }) // 100 ms from each: the earlier
  assert.deepEqual(log.read(0).requests.map(r => [r.path, r.mark]), [
    ['/b', baseClick.seq], ['/p', prClick.seq], ['/mirrored', prLater.seq], ['/tie-own', baseClick.seq], ['/between', early.seq],
  ])
})

// Only a request whose mark changed comes again.
test('a new mark of the other pane leaves a request under its own pane\'s mark alone', () => {
  const c = clock(1_700)
  const log = createActionLog({ now: c.now })
  const own = log.mark('base', 'click') // at 1700
  log.record('base', { at: 1_800, method: 'GET', path: '/mine', status: 200 })
  log.record('pr', { at: 1_900, method: 'GET', path: '/theirs', status: 200 })
  const first = log.read(0)
  assert.deepEqual(first.requests.map(r => r.mark), [own.seq, own.seq])
  c.tick(300)
  const pr = log.mark('pr', 'submit') // at 2000
  assert.deepEqual(log.read(first.seq).requests.map(r => [r.path, r.mark]), [['/theirs', pr.seq]])
})

// The marks no request can belong to go, so a long session's refills don't
// pile up.
test('marks before every request in the rings, and before a minute ago, are let go but the last of them', () => {
  // past 4 × maxMarks (12) marks, a prune: at the 13th (130 s) and the 18th (180 s)
  const run = requestsAt => {
    const c = clock(0)
    const log = createActionLog({ now: c.now, maxEntries: 2, maxMarks: 3, markRefillMs: 1 })
    for (const at of requestsAt) log.record('base', { at, method: 'GET', path: '/x', status: 200 })
    for (let i = 0; i < 20; i++) { c.tick(10_000); log.mark('base', 'click') } // at 10 s ... 200 s
    return log.read(0)
  }
  const ats = from => Array.from({ length: (200_000 - from) / 10_000 + 1 }, (_, i) => from + i * 10_000)
  // the earliest request holds the 60 s mark, the last before its window
  const early = run([65_000, 66_000])
  assert.deepEqual(early.marks.map(m => m.at), ats(60_000))
  assert.deepEqual(early.requests.map(r => r.mark), [early.marks[0].seq, early.marks[0].seq])
  // later requests: a minute before the last prune (180 s) holds the 110 s mark
  const late = run([150_000, 151_000])
  assert.deepEqual(late.marks.map(m => m.at), ats(110_000))
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
  assert.equal(out.requests[0].mark, out.marks[1].seq)
})
