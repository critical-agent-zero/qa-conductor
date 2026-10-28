
// --- #29: the enrolment window, at its edges --------------------------------------------

// Kills S47 (POST /api/enrol exempt from refused()) and S48 (enrol, invite and
// pane-entry dropped from JSON_ROUTES).
test('POST /api/enrol, /api/invite and /api/pane-entry sit behind the same-origin, harness-host and JSON checks', async () => {
  const { c, calls, capability } = makeWorld()
  try {
    const port = await harnessPort(c)
    await waitFor(() => calls.some(x => x[0] === 'sweep-done'))
    const enrolled = capability.size()
    const host = `127.0.0.1:${port}`
    const body = '{"role":"base","to":"/"}'
    for (const path of ['/qa/api/enrol', '/qa/api/invite', '/qa/api/pane-entry']) {
      // another site's page, a pane's page, and an older browser's cross-site POST
      for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site', origin: 'https://h.ts.net:10000' }, { origin: 'https://evil.example' }]) {
        const res = await raw(port, { method: 'POST', path, headers: { host, ...JSON_TYPE, ...headers }, body })
        assert.deepEqual([res.status, JSON.parse(res.body).error], [403, 'cross-site request refused'], `${path} ${JSON.stringify(headers)}`)
      }
      // a handler at another port of the harness hostname
      const elsewhere = await raw(port, { method: 'POST', path, headers: { host: 'h.ts.net:8443', 'sec-fetch-site': 'same-origin', ...JSON_TYPE }, body })
      assert.deepEqual([elsewhere.status, JSON.parse(elsewhere.body).error], [403, 'not the harness origin'], path)
      // a type an HTML form can send
      for (const type of [null, 'text/plain', 'application/x-www-form-urlencoded']) {
        const res = await raw(port, { method: 'POST', path, headers: type ? { 'content-type': type } : {}, body })
        assert.equal(res.status, 415, `${path} ${type}`)
      }
    }
    assert.equal(capability.size(), enrolled, 'no browser enrolled')
  } finally { c.stop() }
})

// Kills S13 (bootSettled marks clean on tornDown alone). Boot A (#7) is taken
// over inside launchServices; boot B (#8) starts with A in flight, A settles,
// then B fails and tears down cleanly. B's own teardown doesn't count: a
// cleanup teardown must follow once both have settled.
test('a failed boot\'s own clean teardown does not mark the panes clean when another boot was in flight as it started', async () => {
  const launchedA = deferred()
  const gateA = deferred()
  const gateB = deferred()
  let launches = 0
  const { c, calls } = makeWorld({
    provisioner: {
      launchServices: async () => {
        launches++
        if (launches === 1) { launchedA.resolve(); await gateA.promise; return }
        await gateB.promise
        throw new Error('launch failed')
      },
    },
  })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await launchedA.promise
    await api(port, 'POST', '/api/session', { pr: 8, takeover: true })
    await waitFor(() => launches === 2)
    gateA.resolve() // A starts its app after the takeover's teardown, sees the abort, settles
    await new Promise(r => setTimeout(r, 20))
    gateB.resolve() // B fails, and its own teardown succeeds
    await waitFor(async () => (await api(port, 'GET', '/api/state')).status === 'error')
    await waitFor(async () => (await enrolment(port)) === 'open')
    // the takeover's (2), B's own (2), and the cleanup once both had settled (2)
    assert.equal(calls.filter(x => x[0] === 'teardown').length, 6)
  } finally { c.stop() }
})

// Kills S19 (doTeardown marks cleanAt = ran on ok alone). The cancelled boot
// starts its app and settles while the teardown runs: that teardown may have
// missed it, so a cleanup teardown must follow before enrolment opens.
test('a cancelled boot that settles during the teardown gets a cleanup teardown before enrolment opens', async () => {
  const launched = deferred()
  const launchGate = deferred()
  const teardownGate = deferred()
  let first = true
  const { c, calls } = makeWorld({
    provisioner: {
      launchServices: async () => { launched.resolve(); await launchGate.promise },
      teardown: async ({ paneRef }) => {
        calls.push(['teardown', paneRef.role])
        if (first) { first = false; await teardownGate.promise }
      },
    },
  })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await launched.promise
    const ending = api(port, 'POST', '/api/teardown')
    await waitFor(() => calls.some(x => x[0] === 'teardown'))
    launchGate.resolve() // the boot goes on, sees the abort and settles, mid-teardown
    await new Promise(r => setTimeout(r, 20))
    teardownGate.resolve()
    await ending
    await waitFor(async () => (await enrolment(port)) === 'open')
    assert.deepEqual(calls.filter(x => x[0] === 'teardown').map(x => x[1]), ['base', 'pr', 'base', 'pr'], 'a cleanup ran after the boot settled')
  } finally { c.stop() }
})

