p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/test/data-capture.test.mjs'
s = open(p).read()
start = s.index("test('a pane with no data still has the other pane\\'s flags, red, and S0 goes once the baseline is taken'")
end = s.index("})\n", s.index("void pr", start)) + 3
new = '''test('a pane with no data leaves the other pane\\'s flags, red, with nothing to excuse them', async () => {
  let rows = [{ id: 1, owner: 'a@example.org' }, { id: 2, owner: 'b@example.org' }]
  const { capture, signal } = await readyCapture({
    open: role => {
      if (role === 'base') throw new Error('no route to db')
      return { snapshot: () => ({ collections: carts(rows) }) }
    },
  })
  rows = rows.slice(1) // the PR's migration deletes one
  await capture.ready({ signal })
  const boot = capture.view({ isolation: { verdict: 'isolated' } }).boot
  assert.deepEqual([boot.base, boot.divergence], [null, null])
  assert.deepEqual(boot.flags.map(f => [f.collection, f.kind, f.severity]), [['saved_carts', 'delete', 'red']])
})

test('S0 goes once the ready snapshot is taken: a pane whose ready one failed shows no stale problems', async () => {
  let readyFails = false
  const { capture, signal } = await readyCapture({
    snapshot: role => {
      if (readyFails && role === 'pr') throw new Error('busy')
      return { collections: { ...carts([]), odd: { rows: 'nope' } } }
    },
  })
  assert.deepEqual(capture.view({}).problems.pr, ['odd: rows must be an array'], 'the seeded snapshot\\'s')
  readyFails = true
  await capture.ready({ signal })
  assert.deepEqual(capture.view({}).problems, { base: ['odd: rows must be an array'], pr: [] })
})
'''
s = s[:start] + new + s[end:]
open(p, 'w').write(s)
