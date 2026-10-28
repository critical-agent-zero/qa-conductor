R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'test/data-capture.test.mjs'
s = open(R + P).read()
a = """test('without a base diff, a seeded collection is still told from the PR\\'s own: its flags, lists and fallback come first', async () => {
  for (const shape of ['base read failed', 'base baseline late']) {
    const base = { users: people(20) }
    let pr = { users: people(20) }
    let failBase = shape === 'base baseline late'
    const { capture, signal } = await readyCapture({
      snapshot: role => {
        if (role === 'base' && failBase) throw new Error('lock timeout')
        return { collections: structuredClone(role === 'base' ? base : pr) }
      },
      capture: { limits: { maxCollections: 2_000 } },
    })
    pr = { users: people(20), ...ownTables(1_000, 2) }
    await capture.ready({ signal })
    failBase = shape === 'base read failed'
"""
b = """test('without a base diff, a seeded collection is still told from the PR\\'s own: its flags, lists and fallback come first', async () => {
  // which of the base pane's reads fail; whether the PR's tables were there
  // before its seed (so its boot span doesn't show them added)
  const shapes = {
    'base read failed': { boot: false, now: true, older: false },
    'base read failed, the PR\\'s tables older than its seed': { boot: false, now: true, older: true },
    'base baseline late': { boot: true, now: false, older: false },
    'base never read': { boot: true, now: true, older: false },
  }
  for (const [shape, { boot, now, older }] of Object.entries(shapes)) {
    const base = { users: people(20) }
    let pr = { users: people(20), ...(older ? ownTables(1_000, 2) : {}) }
    let failBase = boot
    const { capture, signal } = await readyCapture({
      snapshot: role => {
        if (role === 'base' && failBase) throw new Error('lock timeout')
        return { collections: structuredClone(role === 'base' ? base : pr) }
      },
      capture: { limits: { maxCollections: 2_000 } },
    })
    pr = { users: people(20), ...ownTables(1_000, 2) }
    await capture.ready({ signal })
    failBase = now
"""
assert s.count(a) == 1
s = s.replace(a, b)
open(R + P, 'w').write(s)
print('ok')
