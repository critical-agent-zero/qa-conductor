
// --- #8: the data checks ----------------------------------------------------------
// With an inspector, each pane's data is snapshotted right after its seed
// (S0), at ready (S1) and on demand, and diffed. Values (masked where they
// may be secret) reach only GET /api/data and the snapshot route's answer:
// never the event stream, /api/state or a log.

// An inspector over one store per pane, which a test changes as the app
// would. What it is asked to do goes in the world's calls.
function storeInspector({ snapshot = null } = {}) {
  const stores = { base: null, pr: null }
  const fresh = () => ({ saved_carts: { key: ['id'], fields: ['id', 'owner', 'reset_token'], rows: [1, 2, 3].map(id => ({ id, owner: `owner${id}@example.org`, reset_token: `SECRET-token-${id}` })) } })
  let world = null
  const inspector = {
    rules: { classify: [{ collection: 'saved_carts', fields: ['owner'], as: 'pii' }] },
    async open({ paneRef, db }) {
      world?.calls.push(['inspector.open', paneRef.role, db?.dsn])
      stores[paneRef.role] = fresh()
      return {
        snapshot: async () => {
          if (snapshot) await snapshot(paneRef.role)
          return { collections: structuredClone(stores[paneRef.role]) }
        },
        close: async () => { world?.calls.push(['inspector.close', paneRef.role]) },
      }
    },
  }
  return { inspector, stores, attach: w => { world = w } }
}

async function dataWorld({ inspect = storeInspector(), ...opts } = {}) {
  const w = makeWorld({ ...opts, inspector: inspect.inspector })
  inspect.attach(w)
  const ports = await allPorts(w.c)
  await api(ports.harness, 'POST', '/api/session', { pr: 7 })
  await waitFor(async () => (await api(ports.harness, 'GET', '/api/state')).status === 'ready')
  const data = async () => {
    const res = await raw(ports.harness, { path: '/qa/api/data' })
    assert.equal(res.headers['cache-control'], 'no-store')
    return JSON.parse(res.body)
  }
  const snapshot = body => raw(ports.harness, { method: 'POST', path: '/qa/api/data/snapshot', headers: JSON_TYPE, body: JSON.stringify(body ?? {}) })
  return { w, ports, data, snapshot, stores: inspect.stores }
}

test('with no inspector the data checks are unavailable, and the boot is as it was', async () => {
  const { w, ports } = await readyWorld()
  try {
    assert.deepEqual((await api(ports.harness, 'GET', '/api/state')).data, { available: false })
    const res = await raw(ports.harness, { path: '/qa/api/data' })
    assert.deepEqual([res.status, res.headers['cache-control'], JSON.parse(res.body)], [200, 'no-store', { available: false }])
    const snap = await raw(ports.harness, { method: 'POST', path: '/qa/api/data/snapshot', headers: JSON_TYPE, body: '{}' })
    assert.deepEqual([snap.status, JSON.parse(snap.body).error], [409, 'the conductor has no inspector'])
  } finally { w.c.stop() }
})

