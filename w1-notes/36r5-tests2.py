R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'test/data-capture.test.mjs'
s = open(R + P).read()
assert 'slow masking' not in s
s += r"""
// The review's stall: a PR's data that is slow to mask held the event loop
// while the base pane's read was still timed, so that read timed out (and
// the span had no base diff). Every pane's raw read now comes first.
test('one pane\'s slow masking can\'t time out the other pane\'s read: every raw read settles before any is masked', async () => {
  const busy = ms => { const end = Date.now() + ms; while (Date.now() < end) { /* masking a PR's hostile data */ } }
  for (const phase of ['ready', 'snapshot']) {
    let slow = false
    const { capture, signal } = await readyCapture({
      capture: { limits: { timeoutMs: 1_000 } },
      snapshot: async (role, _, stores) => {
        if (!slow) return { collections: structuredClone(stores[role]) }
        if (role === 'pr') return { get collections() { busy(1_500); return structuredClone(stores.pr) } }
        // the base pane's answer comes as I/O does: after the timers that are due
        await new Promise(resolve => setTimeout(resolve, 100))
        await new Promise(resolve => setImmediate(resolve))
        return { collections: structuredClone(stores.base) }
      },
    })
    slow = phase === 'ready'
    await capture.ready({ signal })
    slow = true
    if (phase === 'snapshot') await capture.snapshot()
    const view = capture.view({})
    assert.deepEqual(view.errors, NO_ERRORS, phase)
    assert.ok(view[phase === 'ready' ? 'boot' : 'session'].base, phase)
  }
})
"""
open(R + P, 'w').write(s)
print('ok')
