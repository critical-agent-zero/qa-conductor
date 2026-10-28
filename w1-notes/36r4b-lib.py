R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/data-capture.mjs', [
    ("""// inspector: { open, rules? }; rules: validated (validateRules). key: the
// session's HMAC key, fresh by default.
// diff: diffSnapshots, for tests.
export function createDataCapture({ inspector, rules, limits = {}, key = randomBytes(32), now = Date.now, onCapture = () => {}, viewBytes = VIEW_BYTES, diff = diffSnapshots }) {""",
     """// inspector: { open, rules? }; rules: validated (validateRules). key: the
// session's HMAC key, fresh by default.
export function createDataCapture({ inspector, rules, limits = {}, key = randomBytes(32), now = Date.now, onCapture = () => {}, viewBytes = VIEW_BYTES }) {"""),
    ("""  // a version for each change of what view() shows, and the answer cached;
  // a version for the boot span, which changes only when a pane settles or
  // ready runs, and its spans cached by trust; the session span's diffs
  // and divergence, cached for each version (they don't depend on trust)
  let version = 0
  let cached = null // { id, json }
  let bootVersion = 0
  const bootSpans = new Map() // `${bootVersion} ${runs > 0} ${trusted}` -> span
  let sessionMemo = null // { version, base, pr, divergence }""",
     """  // a version for each change of what view() shows, and the answer cached
  let version = 0
  let cached = null // { id, json }"""),
    ("""      const raw = await bounded(s => probe.snapshot({ limits: { maxRows: lim.maxRows, maxBytes: lim.maxBytes, maxCells: lim.maxCells, timeoutMs: lim.timeoutMs }, signal: s }), lim.timeoutMs, signal)""",
     """      const raw = await bounded(s => probe.snapshot({ limits: { maxRows: lim.maxRows, maxBytes: lim.maxBytes, timeoutMs: lim.timeoutMs }, signal: s }), lim.timeoutMs, signal)"""),
    ("""    baseAt[pane] = at
    bootVersion++
    if (seeded[pane]) {
      boot[pane] = diff(seeded[pane], snap)""",
     """    baseAt[pane] = at
    if (seeded[pane]) {
      boot[pane] = diffSnapshots(seeded[pane], snap)"""),
    ("""    // The session span's diffs and divergence: once for each state, whatever
    // the trust. The boot span: once for each settle, for each trust.
    if (sessionMemo?.version !== version) {
      const sessionOf = pane => (baseline[pane] && latest[pane] ? diff(baseline[pane], latest[pane]) : null)
      sessionMemo = { version, base: sessionOf('base'), pr: sessionOf('pr'), divergence: null }
    }
    const memo = sessionMemo
    const sessionDivergence = () => (memo.divergence ??= divergence(memo.base, memo.pr))
    const newest = pane => latest[pane] ?? baseline[pane] ?? seeded[pane]
    const both = (pair, runOf) => !(pair.base && pair.pr) || runOf.base === runOf.pr
    const bootAligned = !(boot.base && boot.pr) || (bootRun.base === readyRun && bootRun.pr === readyRun)
    const bootKey = `${bootVersion} ${runs > 0} ${trust}`
    const bootSpan = () => {
      if (!lists) return span(boot.base, boot.pr, bootAligned, runs > 0 ? 'failed' : null, () => divergence(boot.base, boot.pr))
      if (!bootSpans.has(bootKey)) {
        if (bootSpans.size >= 4) bootSpans.clear()
        bootSpans.set(bootKey, span(boot.base, boot.pr, bootAligned, runs > 0 ? 'failed' : null, () => divergence(boot.base, boot.pr)))
      }
      return bootSpans.get(bootKey)
    }""",
     """    const sessionOf = pane => (baseline[pane] && latest[pane] ? diffSnapshots(baseline[pane], latest[pane]) : null)
    const newest = pane => latest[pane] ?? baseline[pane] ?? seeded[pane]
    const both = (pair, runOf) => !(pair.base && pair.pr) || runOf.base === runOf.pr
    const bootAligned = !(boot.base && boot.pr) || (bootRun.base === readyRun && bootRun.pr === readyRun)
    const session = { base: sessionOf('base'), pr: sessionOf('pr') }"""),
    ("""      boot: bootSpan(),
      session: latestAt === null ? null : span(memo.base, memo.pr, both(memo, baseRun), fresh.pr ? 'baseline' : 'failed', sessionDivergence),""",
     """      boot: span(boot.base, boot.pr, bootAligned, runs > 0 ? 'failed' : null, () => divergence(boot.base, boot.pr)),
      session: latestAt === null ? null : span(session.base, session.pr, both(session, baseRun), fresh.pr ? 'baseline' : 'failed', () => divergence(session.base, session.pr)),"""),
    ("""    cached = null
    sessionMemo = null
    bootSpans.clear()
""", """    cached = null
"""),
])
print('ok')