test('the data checks: S0 after each seed, S1 at ready, Snapshot now on demand; values masked, and none in the event stream or the state', async () => {
  const { w, ports, data, snapshot, stores } = await dataWorld()
  try {
    assert.deepEqual((await api(ports.harness, 'GET', '/api/state')).data, { available: true })
    // the probe is opened with the pane's db
    assert.deepEqual(w.calls.filter(c => c[0] === 'inspector.open'), [['inspector.open', 'base', 'dsn-base'], ['inspector.open', 'pr', 'dsn-pr']])
    const ready = await data()
    assert.deepEqual([ready.available, ready.active, ready.trust, ready.session], [true, true, 'advisory', null])
    assert.equal(ready.boot.divergence.collections.saved_carts.status, 'same')
    assert.deepEqual(ready.errors, { base: null, pr: null })

    // the PR pane's "Empty cart" also deletes the saved carts
    stores.pr.saved_carts.rows = []
    stores.base.saved_carts.rows[0].owner = 'renamed@example.org'
    const before = (await api(ports.harness, 'GET', '/api/state')).lastActivity
    await new Promise(r => setTimeout(r, 5))
    const res = await snapshot()
    assert.deepEqual([res.status, res.headers['cache-control']], [200, 'no-store'])
    const after = JSON.parse(res.body)
    assert.equal(after.session.divergence.collections.saved_carts.status, 'differs')
    assert.deepEqual(after.session.flags.map(f => [f.collection, f.kind, f.severity, f.pr, f.base]), [['saved_carts', 'delete', 'red', 3, 0], ['saved_carts', 'emptied', 'red', 1, 0]])
    assert.deepEqual(await data(), after)
    assert.ok((await api(ports.harness, 'GET', '/api/state')).lastActivity > before, 'Snapshot now is activity')
    // pii as a fingerprint
    const updated = after.session.base.collections.saved_carts.updated[0].fields[0]
    assert.deepEqual([updated.field, updated.before.t, updated.after.t], ['owner', 'pii', 'pii'])
    const events = await sseEvents(ports.harness, evs => evs.filter(e => e.kind === 'capture').length >= 6)
    const captures = events.filter(e => e.kind === 'capture')
    assert.deepEqual(captures.map(e => [e.pane, e.phase, e.ok]), [
      ['base', 'seeded', true], ['pr', 'seeded', true], ['base', 'ready', true], ['pr', 'ready', true], ['base', 'now', true], ['pr', 'now', true],
    ])
    for (const e of captures) assert.deepEqual(Object.keys(e).sort(), ['at', 'kind', 'ok', 'pane', 'phase'])
    for (const text of [JSON.stringify(after), JSON.stringify(events), JSON.stringify(await api(ports.harness, 'GET', '/api/state')), w.lines.join('\n')]) {
      assert.doesNotMatch(text, /example\.org|SECRET-token/)
    }
    // reading is no activity
    const active = (await api(ports.harness, 'GET', '/api/state')).lastActivity
    await new Promise(r => setTimeout(r, 5))
    await data()
    assert.equal((await api(ports.harness, 'GET', '/api/state')).lastActivity, active)

    // Re-baseline: now is the baseline
    const re = JSON.parse((await snapshot({ rebaseline: true })).body)
    assert.deepEqual([re.rebaselined, re.session], [true, null])
    for (const bad of [{ rebaseline: 'yes' }, { rebaseline: 1 }]) {
      const r = await snapshot(bad)
      assert.deepEqual([r.status, JSON.parse(r.body).error], [400, 'rebaseline must be true or false'])
    }
  } finally { w.c.stop() }
})

test('the base-vs-PR comparison is trusted only when the session is isolated', async () => {
  const check = async () => ({ verdict: 'isolated', reasons: [] })
  const { w, data, snapshot, stores } = await dataWorld({ provisioner: { isolation: check } })
  try {
    for (const role of ['base', 'pr']) stores[role].saved_carts.rows = []
    await snapshot()
    const view = await data()
    assert.equal(view.trust, 'trusted')
    assert.deepEqual(view.session.flags.map(f => [f.kind, f.severity]), [['delete', 'amber'], ['emptied', 'amber']])
  } finally { w.c.stop() }
  const shared = await dataWorld({ provisioner: { isolation: 'shared-host' } })
  try {
    for (const role of ['base', 'pr']) shared.stores[role].saved_carts.rows = []
    await shared.snapshot()
    const view = await shared.data()
    assert.equal(view.trust, 'advisory')
    assert.deepEqual(view.session.flags.map(f => [f.kind, f.severity]), [['delete', 'red'], ['emptied', 'red']])
  } finally { shared.w.c.stop() }
})

