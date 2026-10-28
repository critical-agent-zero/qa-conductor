// --- #8: the Data and Actions panels ----------------------------------------------
// What they show comes from the panes, which PR code controls: built as plain
// nodes, drawn with textContent only.

// Text as a reader sees it: the isolates (U+2068 … U+2069) that set PR code's
// text apart take no room.
const plain = s => String(s).replace(/[\u2068\u2069]/g, '')
// Every text a node tree holds, depth first: as a reader sees it, and as drawn.
const textsOf = nodes => nodes.flatMap(n => [...(n.text === undefined ? [] : [plain(n.text)]), ...(n.title ? [plain(n.title)] : []), ...textsOf(n.children || [])])
const rawTextsOf = nodes => nodes.flatMap(n => [...(n.text === undefined ? [] : [String(n.text)]), ...rawTextsOf(n.children || [])])
const actsOf = nodes => nodes.flatMap(n => [...(n.act ? [n.act] : []), ...actsOf(n.children || [])])
const HOSTILE = '<img src=x onerror=alert(1)>'
const NO_ERRORS = { boot: { base: null, pr: null }, session: { base: null, pr: null } }
// The real engine, for the cases that must hold for what it gives.
const engine = (rules = validateRules({})) => {
  const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
  return { rules, snap: collections => sanitizeSnapshot({ collections }, { masker, rules }) }
}

test('cellText: a value as text; a secret only as one; personal data as its fingerprint', () => {
  const c = v => plain(cellText(v))
  assert.equal(c(null), 'null')
  assert.equal(c(undefined), 'null')
  assert.equal(c('a "b"'), '"a \\"b\\""')
  assert.equal(c(3), '3')
  assert.equal(c(false), 'false')
  assert.equal(c({ t: 'json', s: '{"a":1}' }), '{"a":1}')
  assert.equal(c({ t: 'long', s: 'abc', len: 900, d: 'x' }), 'abc… (900 characters)')
  assert.equal(c({ t: 'blob', len: 9, d: 'x' }), '(9 bytes)')
  assert.equal(c({ t: 'secret', d: '0123456789abcdef' }), '(secret)')
  assert.equal(c({ t: 'pii', fp: 'deadbeef', type: 'string', len: 16 }), '(personal data deadbeef, string, 16)')
  for (const odd of [{ t: 'other' }, {}, Symbol('x'), () => 1]) assert.equal(c(odd), '?')
})

// A secret inside JSON, or text that shows a secret-looking key, keeps a
// digest in the engine (so a change shows), never on screen.
test('cellText shows no digest of a secret held in JSON or in text', () => {
  const { snap } = engine()
  const s = snap({ notes: { key: ['id'], fields: ['id', 'body', 'memo'], rows: [{ id: 1, body: { user: 'a', api_key: 'sk-1' }, memo: 'password: hunter2' }] } })
  const row = s.collections.notes.rows[0]
  const digests = JSON.stringify(row).match(/[0-9a-f]{8}(?=\])/g)
  assert.ok(digests && digests.length === 2, JSON.stringify(row))
  const shown = [plain(cellText(row.body)), plain(cellText(row.memo))]
  assert.deepEqual(shown, ['{"user":"a","api_key":"[secret]"}', '"[text with a secret-looking key, 17 characters]"'])
  for (const d of digests) assert.equal(shown.join(' ').includes(d), false)
  assert.equal(plain(cellText({ t: 'long', s: 'x [secret 0a1b2c3d]', len: 900, d: 'ff' })), 'x [secret]… (900 characters)')
})

// The review's case: a key part with a secret-looking name, or one
// classified pii, showed its masked cell as raw JSON.
test('a row\'s key shows each part as cellText does: a secret part only as a secret, a personal one as its fingerprint', () => {
  const { rules, snap } = engine(validateRules({ classify: [{ collection: 'members', fields: ['email'], as: 'pii' }] }))
  const at = (sessions, members) => snap({
    sessions: { key: ['session_id'], fields: ['session_id', 'n'], rows: sessions },
    members: { key: ['email'], fields: ['email', 'n'], rows: members },
  })
  const before = at([{ session_id: 'sess-0123456789', n: 1 }, { session_id: 'sess-9876543210', n: 1 }], [{ email: 'jane@example.org', n: 1 }, { email: 'li@example.org', n: 1 }])
  const after = at([{ session_id: 'sess-9876543210', n: 2 }], [{ email: 'li@example.org', n: 2 }])
  const pr = diffSnapshots(before, after)
  const data = { available: true, active: true, trust: 'trusted', errors: NO_ERRORS, problems: { base: [], pr: [] }, boot: null, session: { complete: true, base: pr, pr, divergence: divergence(pr, pr), flags: flagChanges(pr, pr, rules, { trusted: true }) } }
  const fp = before.collections.members.rows[0].email.fp
  for (const view of ['pr', 'divergence']) {
    for (const open of [0, 1]) {
      const texts = textsOf(dataNodes(data, { span: 'session', view, open }))
      const all = texts.join('\n')
      assert.doesNotMatch(all, /sess-|example\.org|"t":|"d":/, `${view} ${open}`)
      for (const cell of [before.collections.sessions.rows[0].session_id, before.collections.sessions.rows[1].session_id]) assert.equal(all.includes(cell.d), false)
    }
  }
  const shown = name => textsOf(dataNodes(data, { span: 'session', view: 'pr', open: ['members', 'sessions'].indexOf(name) }))
  assert.ok(shown('sessions').includes('[(secret)]: n: 1, session_id: (secret)'), shown('sessions').join('\n'))
  assert.ok(shown('sessions').includes('[(secret)]: n: 1 → 2'))
  assert.ok(shown('members').includes(`[(personal data ${fp}, string, 16)]: email: (personal data ${fp}, string, 16), n: 1`), shown('members').join('\n'))
})

