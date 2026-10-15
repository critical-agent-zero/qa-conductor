// PR-QA harness: hash-routed picker → boot → side-by-side session → verdict.
// Plain browser JS, zero dependencies. Server state is authoritative on load.
//
// The pure helpers live at top level and are exported through the CommonJS
// guard at the bottom (as bridge.js does) so `node --test` can exercise them;
// the UI IIFE is inert outside a browser. Text that came from a server,
// adapter or PR (titles, build messages, reasons, errors) is rendered with
// textContent or esc(); links from adapters must be https.
/* eslint-env browser */

// One name per boot step, used by the step list, announcements and errors.
// The step ids are the session states and never change.
const LABELS = { 'ensuring-image': 'Building', cloning: 'Preparing data', migrating: 'Migrating', starting: 'Starting' }

function esc(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Only https links from adapters (build runs) become anchors: no javascript:.
function isHttpsUrl(u) {
  return typeof u === 'string' && /^https:\/\//i.test(u)
}

// Where to send a viewer who opened the harness somewhere other than its
// configured origin (say localhost for 127.0.0.1): the panes refuse to load
// in, or mirror with, any other origin. null when there's nothing to say.
function harnessOriginNotice(configured, current) {
  if (!configured || configured === current) return null
  return `${configured}/qa/`
}

// The text under the first boot step for the latest build event (buildRun's
// shape): its message, else a summary of the run, which names a completed
// run's conclusion when it isn't success.
function buildSummary({ url, status, conclusion, message } = {}) {
  if (message) return message
  if (!url && !status) return 'Build started'
  if (status !== 'completed') return `Build ${status || 'in progress'}`
  return conclusion && conclusion !== 'success' ? `Build ended: ${String(conclusion).replace(/_/g, ' ')}` : 'Build complete'
}

// An SSE `build` event, in buildRun's shape.
function buildFromEvent(e) {
  return { url: e.runUrl, status: e.runStatus, conclusion: e.runConclusion, message: e.message }
}

// Whether an API answer refused the call for want of the capability: a 403
// marked X-QA-Refusal: capability, or, where a pane proxy in front dropped
// that header (self-QA's nested harnesses), so marked in its body.
function isCapabilityRefusal(status, refusalHeader, body) {
  return status === 403 && (refusalHeader === 'capability' || (body !== null && typeof body === 'object' && body.refusal === 'capability'))
}

// What the header's isolation chip says for a verdict (/api/state's
// `isolation`): its text, whether it warns, and its reasons as the title;
// null before there is one.
// A Map, so a verdict named like an Object member is just unknown.
const NOT_ISOLATED = new Map([['reachable', 'not isolated'], ['shared-host', 'shared host']])
function isolationLabel(isolation, strict = false) {
  if (!isolation || typeof isolation !== 'object') return null
  const reasons = Array.isArray(isolation.reasons) ? isolation.reasons.join('; ') : ''
  const label = isolation.verdict === 'isolated'
    ? { text: 'isolated', warn: false, title: 'The PR pane can\'t reach the base pane, so the base pane shows what the base did' }
    : { text: NOT_ISOLATED.get(isolation.verdict) || 'isolation unknown', warn: true, title: reasons }
  if (!strict) return label
  // strict mode (QA_REQUIRE_ISOLATION=1), said beside the verdict
  const rule = 'QA_REQUIRE_ISOLATION=1 refuses a session that isn\'t isolated'
  return { text: `${label.text} · strict`, warn: label.warn, title: label.title ? `${label.title} — ${rule}` : rule }
}

// The kind of action a bridge event is, as the action log marks it (#8), or
// null for one it doesn't: a click, a submit, a change, or Enter.
function markType(event) {
  const type = event && event.type
  if (type === 'click' || type === 'submit' || type === 'change') return type
  if (type === 'keydown' && event.key === 'Enter') return 'enter'
  return null
}

// --- #8: the Data and Actions panels -----------------------------------------
// What they show comes from the panes' data and requests, which PR code
// controls: collection and field names, values, paths. So it is built here as
// plain nodes, { tag, cls, text, title, act, children }, which the page draws
// with textContent only (drawNodes). `act` names what a click on the node does.

// The most rows a list shows, the most actions the Actions panel shows, and
// the most requests and marks it keeps.
const SHOWN_ROWS = 50
const SHOWN_ACTIONS = 100
const KEPT_REQUESTS = 4_000
const KEPT_MARKS = 2_000
const PANE_NAMES = { base: 'BASE', pr: 'PR' }
const paneName = pane => PANE_NAMES[pane] || '?'
const node = (tag, cls, text, extra = {}) => ({ tag, cls, text, ...extra })

// A local time of day, HH:MM:SS.
function clockTime(at) {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '—' : d.toTimeString().slice(0, 8)
}

// A value as the data checks keep it (lib/data-diff.mjs's cells), as text. A
// secret shows only that it is one; personal data its fingerprint.
function cellText(cell) {
  if (cell === null || cell === undefined) return 'null'
  if (typeof cell === 'string') return JSON.stringify(cell)
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell)
  if (typeof cell !== 'object') return '?'
  if (cell.t === 'json') return String(cell.s)
  if (cell.t === 'long') return `${cell.s}… (${cell.len} characters)`
  if (cell.t === 'blob') return `(${cell.len} bytes)`
  if (cell.t === 'secret') return '(secret)'
  if (cell.t === 'pii') return `(personal data ${cell.fp}, ${cell.type}, ${cell.len})`
  return '?'
}

const rowText = row => (row && typeof row === 'object' ? Object.keys(row).map(k => `${k}: ${cellText(row[k])}`).join(', ') : '—')
const isSecret = cell => cell !== null && typeof cell === 'object' && cell.t === 'secret'
const fieldsText = fields => (Array.isArray(fields) ? fields : [])
  .map(f => (isSecret(f.before) || isSecret(f.after) ? `${f.field}: (secret, changed)` : `${f.field}: ${cellText(f.before)} → ${cellText(f.after)}`))
  .join(', ')
const deltaText = c => (c ? `+${c.inserted} ~${c.updated} −${c.deleted}` : '—')

// What the trust chip says: whether what the base pane did can excuse a PR
// change, by the session's isolation verdict.
function trustLabel(trust) {
  return trust === 'trusted'
    ? { text: 'trusted', warn: false, title: 'The PR pane is isolated from the base pane: a change the base made too is amber' }
    : { text: 'advisory', warn: true, title: 'The PR pane may reach the base pane: what the base did excuses nothing, so every destructive change is red' }
}

const KIND_LABELS = new Map([
  ['delete', 'rows deleted'], ['emptied', 'emptied'], ['dropped', 'dropped'],
  ['column-dropped', 'column dropped'], ['mass-change', 'mass change'], ['cleared', 'value cleared'],
])
const STATUS_LABELS = new Map([
  ['same', 'same'], ['both', 'both'], ['pr-only', 'PR only'], ['base-only', 'base only'], ['differs', 'differs'],
  ['unknown', 'unknown (truncated)'], ['changed', 'changed'], ['added', 'added'],
])
const label = (map, key) => map.get(key) || String(key)

function flagText(f) {
  const field = f.field === undefined ? '' : ` (${f.field})`
  return `${f.collection}: ${label(KIND_LABELS, f.kind)}${field}, PR ${f.pr}, base ${f.base}`
}

// The Data button's badge: the red flags the base didn't share, both spans.
function dataBadge(data) {
  if (!data || !data.active) return 0
  return ['boot', 'session'].reduce((n, span) => n + ((data[span] && data[span].flags) || []).filter(f => f.severity === 'red' && f.base === 0).length, 0)
}

