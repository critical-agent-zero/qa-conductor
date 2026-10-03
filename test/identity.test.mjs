import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

import { identityGate, isAllowed, normalizeLogins, refusalReason } from '../lib/identity.mjs'

const ALLOWED = ['alice@github', 'Bob@HomeFree.local']
const as = login => ({ 'tailscale-user-login': login })

test('an allowed login is served, trimmed and ignoring case on both sides', () => {
  assert.equal(isAllowed(as('alice@github'), ALLOWED), true)
  assert.equal(isAllowed(as('  ALICE@github '), ALLOWED), true)
  assert.equal(isAllowed(as('bob@homefree.local'), ALLOWED), true)
  assert.equal(refusalReason(as('alice@github'), ALLOWED), null)
})

test('the header name is matched ignoring case', () => {
  assert.equal(isAllowed({ 'Tailscale-User-Login': 'alice@github' }, ALLOWED), true)
})

test('no identity is refused: tagged devices and anything that bypassed tailscale serve', () => {
  for (const headers of [{}, as('   '), undefined]) {
    assert.equal(isAllowed(headers, ALLOWED), false, JSON.stringify(headers))
    assert.match(refusalReason(headers, ALLOWED), /no Tailscale identity/)
  }
})

test('a login outside the list is refused, and the refusal names it', () => {
  assert.equal(isAllowed(as('mallory@github'), ALLOWED), false)
  assert.match(refusalReason(as('mallory@github'), ALLOWED), /mallory@github is not in QA_ALLOWED_LOGINS/)
})

test('only exact logins match: no prefixes, suffixes or lists', () => {
  for (const login of ['alice', 'alice@githubx', 'xalice@github', 'alice@github, mallory@github']) {
    assert.equal(isAllowed(as(login), ALLOWED), false, login)
  }
  assert.equal(isAllowed(as(['alice@github', 'alice@github']), ALLOWED), false)
})

test('an empty or missing allowlist refuses everyone (fail closed)', () => {
  for (const list of [[], [' ', ''], undefined, null]) {
    assert.equal(isAllowed(as('alice@github'), list), false, String(list))
    assert.notEqual(refusalReason(as('alice@github'), list), null, String(list))
  }
})

test('normalizeLogins trims, lowercases and drops blanks', () => {
  assert.deepEqual(normalizeLogins([' Alice@GitHub ', '', '  ', 'bob@homefree.local']), ['alice@github', 'bob@homefree.local'])
  assert.deepEqual(normalizeLogins(undefined), [])
})

// The handler wrapper, over a real loopback server.
async function serve(handler) {
  const server = http.createServer(identityGate(handler, ALLOWED))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return server
}

async function get(server, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { headers })
  return { status: res.status, headers: res.headers, body: await res.text() }
}

test('identityGate serves an allowed login and 403s the rest without calling the handler', async () => {
  let calls = 0
  const server = await serve((req, res) => { calls++; res.end('inner') })
  try {
    assert.deepEqual((await get(server, as('alice@github'))).body, 'inner')
    for (const headers of [{}, as('mallory@github')]) {
      const res = await get(server, headers)
      assert.equal(res.status, 403)
      assert.match(res.headers.get('content-type'), /^text\/plain/)
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(res.headers.get('cache-control'), 'no-store')
      assert.doesNotMatch(res.body, /inner/)
    }
    assert.match((await get(server, as('mallory@github'))).body, /^403: mallory@github is not in QA_ALLOWED_LOGINS/)
    assert.equal(calls, 1)
  } finally { server.close() }
})
