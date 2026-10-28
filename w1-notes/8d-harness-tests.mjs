
// --- #8: the Data and Actions panels ----------------------------------------------
// What they show comes from the panes, which PR code controls: built as plain
// nodes, drawn with textContent only.

// Every text a node tree holds, depth first.
const textsOf = nodes => nodes.flatMap(n => [...(n.text === undefined ? [] : [String(n.text)]), ...(n.title ? [n.title] : []), ...textsOf(n.children || [])])
const actsOf = nodes => nodes.flatMap(n => [...(n.act ? [n.act] : []), ...actsOf(n.children || [])])
const HOSTILE = '<img src=x onerror=alert(1)>'

test('cellText: a value as text; a secret only as one; personal data as its fingerprint', () => {
  assert.equal(cellText(null), 'null')
  assert.equal(cellText(undefined), 'null')
  assert.equal(cellText('a "b"'), '"a \\"b\\""')
  assert.equal(cellText(3), '3')
  assert.equal(cellText(false), 'false')
  assert.equal(cellText({ t: 'json', s: '{"a":1}' }), '{"a":1}')
  assert.equal(cellText({ t: 'long', s: 'abc', len: 900, d: 'x' }), 'abc… (900 characters)')
  assert.equal(cellText({ t: 'blob', len: 9, d: 'x' }), '(9 bytes)')
  assert.equal(cellText({ t: 'secret', d: '0123456789abcdef' }), '(secret)')
  assert.equal(cellText({ t: 'pii', fp: 'deadbeef', type: 'string', len: 16 }), '(personal data deadbeef, string, 16)')
  for (const odd of [{ t: 'other' }, {}, Symbol('x'), () => 1]) assert.equal(cellText(odd), '?')
})

test('trustLabel: trusted only when the session is isolated, else advisory, which warns', () => {
  assert.deepEqual([trustLabel('trusted').text, trustLabel('trusted').warn], ['trusted', false])
  for (const t of ['advisory', undefined, 'TRUSTED', null]) assert.deepEqual([trustLabel(t).text, trustLabel(t).warn], ['advisory', true], String(t))
  assert.match(trustLabel('advisory').title, /excuses nothing/)
})

test('flagText and dataBadge: the badge counts the red flags the base didn\'t share, both spans', () => {
  assert.equal(flagText({ collection: 'saved_carts', kind: 'delete', severity: 'red', pr: 3, base: 0 }), 'saved_carts: rows deleted, PR 3, base 0')
  assert.equal(flagText({ collection: 'users', kind: 'cleared', severity: 'amber', pr: 1, base: 0, field: 'email' }), 'users: value cleared (email), PR 1, base 0')
  assert.equal(flagText({ collection: 'c', kind: 'constructor', pr: 1, base: 0 }), 'c: constructor, PR 1, base 0')
  const flags = [
    { collection: 'a', kind: 'delete', severity: 'red', pr: 1, base: 0 },
    { collection: 'a', kind: 'emptied', severity: 'red', pr: 1, base: 1 }, // advisory: red, but the base did it too
    { collection: 'b', kind: 'cleared', severity: 'amber', pr: 1, base: 0 },
  ]
  assert.equal(dataBadge({ active: true, boot: { flags }, session: { flags: [flags[0]] } }), 2)
  assert.equal(dataBadge({ active: true, boot: null, session: null }), 0)
  for (const none of [null, undefined, { available: false }, { available: true, active: false }]) assert.equal(dataBadge(none), 0)
})

const DIFF = (collections) => ({ collections })
const coll = (extra = {}) => ({ status: 'changed', key: ['id'], inserted: [], updated: [], deleted: [], fieldsDropped: [], fieldsAdded: [], countBefore: 3, countAfter: 0, truncated: false, ...extra })
function sampleData(extra = {}) {
  const name = `saved_carts${HOSTILE}`
  const pr = DIFF({
    [name]: coll({
      deleted: [{ key: '[1]', row: { id: 1, owner: { t: 'pii', fp: 'cafe0123', type: 'string', len: 15 }, note: HOSTILE, token: { t: 'secret', d: 'f'.repeat(16) } } }],
      updated: [{ key: '[2]', fields: [{ field: 'token', before: { t: 'secret', d: 'a'.repeat(16) }, after: { t: 'secret', d: 'b'.repeat(16) } }, { field: 'n', before: 1, after: 2 }] }],
    }),
  })
  const base = DIFF({ [name]: coll({ status: 'same', countAfter: 3 }) })
  const divergence = DIFF({
    [name]: {
      status: 'pr-only', truncated: false,
      counts: { base: { inserted: 0, updated: 0, deleted: 0 }, pr: { inserted: 0, updated: 1, deleted: 1 } },
      changes: [{ kind: 'delete', key: '[1]', status: 'pr-only', base: null, pr: null }, { kind: 'update', key: '[2]', status: 'pr-only', base: null, pr: [{ field: 'n', before: 1, after: 2 }] }],
    },
  })
  const flags = [{ collection: name, kind: 'delete', severity: 'red', pr: 1, base: 0 }]
  return {
    available: true, active: true, trust: 'advisory', baselineAt: 1, rebaselined: false, comparedAt: 2,
    errors: { base: `no route to db ${HOSTILE}`, pr: null }, problems: { base: [], pr: [`odd${HOSTILE}: rows must be an array`] },
    boot: null, session: { base, pr, divergence, flags }, ...extra,
  }
}