test('trustLabel: trusted only when the session is isolated, else advisory, which warns', () => {
  assert.deepEqual([trustLabel('trusted').text, trustLabel('trusted').warn], ['trusted', false])
  for (const t of ['advisory', undefined, 'TRUSTED', null]) assert.deepEqual([trustLabel(t).text, trustLabel(t).warn], ['advisory', true], String(t))
  assert.match(trustLabel('advisory').title, /excuses nothing/)
})

test('flagText says the flag, and whether the base made the same change; dataBadge counts the red flags, both spans', () => {
  assert.equal(plain(flagText({ collection: 'saved_carts', kind: 'delete', severity: 'red', shared: false, pr: 3, base: 0 })), 'saved_carts: rows deleted, PR 3, base 0')
  assert.equal(plain(flagText({ collection: 'users', kind: 'cleared', severity: 'amber', shared: true, pr: 1, base: 1, field: 'email' })), 'users: value cleared (email), PR 1, base 1, the base\'s too')
  assert.equal(plain(flagText({ collection: 'c', kind: 'unverified', severity: 'red', pr: 1, base: 0 })), 'c: unverified (cut short), PR 1, base 0')
  assert.equal(plain(flagText({ collection: 'c', kind: 'constructor', pr: 1, base: 0 })), 'c: constructor, PR 1, base 0')
  const flags = [
    { collection: 'a', kind: 'delete', severity: 'red', shared: false, pr: 1, base: 0 },
    { collection: 'a', kind: 'emptied', severity: 'red', shared: true, pr: 1, base: 1 }, // advisory: the base's too, and still red
    { collection: 'b', kind: 'cleared', severity: 'amber', shared: true, pr: 1, base: 1 },
  ]
  assert.equal(dataBadge({ active: true, boot: { flags }, session: { flags: [flags[0]] } }), 3)
  assert.equal(dataBadge({ active: true, boot: null, session: null }), 0)
  for (const none of [null, undefined, { available: false }, { available: true, active: false }, { available: true, active: true, closed: true }]) assert.equal(dataBadge(none), 0)
})

// The review's cases, through the real engine: the base deletes one row and
// the PR another, or the PR more than the base. Neither is the base's
// change, so the badge counts it, trusted or not; it used to count neither.
test('the Data badge counts a PR delete of other rows than the base\'s, or of more rows, trusted or advisory', () => {
  const { rules, snap } = engine()
  const ids = Array.from({ length: 20 }, (_, i) => i + 1)
  const carts = (...gone) => snap({ carts: { key: ['id'], fields: ['id'], rows: ids.filter(id => !gone.includes(id)).map(id => ({ id })) } })
  const before = carts()
  const badge = (baseGone, prGone, trusted) => {
    const flags = flagChanges(diffSnapshots(before, carts(...baseGone)), diffSnapshots(before, carts(...prGone)), rules, { trusted })
    return [dataBadge({ active: true, boot: null, session: { flags } }), flags.filter(f => f.severity === 'red').map(f => f.kind)]
  }
  for (const trusted of [true, false]) {
    assert.deepEqual(badge([1], [2], trusted), [1, ['delete']], `the wrong row, trusted ${trusted}`)
    assert.deepEqual(badge([1], [1, 2, 3, 4], trusted), [1, ['delete']], `an over-delete, trusted ${trusted}`)
  }
  // the same change: amber when trusted, red when advisory
  assert.deepEqual(badge([1], [1], true), [0, []])
  assert.deepEqual(badge([1], [1], false), [1, ['delete']])
})