// The collections a span's view lists, in name order.
function spanCollections(span, view) {
  const of = d => (d && d.collections ? Object.keys(d.collections) : [])
  const names = view === 'divergence' ? of(span.divergence) : of(span[view])
  return names.sort()
}

// The Data panel. ui: { span: 'session'|'boot', view: 'divergence'|'base'|'pr',
// open: the index of the collection shown in full, or null }.
function dataNodes(data, ui) {
  if (!data || data.available === false) return [node('p', 'stepSub', 'There is no inspector, so there are no data checks.')]
  if (!data.active) return [node('p', 'stepSub', 'No session is ready.')]
  if (data.closed) return [node('p', 'stepSub', 'The session ended.')]
  const trust = trustLabel(data.trust)
  const out = [node('div', 'dataHead', undefined, {
    children: [
      node('span', `chip${trust.warn ? ' warn' : ''}`, trust.text, { title: trust.title }),
      node('span', 'stepSub', `baseline ${data.baselineAt ? clockTime(data.baselineAt) : '—'}${data.rebaselined ? ' (re-baselined)' : ''} · compared ${data.comparedAt ? clockTime(data.comparedAt) : '—'}`),
      node('button', 'secondary', 'Snapshot now', { act: 'snapshot' }),
      node('button', 'ghost', 'Re-baseline', { act: 'rebaseline' }),
    ],
  })]
  const toggle = (group, value, text) => node('button', `secondary${ui[group] === value ? ' on' : ''}`, text, { act: `${group}:${value}` })
  out.push(node('div', 'dataToggles', undefined, {
    children: [
      toggle('span', 'session', 'Session'), toggle('span', 'boot', 'Boot'),
      toggle('view', 'divergence', 'Divergence'), toggle('view', 'base', 'Base'), toggle('view', 'pr', 'PR'),
    ],
  }))
  for (const pane of ['base', 'pr']) {
    const error = data.errors && data.errors[pane]
    if (error) out.push(node('p', 'dataErr', `${paneName(pane)}: ${error}`))
    for (const problem of (data.problems && data.problems[pane]) || []) out.push(node('p', 'stepSub', `${paneName(pane)}: ${problem}`))
  }
  const span = data[ui.span]
  if (!span) {
    out.push(node('p', 'stepSub', ui.span === 'session' ? 'Nothing to compare yet: take a snapshot with Snapshot now.' : 'No boot span: a pane has no seeded or ready snapshot.'))
    return out
  }
  out.push(span.flags.length
    ? node('ul', 'flags', undefined, { children: span.flags.map(f => node('li', `flag ${f.severity === 'red' ? 'red' : 'amber'}`, flagText(f))) })
    : node('p', 'stepSub', 'No destructive change.'))
  const names = spanCollections(span, ui.view)
  const pane = ui.view === 'divergence' ? null : span[ui.view]
  if (ui.view !== 'divergence' && !pane) {
    out.push(node('p', 'stepSub', `The ${paneName(ui.view)} pane has no data for this span.`))
    return out
  }
  const rowsOf = name => {
    if (ui.view === 'divergence') {
      const c = span.divergence.collections[name]
      return [name, deltaText(c.counts.base), deltaText(c.counts.pr), label(STATUS_LABELS, c.status)]
    }
    const c = pane.collections[name]
    return [name, label(STATUS_LABELS, c.status), deltaText({ inserted: c.inserted.length, updated: c.updated.length, deleted: c.deleted.length }), `${c.countBefore} → ${c.countAfter}`]
  }
  const head = ui.view === 'divergence' ? ['collection', 'base', 'PR', 'status'] : ['collection', 'status', 'rows', 'count']
  out.push(node('table', 'dataTable', undefined, {
    children: [
      node('tr', undefined, undefined, { children: head.map(h => node('th', undefined, h)) }),
      ...names.map((name, i) => node('tr', ui.open === i ? 'on' : undefined, undefined, {
        act: `open:${i}`, children: rowsOf(name).map(text => node('td', undefined, text)),
      })),
    ],
  }))
  if (ui.open !== null && ui.open !== undefined && names[ui.open] !== undefined) out.push(...collectionNodes(span, ui.view, names[ui.open]))
  return out
}

// A collection in full: its changes, at most SHOWN_ROWS a list.
function collectionNodes(span, view, name) {
  const list = (title, items, text) => {
    if (!items.length) return []
    const shown = items.slice(0, SHOWN_ROWS).map(item => node('li', undefined, text(item)))
    if (items.length > SHOWN_ROWS) shown.push(node('li', 'stepSub', `and ${items.length - SHOWN_ROWS} more`))
    return [node('h3', undefined, title), node('ul', 'changes', undefined, { children: shown })]
  }
  const out = [node('h3', 'dataName', name)]
  if (view === 'divergence') {
    const c = span.divergence.collections[name]
    const valueOf = (kind, value) => (value === null ? '—' : kind === 'update' ? fieldsText(value) : rowText(value))
    out.push(...list('Changes', c.changes, ch => (ch.key === null
      ? `${ch.kind} ${ch.field}: ${label(STATUS_LABELS, ch.status)}`
      : `${ch.kind} ${ch.key}: ${label(STATUS_LABELS, ch.status)} · base ${valueOf(ch.kind, ch.base)} · PR ${valueOf(ch.kind, ch.pr)}`)))
    if (!c.changes.length) out.push(node('p', 'stepSub', c.status === 'unknown' ? 'Truncated: only its counts are compared.' : 'No change by key to show.'))
    return out
  }
  const c = span[view].collections[name]
  out.push(...list('Inserted', c.inserted, r => `${r.key === null ? '' : `${r.key}: `}${rowText(r.row)}`))
  out.push(...list('Updated', c.updated, u => `${u.key}: ${fieldsText(u.fields)}`))
  out.push(...list('Deleted', c.deleted, r => `${r.key === null ? '' : `${r.key}: `}${rowText(r.row)}`))
  for (const [title, fields] of [['Fields dropped', c.fieldsDropped], ['Fields added', c.fieldsAdded]]) {
    if (fields.length) out.push(node('p', 'stepSub', `${title}: ${fields.join(', ')}`))
  }
  if (c.truncated) out.push(node('p', 'stepSub', 'Truncated: only its count is compared.'))
  return out
}

// The Actions panel's state, from GET /api/actions answers: a fresh one, and
// one with an answer read in. An answer from another log (a new session),
// one that says `resync`, or none active, starts over: `again` says to read
// from 0 now. A request given again replaces the one with its seq.
function actionsFresh() {
  return { log: null, seq: 0, requests: new Map(), marks: new Map(), counts: null, active: false, again: false }
}
function mergeActions(state, answer) {
  if (!answer || !answer.active) return actionsFresh()
  if (answer.resync || (state.log !== null && answer.log !== state.log)) return { ...actionsFresh(), again: true }
  const requests = new Map(state.requests)
  for (const r of answer.requests || []) requests.set(r.seq, r)
  const marks = new Map(state.marks)
  for (const m of answer.marks || []) marks.set(m.seq, m)
  const trim = (map, most) => { if (map.size > most) for (const seq of [...map.keys()].sort((a, b) => a - b).slice(0, map.size - most)) map.delete(seq) }
  trim(requests, KEPT_REQUESTS)
  trim(marks, KEPT_MARKS)
  return {
    log: answer.log, seq: answer.seq, requests, marks, active: true, again: false, more: answer.more === true,
    counts: { dropped: answer.dropped, refused: answer.refused, marksDropped: answer.marksDropped },
  }
}