// Kills S29 (runBoot no longer awaits the cleanup in flight).
test('a boot waits for the cleanup teardown in flight before it builds or provisions', async () => {
  const cleanupGate = deferred()
  let teardowns = 0
  const { c, calls } = makeWorld({
    failAt: 'launchServices',
    provisioner: {
      teardown: async ({ paneRef }) => {
        teardowns++
        calls.push(['teardown', paneRef.role])
        if (teardowns === 1) throw new Error('busy') // the failed boot's own teardown fails
        if (teardowns === 3) await cleanupGate.promise // the cleanup after it hangs
      },
    },
  })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await waitFor(() => teardowns === 3)
    assert.equal((await api(port, 'POST', '/api/session', { pr: 8 })).ok, true)
    await new Promise(r => setTimeout(r, 20))
    assert.equal(calls.some(x => x[0] === 'ensureBuilt' && x[1] === 8), false, 'held back by the cleanup')
    cleanupGate.resolve()
    await waitFor(() => calls.some(x => x[0] === 'ensureBuilt' && x[1] === 8))
    const seq = calls.filter(x => x[0] === 'teardown' || (x[0] === 'ensureBuilt' && x[1] === 8)).map(x => x[0])
    assert.deepEqual(seq.slice(0, 5), ['teardown', 'teardown', 'teardown', 'teardown', 'ensureBuilt'])
  } finally { c.stop() }
})

// Kills S32 (an aborted boot whose bootSession returned settles as ran: false).
test('a boot cancelled during its last sign-in still counts as having run: a cleanup teardown follows it', async () => {
  const signing = deferred()
  const signGate = deferred()
  const { c, calls, adapters } = makeWorld()
  adapters.auth.establishSession = async ({ pane }) => {
    if (pane.ref.role === 'pr') { signing.resolve(); await signGate.promise }
    return { landingUrl: `login-${pane.ref.role}`, cookies: [] }
  }
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await signing.promise
    await api(port, 'POST', '/api/teardown')
    assert.equal(await enrolment(port), STOPPING)
    signGate.resolve() // bootSession returns normally, to a boot that was cancelled
    await waitFor(async () => (await enrolment(port)) === 'open')
    assert.equal(calls.filter(x => x[0] === 'teardown').length, 4, 'the cleanup ran after the boot settled')
  } finally { c.stop() }
})

// Kills S55 (layoutProblem without its null-harness-origin guard): 500.
test('with no harness origin, POST /api/pane-entry still issues a ticket', async () => {
  const { c } = makeWorld({ cfg: { publicHost: null, host: '0.0.0.0' } })
  try {
    const res = await raw(await harnessPort(c), { method: 'POST', path: '/qa/api/pane-entry', headers: JSON_TYPE, body: '{"role":"base","to":"/"}' })
    assert.equal(res.status, 200, res.body)
    assert.match(JSON.parse(res.body).url, /^https:\/\/h\.ts\.net:8443\/__qa\/enter\?t=[A-Za-z0-9_-]{43}$/)
  } finally { c.stop() }
})

// Kills S71 (an error that carries no tornDown counts as torn down). A
// Provisioner that rejects with a string: bootSession can't mark it, and its
// teardown failed, so a cleanup must run before enrolment opens.
test('a boot that fails with a non-Error, and whose own teardown fails, gets a cleanup before enrolment opens', async () => {
  let failing = 1
  const w = makeWorld({
    provisioner: {
      launchServices: async () => { throw 'launch failed' }, // eslint-disable-line no-throw-literal
      teardown: async ({ paneRef }) => {
        w.calls.push(['teardown', paneRef.role])
        if (failing > 0) { failing--; throw new Error('busy') }
      },
    },
  })
  try {
    const port = await harnessPort(w.c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await waitFor(async () => (await api(port, 'GET', '/api/state')).status === 'error')
    await waitFor(async () => (await enrolment(port)) === 'open')
    assert.deepEqual(w.calls.filter(x => x[0] === 'teardown').map(x => x[1]), ['base', 'pr', 'base', 'pr'])
  } finally { w.c.stop() }
})
