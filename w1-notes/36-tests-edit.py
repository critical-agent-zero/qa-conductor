p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/test/data-capture.test.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


# neither pane opened: once ready has run, the boot span says neither could be read
sub("""  assert.match(v.errors.boot.pr, /the inspector's open gave no probe/)
  assert.deepEqual([v.boot, v.session], [null, null])""", """  assert.match(v.errors.boot.pr, /the inspector's open gave no probe/)
  // once ready has run, a span with neither pane's data says so, red
  assert.deepEqual([v.boot.complete, v.boot.base, v.boot.pr, v.boot.flags.map(f => [f.kind, f.reason]), v.boot.flagsCount], [false, null, null, [['unreadable', 'neither']], { red: 1, amber: 0 }])
  assert.equal(v.session, null)""")

# the unreadable flag says why
sub("""  assert.deepEqual(v.session.flags, [{ collection: null, kind: 'unreadable', severity: 'red', shared: false, pr: 1, base: 0 }])""",
    """  assert.deepEqual(v.session.flags, [{ collection: null, kind: 'unreadable', severity: 'red', shared: false, pr: 1, base: 0, reason: 'failed' }])""")

# a build that fails is tried again without its lists, and then cached
sub("""test('an answer that fails to build is cached as a failure for its state', async (t) => {
  const { capture, signal } = await readyCapture()
  await capture.ready({ signal })
  const stringify = t.mock.method(JSON, 'stringify', () => { throw new RangeError('Invalid string length') })
  assert.throws(() => capture.viewJson({}), RangeError)
  assert.throws(() => capture.viewJson({}), RangeError)
  assert.equal(stringify.mock.callCount(), 1)
  stringify.mock.restore()
})""", """test('an answer that fails to build, even without its lists, is cached as a failure for its state', async (t) => {
  const { capture, signal } = await readyCapture()
  await capture.ready({ signal })
  const stringify = t.mock.method(JSON, 'stringify', () => { throw new RangeError('Invalid string length') })
  assert.throws(() => capture.viewJson({}), RangeError)
  assert.throws(() => capture.viewJson({}), RangeError)
  assert.equal(stringify.mock.callCount(), 2, 'once with its lists, once without, and then not again')
  stringify.mock.restore()
})""")

# the late PR baseline: errors.boot says when it came, and its session span says why it has none
sub("""  assert.match(after.errors.boot.pr, /the ready snapshot failed/, 'a later success doesn\\'t erase why')
  assert.deepEqual([after.session.complete, after.session.pr], [false, null], 'that snapshot was its baseline, not a comparison')""",
    """  assert.match(after.errors.boot.pr, /the ready snapshot failed/, 'a later success doesn\\'t erase why')
  assert.match(after.errors.boot.pr, /; its baseline is the snapshot at \\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z$/, 'and says the baseline came')
  assert.doesNotMatch(after.errors.boot.pr, /will be/)
  assert.deepEqual([after.session.complete, after.session.pr], [false, null], 'that snapshot was its baseline, not a comparison')
  assert.deepEqual(after.session.flags.map(f => [f.kind, f.severity, f.reason]), [['unreadable', 'red', 'baseline']], 'red, but not for a read that failed')
  // the next snapshot compares
  await capture.snapshot()
  assert.equal(capture.view({}).session.pr.collections.saved_carts.status, 'same')""")

# the re-baseline late boot: unaligned (N38)
sub("""  const v = capture.view({})
  assert.equal(v.boot.pr.collections.saved_carts.counts.deleted, 1, 'the late pane\\'s boot span, from the re-baseline')""",
    """  const v = capture.view({})
  assert.equal(v.boot.pr.collections.saved_carts.counts.deleted, 1, 'the late pane\\'s boot span, from the re-baseline')
  assert.deepEqual([v.boot.aligned, v.boot.complete], [false, false], 'its window ends later than the base pane\\'s')""")
open(p, 'w').write(s)
print('ok')
