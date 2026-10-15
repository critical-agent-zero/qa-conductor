// A QA session's action log (#8): what each pane's proxy forwarded to its
// app, and the marks the harness posts for the actions each pane's bridge
// reports, mirrored or not, so a reviewer sees which requests each action
// set off. Pure apart from the clock: the conductor (lib/server.mjs) keeps
// one per session, in memory, and drops it with the session.
//
// Value-free by construction. An entry keeps the method, the path, the
// status, the time it took and the bytes sent back: never a header, a
// cookie, a body or a query value. Paths lose every segment that looks like
// a value (a token, an email address, a long number), since a pane's paths
// carry what its app put there. Marks keep the pane and the kind of action:
// never the element, the text or what was typed. A mark comes from the
// pane's own bridge, which PR code can drive, so it is labelled as reported
// by that pane.

import { randomBytes } from 'node:crypto'

const PANES = ['base', 'pr']
export const MARK_TYPES = ['click', 'submit', 'change', 'enter']
// What the proxies say when they refuse a request before forwarding it.
const REFUSALS = new Set([
  'cross-site request refused', 'cross-site framing refused', 'cross-site navigation refused', 'capability', 'misdirected',
])
const MAX_PATH = 200
const QUERY_KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,40}$/
// Seven digits or more, each joined to the next by at most one separator.
const DIGIT_RUN = /\p{Nd}(?:[^\p{L}\p{Nd}]?\p{Nd}){6,}/u

// The clock requests and marks are stamped with: the wall clock at the
// process's start, then monotonic, so a step back of the system clock never
// reorders them.
export const monotonicNow = () => performance.timeOrigin + performance.now()

// A segment decoded until it stops changing, at most three times: a value
// encoded twice is still seen. An escape that doesn't decode stops it.
function decoded(segment) {
  let s = segment
  for (let i = 0; i < 3; i++) {
    let next
    try { next = decodeURIComponent(s) } catch { break }
    if (next === s) break
    s = next
  }
  return s
}

// A key as shown: itself when it looks like a name and not like a value.
const shownKey = key => (QUERY_KEY.test(key) && maskSegment(key) === key ? key : '…')

// What a path segment shows: itself, or what kind of value it held. A
// heuristic: what looks like an email address, a key=value pair, a JWT, a
// number of seven digits or more (a phone, a card, an account), hex, a long
// mix of letters and digits, or a run of 24 letters or more goes; a short
// code or token can slip through.
function maskSegment(segment) {
  if (segment === '') return segment
  const s = decoded(segment)
  if (/[@＠﹫]/.test(s) || /%(?:25)*40/i.test(segment)) return ':email'
  const eq = s.indexOf('=')
  if (eq !== -1) return `${shownKey(s.slice(0, eq))}=…` // key=value, matrix parameters included
  if (/^eyJ[\w-]*\.[\w-]*\.[\w-]*$/.test(s)) return ':token' // a JWT
  if (DIGIT_RUN.test(s)) return ':number'
  if (/^[0-9a-f]{16,}$/i.test(s)) return ':token' // hex
  if (s.length >= 16 && /[A-Za-z]/.test(s) && /\d/.test(s)) return ':token'
  if (s.length >= 20 && /[a-z]/.test(s) && /[A-Z]/.test(s)) return ':token' // base64-like
  if (/[A-Za-z]{24,}/.test(s)) return ':token' // no word is that long
  return segment
}

// A request target as the log shows it: the path with its value-like
// segments masked, then the query's keys with every value dropped, at most
// MAX_PATH characters. A key that doesn't look like a name, or looks like a
// value, is masked too, and so is a query part with no `=`, which is
// usually a value itself.
export function sanitizePath(url) {
  if (typeof url !== 'string') return '/'
  let target = url.split('#')[0]
  if (!target.startsWith('/')) {
    try {
      const u = new URL(target)
      target = u.pathname + u.search
    } catch {
      return '/'
    }
  }
  const at = target.indexOf('?')
  const path = (at === -1 ? target : target.slice(0, at)).split('/').map(maskSegment).join('/')
  const parts = at === -1 ? [] : target.slice(at + 1).split('&').filter(Boolean)
  const query = parts
    .map(part => {
      const eq = part.indexOf('=')
      if (eq === -1) return '…'
      return eq === 0 ? null : `${shownKey(part.slice(0, eq))}=…`
    })
    .filter(part => part !== null)
    .join('&')
  const out = query ? `${path}?${query}` : path
  return out.length > MAX_PATH ? `${out.slice(0, MAX_PATH - 1)}…` : out
}

export function sanitizeMethod(method) {
  return typeof method === 'string' && /^[A-Z]{1,12}$/.test(method) ? method : 'OTHER'
}

const count = value => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0)

function assertPane(pane) {
  if (!PANES.includes(pane)) throw new Error('pane must be base or pr')
}

// The most requests one read gives, new ones and regrouped ones each.
export const MAX_READ = 2_000
// How long a request still running may have been, for the marks kept.
const PRUNE_HORIZON_MS = 60_000

