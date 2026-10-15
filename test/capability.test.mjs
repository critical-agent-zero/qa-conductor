// The per-browser capability store and its cookie helpers (lib/capability.mjs).
// Pure: an injected clock and random source, no I/O.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CAP_HEADER, ENTER_ROUTE, ENTER_TTL_MS, INVITE_TTL_MS, MAX_BROWSERS, REFUSAL_CAPABILITY,
  cookieValues, createCapability, paneCookie, paneCookieName,
} from '../lib/capability.mjs'
import { cookieNames, isReservedCookieName } from '../lib/net.mjs'

// A clock the test moves, and distinct random values.
function fakes() {
  let t = 1_000_000
  let n = 0
  return {
    now: () => t,
    tick: ms => { t += ms },
    random: () => `rnd${String(++n).padStart(20, '0')}`,
  }
}

test('the constants the conductor and its clients share', () => {
  assert.equal(CAP_HEADER, 'x-qa-cap')
  assert.equal(REFUSAL_CAPABILITY, 'capability')
  assert.equal(ENTER_ROUTE, '/__qa/enter')
  assert.equal(MAX_BROWSERS, 32)
  assert.equal(ENTER_TTL_MS, 60_000)
  assert.equal(INVITE_TTL_MS, 600_000)
})

test('real tokens are 32 random bytes, base64url, and never repeat', () => {
  const cap = createCapability()
  const tokens = new Set()
  for (let i = 0; i < 50; i++) {
    const token = cap.enrol()
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    tokens.add(token)
    tokens.add(cap.paneToken(token))
  }
  assert.equal(tokens.size, 100, 'harness and pane tokens are all distinct')
})

test('an enrolled browser\'s harness token is admitted; anything else is not', () => {
  const cap = createCapability(fakes())
  const token = cap.enrol()
  assert.ok(cap.browser(token))
  for (const bad of [undefined, null, '', 'x', `${token}x`, token.toUpperCase(), 42, [token], cap.paneToken(token)]) {
    assert.equal(cap.browser(bad), null, String(bad))
  }
})

test('a pane token is admitted on the panes only, and a harness token is not', () => {
  const cap = createCapability(fakes())
  const token = cap.enrol()
  const pane = cap.paneToken(token)
  assert.equal(cap.admitsPane(pane), true)
  for (const bad of [token, undefined, '', 'nope', `${pane} `]) assert.equal(cap.admitsPane(bad), false, String(bad))
  assert.equal(cap.paneToken('not a token'), null)
})

test('at most MAX_BROWSERS are enrolled: the least recently used is dropped, with its pane token', () => {
  const f = fakes()
  const cap = createCapability({ ...f, maxBrowsers: 3 })
  const [a, b, c] = [cap.enrol(), cap.enrol(), cap.enrol()]
  const paneA = cap.paneToken(a)
  const recordB = cap.browser(b) // at the time it enrolled: no newer
  f.tick(1)
  assert.ok(cap.browser(a), 'a is used, so b is now the oldest')
  assert.equal(cap.holds(recordB), true)
  const d = cap.enrol()
  assert.equal(cap.size(), 3)
  assert.equal(cap.holds(recordB), false, 'a record kept from before says it was dropped')
  assert.equal(cap.holds(null), false)
  assert.equal(cap.browser(b), null)
  for (const kept of [a, c, d]) assert.ok(cap.browser(kept))
  assert.equal(cap.admitsPane(paneA), true)
  f.tick(1)
  cap.browser(c)
  cap.browser(d)
  cap.enrol()
  assert.equal(cap.browser(a), null)
  assert.equal(cap.admitsPane(paneA), false, 'a dropped browser\'s pane cookie goes with it')
})

test('a pane-entry ticket is single use, bound to its role, and lasts ENTER_TTL_MS', () => {
  const f = fakes()
  const cap = createCapability(f)
  const token = cap.enrol()
  const record = cap.browser(token)
  const ticket = cap.enter(record, 'base', '/login?x=1')
  assert.deepEqual(cap.redeemEnter(ticket, 'base'), { to: '/login?x=1', paneToken: cap.paneToken(token) })
  assert.equal(cap.redeemEnter(ticket, 'base'), null, 'used')

  // presented to the other pane, it is spent too
  const other = cap.enter(record, 'base', '/')
  assert.equal(cap.redeemEnter(other, 'pr'), null)
  assert.equal(cap.redeemEnter(other, 'base'), null)

  const late = cap.enter(record, 'pr', '/')
  f.tick(ENTER_TTL_MS)
  assert.equal(cap.redeemEnter(late, 'pr'), null, 'expired')
  const inTime = cap.enter(record, 'pr', '/')
  f.tick(ENTER_TTL_MS - 1)
  assert.equal(cap.redeemEnter(inTime, 'pr').to, '/')

  for (const bad of [undefined, '', 'garbage', token, cap.paneToken(token)]) assert.equal(cap.redeemEnter(bad, 'base'), null, String(bad))
})

test('rotatePanes gives every browser a new pane token, and the old ones admit nothing; harness tokens and live tickets still work', () => {
  const cap = createCapability({ ...fakes(), maxBrowsers: 2 })
  const [a, b] = [cap.enrol(), cap.enrol()]
  const before = [cap.paneToken(a), cap.paneToken(b)]
  const ticket = cap.enter(cap.browser(a), 'base', '/x')
  cap.rotatePanes()
  const after = [cap.paneToken(a), cap.paneToken(b)]
  for (const old of before) assert.equal(cap.admitsPane(old), false, old)
  for (const fresh of after) assert.equal(cap.admitsPane(fresh), true, fresh)
  assert.equal(new Set([...before, ...after]).size, 4)
  for (const token of [a, b]) assert.ok(cap.browser(token))
  assert.deepEqual(cap.redeemEnter(ticket, 'base'), { to: '/x', paneToken: after[0] }, 'a ticket sets the pane token of now')
  // a browser dropped since takes its new pane token with it
  cap.browser(b)
  cap.enrol()
  assert.equal(cap.admitsPane(after[0]), false)
  assert.equal(cap.admitsPane(after[1]), true)
})