test('the data checks are the running session\'s: probes close before the panes go, the next boot starts afresh, and a snapshot racing a teardown answers 409', async () => {
  let hold = null
  const inspect = storeInspector({ snapshot: async () => { if (hold) await hold.promise } })
  const hang = { 8: deferred() }
  const { w, ports, data, snapshot } = await dataWorld({ inspect, hang })
  try {
    await api(ports.harness, 'POST', '/api/teardown')
    const order = w.calls.filter(c => c[0] === 'inspector.close' || c[0] === 'teardown').map(c => c.join(' '))
    assert.deepEqual(order, ['inspector.close base', 'inspector.close pr', 'teardown base', 'teardown pr'])
    assert.deepEqual(await data(), { available: true, active: false })
    assert.equal((await snapshot()).status, 409)

    // a boot in flight: no data until it is ready
    await api(ports.harness, 'POST', '/api/session', { pr: 8 })
    assert.deepEqual(await data(), { available: true, active: false })
    hang[8].resolve()
    await waitFor(async () => (await api(ports.harness, 'GET', '/api/state')).status === 'ready')
    assert.equal((await data()).active, true)

    // a snapshot still running when the session ends
    hold = deferred()
    const racing = snapshot()
    await new Promise(r => setTimeout(r, 20))
    await api(ports.harness, 'POST', '/api/teardown')
    hold.resolve()
    const res = await racing
    assert.equal(res.status, 409)
    assert.match(JSON.parse(res.body).error, /the session ended/)
  } finally { w.c.stop() }
})

test('a boot that is superseded or fails closes its probes, and leaves no data', async () => {
  const hang = { 8: deferred() }
  const inspect = storeInspector()
  const w = makeWorld({ hang, inspector: inspect.inspector })
  inspect.attach(w)
  try {
    const port = await harnessPort(w.c)
    await api(port, 'POST', '/api/session', { pr: 8 })
    await waitFor(() => w.calls.some(c => c[0] === 'ensureBuilt' && c[1] === 8))
    await api(port, 'POST', '/api/session', { pr: 7, takeover: true })
    await waitFor(async () => (await api(port, 'GET', '/api/state')).status === 'ready')
    hang[8].resolve()
    assert.equal((await api(port, 'GET', '/api/data')).active, true)
    assert.deepEqual(w.calls.filter(c => c[0] === 'inspector.open').map(c => c[1]), ['base', 'pr'], 'the superseded boot opened none')
  } finally { w.c.stop() }

  const failing = storeInspector()
  const f = makeWorld({ failAt: 'launchServices', inspector: failing.inspector })
  failing.attach(f)
  try {
    const port = await harnessPort(f.c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await waitFor(async () => (await api(port, 'GET', '/api/state')).status === 'error')
    await waitFor(() => f.calls.filter(c => c[0] === 'inspector.close').length === 2)
    assert.deepEqual(await api(port, 'GET', '/api/data'), { available: true, active: false })
  } finally { f.c.stop() }
})

test('POST /api/data/snapshot sits behind the JSON, same-origin and shutdown checks', async () => {
  const { w, ports } = await dataWorld()
  try {
    const path = '/qa/api/data/snapshot'
    assert.equal((await raw(ports.harness, { method: 'POST', path, headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415)
    assert.equal((await raw(ports.harness, { method: 'POST', path, headers: { ...JSON_TYPE, 'sec-fetch-site': 'cross-site' }, body: '{}' })).status, 403)
    const closing = w.c.shutdown()
    const late = await raw(ports.harness, { method: 'POST', path, headers: JSON_TYPE, body: '{}' }).catch(() => ({ status: 'closed' }))
    assert.ok([503, 'closed'].includes(late.status), String(late.status))
    await closing
  } finally { w.c.stop() }
})

test('startConductor refuses an inspector with no open(), or with rules that aren\'t valid', () => {
  for (const [inspector, re] of [
    [{}, /adapters\.inspector must be an object with an open\(\) function/],
    ['inspector', /adapters\.inspector must be an object with an open\(\) function/],
    [{ open: () => ({}), rules: { keyOf: 1 } }, /adapters\.inspector\.rules: unknown data rule: keyOf/],
    [{ open: () => ({}), rules: { classify: [{ collection: 'x', fields: ['a'], as: 'public' }] } }, /adapters\.inspector\.rules: classify\[0\]\.as must be secret or pii/],
  ]) assert.throws(() => startOnly({}, { inspector }), re, JSON.stringify(inspector))
  assert.doesNotThrow(() => startOnly({}, { inspector: { open: () => ({}) } }))
})
