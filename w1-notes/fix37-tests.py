W = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/'
p = W + 'repo/test/harness.test.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b, 1)


sub("""const {
  esc, isHttpsUrl, LABELS, harnessOriginNotice, buildSummary, buildFromEvent, inviteFromHash, isCapabilityRefusal, isolationLabel,
  cellText, trustLabel, flagText, dataBadge, dataNodes, actionsFresh, mergeActions, actionsNodes,
} = cjsModule.exports""", """const {
  esc, isHttpsUrl, LABELS, harnessOriginNotice, buildSummary, buildFromEvent, inviteFromHash, isCapabilityRefusal, isolationLabel,
  cellText, trustLabel, flagText, dataBadge, dataNodes, actionsFresh, mergeActions, markOf, actionsNodes, drawnText,
} = cjsModule.exports""")
sub("""    'LABELS', 'actionsFresh', 'actionsNodes', 'buildFromEvent', 'buildSummary', 'cellText', 'dataBadge', 'dataNodes', 'esc', 'flagText',
    'harnessOriginNotice', 'inviteFromHash', 'isCapabilityRefusal', 'isHttpsUrl', 'isolationLabel', 'mergeActions', 'trustLabel',""",
    """    'LABELS', 'actionsFresh', 'actionsNodes', 'buildFromEvent', 'buildSummary', 'cellText', 'dataBadge', 'dataNodes', 'drawnText', 'esc', 'flagText',
    'harnessOriginNotice', 'inviteFromHash', 'isCapabilityRefusal', 'isHttpsUrl', 'isolationLabel', 'keyText', 'markOf', 'mergeActions', 'trustLabel',""")
sub("""import { dirname, join } from 'node:path'
""", """import { dirname, join } from 'node:path'

import { createMasker, diffSnapshots, divergence, flagChanges, sanitizeSnapshot, validateRules } from '../lib/data-diff.mjs'
""")

# the stand-in browser: a held answer, and intervals that clear
sub("""// stub, fetch answers from `routes` (an answer, or a function of the request's
// body and headers; `ticks` holds an answer back that many turns), and the""",
    """// stub, fetch answers from `routes` (an answer, or a function of the request's
// body and headers; `ticks` holds an answer back that many turns, and `hold`
// until that promise settles), and the""")
sub("""  const intervals = [] // { fn, ms }, in the order set; none ever runs by itself""",
    """  const intervals = [] // { fn, ms, cleared }, in the order set; none ever runs by itself""")
sub("""      const { status = 200, body = {}, headers = {}, ticks = 0 } = out
      for (let i = 0; i < ticks; i++) await new Promise(r => setImmediate(r))""",
    """      const { status = 200, body = {}, headers = {}, ticks = 0, hold } = out
      for (let i = 0; i < ticks; i++) await new Promise(r => setImmediate(r))
      if (hold) await hold""")
sub("""    setInterval: (fn, ms) => intervals.push({ fn, ms }),
    clearInterval: () => {},""",
    """    setInterval: (fn, ms) => intervals.push({ fn, ms, cleared: false }),
    clearInterval: id => { if (intervals[id - 1]) intervals[id - 1].cleared = true },""")

a = s.index('// --- #8: the Data and Actions panels ----')
b = s.index('// The throttle runs on a monotonic clock')
s = s[:a] + open(W + 'notes/8d-tests.mjs').read() + s[b:]
open(p, 'w').write(s)
print('ok')
