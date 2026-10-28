p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/test/harness.test.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""  assert.ok(textsOf(dataNodes(sampleData(), { ...ui, span: 'boot' })).includes('No boot span: neither pane has a seeded and a ready snapshot.'))""",
    """  assert.ok(textsOf(dataNodes(sampleData(), { ...ui, span: 'boot' })).includes('No boot span yet: the panes\\' ready snapshots haven\\'t been taken.'))""")
sub("""  const nodes = dataNodes(data, { span: 'session', view: 'pr', open: 299 })
  assert.equal(actsOf(nodes).filter(a => a.startsWith('open:')).length, 300)
  const texts = textsOf(nodes)
  assert.ok(texts.includes('and 700 more collections'))
  assert.ok(texts.includes('c0299'), 'the last one drawn opens')""", """  const nodes = dataNodes(data, { span: 'session', view: 'pr', open: 299 })
  assert.equal(actsOf(nodes).filter(a => a.startsWith('open:')).length, 300)
  const texts = textsOf(nodes)
  assert.ok(texts.includes('and 700 more collections'))
  // those with a red flag first, then the rest in name order
  const rows = nodes.find(n => n.cls === 'dataTable').children.slice(1).map(r => plain(r.children[0].text))
  assert.deepEqual([rows[0], rows[19], rows[20], rows[299]], ['c0500', 'c0519', 'c0000', 'c0279'])
  assert.ok(texts.includes('c0279'), 'the last one drawn opens')""")
sub("""  assert.ok(sets.some(e => e[2] === 'textContent' && e[3] === 'x\\\\u{202E}y → 0'), 'drawn with its control as a code')""",
    """  assert.ok(sets.some(e => e[2] === 'textContent' && e[3] === '? → 0'), 'a count that isn\\'t one is drawn as ?, its control never')""")
open(p, 'w').write(s)
print('ok')