// maxEntries per pane, a ring: the oldest go first, counted in `dropped`.
// Marks: at most one of each kind per pane every markGapMs (a click and the
// submit it sets off come within milliseconds), from a budget per pane of
// maxMarks that refills one mark every markRefillMs. PR code can post bridge
// messages: it can use up its own pane's budget for a while, never the base
// pane's. Those refused are counted per pane. A request belongs to the
// nearest mark of those that came no more than groupWindowMs after it
// started (the mark a click posts can arrive after the request the click set
// off), its own pane's when one is that close, worked out when read. Marks
// group both panes' requests: a mirrored action is reported by the pane it
// happened in only.
export function createActionLog({
  now = monotonicNow, maxEntries = 5_000, maxMarks = 2_000, markRefillMs = 1_000, markGapMs = 100, groupWindowMs = 300,
} = {}) {
  // which log a reader is reading: a new session's starts its seq again
  const id = randomBytes(8).toString('hex')
  let seq = 0
  const entries = { base: [], pr: [] }
  const dropped = { base: 0, pr: 0 }
  const refusals = { base: {}, pr: {} }
  // in time order: a clock that steps back is held at the last mark's time
  let marks = []
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
    const m = { seq: ++seq, pane, at: Math.max(t, marks.at(-1)?.at ?? -Infinity), type }
    marks.push(m)
    if (marks.length > 4 * maxMarks) prune()
    return m
  }

  // Lets go of the marks no request can belong to: those before the window
  // of the earliest request in the rings, and of one still running that
  // started up to PRUNE_HORIZON_MS ago, but the last of them.
  function prune() {
    const ats = [...entries.base, ...entries.pr].map(e => e.at)
    const earliest = Math.min(ats.length ? Math.min(...ats) : Infinity, now() - PRUNE_HORIZON_MS)
    const keepFrom = lastAtOrBefore(earliest - groupWindowMs, marks.length)
    if (keepFrom > 0) marks = marks.slice(keepFrom)
  }

  // The index of the last of the first `known` marks at or before time t,
  // or -1.
  function lastAtOrBefore(t, known) {
    let lo = 0
    let hi = known - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (marks[mid].at <= t) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    return found
  }

  // The mark a request of `pane` that started at t belongs to, of the first
  // `known` marks: of those no more than groupWindowMs after it, its own
  // pane's nearest within groupWindowMs either side, else the nearest; on a
  // tie, the earlier. null before any (the landing).
  function markOf(t, pane, known) {
    const last = lastAtOrBefore(t + groupWindowMs, known)
    if (last === -1) return null
    let mine = null
    for (let i = last; i >= 0 && marks[i].at >= t - groupWindowMs; i--) {
      if (marks[i].pane === pane && (mine === null || Math.abs(marks[i].at - t) <= Math.abs(mine.at - t))) mine = marks[i]
    }
    if (mine !== null) return mine.seq
    const before = lastAtOrBefore(t, known)
    if (before === -1) return marks[0].seq
    const next = before + 1 <= last ? marks[before + 1] : null
    return next !== null && next.at - t < t - marks[before].at ? next.seq : marks[before].seq
  }

  const knownAt = s => marks.findLastIndex(m => m.seq <= s) + 1

  // What came after sequence number `after`: at most `limit` new requests
  // (MAX_READ at most), `more` when there are others, and `seq`, where to
  // read on from. An earlier request whose mark the new marks change is
  // given again, regrouped: at most `limit` of those too, else `resync`
  // says to drop what was read and read again from 0. A page groups only
  // against the marks it gives or gave. `log` names this log: a new
  // session's is another.
  function read(after, { limit = MAX_READ } = {}) {
    const from = Number.isSafeInteger(after) && after >= 0 ? after : 0
    const most = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_READ) : MAX_READ
    const all = [...entries.base, ...entries.pr].sort((a, b) => a.seq - b.seq)
    const fresh = all.filter(entry => entry.seq > from)
    const page = fresh.slice(0, most)
    const more = fresh.length > page.length
    const until = more ? page.at(-1).seq : seq
    const known = knownAt(until)
    const knew = knownAt(from)
    const newMarks = marks.slice(knew, known)
    const since = newMarks.length ? newMarks[0].at - groupWindowMs : Infinity
    const again = from > 0
      ? all.filter(e => e.seq <= from && e.at >= since && markOf(e.at, e.pane, knew) !== markOf(e.at, e.pane, known))
      : []
    const counts = { dropped: { ...dropped }, refused: { base: { ...refusals.base }, pr: { ...refusals.pr } }, marksDropped: { ...marksDropped } }
    if (again.length > most) return { log: id, seq: 0, more: true, resync: true, marks: [], requests: [], ...counts }
    return {
      log: id,
      seq: until,
      more,
      resync: false,
      marks: newMarks.map(m => ({ ...m })),
      requests: [...again, ...page].map(entry => ({ ...entry, mark: markOf(entry.at, entry.pane, known) })),
      ...counts,
    }
  }

  return { record, refused, mark, read }
}