const DIFF = (collections) => ({ collections })
const coll = (extra = {}) => ({ status: 'changed', key: ['id'], inserted: [], updated: [], deleted: [], fieldsDropped: [], fieldsAdded: [], countBefore: 3, countAfter: 0, truncated: false, ...extra })
const counted = c => ({ ...c, counts: { inserted: c.inserted.length, updated: c.updated.length, deleted: c.deleted.length } })
function sampleData(extra = {}) {
  const name = `saved_carts${HOSTILE}`
  const pr = DIFF({
    [name]: counted(coll({
      deleted: [{ key: '[1]', row: { id: 1, owner: { t: 'pii', fp: 'cafe0123', type: 'string', len: 15 }, note: HOSTILE, token: { t: 'secret', d: 'f'.repeat(16) } } }],
      updated: [{ key: '[2]', fields: [{ field: 'token', before: { t: 'secret', d: 'a'.repeat(16) }, after: { t: 'secret', d: 'b'.repeat(16) } }, { field: 'n', before: 1, after: 2 }] }],
    })),
  })
  const base = DIFF({ [name]: counted(coll({ status: 'same', countAfter: 3 })) })
  const divergence = DIFF({
    [name]: {
      status: 'pr-only', truncated: false,
      counts: { base: { inserted: 0, updated: 0, deleted: 0 }, pr: { inserted: 0, updated: 1, deleted: 1 } },
      changes: [{ kind: 'delete', key: '[1]', status: 'pr-only', base: null, pr: null }, { kind: 'update', key: '[2]', status: 'pr-only', base: null, pr: [{ field: 'n', before: 1, after: 2 }] }],
      changesCount: 2,
    },
  })
  const flags = [{ collection: name, kind: 'delete', severity: 'red', shared: false, pr: 1, base: 0 }]
  return {
    available: true, active: true, trust: 'advisory', baselineAt: 1, rebaselined: false, comparedAt: 2,
    errors: { boot: { base: `no route to db ${HOSTILE}`, pr: null }, session: { base: null, pr: `busy ${HOSTILE}` } },
    problems: { base: [], pr: [`odd${HOSTILE}: rows must be an array`] },
    boot: null, session: { complete: true, base, pr, divergence, flags }, ...extra,
  }
}

test('dataNodes: the trust chip, Snapshot now and Re-baseline, the span and view toggles, errors, flags and the collections', () => {
  const ui = { span: 'session', view: 'divergence', open: null }
  const nodes = dataNodes(sampleData(), ui)
  const texts = textsOf(nodes)
  assert.ok(texts.includes('advisory'))
  assert.ok(texts.includes(trustLabel('advisory').title))
  assert.ok(texts.includes(`BASE, at boot: no route to db ${HOSTILE}`))
  assert.ok(texts.includes(`PR: busy ${HOSTILE}`))
  assert.ok(texts.includes(`PR: odd${HOSTILE}: rows must be an array`))
  assert.ok(texts.includes(`saved_carts${HOSTILE}: rows deleted, PR 1, base 0`))
  assert.ok(texts.includes('PR only'))
  assert.deepEqual(actsOf(nodes), ['snapshot', 'rebaseline', 'span:session', 'span:boot', 'view:divergence', 'view:base', 'view:pr', 'open:0'])
  // the boot span says only why a pane has no boot data
  const boot = textsOf(dataNodes(sampleData({ boot: sampleData().session }), { ...ui, span: 'boot' }))
  assert.ok(boot.includes(`BASE: no route to db ${HOSTILE}`))
  assert.equal(boot.some(t => t.startsWith('PR: busy')), false)
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
  assert.ok(textsOf(dataNodes(sampleData(), { ...ui, span: 'boot' })).includes('No boot span: neither pane has a seeded and a ready snapshot.'))
  assert.deepEqual(textsOf(dataNodes({ available: false }, ui)), ['There is no inspector, so there are no data checks.'])
  assert.deepEqual(textsOf(dataNodes({ available: true, active: false }, ui)), ['No session is ready.'])
  assert.deepEqual(textsOf(dataNodes({ available: true, active: true, closed: true }, ui)), ['The session ended.'])
})

// Before the first answer, or when it failed, the panel says so rather than
// that there is no inspector; a span with a pane missing says it is
// incomplete, and why it has no divergence.
test('dataNodes: reading, a failed read, and a span with a pane missing', () => {
  const ui = { span: 'session', view: 'divergence', open: null }
  assert.deepEqual(textsOf(dataNodes(null, ui)), ['Reading the data checks…'])
  assert.deepEqual(textsOf(dataNodes(null, ui, true)), ['The data checks couldn\'t be read yet.'])
  const half = sampleData()
  half.session = { ...half.session, complete: false, base: null, divergence: null }
  const texts = textsOf(dataNodes(half, ui))
  assert.ok(texts.includes('Incomplete: the BASE pane has no data for this span, so nothing it did can excuse a change.'))
  assert.ok(texts.includes('No divergence: it needs both panes\' data, and the BASE pane has none for this span.'))
  assert.ok(texts.includes(`saved_carts${HOSTILE}: rows deleted, PR 1, base 0`), 'its flags still show')
  assert.ok(textsOf(dataNodes(half, { ...ui, view: 'base' })).includes('The BASE pane has no data for this span.'))
})