test('a ticket of a browser dropped since it was minted lets nobody in', () => {
  const cap = createCapability({ ...fakes(), maxBrowsers: 1 })
  const first = cap.enrol()
  const ticket = cap.enter(cap.browser(first), 'base', '/')
  cap.enrol()
  assert.equal(cap.redeemEnter(ticket, 'base'), null)
})

test('an invite enrols one more browser, once, within INVITE_TTL_MS; an enter ticket is no invite, nor the reverse', () => {
  const f = fakes()
  const cap = createCapability(f)
  const record = cap.browser(cap.enrol())
  const { ticket, expiresAt } = cap.invite(record)
  assert.equal(expiresAt, f.now() + INVITE_TTL_MS)
  const token = cap.redeemInvite(ticket)
  assert.ok(cap.browser(token))
  assert.equal(cap.size(), 2)
  assert.equal(cap.redeemInvite(ticket), null, 'used')

  const late = cap.invite(record).ticket
  f.tick(INVITE_TTL_MS)
  assert.equal(cap.redeemInvite(late), null, 'expired')

  const enter = cap.enter(record, 'base', '/')
  assert.equal(cap.redeemInvite(enter), null)
  const invite = cap.invite(record).ticket
  assert.equal(cap.redeemEnter(invite, 'base'), null)
})

test('outstanding tickets are capped, oldest dropped first', () => {
  const cap = createCapability({ ...fakes(), maxTickets: 2 })
  const record = cap.browser(cap.enrol())
  const t1 = cap.enter(record, 'base', '/1')
  const t2 = cap.enter(record, 'base', '/2')
  const t3 = cap.enter(record, 'base', '/3')
  assert.equal(cap.redeemEnter(t1, 'base'), null)
  assert.equal(cap.redeemEnter(t2, 'base').to, '/2')
  assert.equal(cap.redeemEnter(t3, 'base').to, '/3')
})

test('the pane cookie name: qa-<8 hex of the harness origin>, __Host- on an https pane', () => {
  const plain = paneCookieName('http://127.0.0.1:3100', 'http://127.0.0.1:3101')
  assert.match(plain, /^qa-[0-9a-f]{8}$/)
  assert.equal(paneCookieName('http://127.0.0.1:3100', 'http://127.0.0.1:3102'), plain, 'both panes share it')
  assert.notEqual(paneCookieName('http://127.0.0.1:3101', 'http://127.0.0.1:3103'), plain, 'a nested conductor has its own')
  assert.equal(paneCookieName('https://h.ts.net:8444', 'https://h.ts.net:8443'), `__Host-${paneCookieName('https://h.ts.net:8444', 'http://x')}`)
  assert.match(paneCookieName(null, 'http://127.0.0.1:1'), /^qa-[0-9a-f]{8}$/)
})

test('the pane Set-Cookie: HttpOnly, SameSite=Strict, Path=/, and Secure only on https', () => {
  assert.equal(paneCookie('qa-1', 'v', false), 'qa-1=v; Path=/; HttpOnly; SameSite=Strict')
  assert.equal(paneCookie('__Host-qa-1', 'v', true), '__Host-qa-1=v; Path=/; HttpOnly; SameSite=Strict; Secure')
})

test('cookieValues finds every value of one name, exactly', () => {
  assert.deepEqual(cookieValues('a=1; qa-x=2;qa-x=3 ; QA-X=4; qa-xy=5; qa-x', 'qa-x'), ['2', '3'])
  assert.deepEqual(cookieValues(undefined, 'qa-x'), [])
  assert.deepEqual(cookieValues('', 'qa-x'), [])
})

test('cookie names starting with qa- (any case, with or without a __Host- or __Secure- prefix) are reserved', () => {
  for (const name of ['qa-', 'qa-1', 'QA-session', '__Host-qa-1', '__host-QA-x', '__Secure-qa-1']) assert.equal(isReservedCookieName(name), true, name)
  for (const name of ['qa', 'qa_1', 'aqa-1', '__Host-session', 'locale', 'x-qa-1']) assert.equal(isReservedCookieName(name), false, name)
  assert.throws(() => cookieNames(['locale', 'qa-1'], 'opt'), /^Error: opt can't name "qa-1": cookie names starting with qa- are the conductor's own/)
  assert.deepEqual(cookieNames(['locale'], 'opt'), ['locale'])
})

// An expired ticket must not hold a slot: the cap would evict a live invite
// minted before it.
test('expired tickets are pruned before the cap evicts a live one', () => {
  const f = fakes()
  const cap = createCapability({ ...f, maxTickets: 2 })
  const record = cap.browser(cap.enrol())
  const { ticket: invite } = cap.invite()
  cap.enter(record, 'base', '/old')
  f.tick(ENTER_TTL_MS) // the enter ticket has expired; the invite has not
  const fresh = cap.enter(record, 'base', '/new')
  assert.ok(cap.redeemInvite(invite), 'the live invite outlived the expired ticket')
  assert.equal(cap.redeemEnter(fresh, 'base').to, '/new')
})
