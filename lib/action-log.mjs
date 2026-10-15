// A QA session's action log (#8): what each pane's proxy forwarded to its
// app, and the marks the harness posts for the actions mirrored between the
// panes, so a reviewer sees which requests each action set off. Pure apart
// from the clock: the conductor (lib/server.mjs) keeps one per session, in
// memory, and drops it with the session.
//
// Value-free by construction. An entry keeps the method, the path, the
// status, the time it took and the bytes sent back: never a header, a
// cookie, a body or a query value. Paths lose every segment that looks like
// a value (a token, an email address, a long number), since a pane's paths
// carry what its app put there. Marks keep the pane and the kind of action:
// never the element, the text or what was typed. A mark comes from the
// pane's own bridge, which PR code can drive, so it is labelled as reported
// by that pane.

const PANES = ['base', 'pr']
export const MARK_TYPES = ['click', 'submit', 'change', 'enter']
// What the proxies say when they refuse a request before forwarding it.
const REFUSALS = new Set([
  'cross-site request refused', 'cross-site framing refused', 'cross-site navigation refused', 'capability', 'misdirected',
])
const MAX_PATH = 200
const QUERY_KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,40}$/

function decoded(segment) {
  try { return decodeURIComponent(segment) } catch { return segment }
}

// A key as shown: itself when it looks like a name and not like a value.
const shownKey = key => (QUERY_KEY.test(key) && maskSegment(key) === key ? key : '…')

// What a path segment shows: itself, or what kind of value it held. A
// heuristic: what looks like an email address, a long number (a phone, a
// card), a key=value pair, a JWT, hex, or a long mix of letters and digits
// goes; a short code or token can slip through.
function maskSegment(segment) {
  if (segment === '') return segment
  const s = decoded(segment)
  if (/@|＠|%40/i.test(segment) || /@|＠/.test(s)) return ':email'
  const eq = segment.indexOf('=')
  if (eq !== -1) return `${shownKey(segment.slice(0, eq))}=…` // key=value, matrix parameters included
  if (/^\+?[\d\s().-]+$/.test(s) && (s.match(/\d/g) ?? []).length >= 7) return ':number'
  if (/^eyJ[\w-]*\.[\w-]*\.[\w-]*$/.test(s)) return ':token' // a JWT
  if (/^[0-9a-f]{16,}$/i.test(s)) return ':token' // hex
  if (s.length >= 16 && /[A-Za-z]/.test(s) && /\d/.test(s)) return ':token'
  if (s.length >= 20 && /[a-z]/.test(s) && /[A-Z]/.test(s)) return ':token' // base64-like
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

// The most requests one read gives.
export const MAX_READ = 2_000

// maxEntries per pane, a ring: the oldest go first, counted in `dropped`.
// At most one mark of each kind per pane every markGapMs (a click and the
// submit it sets off come within milliseconds), and maxMarks per pane (PR
// code can post bridge messages, and use up its own pane's only); those
// refused are counted per pane. A request belongs to the mark nearest it in
// time among those that came no more than groupWindowMs after it started
// (the mark a click posts can arrive after the request the click set off),
// worked out when read.
export function createActionLog({ now = Date.now, maxEntries = 5_000, maxMarks = 2_000, markGapMs = 100, groupWindowMs = 300 } = {}) {
  let seq = 0
  const entries = { base: [], pr: [] }
  const dropped = { base: 0, pr: 0 }
  const refusals = { base: {}, pr: {} }
  // in time order: a clock that steps back is held at the last mark's time
  const marks = []
  const lastMark = new Map() // `${pane} ${type}` -> at
  const markCount = { base: 0, pr: 0 }
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

  function mark(pane, type) {
    assertPane(pane)
    if (!MARK_TYPES.includes(type)) throw new Error(`type must be one of ${MARK_TYPES.join(', ')}`)
    const at = Math.max(now(), marks.at(-1)?.at ?? -Infinity)
    const kind = `${pane} ${type}`
    if (at - (lastMark.get(kind) ?? -Infinity) < markGapMs || markCount[pane] >= maxMarks) { marksDropped[pane]++; return null }
    lastMark.set(kind, at)
    markCount[pane]++
    const m = { seq: ++seq, pane, at, type }
    marks.push(m)
    return m
  }

  // The index of the last mark at or before time t, or -1.
  function lastAtOrBefore(t) {
    let lo = 0
    let hi = marks.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (marks[mid].at <= t) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    return found
  }

  // The mark a request started under: of those no more than groupWindowMs
  // after it, the nearest in time; null before any (the landing).
  function markOf(t) {
    const last = lastAtOrBefore(t + groupWindowMs)
    if (last === -1) return null
    const before = lastAtOrBefore(t)
    if (before === -1) return marks[0].seq
    const next = before + 1 <= last ? marks[before + 1] : null
    return next !== null && next.at - t < t - marks[before].at ? next.seq : marks[before].seq
  }

  // What came after sequence number `after`: at most `limit` new requests
  // (MAX_READ at most), `more` when there are others, and `seq`, where to
  // read on from. A request already given that a newer mark now claims (it
  // started at most groupWindowMs before that mark) is given again,
  // regrouped.
  function read(after, { limit = MAX_READ } = {}) {
    const from = Number.isSafeInteger(after) && after >= 0 ? after : 0
    const most = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_READ) : MAX_READ
    const all = [...entries.base, ...entries.pr].sort((a, b) => a.seq - b.seq)
    const fresh = all.filter(entry => entry.seq > from)
    const page = fresh.slice(0, most)
    const more = fresh.length > page.length
    const until = more ? page.at(-1).seq : seq
    const newMarks = marks.filter(m => m.seq > from && m.seq <= until)
    const since = newMarks.length ? newMarks[0].at - groupWindowMs : Infinity
    const again = from > 0 ? all.filter(entry => entry.seq <= from && entry.at >= since) : []
    return {
      seq: until,
      more,
      marks: newMarks.map(m => ({ ...m })),
      requests: [...again, ...page].map(entry => ({ ...entry, mark: markOf(entry.at) })),
      dropped: { ...dropped },
      refused: { base: { ...refusals.base }, pr: { ...refusals.pr } },
      marksDropped: { ...marksDropped },
    }
  }

  return { record, refused, mark, read }
}