test('dataNodes: the trust chip, Snapshot now and Re-baseline, the span and view toggles, errors, flags and the collections', () => {
  const ui = { span: 'session', view: 'divergence', open: null }
  const nodes = dataNodes(sampleData(), ui)
  const texts = textsOf(nodes)
  assert.ok(texts.includes('advisory'))
  assert.ok(texts.includes(trustLabel('advisory').title))
  assert.ok(texts.includes(`BASE: no route to db ${HOSTILE}`))
  assert.ok(texts.includes(`PR: odd${HOSTILE}: rows must be an array`))
  assert.ok(texts.includes(`saved_carts${HOSTILE}: rows deleted, PR 1, base 0`))
  assert.ok(texts.includes('PR only'))
  assert.deepEqual(actsOf(nodes), ['snapshot', 'rebaseline', 'span:session', 'span:boot', 'view:divergence', 'view:base', 'view:pr', 'open:0'])
  // a collection opened: its changes, by key
  const open = textsOf(dataNodes(sampleData(), { ...ui, open: 0 }))
  assert.ok(open.includes('delete [1]: PR only · base — · PR —'))
  assert.ok(open.includes('update [2]: PR only · base — · PR n: 1 → 2'))
  // the PR pane's own view: rows, a secret only as changed, personal data as a fingerprint
  const pr = textsOf(dataNodes(sampleData(), { span: 'session', view: 'pr', open: 0 }))
  assert.ok(pr.includes(`[1]: id: 1, owner: (personal data cafe0123, string, 15), note: ${JSON.stringify(HOSTILE)}, token: (secret)`))
  assert.ok(pr.includes('[2]: token: (secret, changed), n: 1 → 2'))
  assert.equal(pr.some(t => t.includes('ffffffff') || t.includes('aaaaaaaa')), false, 'no digest shows')
  // trusted, and nothing to compare yet
  assert.ok(textsOf(dataNodes(sampleData({ trust: 'trusted', session: null }), ui)).includes('Nothing to compare yet: take a snapshot with Snapshot now.'))
  assert.ok(textsOf(dataNodes(sampleData(), { ...ui, span: 'boot' })).includes('No boot span: a pane has no seeded or ready snapshot.'))
  assert.deepEqual(textsOf(dataNodes({ available: false }, ui)), ['There is no inspector, so there are no data checks.'])
  assert.deepEqual(textsOf(dataNodes({ available: true, active: false }, ui)), ['No session is ready.'])
})

test('dataNodes shows at most 50 rows a list, and says how many more', () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ key: `[${i}]`, row: { id: i } }))
  const data = sampleData({ session: { base: DIFF({ c: coll({ deleted: rows }) }), pr: DIFF({ c: coll() }), divergence: DIFF({}), flags: [] } })
  const texts = textsOf(dataNodes(data, { span: 'session', view: 'base', open: 0 }))
  assert.equal(texts.filter(t => /^\[\d+\]: id: \d+$/.test(t)).length, 50)
  assert.ok(texts.includes('and 20 more'))
})

const answer = (extra = {}) => ({
  active: true, log: 'log-a', seq: 0, more: false, resync: false, marks: [], requests: [],
  dropped: { base: 0, pr: 0 }, refused: { base: {}, pr: {} }, marksDropped: { base: 0, pr: 0 }, ...extra,
})
const req = (seq, pane, path, mark = null) => ({ seq, pane, at: 1_000 + seq, method: 'GET', path, status: 200, ms: 5, bytes: 10, aborted: false, mark })

