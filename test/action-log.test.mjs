// The session's action log (lib/action-log.mjs): what each pane's proxy
// forwarded, and the marks the harness posts for the actions mirrored
// between the panes. Value-free by construction: no header, cookie, body or
// query value ever enters it, and paths lose what looks like a token, an
// email address or a long number.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MARK_TYPES, createActionLog, sanitizeMethod, sanitizePath } from '../lib/action-log.mjs'

test('sanitizePath keeps the shape of a path and drops every value in it', () => {
  const cases = [
    ['/', '/'],
    ['/cart', '/cart'],
    ['/orders/42/items', '/orders/42/items'],
    // query values go, keys that look like names stay
    ['/search?q=hello&page=2', '/search?q=…&page=…'],
    ['/login?token=abc123&next=/x', '/login?token=…&next=…'],
    ['/x?a', '/x?a=…'],
    ['/x?', '/x'],
    ['/x?=v&&b=2', '/x?b=…'],
    // a key that is itself a value is masked too
    ['/x?eyJhbGciOiJIUzI1NiJ9=1', '/x?…=…'],
    ['/x?a%20b=1', '/x?…=…'],
    // segments that look like values
    ['/reset/9f86d081884c7d659a2feaa0c55ad015', '/reset/:token'],
    ['/invite/AbC123xYz789QwErTy00', '/invite/:token'],
    ['/users/jane.doe@example.org/edit', '/users/:email/edit'],
    ['/users/jane.doe%40example.org', '/users/:email'],
    ['/session/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', '/session/:token'],
    ['/phone/5551234567', '/phone/:number'],
    ['/2026/10/15/post', '/2026/10/15/post'],
    ['/products/widget-classic', '/products/widget-classic'],
    // a fragment never reaches a server, but nothing of it is kept either
    ['/a#secret', '/a'],
  ]
  for (const [url, want] of cases) assert.equal(sanitizePath(url), want, url)
  // at most 200 characters
  const long = sanitizePath(`/${'x'.repeat(500)}`)
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

test('marks are value-free, one per pane per 100 ms, and at most maxMarks a session', () => {
  const c = clock()
  const log = createActionLog({ now: c.now, maxMarks: 3 })
  assert.deepEqual(MARK_TYPES, ['click', 'submit', 'change', 'enter'])
  assert.ok(log.mark('base', 'click'))
  assert.equal(log.mark('base', 'submit'), null, 'within 100 ms of the last')
  assert.ok(log.mark('pr', 'submit'), 'the other pane has its own gap')
  c.tick(100)
  assert.ok(log.mark('base', 'enter'))
  c.tick(100)
  assert.equal(log.mark('base', 'change'), null, 'over maxMarks')
  assert.equal(log.read(0).marksDropped, 2)
  assert.throws(() => log.mark('base', 'keyup'), /type must be one of click, submit, change, enter/)
  assert.throws(() => log.mark('both', 'click'), /pane must be base or pr/)
})

test('refusals count per pane by reason, and nothing else of them is kept', () => {
  const log = createActionLog({ now: () => 1 })
  log.refused('base', 'cross-site framing refused')
  log.refused('base', 'cross-site framing refused')
  log.refused('pr', 'capability')
  log.refused('pr', 'something the PR made up <img src=x>')
  assert.deepEqual(log.read(0).refused, { base: { 'cross-site framing refused': 2 }, pr: { capability: 1, other: 1 } })
})

// A request belongs to the latest mark that came no more than 300 ms after
// it started: the mark a click posts can arrive just after the request the
// click set off. Requests before any mark are the landing.
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
})
