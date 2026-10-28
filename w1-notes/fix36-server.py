p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/server.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert a in s, a[:70]
    s = s.replace(a, b, 1)


sub("""  actions = null
  endCapture()
  progressLog.length = 0""", """  actions = null
  // the last session's probes close before this boot goes on
  const closingCapture = endCapture()
  progressLog.length = 0""")
sub("""    await startupSweep
    if (ac.signal.aborted) return { ran: false } // torn down or taken over while waiting""",
    """    await closingCapture
    await startupSweep
    if (ac.signal.aborted) return { ran: false } // torn down or taken over while waiting""")
sub("""function json(res, status, body, headers = {}) {
  const buf = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(buf), ...headers })
  res.end(buf)
}""", """function json(res, status, body, headers = {}) {
  sendJson(res, status, JSON.stringify(body), headers)
}
function sendJson(res, status, buf, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(buf), ...headers })
  res.end(buf)
}""")
sub("""      return json(res, 200, { active: true, ...data.view({ isolation }) }, NO_STORE)""",
    """      // built once for each state, however many read it
      return sendJson(res, 200, data.viewJson({ isolation }), NO_STORE)""")
sub("""      return json(res, 200, { active: true, ...mine.view({ isolation }) }, NO_STORE)""",
    """      return sendJson(res, 200, mine.viewJson({ isolation }), NO_STORE)""")
open(p, 'w').write(s)
print('ok')