// The Actions panel: each action the panes reported, newest last, with the
// requests it most likely set off, after the landing's.
function actionsNodes(state) {
  if (!state.active) return [node('p', 'stepSub', 'No session is ready.')]
  const groups = new Map()
  for (const r of [...state.requests.values()].sort((a, b) => a.seq - b.seq)) {
    const key = r.mark === null || r.mark === undefined ? null : r.mark
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const order = [...new Set([...state.marks.keys(), ...groups.keys()])].filter(k => k !== null).sort((a, b) => a - b)
  const shown = order.slice(-SHOWN_ACTIONS)
  const out = []
  if (groups.has(null) && shown.length === order.length) out.push(groupNode('Landing, before any action', groups.get(null)))
  if (order.length > shown.length) out.push(node('p', 'stepSub', `${order.length - shown.length} earlier actions not shown`))
  for (const seq of shown) {
    const m = state.marks.get(seq)
    const title = m ? `${clockTime(m.at)} ${m.type}, reported by the ${paneName(m.pane)} pane` : 'an earlier action'
    out.push(groupNode(title, groups.get(seq) || []))
  }
  if (!out.length) out.push(node('p', 'stepSub', 'Nothing yet: the panes\' requests show here.'))
  const c = state.counts
  if (c) {
    const refused = pane => Object.entries((c.refused && c.refused[pane]) || {}).map(([reason, n]) => `${reason} ${n}`).join(', ') || 'none'
    out.push(node('p', 'stepSub', `dropped: BASE ${c.dropped.base}, PR ${c.dropped.pr} · refused: BASE ${refused('base')}; PR ${refused('pr')} · marks dropped: BASE ${c.marksDropped.base}, PR ${c.marksDropped.pr}`))
  }
  return out
}

function groupNode(title, requests) {
  return node('div', 'action', undefined, {
    children: [
      node('div', 'actionHead', title),
      ...requests.map(r => node('div', 'request', `${paneName(r.pane)} ${r.method} ${r.path} ${r.status || '—'} ${r.ms} ms${r.aborted ? ' (aborted)' : ''}`)),
    ],
  })
}

// The ticket an invite link carries in its fragment (#enrol=<ticket>), else
// null. The fragment never reaches a server or a Referer.
function inviteFromHash(hash) {
  const m = /^#enrol=([A-Za-z0-9_-]+)$/.exec(String(hash ?? ''))
  return m ? m[1] : null
}

;(() => {
  if (typeof window === 'undefined') return
  const $ = id => document.getElementById(id)

  // This browser's capability: the token the conductor gave it at enrolment,
  // kept at the harness origin (localStorage is per origin, port included, so
  // no pane can read it) and sent as X-QA-Cap on every API call. Where
  // storage throws (a private window, say), it lasts until a reload.
  const CAP_KEY = 'qa-cap'
  let capMemory = null
  const cap = {
    get() { try { return localStorage.getItem(CAP_KEY) ?? capMemory } catch { return capMemory } },
    set(token) { capMemory = token; try { localStorage.setItem(CAP_KEY, token) } catch { /* memory only */ } },
    clear() { capMemory = null; try { localStorage.removeItem(CAP_KEY) } catch { /* nothing kept */ } },
  }

  const api = (path, opts = {}) => {
    const token = cap.get()
    const headers = { ...(opts.headers || {}), ...(token ? { 'x-qa-cap': token } : {}) }
    return fetch(`/qa/api${path}`, { ...opts, headers }).then(async r => {
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        const e = new Error(body.error || `HTTP ${r.status}`); e.status = r.status; e.body = body
        // a restart revoked the token, or it was never given one
        e.capability = isCapabilityRefusal(r.status, r.headers.get('x-qa-refusal'), body)
        // not when the token refused is one already replaced
        if (e.capability && path !== '/enrol' && cap.get() === token) lostCapability()
        throw e
      }
      return body
    })
  }
  // The harness refuses non-JSON POSTs (415), so every write goes through here.
  const postJson = (path, body = {}) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const announce = (msg, assertive) => { const el = $(assertive ? 'announcerAssertive' : 'announcer'); el.textContent = ''; el.textContent = msg }
  const stepLabel = step => LABELS[step] || step
  const tagOf = img => (img || '').split(':').pop()
  const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
  const BOOTING = ['ensuring-image', 'cloning', 'migrating', 'starting']

  const S = {
    pr: null, panes: null, paneOrigins: null, mounted: null, startedAt: null,
    mirror: true, scrollMirror: true,
    path: { base: '', pr: '' }, lastMsg: { base: 0, pr: 0 }, hasNav: { base: false, pr: false },
    unmatched: { base: 0, pr: 0 },
    es: null, idlePoll: null, dotPoll: null, notesTimer: null, confirmTimer: null, pendingVerdict: null, strict: false,
    dataAvailable: false,
  }

  // --- router --------------------------------------------------------------
  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/'
    let m = h.match(/^\/pr\/(\d+)\/boot$/); if (m) return { view: 'boot', pr: +m[1] }
    m = h.match(/^\/pr\/(\d+)\/verdict$/); if (m) return { view: 'verdict', pr: +m[1] }
    m = h.match(/^\/pr\/(\d+)$/); if (m) return { view: 'session', pr: +m[1] }
    return { view: 'picker', pr: null }
  }
  const go = hash => { if (location.hash !== hash) location.hash = hash; else render() }
  const setHashSilent = hash => history.replaceState(null, '', hash)

  function showView(id) {
    for (const v of ['enrol', 'picker', 'boot', 'session', 'verdictDone']) $(v).hidden = v !== id
    $('sessionControls').hidden = id !== 'session'
    $('verdictBar').hidden = id !== 'session'
    $('inviteBtn').hidden = id === 'enrol'
    const heading = { boot: 'bootHeading', session: 'sessionHeading' }[id]
    const h = heading ? $(heading) : document.querySelector(`#${id} h1`)
    if (h) setTimeout(() => h.focus(), 0)
  }

  // --- enrolment -------------------------------------------------------------
  // The conductor enrols a browser while no PR code can be running, or with an
  // invite link (#enrol=<ticket>) from a browser it has enrolled.
  let enrolling = null
  let enrolledAt = 0

  // Resolves, once the view it then renders is up, to whether this browser
  // holds the token it got: one refused while that view was drawn is gone.
  async function enrol(invite = null) {
    let token
    try {
      ({ token } = await postJson('/enrol', invite ? { invite } : {}))
    } catch (err) {
      // a browser already enrolled that opens a spent invite stays as it was
      if (invite && cap.get()) { announce(`Invite link not used: ${err.message}`, true); render(); return false }
      showEnrol(err)
      return false
    }
    cap.set(token); enrolledAt = Date.now()
    await render()
    return cap.get() === token
  }

  // An API call was refused for want of the capability: drop the token and
  // enrol again, once at a time. A token refused just after it was given
  // (while the view after enrolling is drawn, say) shows the enrolment view
  // instead of trying again.
  function lostCapability() {
    cap.clear()
    if (Date.now() - enrolledAt < 5000) return showEnrol(null)
    if (enrolling) return
    enrolling = enrol().finally(() => { enrolling = null })
  }

  function showEnrol(err) {
    teardownSessionUi()
    showView('enrol'); setPill('not enrolled')
    // the harness origin, for the banner when this isn't it
    const origin = err && err.body ? err.body.harnessOrigin : null
    if (origin) showOriginNotice(origin)
    $('enrolReason').textContent = err && err.body && err.body.reason ? `Enrolment is closed: ${err.body.reason}.`
      : err && !err.capability && origin ? `Open the harness at ${origin}/qa/ to enrol this browser.`
        : err ? err.message : 'This browser lost its enrolment.'
  }
  $('enrolRetry').onclick = () => { if (!enrolling) enrolling = enrol().finally(() => { enrolling = null }) }

  // An enrolled browser hands out a link that enrols one more, once, within
  // ten minutes, whatever is running.
  $('inviteBtn').onclick = async () => {
    try {
      const { url, expiresAt } = await postJson('/invite')
      $('inviteLink').value = url
      $('inviteExpiry').textContent = `It works once, until ${new Date(expiresAt).toLocaleTimeString()}.`
      $('inviteCopy').textContent = 'Copy'
      $('inviteDialog').showModal(); $('inviteLink').select()
    } catch (err) { if (!err.capability) announce(`Invite failed: ${err.message}`, true) }
  }
  $('inviteCopy').onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText($('inviteLink').value).then(() => { $('inviteCopy').textContent = 'Copied' }, () => {}) }
  $('inviteClose').onclick = () => $('inviteDialog').close()
  function setPill(text) { $('statusPill').textContent = text }

  // The session's isolation verdict, in the header; none while idle.
  function showIsolation(isolation) {
    const el = $('isolationChip'); const label = isolationLabel(isolation, S.strict)
    el.hidden = !label
    if (!label) return
    el.textContent = label.text; el.title = label.title; el.classList.toggle('warn', label.warn)
    el.setAttribute('aria-label', `Isolation: ${label.text}. ${label.title}`)
  }

  // The banner for a harness opened at another origin. Its text is set as
  // text, and the link is made only for an http(s) URL.
  function showOriginNotice(configured) {
    const el = $('originNotice')
    const url = harnessOriginNotice(configured, location.origin)
    el.textContent = ''
    el.hidden = !url
    if (!url) return
    el.append('This harness is meant to be opened at ')
    if (/^https?:\/\//i.test(url)) {
      const a = document.createElement('a'); a.href = url; a.textContent = url
      el.append(a)
    } else {
      el.append(url)
    }
    el.append('. The panes load and mirror only there.')
  }

  async function render() {
    const route = parseHash()
    let s
    try {
      s = await api('/state'); showOriginNotice(s.harnessOrigin); S.strict = s.requireIsolation === true; showIsolation(s.status === 'idle' ? null : s.isolation)
      S.dataAvailable = Boolean(s.data && s.data.available === true)
    } catch (e) {
      if (e && e.capability) return // enrolment takes over
      // At another host or port than the harness origin's, the API refuses a
      // browser (403 not the harness origin) and names the origin instead.
      showOriginNotice(e && e.body ? e.body.harnessOrigin : null)
      s = { status: 'idle' }
    }
    const active = s.status !== 'idle'
    if (route.view === 'picker' || !route.pr) { teardownSessionUi(); return renderPicker(s) }
    if (active && s.pr === route.pr) {
      if (s.status === 'ready') return renderSession(s)
      return renderBoot(route.pr, s)
    }
    teardownSessionUi()
    if (active) return renderPicker(s, { conflictFor: route.pr })
    return renderPicker(s, { endedFor: route.pr })
  }

  // --- picker --------------------------------------------------------------
  const rows = new Map()
  let picking = false

  async function renderPicker(state, opts = {}) {
    setHashSilent('#/')
    showView('picker')
    setPill(state && state.status !== 'idle' ? `session: #${state.pr}` : 'idle')
    renderConflict(state, opts)
    try {
      const { prs, session } = await api('/prs')
      patchRows(prs, session)
    } catch (err) {
      if (err && err.capability) return // enrolment takes over, and renders again
      $('prList').textContent = `Failed to load PRs: ${err.message}`
    }
  }

  function renderConflict(state, opts) {
    const slot = $('conflictSlot'); slot.innerHTML = ''
    if (opts.endedFor) {
      const n = document.createElement('div'); n.className = 'note'
      n.textContent = `Session for #${opts.endedFor} has ended (idle teardown or manual). Pick a PR to start a new one.`
      slot.appendChild(n); return
    }
    if (opts.conflictFor && state && state.status !== 'idle') {
      slot.appendChild(conflictCard(state, opts.conflictFor))
    }
  }

  function conflictCard(state, wantPr) {
    const now = Date.now()
    const readyFor = state.startedAt ? mmss(now - state.startedAt) : '—'
    const idleFor = state.lastActivity ? mmss(now - state.lastActivity) : '—'
    const endsIn = state.lastActivity && state.idleMinutes ? mmss(state.lastActivity + state.idleMinutes * 60000 - now) : '—'
    const c = document.createElement('div'); c.className = 'conflict'
    c.innerHTML = `<h2>A session is already running on #${state.pr}${state.title ? ' — ' + esc(state.title) : ''}</h2>`
      + `<div class="times">${state.status === 'ready' ? `ready ${readyFor}` : esc(state.status)} · idle ${idleFor} · auto-ends in ${endsIn}</div>`
      + `<div class="acts"><button class="secondary" data-resume="${state.pr}">Resume #${state.pr}</button>`
      + `<button class="danger-ghost" data-takeover="${wantPr}">End #${state.pr} and open #${wantPr}</button>`
      + `<button class="ghost" data-back="1">Back</button></div>`
    c.querySelector('[data-resume]').onclick = () => go(`#/pr/${state.pr}`)
    c.querySelector('[data-back]').onclick = () => { $('conflictSlot').innerHTML = '' }
    twoStepConfirm(c.querySelector('[data-takeover]'), 'End & open?', () => openSession(wantPr, { takeover: true }).catch(err => {
      if (!showConflict(err, wantPr)) announce(`Couldn't open #${wantPr}: ${err.message}`, true)
    }))
    return c
  }

  function patchRows(prs, session) {
    const list = $('prList')
    // Text that stood in for the rows ("Loading…", "No open PRs.", an error)
    // detached them all: clear it, and each row is appended again below.
    if (![...rows.values()].some(row => row.parentNode === list)) list.textContent = ''
    if (!prs.length) { list.textContent = 'No open PRs.'; rows.clear(); return }
    const seen = new Set()
    for (const pr of prs) {
      seen.add(pr.number)
      let row = rows.get(pr.number)
      if (!row) { row = document.createElement('div'); row.className = 'pr'; row.dataset.pr = pr.number; rows.set(pr.number, row) }
      if (row.parentNode !== list) list.appendChild(row)
      const holds = session && session.pr === pr.number && session.status !== 'idle'
      const num = esc(pr.number)
      // A blocked PR can still be opened: the build's ensureBuilt is the real gate.
      const action = holds
        ? `<button class="primary" data-open="${num}" data-resume="1">QA session active — Resume</button>`
        : `<button class="primary" data-open="${num}">Open QA</button>`
      row.innerHTML = `<span class="num">#${num}</span>`
        + `<span class="main"><span class="title">${esc(pr.title)}</span>`
        + `<span class="submeta">${esc(pr.headRef || '')}${pr.author ? ' · ' + esc(pr.author) : ''} </span>`
        + `<span class="rowErr" hidden></span></span>${action}`
      row.querySelector('.submeta').appendChild(imageBadge(pr))
    }
    for (const [num, row] of rows) if (!seen.has(num)) { row.remove(); rows.delete(num) }
  }

  function runLink(url, text) {
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = text
    return a
  }

  function imageBadge(pr) {
    const badge = document.createElement('span'); badge.className = 'badge'
    const dot = document.createElement('span')
    let text
    if (pr.imageStatus === 'built') { dot.className = 'dot green'; text = 'ready — opens in seconds' }
    else if (pr.imageStatus === 'building') { dot.className = 'dot amber pulse'; text = 'building…' }
    else if (pr.imageStatus === 'blocked') { dot.className = 'dot grey'; badge.classList.add('blocked'); text = `can't boot: ${pr.reason || 'not allowed'}` }
    else { dot.className = 'dot amber'; text = 'needs build (~10 min)' }
    badge.append(dot, document.createTextNode(text))
    if (pr.imageStatus === 'building' && isHttpsUrl(pr.runUrl)) badge.append(' ', runLink(pr.runUrl, 'run ↗'))
    return badge
  }

  // delegated picker clicks — survive re-renders
  $('prList').addEventListener('click', e => {
    const btn = e.target.closest('button[data-open]'); if (!btn) return
    const num = +btn.dataset.open
    if (btn.dataset.resume) return go(`#/pr/${num}`)
    // one Open QA at a time: rows redrawn meanwhile (a re-enrolment's) are
    // enabled, but take no click
    if (picking) return
    // the row stays while it is re-rendered (a re-enrolment's, say); the
    // buttons in it don't
    const row = btn.closest('.pr')
    for (const b of $('prList').querySelectorAll('button[data-open]')) b.disabled = true
    btn.textContent = 'Opening…'; row.setAttribute('aria-busy', 'true')
    openSession(num).catch(err => {
      row.removeAttribute('aria-busy')
      for (const b of $('prList').querySelectorAll('button[data-open]')) b.disabled = false
      if (!showConflict(err, num)) { const slot = row.querySelector('.rowErr'); slot.hidden = false; slot.textContent = err.message }
    })
  })

  // A 409 naming the session that holds the conductor gets its conflict
  // card. Returns whether it did.
  function showConflict(err, num) {
    if (!(err.status === 409 && err.body && err.body.session)) return false
    $('conflictSlot').innerHTML = ''; $('conflictSlot').appendChild(conflictCard(err.body.session, num))
    return true
  }
  $('refreshBtn').onclick = () => renderPicker(null)

  async function openSession(num, opts = {}) {
    if (picking) return; picking = true
    try {
      await postJson('/session', { pr: num, ...opts }).catch(async err => {
        // A restart revoked the token, and with it any session: once this
        // browser has enrolled again, ask once more. Not as a takeover: a
        // session started since gets its conflict card, not an unseen end.
        if (!(err.capability && enrolling && await enrolling)) throw err
        return postJson('/session', { pr: num })
      })
      go(`#/pr/${num}/boot`)
    } finally { picking = false }
  }

  // --- boot ----------------------------------------------------------------
  const stepAt = {}
  let bootPr = null
  for (const li of $('bootSteps').querySelectorAll('li')) li.querySelector('.stepLabel').textContent = stepLabel(li.dataset.step)

  function renderBoot(pr, state) {
    showView('boot'); setPill(`booting #${pr}`)
    if (bootPr !== pr) { bootPr = pr; for (const k of Object.keys(stepAt)) delete stepAt[k]; resetBootUi() }
    $('bootPr').textContent = pr
    if (state && state.buildRun) setBuildSub(state.buildRun)
    attachSse()
  }
  function resetBootUi() {
    for (const li of $('bootSteps').querySelectorAll('li')) { li.classList.remove('now', 'done'); li.removeAttribute('aria-current'); li.querySelector('.stepTime').textContent = '' }
    $('bootSteps').querySelector('[data-step="ensuring-image"] .stepSub').textContent = ''
    $('bootError').hidden = true; $('bootActions').hidden = true; $('bootActions').textContent = ''; $('bootBar').hidden = false
    $('bootTotal').textContent = ''
  }
  function stepIndex(step) { return BOOTING.indexOf(step) }
  function markStep(step, at) {
    stepAt[step] = at || Date.now()
    const cur = stepIndex(step)
    for (const li of $('bootSteps').querySelectorAll('li')) {
      const i = stepIndex(li.dataset.step)
      li.classList.toggle('now', i === cur); li.classList.toggle('done', i < cur)
      if (i === cur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current')
    }
    announce(`${stepLabel(step)}, step ${cur + 1} of 4`)
  }
  // Build progress under the first step: the BuildConvention's own message
  // when it sends one, else a summary of its CI run, plus an https run link.
  function setBuildSub(build = {}) {
    const { url } = build
    const sub = $('bootSteps').querySelector('[data-step="ensuring-image"] .stepSub')
    sub.textContent = ` — ${buildSummary(build)}`
    if (isHttpsUrl(url)) sub.append(' ', runLink(url, 'view run ↗'))
  }
  let bootTimer = null
  function tickBoot() {
    const now = Date.now()
    const first = stepAt['ensuring-image']
    if (first) $('bootTotal').textContent = mmss(now - first)
    for (const li of $('bootSteps').querySelectorAll('li')) {
      const step = li.dataset.step, tEl = li.querySelector('.stepTime')
      const started = stepAt[step]; if (!started) continue
      const next = BOOTING[stepIndex(step) + 1]
      const ended = next && stepAt[next]
      tEl.textContent = mmss((ended || now) - started)
    }
  }

  function attachSse() {
    if (S.es) return
    // EventSource can't send a header, so the token goes in the URL
    const es = new EventSource(`/qa/api/progress?cap=${encodeURIComponent(cap.get() || '')}`); S.es = es
    if (!bootTimer) bootTimer = setInterval(tickBoot, 1000)
    // It reconnects by itself, but not after a refusal: state says why.
    es.onerror = () => { if (S.es === es && es.readyState === EventSource.CLOSED) { closeSse(); setTimeout(render, 1000) } }
    es.onmessage = ev => {
      const e = JSON.parse(ev.data)
      if (e.kind === 'step') markStep(e.step, e.at)
      else if (e.kind === 'build') setBuildSub(buildFromEvent(e))
      else if (e.kind === 'isolation') showIsolation(e)
      else if (e.kind === 'ready') { closeSse(); onReady(e) }
      else if (e.kind === 'error') showBootError(e)
      else if (e.kind === 'torn-down') { closeSse(); go('#/') }
    }
  }
  function closeSse() { if (S.es) { S.es.close(); S.es = null } if (bootTimer) { clearInterval(bootTimer); bootTimer = null } }

  function showBootError(e) {
    const cached = stepAt['ensuring-image'] === undefined
    if (cached) $('bootSteps').querySelector('[data-step="ensuring-image"] .stepSub').textContent = 'Already built'
    $('bootBar').hidden = true
    showErrorText(`Failed at ${stepLabel(e.step)}: ${e.message}`, e.logTail)
    announce(`Boot failed at ${stepLabel(e.step)}: ${e.message}`, true)
    const acts = $('bootActions'); acts.hidden = false; acts.textContent = ''
    const retry = mkBtn('Retry boot', 'primary', () => { resetBootUi(); openSession(bootPr).catch(showOpenErr) })
    const back = mkBtn('Back to pull requests', 'ghost', () => go('#/'))
    acts.append(retry, back)
    if (e.step === 'ensuring-image' && isHttpsUrl(e.runUrl)) { const a = runLink(e.runUrl, 'View build log ↗'); a.className = 'btn secondary'; acts.append(a) }
  }
  function showErrorText(line, tail) {
    const pre = $('bootError'); pre.hidden = false; pre.textContent = ''
    const span = document.createElement('span'); span.className = 'errline'; span.textContent = line
    pre.append(span)
    if (tail) pre.append(tail)
  }
  function showOpenErr(err) { showErrorText(err.message) }
  function mkBtn(text, cls, onclick) { const b = document.createElement('button'); b.className = cls; b.textContent = text; b.onclick = onclick; return b }
  $('cancelBoot').onclick = async () => { await postJson('/teardown').catch(() => {}); go('#/') }

  // --- session -------------------------------------------------------------
  function onReady(meta) { setHashSilent(`#/pr/${meta.pr || bootPr}`); showIsolation(meta.isolation); renderSession(meta) }

  function renderSession(meta) {
    const pr = meta.pr || bootPr || parseHash().pr
    showView('session'); setPill(`session: #${pr}`)
    const panes = meta.panes
    if (S.mounted !== pr) {
      S.mounted = pr; S.startedAt = meta.startedAt ?? null; S.pr = pr; S.panes = panes; S.paneOrigins = [panes.baseOrigin, panes.prOrigin]
      S.path = { base: '', pr: '' }; S.hasNav = { base: false, pr: false }; S.lastMsg = { base: Date.now(), pr: Date.now() }
      S.unmatched = { base: 0, pr: 0 }; renderUnmatched('base'); renderUnmatched('pr')
      // as given: the pane proxy tells each pane's bridge whom to talk to
      enterPane('base', panes.base); enterPane('pr', panes.pr)
      $('baseOpen').href = panes.baseOrigin; $('prOpen').href = panes.prOrigin
      setDot('base', 'amber', 'signing in…'); setDot('pr', 'amber', 'signing in…')
      $('baseUrl').textContent = 'signing in…'; $('prUrl').textContent = 'signing in…'
      restoreDraft(pr)
      startIdlePoll(); startDotPoll()
      mountPanels()
      announce('QA session ready')
    }
    $('sessionMeta').innerHTML = meta.baseTag ? `#${pr} · <span class="tag">${esc(tagOf(meta.baseTag))}</span> vs <span class="tag">${esc(tagOf(meta.prTag))}</span>` : `#${pr}`
    $('sessionHeading').textContent = `QA session for PR ${pr}`
  }

  function teardownSessionUi() {
    S.mounted = null; S.startedAt = null; closeSse()
    if (S.idlePoll) { clearInterval(S.idlePoll); S.idlePoll = null }
    if (S.dotPoll) { clearInterval(S.dotPoll); S.dotPoll = null }
    $('baseFrame').removeAttribute('src'); $('prFrame').removeAttribute('src')
    hideVerdictBody()
    unmountPanels()
  }

  const paneOf = origin => origin === S.paneOrigins[0] ? 'base' : origin === S.paneOrigins[1] ? 'pr' : null
  const frameOf = pane => pane === 'base' ? $('baseFrame') : $('prFrame')
  // A path a pane's bridge reported, on that pane's origin: as a bare path,
  // one that starts with // would name another host, which the conductor
  // refuses. The conductor checks what this gives stays on the pane.
  const onPane = (pane, path) => `${S.paneOrigins[pane === 'base' ? 0 : 1]}${path}`

  // Loads a pane's frame at `to` (a URL or path on that pane) through a
  // one-time link, which sets the pane cookie first: the panes answer only a
  // browser that holds it. A failure shows on the pane's bar.
  async function enterPane(pane, to) {
    try {
      const { url } = await postJson('/pane-entry', { role: pane, to: to || '/' })
      frameOf(pane).src = url
    } catch (err) {
      if (err.capability) return
      setDot(pane, 'red', err.message); $(pane + 'Url').textContent = err.message
    }
  }
  function setDot(pane, cls, title) { const d = $(pane + 'Dot'); d.className = 'dot ' + cls; d.title = title }
  function renderUnmatched(pane) {
    const el = $(pane + 'Unmatched'); const n = S.unmatched[pane]
    el.hidden = n === 0; el.textContent = `${n} unmatched`
    const tab = document.querySelector(`.tab[data-tab="${pane}"]`)
    if (tab) { let b = tab.querySelector('.tabBadge'); if (n === 0) { if (b) b.remove() } else { if (!b) { b = document.createElement('span'); b.className = 'tabBadge'; tab.appendChild(b) } b.textContent = n } }
  }
  function updateDivergence() {
    const diverged = S.hasNav.base && S.hasNav.pr && S.path.base !== S.path.pr
    document.querySelector('.pane[data-pane="base"]').classList.toggle('diverged', diverged)
    document.querySelector('.pane[data-pane="pr"]').classList.toggle('diverged', diverged)
    let dot = $('resyncBtn').querySelector('.dot'); if (diverged && !dot) { dot = document.createElement('span'); dot.className = 'dot amber'; dot.style.marginLeft = '4px'; $('resyncBtn').appendChild(dot) } else if (!diverged && dot) dot.remove()
  }

  window.addEventListener('message', ev => {
    if (!S.paneOrigins || !S.paneOrigins.includes(ev.origin)) return
    const d = ev.data; if (!d || d.qa !== 1) return
    const pane = paneOf(ev.origin); if (!pane) return
    S.lastMsg[pane] = Date.now()
    if (d.kind === 'event') {
      markAction(pane, d)
      if (!S.mirror) return
      if (d.type === 'scroll' && !S.scrollMirror) return
      const other = pane === 'base' ? 'pr' : 'base'
      frameOf(other).contentWindow.postMessage({ ...d, kind: 'replay' }, S.paneOrigins[other === 'base' ? 0 : 1])
    } else if (d.kind === 'nav') {
      S.path[pane] = d.href; S.hasNav[pane] = true
      $(pane + 'Url').textContent = d.href; setDot(pane, 'green', 'live')
      updateDivergence()
    } else if (d.kind === 'ping') {
      if (S.hasNav[pane]) setDot(pane, 'green', 'live')
    } else if (d.kind === 'unmatched') {
      S.unmatched[pane]++; renderUnmatched(pane)
      const wrap = frameOf(pane).closest('.paneWrap'); wrap.classList.remove('flash'); void wrap.offsetWidth; wrap.classList.add('flash')
      announce(`Interaction not mirrored to ${pane === 'pr' ? 'PR' : 'base'} pane`)
    }
  })

  // #8: each action a pane's bridge reports, mirrored or not, becomes a mark
  // in the session's action log: the pane and the kind of action, never the
  // element or a value. At most one of each kind a pane every 100 ms, as the
  // conductor keeps: a click and the submit it sets off are two. The pane's
  // own page can post such messages, so the log labels a mark as reported
  // by that pane. A monotonic clock: a step back of the system clock must
  // not hold marks back.
  const lastMark = new Map()
  function markAction(pane, d) {
    const type = markType(d)
    if (type === null) return
    const now = performance.now()
    const kind = `${pane} ${type}`
    if (now - (lastMark.get(kind) ?? -Infinity) < 100) return
    lastMark.set(kind, now)
    postJson('/actions/mark', { pane, type }).catch(() => {})
  }

  // --- #8: the Data and Actions panels ---------------------------------------
  // Drawn from plain nodes (dataNodes, actionsNodes) with textContent only:
  // what they show comes from the panes, which PR code controls.
  function buildNode(n) {
    const el = document.createElement(n.tag)
    if (n.cls) el.className = n.cls
    if (n.text !== undefined) el.textContent = n.text
    if (n.title) el.title = n.title
    if (n.act) el.dataset.act = n.act
    for (const child of n.children || []) el.append(buildNode(child))
    return el
  }
  function drawNodes(id, nodes) {
    const el = $(id); el.textContent = ''
    for (const n of nodes) el.append(buildNode(n))
  }

  const DATA_UI = () => ({ span: 'session', view: 'divergence', open: null })
  const D = { open: false, data: null, ui: DATA_UI(), busy: false }
  const A = { open: false, state: actionsFresh(), timer: null, reading: false }

  function showDataBadge() {
    const n = dataBadge(D.data); const b = $('dataBadge')
    b.hidden = n === 0; b.textContent = String(n)
    $('dataBtn').title = n ? `Data checks (d): ${n} destructive change${n === 1 ? '' : 's'} only the PR made` : 'Data checks (d)'
  }
  function drawData() { drawNodes('dataBody', dataNodes(D.data, D.ui)); showDataBadge() }
  async function loadData() {
    const mounted = S.mounted
    let data
    try { data = await api('/data') } catch (err) { if (!err.capability) $('dataStatus').textContent = `Couldn't read the data checks: ${err.message}`; return }
    if (S.mounted !== mounted) return // another session's view now
    D.data = data; $('dataStatus').textContent = ''
    drawData()
  }
  // Snapshot now, or Re-baseline: the answer is the data checks as they now stand.
  async function takeSnapshot(rebaseline) {
    if (D.busy) return
    D.busy = true; $('dataStatus').textContent = rebaseline ? 'Re-baselining…' : 'Taking a snapshot…'
    try {
      D.data = await postJson('/data/snapshot', { rebaseline })
      $('dataStatus').textContent = ''
      drawData()
      const n = dataBadge(D.data)
      announce(rebaseline ? 'Re-baselined: now is the baseline' : `Snapshot taken: ${n} destructive change${n === 1 ? '' : 's'} only the PR made`)
    } catch (err) {
      if (!err.capability) $('dataStatus').textContent = `${rebaseline ? 'Re-baseline' : 'Snapshot'} failed: ${err.message}`
    } finally { D.busy = false }
  }
  function setDataPanel(open) {
    D.open = open; $('dataPanel').hidden = !open; $('dataBtn').classList.toggle('on', open)
    if (open) { drawData(); loadData() }
  }
  $('dataBtn').onclick = () => setDataPanel(!D.open)
  $('dataClose').onclick = () => setDataPanel(false)
  $('dataBody').addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return
    const act = el.dataset.act
    if (act === 'snapshot' || act === 'rebaseline') return takeSnapshot(act === 'rebaseline')
    const [group, value] = act.split(':')
    if (group === 'span' || group === 'view') { D.ui[group] = value; D.ui.open = null }
    else if (group === 'open') D.ui.open = D.ui.open === +value ? null : +value
    drawData()
  })

  // The action log, read on from where the last read ended, a few pages at a
  // time: another session's log, or `resync`, starts it over from 0.
  async function readActions() {
    if (A.reading) return
    A.reading = true
    const mounted = S.mounted
    try {
      for (let pages = 0; pages < 5; pages++) {
        const answer = await api(`/actions?after=${A.state.seq}&limit=500`)
        if (S.mounted !== mounted) return
        A.state = mergeActions(A.state, answer)
        if (!A.state.again && !A.state.more) break
      }
      $('actionsStatus').textContent = ''
    } catch (err) {
      if (!err.capability) $('actionsStatus').textContent = `Couldn't read the action log: ${err.message}`
    } finally { A.reading = false }
    if (S.mounted === mounted) drawNodes('actionsBody', actionsNodes(A.state))
  }
  function setActionsPanel(open) {
    A.open = open; $('actionsPanel').hidden = !open; $('actionsBtn').classList.toggle('on', open)
    if (A.timer) { clearInterval(A.timer); A.timer = null }
    if (open) { readActions(); A.timer = setInterval(readActions, 2000) }
  }
  $('actionsBtn').onclick = () => setActionsPanel(!A.open)
  $('actionsClose').onclick = () => setActionsPanel(false)

  // A newly mounted session starts both panels afresh.
  function mountPanels() {
    D.data = null; D.ui = DATA_UI(); A.state = actionsFresh()
    $('dataBtn').hidden = !S.dataAvailable
    showDataBadge()
    if (S.dataAvailable) loadData()
    if (A.open) readActions()
  }
  function unmountPanels() {
    setActionsPanel(false); setDataPanel(false)
    D.data = null; A.state = actionsFresh()
  }

  function startDotPoll() {
    S.dotPoll = setInterval(() => {
      const now = Date.now()
      for (const pane of ['base', 'pr']) {
        if (!S.hasNav[pane]) continue
        if (now - S.lastMsg[pane] > 10000) setDot(pane, 'grey', 'stale — no bridge signal >10s')
      }
    }, 3000)
  }

  // pane bar controls
  document.querySelector('#paneRow').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return
    const pane = btn.dataset.pane
    // where the pane's bridge last said it was, else its landing page
    if (btn.dataset.act === 'reload') enterPane(pane, S.path[pane] ? onPane(pane, S.path[pane]) : S.panes[pane])
    else if (btn.dataset.act === 'copy') navigator.clipboard && navigator.clipboard.writeText(S.path[pane] || '/')
  })
  for (const p of ['base', 'pr']) $(p + 'Unmatched').onclick = () => { S.unmatched[p] = 0; renderUnmatched(p) }

  // header controls
  $('mirrorBtn').onclick = () => setMirror(!S.mirror)
  function setMirror(on) { S.mirror = on; $('mirrorBtn').textContent = `Mirror: ${on ? 'on' : 'off'}`; $('mirrorBtn').classList.toggle('on', on) }
  menuToggle('mirrorMenuBtn', 'mirrorMenu')
  menuToggle('resyncMenuBtn', 'resyncMenu')
  $('scrollMirror').onchange = e => { S.scrollMirror = e.target.checked }
  $('resyncBtn').onclick = () => { enterPane('pr', onPane('pr', S.path.base || '/')); S.path.pr = S.path.base; updateDivergence() }
  $('resyncLeft').onclick = () => { enterPane('base', onPane('base', S.path.pr || '/')); S.path.base = S.path.pr; updateDivergence(); $('resyncMenu').hidden = true }
  for (const btn of document.querySelectorAll('button[data-width]')) btn.onclick = () => setWidth(+btn.dataset.width, btn)
  function setWidth(w, btn) {
    for (const f of [$('baseFrame'), $('prFrame')]) f.style.width = w ? `${w}px` : '100%'
    for (const b of document.querySelectorAll('button[data-width]')) b.classList.toggle('on', b === (btn || document.querySelector(`button[data-width="${w}"]`)))
  }
  function menuToggle(btnId, menuId) {
    $(btnId).onclick = e => { e.stopPropagation(); const m = $(menuId); m.hidden = !m.hidden; $(btnId).setAttribute('aria-expanded', String(!m.hidden)) }
  }
  document.addEventListener('click', () => { $('mirrorMenu').hidden = true; $('resyncMenu').hidden = true })
  for (const m of ['mirrorMenu', 'resyncMenu']) $(m).addEventListener('click', e => e.stopPropagation())

  // idle countdown chip
  function startIdlePoll() { pollIdle(); S.idlePoll = setInterval(pollIdle, 60000) }
  async function pollIdle() {
    let s; try { s = await api('/state') } catch { return }
    if (S.mounted === null) return // the view went meanwhile
    // a view mounted from the ready event learns its session's start here
    if (S.startedAt === null && s.status === 'ready' && s.pr === S.mounted) S.startedAt = s.startedAt
    // The session this view shows ended, or was opened again (by another
    // browser, say), whose panes took new pane cookies: draw it afresh.
    if (s.status !== 'ready' || s.pr !== S.mounted || s.startedAt !== S.startedAt) { teardownSessionUi(); return render() }
    if (!s.lastActivity || !s.idleMinutes) return
    const left = s.lastActivity + s.idleMinutes * 60000 - Date.now()
    const chip = $('idleChip'); chip.textContent = `auto-end ${mmss(left)}`
    const low = left < 5 * 60000; chip.classList.toggle('warn', low)
    if (low) announce(`QA session ends in ${Math.ceil(left / 60000)} minutes unless you interact`)
  }

  // teardown two-step
  twoStepConfirm($('teardownBtn'), 'Confirm end? (3s)', async () => { await postJson('/teardown').catch(() => {}); go('#/') })
  function twoStepConfirm(btn, confirmLabel, action) {
    const orig = btn.textContent
    btn.onclick = () => {
      if (btn.dataset.armed) { clearTimeout(S.confirmTimer); btn.dataset.armed = ''; btn.textContent = orig; btn.classList.remove('confirm'); return action() }
      btn.dataset.armed = '1'; btn.textContent = confirmLabel; btn.classList.add('confirm')
      S.confirmTimer = setTimeout(() => { btn.dataset.armed = ''; btn.textContent = orig; btn.classList.remove('confirm') }, 3000)
    }
    btn._disarm = () => { if (btn.dataset.armed) { clearTimeout(S.confirmTimer); btn.dataset.armed = ''; btn.textContent = orig; btn.classList.remove('confirm') } }
  }

  // --- verdict drawer ------------------------------------------------------
  $('verdictToggle').onclick = () => toggleVerdict()
  function toggleVerdict(force) {
    const body = $('verdictBody'); const open = force !== undefined ? force : body.hidden
    body.hidden = !open; $('verdictToggle').setAttribute('aria-expanded', String(open))
    if (open) { $('verdictPreview').hidden = true; $('verdictEdit').hidden = false; $('notes').focus() }
  }
  function hideVerdictBody() { $('verdictBody').hidden = true; $('verdictToggle').setAttribute('aria-expanded', 'false') }
  const draftKey = pr => `qa-notes-${pr}`
  function restoreDraft(pr) { $('notes').value = localStorage.getItem(draftKey(pr)) || '' }
  $('notes').addEventListener('input', () => { clearTimeout(S.notesTimer); S.notesTimer = setTimeout(() => { if (S.pr) localStorage.setItem(draftKey(S.pr), $('notes').value) }, 500) })

  $('acceptBtn').onclick = () => openPreview('accept')
  $('rejectBtn').onclick = () => openPreview('reject')
  async function openPreview(verdict) {
    S.pendingVerdict = verdict
    const q = `?verdict=${verdict}&notes=${encodeURIComponent($('notes').value)}`
    let body = '(preview unavailable — post will still work)', applies = verdict === 'accept' ? 'qa-approved' : 'qa-changes-requested', removes = verdict === 'accept' ? 'qa-changes-requested' : 'qa-approved'
    try { const r = await api('/verdict/preview' + q); body = r.body || body; applies = r.applies || applies; removes = r.removes || removes } catch { /* keep fallback */ }
    $('previewBody').textContent = body
    $('previewLabelChange').textContent = `Will apply ${applies}, remove ${removes}.`
    const postBtn = $('postBtn'); postBtn.textContent = `Post to PR #${S.pr}`; postBtn.className = verdict === 'accept' ? 'primary' : 'danger'
    $('verdictEdit').hidden = true; $('verdictPreview').hidden = false
  }
  $('previewBack').onclick = () => { $('verdictPreview').hidden = true; $('verdictEdit').hidden = false }
  $('postBtn').onclick = async () => {
    const postBtn = $('postBtn'); postBtn.disabled = true; $('previewBack').disabled = true
    try {
      const { url } = await postJson('/verdict', { verdict: S.pendingVerdict, notes: $('notes').value })
      localStorage.removeItem(draftKey(S.pr))
      announce('Verdict posted')
      $('doneP').textContent = S.pr; $('doneLink').href = url
      go(`#/pr/${S.pr}/verdict`)
    } catch (err) { postBtn.disabled = false; $('previewBack').disabled = false; $('previewLabelChange').textContent = `Failed: ${err.message}` }
  }

  // verdict-done view is rendered on demand; wire once
  $('doneEnd').onclick = async () => { await postJson('/teardown').catch(() => {}); go('#/') }
  $('doneKeep').onclick = () => go(`#/pr/${S.pr}`)
  $('doneBack').onclick = () => go('#/')

  // when routed to #/pr/n/verdict but state lost (reload), fall back to session
  function maybeVerdictDone() {
    const r = parseHash()
    if (r.view === 'verdict' && $('doneLink').href && +$('doneP').textContent === r.pr) { showView('verdictDone'); setPill(`session: #${r.pr}`); return true }
    return false
  }

  // --- keyboard ------------------------------------------------------------
  document.addEventListener('keydown', e => {
    if ($('inviteDialog').open) return // its own keys; Escape closes it
    if ($('shortcuts').open && e.key === 'Escape') return $('shortcuts').close()
    if (e.key === '?') { e.preventDefault(); return $('shortcuts').showModal() }
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    if ($('session').hidden) return
    const keys = ['m', 's', 'r', '1', '2', '3', 'v', 'e', 'd', 'a']
    if (keys.includes(e.key)) e.preventDefault()
    switch (e.key) {
      case 'd': if (S.dataAvailable) setDataPanel(!D.open); break
      case 'a': setActionsPanel(!A.open); break
      case 'm': setMirror(!S.mirror); break
      case 's': $('scrollMirror').checked = !$('scrollMirror').checked; S.scrollMirror = $('scrollMirror').checked; break
      case 'r': $('resyncBtn').click(); break
      case '1': setWidth(375); break
      case '2': setWidth(768); break
      case '3': setWidth(0); break
      case 'v': toggleVerdict(); break
      case 'e': $('teardownBtn').click(); break
      case 'Escape':
        $('teardownBtn')._disarm && $('teardownBtn')._disarm()
        if (!$('verdictBody').hidden) hideVerdictBody()
        else if (D.open || A.open) { setDataPanel(false); setActionsPanel(false) }
        break
    }
  })
  $('shortcutsClose').onclick = () => $('shortcuts').close()

  // --- compact <900px ------------------------------------------------------
  const mq = window.matchMedia('(max-width: 900px)')
  function applyCompact() { document.body.classList.toggle('compact', mq.matches); $('tabs').hidden = !mq.matches; if (mq.matches) selectTab(currentTab) }
  let currentTab = 'base'
  $('tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) selectTab(t.dataset.tab) })
  function selectTab(which) {
    currentTab = which
    for (const tab of $('tabs').querySelectorAll('.tab')) tab.classList.toggle('on', tab.dataset.tab === which)
    for (const pane of document.querySelectorAll('#paneRow .pane')) pane.classList.toggle('activeTab', pane.dataset.pane === which)
  }
  mq.addEventListener('change', applyCompact); applyCompact()

  // --- boot ----------------------------------------------------------------
  window.addEventListener('hashchange', () => {
    if (inviteFromHash(location.hash)) start() // an invite link opened in this tab
    else if (!maybeVerdictDone()) render()
  })

  // An invite link's ticket leaves the URL before it is used, so neither a
  // reload nor the history holds it. Without a token, enrol now.
  function start() {
    const invite = inviteFromHash(location.hash)
    if (invite) {
      history.replaceState(null, '', `${location.pathname}${location.search}#/`)
      enrolling = enrol(invite).finally(() => { enrolling = null })
    } else if (!cap.get()) {
      enrolling = enrol().finally(() => { enrolling = null })
    } else {
      render()
    }
  }
  start()
})()

// --- test exports (node --test evaluates this file through a CJS wrapper) ---

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    esc, isHttpsUrl, LABELS, harnessOriginNotice, buildSummary, buildFromEvent, inviteFromHash, isCapabilityRefusal, isolationLabel,
    cellText, trustLabel, flagText, dataBadge, dataNodes, actionsFresh, mergeActions, actionsNodes,
  }
}
