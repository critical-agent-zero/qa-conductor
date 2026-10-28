
// A boot that fails closes its probes; the next boot waits for them too.
test('a boot after a failed one waits for the failed boot\'s probes to close before it builds', async () => {
  const closing = deferred()
  const inspect = storeInspector()
  const original = inspect.inspector.open
  inspect.inspector.open = async args => {
    const probe = await original(args)
    return { ...probe, close: async () => { await closing.promise; return probe.close() } }
  }
  const w = makeWorld({ failAt: 'launchServices', inspector: inspect.inspector })
  inspect.attach(w)
  try {
    const port = await harnessPort(w.c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await waitFor(async () => (await api(port, 'GET', '/api/state')).status === 'error')
    const builds = () => w.calls.filter(c => c[0] === 'ensureBuilt').length
    const before = builds()
    await api(port, 'POST', '/api/session', { pr: 7 })
    await new Promise(r => setTimeout(r, 50))
    assert.equal(builds(), before, 'no build while the failed boot\'s probes are still closing')
    closing.resolve()
    await waitFor(() => builds() === before + 1)
  } finally { closing.resolve(); w.c.stop() }
})
