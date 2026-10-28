p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/action-log.mjs'
s = open(p).read()
start = s.index("// The most requests one read gives, new ones and regrouped ones each.")
end = s.index("  return { record, refused, mark, read }\n}")
new = '''// The most a read gives: requests and marks together.
export const MAX_READ = 2_000

// One sequence numbers every request and mark, in the order they were
// recorded (a request when it ends), and a read gives the next of them,
// requests and marks alike, at most `limit`: so a reader that reads on from
// its cursor until `more` is false has had everything, in order.
//
// maxEntries requests per pane, a ring: the oldest go first, counted in
// `dropped`. Marks: at most one of each kind per pane every markGapMs (a
// click and the submit it sets off come within milliseconds), from a budget
// per pane of maxMarks that refills one mark every markRefillMs. PR code can
// post bridge messages: it can use up its own pane's budget for as long as
// it keeps posting, never the base pane's. The marks kept are a ring of
// keptMarks per pane. Those refused or no longer kept are counted per pane
// in `marksDropped`.
//
// Which action a request came from is the reader's to work out, from the
// marks it has: README's HTTP API says how. A mark may come after the
// request it set off, so the log never has to give a request again.
export function createActionLog({
  now = monotonicNow, maxEntries = 5_000, maxMarks = 2_000, keptMarks = 4 * maxMarks, markRefillMs = 1_000, markGapMs = 100,
} = {}) {
  // which log a reader is reading: a new session's starts its seq again
  const id = randomBytes(8).toString('hex')
  let seq = 0
  const entries = { base: [], pr: [] }
  const dropped = { base: 0, pr: 0 }
  const refusals = { base: {}, pr: {} }
  // per pane; in time order across both: a clock that steps back is held at
  // the last mark's time
  const marks = { base: [], pr: [] }
  let lastAt = -Infinity
  const lastMark = new Map() // `${pane} ${type}` -> the clock's time
  // in milliseconds of refill: a mark costs markRefillMs
  const full = maxMarks * markRefillMs
  const budget = { base: { left: full, at: null }, pr: { left: full, at: null } }
  const marksDropped = { base: 0, pr: 0 }

  function record(pane, exchange = {}) {
    assertPane(pane)
    const entry = {
      seq: ++seq,
      pane,
      at: Number.isFinite(exchange.at) ? exchange.at : now(),
      method: sanitizeMethod(exchange.method),
      path: sanitizePath(exchange.path),
      status: Number.isInteger(exchange.status) && exchange.status >= 100 && exchange.status <= 999 ? exchange.status : 0,
      ms: count(exchange.ms),
      bytes: count(exchange.bytes),
      aborted: exchange.aborted === true,
    }
    const ring = entries[pane]
    ring.push(entry)
    if (ring.length > maxEntries) { ring.shift(); dropped[pane]++ }
    return entry
  }

  function refused(pane, reason) {
    assertPane(pane)
    const key = REFUSALS.has(reason) ? reason : 'other'
    refusals[pane][key] = (refusals[pane][key] ?? 0) + 1
  }

  // Whether the pane's budget has a mark left at time t, taking it if so.
  function spend(pane, t) {
    const b = budget[pane]
    if (b.at !== null && t > b.at) b.left = Math.min(full, b.left + (t - b.at))
    b.at = b.at === null ? t : Math.max(b.at, t)
    if (b.left < markRefillMs) return false
    b.left -= markRefillMs
    return true
  }

  function mark(pane, type) {
    assertPane(pane)
    if (!MARK_TYPES.includes(type)) throw new Error(`type must be one of ${MARK_TYPES.join(', ')}`)
    const t = now()
    const kind = `${pane} ${type}`
    if (t - (lastMark.get(kind) ?? -Infinity) < markGapMs || !spend(pane, t)) { marksDropped[pane]++; return null }
    lastMark.set(kind, t)
    lastAt = Math.max(t, lastAt)
    const m = { seq: ++seq, pane, at: lastAt, type }
    const ring = marks[pane]
    ring.push(m)
    if (ring.length > keptMarks) { ring.shift(); marksDropped[pane]++ }
    return m
  }

  // What came after sequence number `after`: at most `limit` requests and
  // marks together (MAX_READ at most), in sequence order; `more` when there
  // are others, and `seq`, where to read on from. `log` names this log: a
  // new session's is another, whose seq starts again.
  function read(after, { limit = MAX_READ } = {}) {
    const from = Number.isSafeInteger(after) && after >= 0 ? after : 0
    const most = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_READ) : MAX_READ
    const fresh = [...entries.base, ...entries.pr, ...marks.base, ...marks.pr].filter(e => e.seq > from).sort((a, b) => a.seq - b.seq)
    const page = fresh.slice(0, most)
    const more = fresh.length > page.length
    return {
      log: id,
      seq: more ? page.at(-1).seq : Math.max(from, seq),
      more,
      requests: page.filter(e => 'method' in e).map(e => ({ ...e })),
      marks: page.filter(e => 'type' in e).map(e => ({ ...e })),
      dropped: { ...dropped },
      refused: { base: { ...refusals.base }, pr: { ...refusals.pr } },
      marksDropped: { ...marksDropped },
    }
  }

'''
s = s[:start] + new + s[end:]
open(p, 'w').write(s)
print('ok')