test('dataNodes shows at most 50 rows a list, and says how many more there are in all', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ key: `[${i}]`, row: { id: i } }))
  const c = { ...coll({ deleted: rows }), counts: { inserted: 0, updated: 0, deleted: 120 } }
  const data = sampleData({ session: { complete: true, base: DIFF({ c }), pr: DIFF({ c: counted(coll()) }), divergence: DIFF({}), flags: [] } })
  const texts = textsOf(dataNodes(data, { span: 'session', view: 'base', open: 0 }))
  assert.equal(texts.filter(t => /^\[\d+\]: id: \d+$/.test(t)).length, 50)
  assert.ok(texts.includes('and 70 more'))
  assert.ok(texts.includes('+0 ~0 −120'), 'the whole count')
  // divergence: its whole count of changes
  const changes = Array.from({ length: 50 }, (_, i) => ({ kind: 'delete', key: `[${i}]`, status: 'pr-only', base: null, pr: null }))
  const div = DIFF({ c: { status: 'pr-only', truncated: false, counts: { base: c.counts, pr: c.counts }, changes, changesCount: 75 } })
  const d = textsOf(dataNodes(sampleData({ session: { complete: true, base: DIFF({ c }), pr: DIFF({ c }), divergence: div, flags: [] } }), { span: 'session', view: 'divergence', open: 0 }))
  assert.ok(d.includes('and 25 more'))
})

// The review measured 0.8 s a click with 5,000 collections: at most 300
// collections and 100 flags are drawn, the red flags first.
test('the Data panel draws at most 300 collections and 100 flags, red first, and says how many more', () => {
  const names = Array.from({ length: 1_000 }, (_, i) => `c${String(i).padStart(4, '0')}`)
  const pane = DIFF(Object.fromEntries(names.map(n => [n, counted(coll())])))
  const amber = names.slice(0, 150).map(n => ({ collection: n, kind: 'cleared', severity: 'amber', shared: true, pr: 1, base: 1, field: 'f' }))
  const red = names.slice(500, 520).map(n => ({ collection: n, kind: 'delete', severity: 'red', shared: false, pr: 3, base: 0 }))
  const data = sampleData({ session: { complete: true, base: pane, pr: pane, divergence: null, flags: [...amber, ...red] } })
  const nodes = dataNodes(data, { span: 'session', view: 'pr', open: 299 })
  assert.equal(actsOf(nodes).filter(a => a.startsWith('open:')).length, 300)
  const texts = textsOf(nodes)
  assert.ok(texts.includes('and 700 more collections'))
  assert.ok(texts.includes('c0299'), 'the last one drawn opens')
  const list = nodes.find(n => n.cls === 'flags').children
  assert.equal(list.length, 101)
  assert.deepEqual(list.slice(0, 20).map(n => n.cls), Array(20).fill('flag red'))
  assert.equal(list[20].cls, 'flag amber')
  assert.equal(plain(list[100].text), 'and 70 more flags')
})

// The review's cases: a bidi override in a collection name reversed the
// flag's text, and a newline in a field name drew a forged row line.
test('text PR code controls can\'t reorder or break what the panels draw: each control shows as its code, each name set apart', () => {
  const name = 'carts\u202Egnp.exe'
  const field = 'owner\n[7]: id: 7, owner: forged'
  const data = sampleData({
    errors: { boot: { base: 'no\u200Broute', pr: null }, session: NO_ERRORS.session },
    session: {
      complete: true,
      base: DIFF({ [name]: counted(coll({ fieldsDropped: [field] })) }),
      pr: DIFF({ [name]: counted(coll({ deleted: [{ key: JSON.stringify(['k\u2069\u202E']), row: { [field]: 'v\u2066x' } }], updated: [{ key: '[2]', fields: [{ field, before: 1, after: 2 }] }] })) }),
      divergence: DIFF({ [name]: { status: 'pr-only', truncated: false, counts: { base: {}, pr: {} }, changes: [{ kind: 'column-drop', key: null, field, status: 'pr-only' }], changesCount: 1 } }),
      flags: [{ collection: name, kind: 'delete', severity: 'red', shared: false, pr: 1, base: 0, field }],
    },
  })
  const raws = []
  for (const view of ['divergence', 'base', 'pr']) raws.push(...rawTextsOf(dataNodes(data, { span: 'session', view, open: 0 })))
  const actions = mergeActions(actionsFresh(), answer({ seq: 2, requests: [req(1, 'base', `/x\u202E/y\n`)], marks: [], refused: { base: { 'other\u0007': 1 }, pr: {} } }))
  raws.push(...rawTextsOf(actionsNodes(actions)))
  for (const t of raws) {
    assert.doesNotMatch(t.replace(/[\u2068\u2069]/g, ''), /[\p{Cc}\p{Cf}]/u, JSON.stringify(t))
    let depth = 0
    for (const ch of t) {
      if (ch === '\u2068') depth++
      if (ch === '\u2069') { depth--; assert.ok(depth >= 0, JSON.stringify(t)) }
    }
    assert.equal(depth, 0, JSON.stringify(t))
  }
  const texts = raws.map(plain)
  assert.ok(raws.includes(`\u2068carts\\u{202E}gnp.exe\u2069: rows deleted (\u2068owner\\u{A}[7]: id: 7, owner: forged\u2069), PR 1, base 0`), 'the name and the field set apart, the controls as codes')
  assert.ok(texts.includes('BASE, at boot: no\\u{200B}route'))
  assert.ok(texts.some(t => t.startsWith('["k\\u{2069}\\u{202E}"]: ')), texts.join('\n'))
  assert.ok(texts.includes('BASE GET /x\\u{202E}/y\\u{A} 200 5 ms'))
  // what the page draws any other way gets the same, but for the isolates
  assert.equal(drawnText('a\u202Eb\nc\u2068d\u2069'), 'a\\u{202E}b\\u{A}c\u2068d\u2069')
})

