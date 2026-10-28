
// --- #32: the PR pane on an internal network -------------------------------------
// A Provisioner that puts the PR pane on an internal network says so
// (`internal: true`), and its check's result says whether it did. Only a
// result that says so lifts macOS's floor: the probe then speaks for the
// VM's forwarding too.
test('on macOS, an internal network lifts the VM floor only when the check\'s result says the PR pane is on one', async () => {
  for (const [result, want] of [
    [{ verdict: 'isolated', reasons: [], internal: true }, ['isolated', []]],
    [{ verdict: 'reachable', reasons: ['the PR pane got through the forwarder\'s proxy to 172.19.0.2:5432'], internal: true }, ['reachable', ['the PR pane got through the forwarder\'s proxy to 172.19.0.2:5432']]],
    // it fell back to an ordinary network: the floor holds
    [{ verdict: 'isolated', reasons: [] }, ['reachable', [/^on macOS, containers run in a VM/]]],
    [{ verdict: 'isolated', reasons: [], internal: 'yes' }, ['reachable', [/^on macOS, containers run in a VM/]]],
  ]) {
    const w = makeWorld({ platform: 'darwin', provisioner: { internal: true, isolation: async () => result } })
    try {
      const port = await harnessPort(w.c)
      await api(port, 'POST', '/api/session', { pr: 7 })
      const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'ready' && s })
      assert.equal(st.isolation.verdict, want[0], JSON.stringify(result))
      assert.equal(st.isolation.reasons.length, want[1].length, st.isolation.reasons.join(' | '))
      want[1].forEach((reason, i) => (typeof reason === 'string' ? assert.equal(st.isolation.reasons[i], reason) : assert.match(st.isolation.reasons[i], reason)))
    } finally { w.c.stop() }
  }
  // a bind off loopback holds whatever the network
  const off = makeWorld({ platform: 'darwin', cfg: { host: '0.0.0.0', publicHost: 'h.ts.net' }, provisioner: { internal: true, isolation: async () => ({ verdict: 'isolated', reasons: [], internal: true }) } })
  try {
    const port = await harnessPort(off.c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'ready' && s })
    assert.deepEqual([st.isolation.verdict, st.isolation.reasons], ['reachable', ['the conductor listens on 0.0.0.0, which containers can reach']])
  } finally { off.c.stop() }
})

// Strict mode on macOS: with a Provisioner meant for an internal network,
// the check decides, so neither startup nor the boot's start refuses.
test('strict mode on macOS waits for the check of a Provisioner meant for an internal network, and refuses one that fell back', async () => {
  for (const [result, refused] of [[{ verdict: 'isolated', reasons: [], internal: true }, false], [{ verdict: 'isolated', reasons: [] }, true]]) {
    const w = makeWorld({ platform: 'darwin', cfg: { requireIsolation: true }, provisioner: { internal: true, isolation: async () => result } })
    try {
      const port = await harnessPort(w.c)
      assert.equal(w.errorLines.some(l => l.includes('refuses every session')), false, w.errorLines.join('\n'))
      await api(port, 'POST', '/api/session', { pr: 7 })
      const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return (s.status === 'ready' || s.status === 'error') && s })
      assert.equal(st.status, refused ? 'error' : 'ready', JSON.stringify(result))
      if (refused) {
        assert.equal(st.error.step, 'cloning')
        assert.match(st.error.message, /^QA_REQUIRE_ISOLATION=1 refuses a session whose PR pane isn't isolated from the base pane \(reachable: on macOS, containers run in a VM/)
      }
    } finally { w.c.stop() }
  }
})
