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

// What a path segment shows: itself, or what kind of value it held.
function maskSegment(segment) {
  if (segment === '') return segment
  const s = decoded(segment)
  if (s.includes('@')) return ':email'
  if (/^\d{9,}$/.test(s)) return ':number'
  if (/^eyJ[\w-]*\.[\w-]*\.[\w-]*$/.test(s)) return ':token' // a JWT
  if (/^[0-9a-f]{16,}$/i.test(s)) return ':token' // hex
  if (s.length >= 16 && /[A-Za-z]/.test(s) && /\d/.test(s)) return ':token'
  if (s.length >= 20 && /[a-z]/.test(s) && /[A-Z]/.test(s)) return ':token' // base64-like
  return segment
}

// A request target as the log shows it: the path with its value-like
// segments masked, then the query's keys with every value dropped, at most
// MAX_PATH characters. A key that doesn't look like a name, or looks like a
// value, is masked too.
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
  const keys = at === -1 ? [] : target.slice(at + 1).split('&').map(part => part.split('=')[0]).filter(Boolean)
  const query = keys.map(key => `${QUERY_KEY.test(key) && maskSegment(key) === key ? key : '…'}=…`).join('&')
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

// maxEntries per pane, a ring: the oldest go first, counted in `dropped`.
// At most one mark per pane every markGapMs, and maxMarks in all; those
// refused are counted. A request belongs to the latest mark that came no
// more than groupWindowMs after it started (the mark a click posts can
// arrive after the request the click set off), worked out when read.
export function createActionLog({ now = Date.now, maxEntries = 5_000, maxMarks = 2_000, markGapMs = 100, groupWindowMs = 300 } = {}) {
  let seq = 0
  const entries = { base: [], pr: [] }
  const dropped = { base: 0, pr: 0 }
  const refusals = { base: {}, pr: {} }
  const marks = []
  const lastMark = { base: -Infinity, pr: -Infinity }
  let marksDropped = 0

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
    const at = now()
    if (at - lastMark[pane] < markGapMs || marks.length >= maxMarks) { marksDropped++; return null }
    lastMark[pane] = at
    const m = { seq: ++seq, pane, at, type }
    marks.push(m)
    return m
  }

  // The mark a request started under, or null (before any: the landing).
  function markOf(at) {
    for (let i = marks.length - 1; i >= 0; i--) if (marks[i].at - groupWindowMs <= at) return marks[i].seq
    return null
  }

  function read(after) {
    const from = Number.isSafeInteger(after) && after >= 0 ? after : 0
    const requests = [...entries.base, ...entries.pr]
      .filter(entry => entry.seq > from)
      .sort((a, b) => a.seq - b.seq)
      .map(entry => ({ ...entry, mark: markOf(entry.at) }))
    return {
      seq,
      marks: marks.filter(m => m.seq > from).map(m => ({ ...m })),
      requests,
      dropped: { ...dropped },
      refused: { base: { ...refusals.base }, pr: { ...refusals.pr } },
      marksDropped,
    }
  }

  return { record, refused, mark, read }
}