const answer = (extra = {}) => ({
  active: true, log: 'log-a', seq: 0, more: false, marks: [], requests: [],
  dropped: { base: 0, pr: 0 }, refused: { base: {}, pr: {} }, marksDropped: { base: 0, pr: 0 }, ...extra,
})
const req = (seq, pane, path, at = 1_000 + seq) => ({ seq, pane, at, method: 'GET', path, status: 200, ms: 5, bytes: 10, aborted: false })
const mark = (seq, pane, at, type = 'click') => ({ seq, pane, at, type })

test('mergeActions reads on from its cursor, replaces an item given again, and starts over for another log, or no session', () => {
  let s = mergeActions(actionsFresh(), answer({ seq: 3, marks: [mark(2, 'base', 1_002)], requests: [req(1, 'base', '/'), req(3, 'pr', '/x')] }))
  assert.deepEqual([s.log, s.seq, s.requests.size, s.marks.size, s.again], ['log-a', 3, 2, 1, false])
  s = mergeActions(s, answer({ seq: 4, requests: [req(3, 'pr', '/x2'), req(4, 'base', '/y')] }))
  assert.deepEqual([s.seq, s.requests.get(3).path, s.requests.size], [4, '/x2', 3])
  const again = mergeActions(s, answer({ log: 'log-b', seq: 9 }))
  assert.deepEqual([again.again, again.seq, again.log, again.requests.size], [true, 0, null, 0])
  for (const gone of [answer({ active: false, log: null }), null]) {
    const none = mergeActions(s, gone)
    assert.deepEqual([none.active, none.again, none.seq, none.requests.size], [false, false, 0, 0])
  }
  // a first read takes whatever log it finds
  assert.equal(mergeActions(actionsFresh(), answer({ log: 'log-z' })).log, 'log-z')
  // what it keeps is bounded: the newest stay
  const many = Array.from({ length: 4_100 }, (_, i) => req(i + 1, 'base', '/p'))
  const kept = mergeActions(actionsFresh(), answer({ seq: 4_100, requests: many }))
  assert.deepEqual([kept.requests.size, Math.min(...kept.requests.keys())], [4_000, 101])
  const marks = Array.from({ length: 2_100 }, (_, i) => mark(i + 1, 'base', i))
  assert.equal(mergeActions(actionsFresh(), answer({ seq: 2_100, marks })).marks.size, 2_000)
})

// README's GET /api/actions: a request most likely came from, of the marks no
// more than 300 ms after it started, its own pane's nearest within 300 ms
// either side, else the nearest; the earlier (then the lower seq) on a tie;
// none when no mark is that early (the landing).
test('markOf groups a request by README\'s rule: its own pane, the window after it, ties, and the landing', () => {
  const r = (pane, at) => ({ pane, at })
  // the landing
  assert.equal(markOf(r('base', 1_000), []), null)
  assert.equal(markOf(r('base', 1_000), [mark(1, 'base', 1_301)]), null, 'more than 300 ms after: not its')
  assert.equal(markOf(r('base', 1_000), [mark(1, 'base', 1_300)]), 1, '300 ms after: its')
  // its own pane's nearest within 300 ms, over another pane's nearer one, before or after
  assert.equal(markOf(r('base', 1_000), [mark(1, 'base', 700), mark(2, 'pr', 990)]), 1)
  assert.equal(markOf(r('base', 1_000), [mark(1, 'pr', 999), mark(2, 'base', 1_250)]), 2)
  // none of its own within 300 ms: the nearest of any pane, before or after
  assert.equal(markOf(r('base', 1_000), [mark(1, 'base', 699), mark(2, 'pr', 990)]), 2)
  assert.equal(markOf(r('base', 1_000), [mark(1, 'pr', 500), mark(2, 'pr', 1_100)]), 2)
  assert.equal(markOf(r('base', 1_000), [mark(1, 'pr', 100)]), 1, 'however long before')
  // ties: the earlier, then the lower seq
  assert.equal(markOf(r('base', 1_000), [mark(1, 'pr', 900), mark(2, 'pr', 1_100)]), 1)
  assert.equal(markOf(r('base', 1_000), [mark(1, 'base', 900), mark(2, 'base', 1_100)]), 1)
  assert.equal(markOf(r('base', 1_000), [mark(1, 'pr', 950), mark(2, 'pr', 950)]), 1)
  assert.equal(markOf(r('base', 1_000), [mark(1, 'pr', 900), mark(2, 'base', 950), mark(3, 'base', 950)]), 2)
  assert.equal(markOf(r('base', 1_000), [mark(1, 'pr', 990), mark(2, 'pr', 990), mark(3, 'pr', 1_200)]), 1)
})

