R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'test/data-capture.test.mjs'
s = open(R + P).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b)


sub("""  // names long and short in turn, so a long one that doesn't fit is
  // followed by a short one that would
  const names = Array.from({ length: 30 }, (_, i) => `c${String(i).padStart(2, '0')}${i % 2 ? 'x'.repeat(150) : ''}`)
  const three = names.map(n => [n, { key: ['id'], rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }])
  const before = Object.fromEntries(three)
  // the PR inserts a row in each; the base pane changes nothing
  const after = Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }]))
  const at = async viewBytes => {
    let pr = before
    const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? before : pr) }), capture: { viewBytes } })
    await capture.ready({ signal })
    pr = after
    await capture.snapshot()
    return capture.view({}).session
  }
  const whole = await at(10_000_000)
  const order = Object.fromEntries(['pr', 'divergence', 'base'].map(l => [l, Object.keys(whole[l].collections)]))
  // N12: equal ranks go by name
  assert.deepEqual(order.pr, [...names].sort())
  assert.deepEqual(order.base, [...names].sort())
""", """  // names long and short in turn; the PR inserts a row in the long ones,
  // the base pane in the short ones. So the divergence's entry for a long
  // one (after the PR diff's) is followed by its entry for a short one
  // (before the base diff's), which is smaller: one that doesn't fit is
  // followed by one that would
  const names = Array.from({ length: 30 }, (_, i) => `c${String(i).padStart(2, '0')}${i % 2 ? 'x'.repeat(150) : ''}`)
  const rows = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
  const before = Object.fromEntries(names.map(n => [n, rows(3)]))
  const long = names.filter((_, i) => i % 2)
  const short = names.filter((_, i) => i % 2 === 0)
  const prAfter = { ...before, ...Object.fromEntries(long.map(n => [n, rows(4)])) }
  const baseAfter = { ...before, ...Object.fromEntries(short.map(n => [n, rows(4)])) }
  const at = async viewBytes => {
    let state = { base: before, pr: before }
    const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(state[role]) }), capture: { viewBytes } })
    await capture.ready({ signal })
    state = { base: baseAfter, pr: prAfter }
    await capture.snapshot()
    return capture.view({}).session
  }
  const whole = await at(10_000_000)
  const order = Object.fromEntries(['pr', 'divergence', 'base'].map(l => [l, Object.keys(whole[l].collections)]))
  // N12: equal ranks go by name
  assert.deepEqual(order.pr, [...long, ...short])
  assert.deepEqual(order.divergence, names)
  assert.deepEqual(order.base, [...short, ...long])
""")
open(R + P, 'w').write(s)
print('ok')