test('mergeActions reads on from its cursor, replaces a request given again, and starts over for another log, resync, or no session', () => {
  let s = mergeActions(actionsFresh(), answer({ seq: 3, marks: [{ seq: 2, pane: 'base', at: 1_002, type: 'click' }], requests: [req(1, 'base', '/'), req(3, 'pr', '/x')] }))
  assert.deepEqual([s.log, s.seq, s.requests.size, s.marks.size, s.again], ['log-a', 3, 2, 1, false])
  s = mergeActions(s, answer({ seq: 4, requests: [req(3, 'pr', '/x', 2), req(4, 'base', '/y', 2)] }))
  assert.deepEqual([s.seq, s.requests.get(3).mark, s.requests.size], [4, 2, 3], 'regrouped in place')
  for (const other of [answer({ log: 'log-b', seq: 9 }), answer({ resync: true })]) {
    const again = mergeActions(s, other)
    assert.deepEqual([again.again, again.seq, again.log, again.requests.size], [true, 0, null, 0])
  }
  for (const gone of [answer({ active: false }), null]) {
    const none = mergeActions(s, gone)
    assert.deepEqual([none.active, none.again, none.seq, none.requests.size], [false, false, 0, 0])
  }
  // a first read takes whatever log it finds
  assert.equal(mergeActions(actionsFresh(), answer({ log: 'log-z' })).log, 'log-z')
  // what it keeps is bounded: the newest requests stay
  const many = Array.from({ length: 4_100 }, (_, i) => req(i + 1, 'base', '/p'))
  const kept = mergeActions(actionsFresh(), answer({ seq: 4_100, requests: many }))
  assert.deepEqual([kept.requests.size, Math.min(...kept.requests.keys())], [4_000, 101])
})

test('actionsNodes: the landing, then each action with the requests it set off, and the counts', () => {
  const s = mergeActions(actionsFresh(), answer({
    seq: 6,
    marks: [{ seq: 2, pane: 'pr', at: Date.UTC(2026, 9, 15, 12, 0, 0), type: 'submit' }],
    requests: [req(1, 'base', '/'), req(3, 'pr', `/x/${HOSTILE}`, 2), { ...req(4, 'base', '/slow', 2), status: 0, aborted: true }, req(6, 'base', '/later', 5)],
    dropped: { base: 1, pr: 0 }, refused: { base: { capability: 2 }, pr: {} }, marksDropped: { base: 0, pr: 3 },
  }))
  const texts = textsOf(actionsNodes(s))
  assert.equal(texts[0], 'Landing, before any action')
  assert.equal(texts[1], 'BASE GET / 200 5 ms')
  assert.match(texts[2], /^\d\d:\d\d:\d\d submit, reported by the PR pane$/)
  assert.equal(texts[3], `PR GET /x/${HOSTILE} 200 5 ms`)
  assert.equal(texts[4], 'BASE GET /slow — 5 ms (aborted)')
  assert.equal(texts[5], 'an earlier action', 'a mark no longer kept')
  assert.equal(texts.at(-1), 'dropped: BASE 1, PR 0 · refused: BASE capability 2; PR none · marks dropped: BASE 0, PR 3')
  assert.deepEqual(textsOf(actionsNodes(actionsFresh())), ['No session is ready.'])
  assert.deepEqual(textsOf(actionsNodes(mergeActions(actionsFresh(), answer()))).slice(0, 1), ['Nothing yet: the panes\' requests show here.'])
  // at most 100 actions, the newest
  const marks = Array.from({ length: 120 }, (_, i) => ({ seq: i + 1, pane: 'base', at: i, type: 'click' }))
  const busy = textsOf(actionsNodes(mergeActions(actionsFresh(), answer({ seq: 120, marks, requests: [req(200, 'base', '/')] }))))
  assert.equal(busy[0], '20 earlier actions not shown')
  assert.equal(busy.includes('Landing, before any action'), false, 'the landing is earlier still')
})