// The same rule, written plainly, on many random logs whose times often tie.
test('markOf agrees with the rule written plainly, on random logs', () => {
  const plainly = (q, marks) => {
    const early = marks.filter(m => m.at <= q.at + 300)
    const own = early.filter(m => m.pane === q.pane && Math.abs(m.at - q.at) <= 300)
    const best = list => [...list].sort((a, b) => Math.abs(a.at - q.at) - Math.abs(b.at - q.at) || a.at - b.at || a.seq - b.seq)[0]
    return (own.length ? best(own) : early.length ? best(early) : { seq: null }).seq
  }
  let seed = 7
  const rand = n => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed % n }
  for (let run = 0; run < 500; run++) {
    let at = 0
    const marks = Array.from({ length: rand(12) }, (_, i) => mark(i + 1, rand(2) ? 'base' : 'pr', (at += rand(4) * 100 + rand(2) * 50)))
    for (let i = 0; i < 10; i++) {
      const q = { pane: rand(2) ? 'base' : 'pr', at: rand(at + 600) }
      assert.equal(markOf(q, marks), plainly(q, marks), JSON.stringify({ q, marks }))
    }
  }
})

test('actionsNodes: the landing, then each action with the requests it most likely set off, and the counts', () => {
  const at = Date.UTC(2026, 9, 15, 12, 0, 0)
  const s = mergeActions(actionsFresh(), answer({
    seq: 7,
    marks: [mark(2, 'pr', at, 'submit'), mark(5, 'base', at + 5_000)],
    requests: [
      req(1, 'base', '/', at - 2_000),
      req(3, 'pr', `/x/${HOSTILE}`, at + 10),
      { ...req(4, 'base', '/slow', at - 100), status: 0, aborted: true },
      req(6, 'base', '/later', at + 5_050),
      // it ended after the click, but started before it, within 300 ms
      req(7, 'base', '/early', at + 4_800),
    ],
    dropped: { base: 1, pr: 0 }, refused: { base: { capability: 2 }, pr: {} }, marksDropped: { base: 0, pr: 3 },
  }))
  const texts = textsOf(actionsNodes(s))
  assert.deepEqual(texts.slice(0, 2), ['Landing, before any action', 'BASE GET / 200 5 ms'])
  assert.match(texts[2], /^\d\d:\d\d:\d\d submit, reported by the PR pane$/)
  assert.deepEqual(texts.slice(3, 5), [`PR GET /x/${HOSTILE} 200 5 ms`, 'BASE GET /slow — 5 ms (aborted)'])
  assert.match(texts[5], /^\d\d:\d\d:\d\d click, reported by the BASE pane$/)
  assert.deepEqual(texts.slice(6, 8), ['BASE GET /later 200 5 ms', 'BASE GET /early 200 5 ms'])
  assert.equal(texts.at(-1), 'dropped: BASE 1, PR 0 · refused: BASE capability 2; PR none · marks dropped: BASE 0, PR 3')
  assert.deepEqual(textsOf(actionsNodes(actionsFresh())), ['No session is ready.'])
  assert.deepEqual(textsOf(actionsNodes(mergeActions(actionsFresh(), answer()))).slice(0, 1), ['Nothing yet: the panes\' requests show here.'])
  // a mark that comes after the requests it set off regroups them
  const later = mergeActions(mergeActions(actionsFresh(), answer({ seq: 1, requests: [req(1, 'pr', '/go', 1_000)] })), answer({ seq: 2, marks: [mark(2, 'pr', 1_200)] }))
  assert.deepEqual(textsOf(actionsNodes(later)).slice(0, 2).map(t => t.replace(/^\d\d:\d\d:\d\d /, '')), ['click, reported by the PR pane', 'PR GET /go 200 5 ms'])
  // at most 100 actions, the newest
  const marks = Array.from({ length: 120 }, (_, i) => mark(i + 1, 'base', i * 1_000))
  const busy = textsOf(actionsNodes(mergeActions(actionsFresh(), answer({ seq: 200, marks, requests: [req(200, 'base', '/', -5_000)] }))))
  assert.equal(busy[0], '20 earlier actions not shown')
  assert.equal(busy.includes('Landing, before any action'), false, 'the landing is earlier still')
})

