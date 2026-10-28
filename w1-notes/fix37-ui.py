p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/public/harness.js'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b, 1)


sub("""    if (n.text !== undefined) el.textContent = n.text
    if (n.title) el.title = n.title""", """    if (n.text !== undefined) el.textContent = drawnText(n.text)
    if (n.title) el.title = drawnText(n.title)""")

sub("""  const D = { open: false, data: null, ui: DATA_UI(), busy: false }""",
    """  const D = { open: false, data: null, ui: DATA_UI(), busy: false, failed: false }""")

sub("""    $('dataBtn').title = n ? `Data checks (d): ${n} destructive change${n === 1 ? '' : 's'} only the PR made` : 'Data checks (d)'
  }
  function drawData() { drawNodes('dataBody', dataNodes(D.data, D.ui)); showDataBadge() }
  async function loadData() {
    const mounted = S.mounted
    let data
    try { data = await api('/data') } catch (err) { if (!err.capability) $('dataStatus').textContent = `Couldn't read the data checks: ${err.message}`; return }
    if (S.mounted !== mounted) return // another session's view now
    D.data = data; $('dataStatus').textContent = ''
    drawData()
  }""", """    $('dataBtn').title = n ? `Data checks (d): ${n} red flag${n === 1 ? '' : 's'}` : 'Data checks (d)'
  }
  function drawData() { drawNodes('dataBody', dataNodes(D.data, D.ui, D.failed)); showDataBadge() }
  async function loadData() {
    const mounted = S.mounted
    let data
    try {
      data = await api('/data')
    } catch (err) {
      if (S.mounted !== mounted) return
      if (!err.capability) $('dataStatus').textContent = `Couldn't read the data checks: ${err.message}`
      D.failed = true; drawData()
      return
    }
    if (S.mounted !== mounted) return // another session's view now
    D.data = data; D.failed = false; $('dataStatus').textContent = ''
    drawData()
  }""")

sub("""    D.busy = true; $('dataStatus').textContent = rebaseline ? 'Re-baselining…' : 'Taking a snapshot…'
    try {
      D.data = await postJson('/data/snapshot', { rebaseline })
      $('dataStatus').textContent = ''
      drawData()
      const n = dataBadge(D.data)
      announce(rebaseline ? 'Re-baselined: now is the baseline' : `Snapshot taken: ${n} destructive change${n === 1 ? '' : 's'} only the PR made`)
    } catch (err) {
      if (!err.capability) $('dataStatus').textContent = `${rebaseline ? 'Re-baseline' : 'Snapshot'} failed: ${err.message}`
    } finally { D.busy = false }""", """    const mounted = S.mounted
    D.busy = true; $('dataStatus').textContent = rebaseline ? 'Re-baselining…' : 'Taking a snapshot…'
    try {
      const data = await postJson('/data/snapshot', { rebaseline })
      if (S.mounted !== mounted) return // another session's view now
      D.data = data; D.failed = false
      $('dataStatus').textContent = ''
      drawData()
      const n = dataBadge(D.data)
      announce(rebaseline ? 'Re-baselined: now is the baseline' : `Snapshot taken: ${n} red flag${n === 1 ? '' : 's'}`)
    } catch (err) {
      if (S.mounted === mounted && !err.capability) $('dataStatus').textContent = `${rebaseline ? 'Re-baseline' : 'Snapshot'} failed: ${err.message}`
    } finally { D.busy = false }""")

sub("""  // The action log, read on from where the last read ended, a few pages at a
  // time: another session's log, or `resync`, starts it over from 0.""",
    """  // The action log, read on from where the last read ended, a few pages at a
  // time: another session's log starts it over from 0.""")

sub("""  function setActionsPanel(open) {
    A.open = open; $('actionsPanel').hidden = !open; $('actionsBtn').classList.toggle('on', open)
    if (A.timer) { clearInterval(A.timer); A.timer = null }
    if (open) { readActions(); A.timer = setInterval(readActions, 2000) }
  }""", """  function setActionsPanel(open) {
    A.open = open; $('actionsPanel').hidden = !open; $('actionsBtn').classList.toggle('on', open)
    pollActions()
  }
  // Read while the panel is open and in view: not on the verdict-done view,
  // say, where it can't be seen.
  function pollActions() {
    const want = A.open && !$('session').hidden
    if (want && !A.timer) { readActions(); A.timer = setInterval(readActions, 2000) }
    if (!want && A.timer) { clearInterval(A.timer); A.timer = null }
  }""")

sub("""    D.data = null; D.ui = DATA_UI(); A.state = actionsFresh()
    $('dataBtn').hidden = !S.dataAvailable""", """    D.data = null; D.failed = false; D.ui = DATA_UI(); A.state = actionsFresh()
    $('dataBtn').hidden = !S.dataAvailable""")

sub("""    setActionsPanel(false); setDataPanel(false)
    D.data = null; A.state = actionsFresh()""", """    setActionsPanel(false); setDataPanel(false)
    D.data = null; D.failed = false; A.state = actionsFresh()""")

sub("""    for (const v of ['enrol', 'picker', 'boot', 'session', 'verdictDone']) $(v).hidden = v !== id
""", """    for (const v of ['enrol', 'picker', 'boot', 'session', 'verdictDone']) $(v).hidden = v !== id
    pollActions()
""")
open(p, 'w').write(s)
print('ok')
