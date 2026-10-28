
// --- #29: the per-session isolation verdict ---------------------------------------
// Whether the PR pane can reach the base pane, so #8 knows whether to trust a
// base-vs-PR comparison: the Provisioner's check (or declaration), raised by
// the runtime floors, in /api/state and the event stream. QA_REQUIRE_ISOLATION
// refuses a session that isn't isolated, before the PR's code runs.

const isolatedCheck = calls => async ({ canary }) => {
  calls.push(['isolation', canary.port, canary.path, canary.expect])
  return { verdict: 'isolated', reasons: [] }
}

test('the verdict comes from the Provisioner\'s check, and reaches /api/state, the event stream and ready; a new boot starts without one', async () => {
  const hang = { 8: deferred() }
  const w = makeWorld({ hang })
  w.adapters.provisioner.isolation = isolatedCheck(w.calls)
  try {
    const port = await harnessPort(w.c)
    assert.equal((await api(port, 'GET', '/api/state')).isolation, null)
    await api(port, 'POST', '/api/session', { pr: 7 })
    const events = await sseEvents(port, evs => evs.some(e => e.kind === 'ready'))
    const st = await api(port, 'GET', '/api/state')
    assert.deepEqual({ ...st.isolation, checkedAt: typeof st.isolation.checkedAt }, { verdict: 'isolated', reasons: [], checkedAt: 'number' })
    const ev = events.find(e => e.kind === 'isolation')
    assert.deepEqual([ev.verdict, ev.reasons], ['isolated', []])
    assert.deepEqual(events.find(e => e.kind === 'ready').isolation, st.isolation)
    // the check ran once both databases existed, before the panes were started
    const seq = w.calls.map(x => x[0])
    assert.ok(seq.lastIndexOf('provisionDatabase') < seq.indexOf('isolation'), seq.join(' '))
    const [, canaryPort, path, expect] = w.calls.find(x => x[0] === 'isolation')
    assert.equal(canaryPort, port)
    assert.match(path, /^\/__qa\/canary\/[0-9a-f]{32}$/)
    assert.equal(expect, `qa-canary ${path.split('/').pop()}`)

    await api(port, 'POST', '/api/session', { pr: 8, takeover: true })
    await waitFor(() => w.calls.some(x => x[0] === 'ensureBuilt' && x[1] === 8))
    assert.equal((await api(port, 'GET', '/api/state')).isolation, null, 'reset for the new boot')
  } finally { w.c.stop() }
})

test('a Provisioner that declares shared-host, has no check, or whose check fails or says nothing, gets that verdict at once or unknown', async () => {
  const cases = [
    ['shared-host', { verdict: 'shared-host', reasons: ['both panes run as one user on this host'] }],
    [undefined, { verdict: 'unknown', reasons: ['the Provisioner has no isolation check'] }],
    [async () => { throw new Error('docker went away') }, { verdict: 'unknown', reasons: ['the isolation check failed: docker went away'] }],
    [async () => ({ verdict: 'yes' }), { verdict: 'unknown', reasons: ['the isolation check gave no verdict'] }],
    [async () => ({ verdict: 'reachable', reasons: ['the PR pane reached the base pane\'s database'] }), { verdict: 'reachable', reasons: ['the PR pane reached the base pane\'s database'] }],
  ]
  for (const [isolation, want] of cases) {
    const w = makeWorld()
    if (isolation === undefined) delete w.adapters.provisioner.isolation
    else w.adapters.provisioner.isolation = isolation
    try {
      const port = await harnessPort(w.c)
      await api(port, 'POST', '/api/session', { pr: 7 })
      const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'ready' && s })
      assert.deepEqual({ verdict: st.isolation.verdict, reasons: st.isolation.reasons }, want, String(isolation))
    } finally { w.c.stop() }
  }
})

test('the runtime floors raise the check\'s verdict: macOS, and a bind off loopback', async () => {
  for (const [opts, want] of [
    [{ platform: 'darwin' }, /^on macOS, containers run in a VM/],
    [{ cfg: { host: '0.0.0.0', publicHost: 'h.ts.net' } }, /^the conductor listens on 0\.0\.0\.0, which containers can reach$/],
  ]) {
    const w = makeWorld(opts)
    w.adapters.provisioner.isolation = isolatedCheck(w.calls)
    try {
      const port = await harnessPort(w.c)
      await api(port, 'POST', '/api/session', { pr: 7 })
      const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'ready' && s })
      assert.equal(st.isolation.verdict, 'reachable', JSON.stringify(opts))
      assert.equal(st.isolation.reasons.length, 1)
      assert.match(st.isolation.reasons[0], want)
    } finally { w.c.stop() }
  }
})