// The page draws the nodes with textContent, never markup: a hostile name
// reaches the DOM only as text.
test('the panels draw with textContent only: no innerHTML in their code, and a hostile name lands as text', async () => {
  const start = harnessSrc.indexOf('// --- #8: the Data and Actions panels ---------------------------------------')
  const end = harnessSrc.indexOf('function startDotPoll()')
  const panels = harnessSrc.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.doesNotMatch(panels, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bsrc\s*=|\bhref\s*=/)
  const pure = harnessSrc.slice(harnessSrc.indexOf('// --- #8: the Data and Actions panels -------------------------------------'), harnessSrc.indexOf('// The ticket an invite link carries'))
  assert.doesNotMatch(pure, /innerHTML|outerHTML|insertAdjacentHTML|document\./)

  const data = sampleData()
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES, data: { available: true } } },
      'POST /qa/api/pane-entry': entryRoute,
      'GET /qa/api/data': { body: data },
    },
  })
  await b.settle()
  const sets = b.log.filter(e => e[0] === 'set')
  const hostile = sets.filter(e => String(e[3]).includes(HOSTILE))
  assert.ok(hostile.length > 0, 'the data was drawn')
  for (const [, , prop] of hostile) assert.equal(prop, 'textContent')
  assert.equal(b.log.some(e => e[0] === 'set' && /HTML/.test(String(e[2])) && String(e[3]).includes('saved_carts')), false)
})

test('the Data panel: shown with an inspector, read as the session mounts, and Snapshot now and Re-baseline post', async () => {
  const data = sampleData()
  const posts = []
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES, data: { available: true } } },
      'POST /qa/api/pane-entry': entryRoute,
      'GET /qa/api/data': { body: data },
      'POST /qa/api/data/snapshot': body => { posts.push(body); return { body: { ...data, comparedAt: 3 } } },
    },
  })
  await b.settle()
  assert.ok(b.log.some(e => e[0] === 'fetch' && e[2] === '/qa/api/data'), 'read for the badge')
  assert.ok(b.log.some(e => e[0] === 'set' && e[1] === 'dataBtn' && e[2] === 'hidden' && e[3] === false))
  assert.ok(b.log.some(e => e[0] === 'set' && e[1] === 'dataBadge' && e[2] === 'textContent' && e[3] === '1'))
  const [, , onClick] = b.listeners.find(([name, type]) => name === 'dataBody' && type === 'click')
  const click = act => onClick({ target: { closest: () => ({ dataset: { act } }) } })
  click('snapshot')
  await b.settle()
  click('rebaseline')
  await b.settle()
  assert.deepEqual(posts, [{ rebaseline: false }, { rebaseline: true }])
  // no inspector: no Data button, and nothing read
  const none = fakeBrowser({
    hash: '#/pr/7', stored: 'tok-1',
    routes: { 'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES, data: { available: false } } }, 'POST /qa/api/pane-entry': entryRoute },
  })
  await none.settle()
  assert.ok(none.log.some(e => e[0] === 'set' && e[1] === 'dataBtn' && e[2] === 'hidden' && e[3] === true))
  assert.equal(none.log.some(e => e[0] === 'fetch' && e[2] === '/qa/api/data'), false)
})

test('the Actions panel reads on from its cursor while open, and from 0 again for another log or resync', async () => {
  const reads = []
  let next = [answer({ seq: 2, requests: [req(1, 'base', '/'), req(2, 'pr', '/')] })]
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES } },
      'POST /qa/api/pane-entry': entryRoute,
      'GET /qa/api/actions': () => ({ body: next.shift() ?? answer({ seq: 2 }) }),
    },
  })
  await b.settle()
  assert.equal(b.log.some(e => e[0] === 'fetch' && e[2] === '/qa/api/actions'), false, 'not read while closed')
  b.byId('actionsBtn').onclick()
  await b.settle()
  const poll = b.intervals.find(i => i.ms === 2000)
  assert.ok(poll, 'polled while open')
  // another session's log: start over from 0 at once
  next = [answer({ log: 'log-b', seq: 5 }), answer({ log: 'log-b', seq: 1, requests: [req(1, 'base', '/fresh')] })]
  poll.fn()
  await b.settle()
  // resync: the same
  next = [answer({ log: 'log-b', resync: true }), answer({ log: 'log-b', seq: 1, requests: [req(1, 'base', '/fresh')] })]
  poll.fn()
  await b.settle()
  for (const e of b.log) if (e[0] === 'fetch' && e[2] === '/qa/api/actions') reads.push(e[5])
  assert.deepEqual(reads, ['after=0&limit=500', 'after=2&limit=500', 'after=0&limit=500', 'after=1&limit=500', 'after=0&limit=500'])
  // closed: no more polling
  b.byId('actionsBtn').onclick()
  assert.ok(b.log.some(e => e[0] === 'set' && e[1] === 'actionsPanel' && e[2] === 'hidden' && e[3] === true))
})
