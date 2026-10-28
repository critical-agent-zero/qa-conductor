p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/test/data-diff.test.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


# the byte budget: a collection's key and declared fields are charged too
sub("""  // the byte budget is shared fairly: the first collection gets half, the last what is left
  const bytes = snap({ a: { key: ['id'], rows: [{ id: 1, s: 'x'.repeat(50) }] }, b: { key: ['id'], rows: [{ id: 1, s: 'y'.repeat(50) }] } }, {}, { maxBytes: 80 })""",
    """  // the byte budget is shared fairly: the first collection gets half, the
  // last what is left (each key's JSON, ["id"], is charged too)
  const bytes = snap({ a: { key: ['id'], rows: [{ id: 1, s: 'x'.repeat(50) }] }, b: { key: ['id'], rows: [{ id: 1, s: 'y'.repeat(50) }] } }, {}, { maxBytes: 100 })""")

# the new order: red first, then by collection within the destructive kinds
sub("""  assert.deepEqual(flags.map(f => [f.collection, f.kind, f.severity, f.pr, f.base]), [
    ['big', 'mass-change', 'red', 30, 0],
    ['cart_items', 'delete', 'amber', 2, 2],
    ['cart_items', 'emptied', 'amber', 1, 1],
    ['doomed', 'dropped', 'red', 1, 0],
    ['messages', 'column-dropped', 'red', 1, 0],
    ['orders', 'delete', 'red', 1, 0],
    ['saved_carts', 'delete', 'red', 3, 0],
    ['saved_carts', 'emptied', 'red', 1, 0],
  ])""", """  assert.deepEqual(flags.map(f => [f.collection, f.kind, f.severity, f.pr, f.base]), [
    ['big', 'mass-change', 'red', 30, 0],
    ['doomed', 'dropped', 'red', 1, 0],
    ['messages', 'column-dropped', 'red', 1, 0],
    ['orders', 'delete', 'red', 1, 0],
    ['saved_carts', 'delete', 'red', 3, 0],
    ['saved_carts', 'emptied', 'red', 1, 0],
    ['cart_items', 'delete', 'amber', 2, 2],
    ['cart_items', 'emptied', 'amber', 1, 1],
  ])""")

# a collection only the PR pane has, cut short: folded, after the base's
sub("""  const flags = flagChanges(diffSnapshots(seed, seed), diffSnapshots(seed, after), none, { trusted: false })
  assert.deepEqual(flags.map(f => [f.collection, f.kind, f.severity]), [['aaa_padding', 'unverified', 'red'], ['users', 'mass-change', 'red']])""",
    """  const flags = flagChanges(diffSnapshots(seed, seed), diffSnapshots(seed, after), none, { trusted: false })
  // the padding, which only the PR pane has, is folded into one flag after the base's collections
  assert.deepEqual(flags.map(f => [f.collection, f.kind, f.severity]), [['users', 'mass-change', 'red'], [null, 'unverified', 'red']])
  assert.deepEqual([flags[1].collections, flags[1].names], [1, ['aaa_padding']])""")
open(p, 'w').write(s)
print('ok')