// The probe confirms a hit is this conductor: the harness port answers the
// probe's nonce, only while the check runs, before the identity gate.
test('the harness answers the canary path only while the check runs, in none and tailscale modes', async () => {
  for (const cfg of [{}, GATED]) {
    const w = makeWorld({ cfg })
    let during = null
    w.adapters.provisioner.isolation = async ({ canary }) => {
      const hit = await raw(canary.port, { path: canary.path, cap: false })
      const wrong = await raw(canary.port, { path: canary.path.replace(/.$/, c => (c === '0' ? '1' : '0')), cap: false })
      during = { canary, hit, wrong }
      return { verdict: hit.body.includes(canary.expect) ? 'reachable' : 'isolated', reasons: ['the PR pane reached this conductor'] }
    }
    try {
      const port = await harnessPort(w.c)
      const login = cfg === GATED ? ALLOWED : {}
      await api(port, 'POST', '/api/session', { pr: 7 }, login)
      await waitFor(async () => (await api(port, 'GET', '/api/state', undefined, login)).status === 'ready')
      assert.deepEqual([during.hit.status, during.hit.body], [200, `${during.canary.expect}\n`], JSON.stringify(cfg))
      assert.notEqual(during.wrong.status, 200)
      const after = await raw(port, { path: during.canary.path, cap: false })
      assert.notEqual(after.status, 200, 'not once the check is done')
      assert.doesNotMatch(after.body, /qa-canary/)
    } finally { w.c.stop() }
  }
})

test('QA_REQUIRE_ISOLATION refuses a session that isn\'t isolated: as it starts when that is known then, else once the databases exist, before the PR\'s code', async () => {
  const strict = { requireIsolation: true }
  const refuse = verdict => new RegExp(`^QA_REQUIRE_ISOLATION=1 refuses a session whose PR pane isn't isolated from the base pane \\(${verdict}: `)
  const start = [
    [{ cfg: strict }, 'shared-host', 'shared-host'],
    [{ cfg: strict }, undefined, 'unknown'],
    [{ cfg: strict, platform: 'darwin' }, 'check', 'reachable'],
  ]
  for (const [opts, isolation, verdict] of start) {
    const w = makeWorld(opts)
    if (isolation === undefined) delete w.adapters.provisioner.isolation
    else w.adapters.provisioner.isolation = isolation === 'check' ? isolatedCheck(w.calls) : isolation
    try {
      const port = await harnessPort(w.c)
      await api(port, 'POST', '/api/session', { pr: 7 })
      const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'error' && s })
      assert.equal(st.error.step, 'ensuring-image')
      assert.match(st.error.message, refuse(verdict))
      assert.equal(st.isolation.verdict, verdict)
      const seq = w.calls.map(x => x[0])
      for (const later of ['ensureBuilt', 'provisionDatabase', 'isolation']) assert.equal(seq.includes(later), false, `${verdict}: ${later}`)
    } finally { w.c.stop() }
  }

  // a check that finds the base pane: refused before any migrate or launch
  const w = makeWorld({ cfg: strict })
  w.adapters.provisioner.isolation = async () => ({ verdict: 'reachable', reasons: ['the PR pane reached the base pane\'s database at 172.19.0.2:5432'] })
  w.adapters.provisioner.launchServices = async ({ paneRef }) => { w.calls.push(['launchServices', paneRef.role]) }
  try {
    const port = await harnessPort(w.c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'error' && s })
    assert.equal(st.error.step, 'cloning')
    assert.match(st.error.message, refuse('reachable'))
    assert.match(st.error.message, /172\.19\.0\.2:5432/)
    const seq = w.calls.map(x => x[0])
    assert.ok(seq.includes('provisionDatabase'))
    assert.equal(seq.includes('launchServices'), false)
    assert.deepEqual(w.calls.filter(x => x[0] === 'teardown').map(x => x[1]), ['base', 'pr'])
  } finally { w.c.stop() }

  // an isolated session boots as ever
  const ok = makeWorld({ cfg: strict })
  ok.adapters.provisioner.isolation = isolatedCheck(ok.calls)
  try {
    const port = await harnessPort(ok.c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'ready' && s })
    assert.equal(st.isolation.verdict, 'isolated')
  } finally { ok.c.stop() }
})