// The page draws the nodes with textContent, never markup: a hostile name
// reaches the DOM only as text.
test('the panels draw with textContent only: no innerHTML in their code, and a hostile name lands as text', async () => {
  // the page's part (indented, in the UI script) and the pure part (top level)
  const start = harnessSrc.indexOf('\n  // --- #8: the Data and Actions panels')
  const end = harnessSrc.indexOf('function startDotPoll()')
  const panels = harnessSrc.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.doesNotMatch(panels, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bsrc\s*=|\bhref\s*=/)
  const pure = harnessSrc.slice(harnessSrc.indexOf('\n// --- #8: the Data and Actions panels'), harnessSrc.indexOf('// The ticket an invite link carries'))
  assert.ok(pure.length > 1_000)
  assert.doesNotMatch(pure, /innerHTML|outerHTML|insertAdjacentHTML|document\./)

  // a hostile answer: markup, and a control where no isolate was expected
  const data = sampleData()
  const name = Object.keys(data.session.pr.collections)[0]
  data.session.pr.collections[name].countBefore = 'x\u202Ey'
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
  b.byId('dataBtn').onclick()
  await b.settle()
  const [, , onClick] = b.listeners.find(([n, type]) => n === 'dataBody' && type === 'click')
  onClick({ target: { closest: () => ({ dataset: { act: 'view:pr' } }) } })
  const sets = b.log.filter(e => e[0] === 'set')
  const hostile = sets.filter(e => String(e[3]).includes(HOSTILE))
  assert.ok(hostile.length > 0, 'the data was drawn')
  for (const [, , prop] of hostile) assert.ok(prop === 'textContent' || prop === 'title', prop)
  assert.equal(b.log.some(e => e[0] === 'set' && /HTML/.test(String(e[2])) && String(e[3]).includes('saved_carts')), false)
  assert.ok(sets.some(e => e[2] === 'textContent' && e[3] === 'x\\u{202E}y → 0'), 'drawn with its control as a code')
  assert.equal(sets.some(e => /\u202E/.test(String(e[3]))), false)
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
  assert.ok(b.log.some(e => e[0] === 'set' && e[1] === 'dataBtn' && e[2] === 'title' && e[3] === 'Data checks (d): 1 red flag'))
  const [, , onClick] = b.listeners.find(([name, type]) => name === 'dataBody' && type === 'click')
  const click = act => onClick({ target: { closest: () => ({ dataset: { act } }) } })
  click('snapshot')
  await b.settle()
  assert.ok(b.log.some(e => e[0] === 'set' && e[1] === 'announcer' && e[2] === 'textContent' && e[3] === 'Snapshot taken: 1 red flag'))
  click('rebaseline')
  await b.settle()
  assert.deepEqual(posts, [{ rebaseline: false }, { rebaseline: true }])
  // no inspector: no Data button, and nothing read, by click or by key
  const none = fakeBrowser({
    hash: '#/pr/7', stored: 'tok-1',
    elements: { inviteDialog: { open: false }, shortcuts: { open: false } },
    routes: { 'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES, data: { available: false } } }, 'POST /qa/api/pane-entry': entryRoute },
  })
  await none.settle()
  assert.ok(none.log.some(e => e[0] === 'set' && e[1] === 'dataBtn' && e[2] === 'hidden' && e[3] === true))
  const [, , onKey] = none.listeners.find(([name, type]) => name === 'document' && type === 'keydown')
  onKey({ key: 'd', target: {}, preventDefault() {} })
  await none.settle()
  assert.equal(none.log.some(e => e[0] === 'fetch' && e[2] === '/qa/api/data'), false)
  assert.equal(none.log.some(e => e[0] === 'set' && e[1] === 'dataPanel' && e[2] === 'hidden' && e[3] === false), false, 'd opens nothing')
})

// The data checks' first read failing says so, rather than that there is no
// inspector; and an answer for a session that ended meanwhile is dropped.
test('the Data panel says a read failed, and draws nothing of a session that ended while it read', async () => {
  const failing = fakeBrowser({
    hash: '#/pr/7', stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES, data: { available: true } } },
      'POST /qa/api/pane-entry': entryRoute,
      'GET /qa/api/data': { status: 500, body: { error: 'boom' } },
    },
  })
  await failing.settle()
  failing.byId('dataBtn').onclick()
  await failing.settle()
  const drawn = failing.log.filter(e => e[0] === 'set' && e[2] === 'textContent').map(e => e[3])
  assert.ok(drawn.includes('The data checks couldn\'t be read yet.'), drawn.join('\n'))
  assert.ok(drawn.includes('Couldn\'t read the data checks: boom'))
  assert.equal(drawn.includes('There is no inspector, so there are no data checks.'), false)

  let state = { status: 'ready', pr: 7, panes: PANES, data: { available: true }, startedAt: 1 }
  let release
  const gate = new Promise(resolve => { release = resolve })
  const b = fakeBrowser({
    hash: '#/pr/7', stored: 'tok-1', elements: { prList: fakeList() },
    routes: {
      'GET /qa/api/state': () => ({ body: state }),
      'POST /qa/api/pane-entry': entryRoute,
      'GET /qa/api/prs': { body: { prs: [], session: null } },
      'GET /qa/api/data': { body: sampleData(), hold: gate },
    },
  })
  await b.settle()
  // the session ends while its data is still being read
  state = { status: 'idle' }
  b.intervals.find(i => i.ms === 60_000).fn()
  await b.settle()
  const from = b.log.length
  release()
  await b.settle()
  assert.equal(b.log.slice(from).some(e => e[0] === 'set' && (e[1] === 'dataBadge' || e[1] === 'dataBody')), false, 'nothing of the ended session drawn')
})

test('the Actions panel reads on from its cursor while open and in view, from 0 again for another log, and stops when closed', async () => {
  let next = [answer({ seq: 2, requests: [req(1, 'base', '/'), req(2, 'pr', '/')] })]
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES } },
      'POST /qa/api/pane-entry': entryRoute,
      'GET /qa/api/actions': () => ({ body: next.shift() ?? answer({ log: 'log-c' }) }),
    },
  })
  await b.settle()
  const reads = () => b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/actions').map(e => e[5])
  assert.deepEqual(reads(), [], 'not read while closed')
  b.byId('actionsBtn').onclick()
  await b.settle()
  const poll = b.intervals.find(i => i.ms === 2000 && !i.cleared)
  assert.ok(poll, 'polled while open')
  // another session's log: start over from 0 at once
  next = [answer({ log: 'log-b', seq: 5 }), answer({ log: 'log-b', seq: 1, requests: [req(1, 'base', '/fresh')] })]
  poll.fn()
  await b.settle()
  // no session: empty, and read from 0 next time
  next = [answer({ active: false, log: null })]
  poll.fn()
  await b.settle()
  poll.fn()
  await b.settle()
  assert.deepEqual(reads(), ['after=0&limit=500', 'after=2&limit=500', 'after=0&limit=500', 'after=1&limit=500', 'after=0&limit=500'])
  // closed: no more polling
  b.byId('actionsBtn').onclick()
  assert.ok(b.log.some(e => e[0] === 'set' && e[1] === 'actionsPanel' && e[2] === 'hidden' && e[3] === true))
  assert.equal(poll.cleared, true)
})

// Polling stops whenever the panel can't be seen: Esc, the session ending,
// or the verdict-done view; it starts again back on the session.
test('the Actions panel stops polling on Esc, when the session ends, and on the verdict-done view', async () => {
  let state = { status: 'ready', pr: 7, panes: PANES, startedAt: 1 }
  const open = () => fakeBrowser({
    hash: '#/pr/7', stored: 'tok-1',
    elements: { inviteDialog: { open: false }, shortcuts: { open: false }, prList: fakeList(), doneLink: { href: 'https://github.example/c/1' }, doneP: { textContent: '7' } },
    routes: {
      'GET /qa/api/state': () => ({ body: state }),
      'POST /qa/api/pane-entry': entryRoute,
      'GET /qa/api/prs': { body: { prs: [], session: null } },
      'GET /qa/api/actions': { body: answer() },
    },
  })
  const polls = b => b.intervals.filter(i => i.ms === 2000)
  // Esc
  const esc = open()
  await esc.settle()
  esc.byId('actionsBtn').onclick()
  const [, , onKey] = esc.listeners.find(([name, type]) => name === 'document' && type === 'keydown')
  onKey({ key: 'Escape', target: {}, preventDefault() {} })
  assert.deepEqual(polls(esc).map(i => i.cleared), [true])
  // the session ends
  const ends = open()
  await ends.settle()
  ends.byId('actionsBtn').onclick()
  state = { status: 'idle' }
  ends.intervals.find(i => i.ms === 60_000).fn()
  await ends.settle()
  assert.deepEqual(polls(ends).map(i => i.cleared), [true])
  // the verdict-done view, and back
  state = { status: 'ready', pr: 7, panes: PANES, startedAt: 1 }
  const done = open()
  await done.settle()
  done.byId('actionsBtn').onclick()
  const [, , onHash] = done.listeners.find(([name, type]) => name === 'window' && type === 'hashchange')
  done.location.hash = '#/pr/7/verdict'
  onHash()
  await done.settle()
  assert.deepEqual(polls(done).map(i => i.cleared), [true], 'unseen: not polled')
  done.location.hash = '#/pr/7'
  onHash()
  await done.settle()
  assert.deepEqual(polls(done).map(i => i.cleared), [true, false], 'back in view: polled again')
})

