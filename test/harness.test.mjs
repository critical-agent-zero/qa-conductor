// Pure helpers of the harness UI script. harness.js is a plain browser script
// with the same CommonJS export guard bridge.js uses; the package declares
// "type": "module", so evaluate it through the CJS wrapper shape instead of
// require(). `window` stays undefined, which keeps the UI IIFE inert.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const harnessPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'harness.js')
const cjsModule = { exports: {} }
new Function('module', 'exports', readFileSync(harnessPath, 'utf8'))(cjsModule, cjsModule.exports)
const { esc, isHttpsUrl, LABELS, harnessOriginNotice, buildSummary, buildFromEvent, inviteFromHash, isCapabilityRefusal } = cjsModule.exports
const harnessSrc = readFileSync(harnessPath, 'utf8')

test('the CJS guard exports the pure helpers only', () => {
  assert.deepEqual(Object.keys(cjsModule.exports).sort(), ['LABELS', 'buildFromEvent', 'buildSummary', 'esc', 'harnessOriginNotice', 'inviteFromHash', 'isCapabilityRefusal', 'isHttpsUrl'])
})

test('isCapabilityRefusal: a 403 marked by its header or, the header dropped, by its body', () => {
  assert.equal(isCapabilityRefusal(403, 'capability', {}), true)
  assert.equal(isCapabilityRefusal(403, null, { refusal: 'capability' }), true)
  for (const [status, header, body] of [[403, null, {}], [403, 'identity', {}], [403, null, { refusal: 'identity' }], [401, 'capability', { refusal: 'capability' }], [403, null, null], [403, null, 'capability']]) {
    assert.equal(isCapabilityRefusal(status, header, body), false, JSON.stringify([status, header, body]))
  }
})

test('inviteFromHash reads an invite link\'s ticket from the fragment, and nothing else', () => {
  assert.equal(inviteFromHash('#enrol=abc_DEF-123'), 'abc_DEF-123')
  for (const hash of [undefined, '', '#', '#/', '#/pr/7', '#enrol=', '#enrol=a b', '#enrol=abc&x=1', '#x=1&enrol=abc', '#ENROL=abc', '#enrol=<x>']) {
    assert.equal(inviteFromHash(hash), null, String(hash))
  }
})

// The panes answer only a browser holding their cookie, which a one-time
// ticket sets: a frame loaded at a pane URL directly would get a 403.
test('the harness loads a pane frame only through a pane-entry ticket, and sends its token on every API call and the event stream', () => {
  const assignments = [...harnessSrc.matchAll(/Frame'\)\.src = ([^\n;]+)|frameOf\([^)]*\)\.src = ([^\n;]+)/g)].map(m => (m[1] ?? m[2]).trim())
  assert.deepEqual(assignments, ['url'], 'one assignment, in enterPane')
  assert.match(harnessSrc, /'x-qa-cap': token/)
  assert.match(harnessSrc, /new EventSource\(`\/qa\/api\/progress\?cap=\$\{encodeURIComponent\(/)
})

test('buildFromEvent reads an SSE build event as buildRun\'s shape, conclusion included', () => {
  const url = 'https://github.com/acme/widget/actions/runs/7'
  const ev = { at: 1, kind: 'build', runUrl: url, runStatus: 'completed', runConclusion: 'failure', message: null }
  assert.deepEqual(buildFromEvent(ev), { url, status: 'completed', conclusion: 'failure', message: null })
  assert.equal(buildSummary(buildFromEvent(ev)), 'Build ended: failure')
})

test('buildSummary: the message, else the run\'s status, naming a conclusion other than success', () => {
  const url = 'https://github.com/acme/widget/actions/runs/7'
  assert.equal(buildSummary({ message: 'installing dependencies for #7 (abc1234)…', status: 'in_progress' }), 'installing dependencies for #7 (abc1234)…')
  assert.equal(buildSummary({}), 'Build started')
  assert.equal(buildSummary({ url, status: 'queued' }), 'Build queued')
  assert.equal(buildSummary({ url }), 'Build in progress')
  assert.equal(buildSummary({ url, status: 'completed' }), 'Build complete')
  assert.equal(buildSummary({ url, status: 'completed', conclusion: 'success' }), 'Build complete')
  assert.equal(buildSummary({ url, status: 'completed', conclusion: 'failure' }), 'Build ended: failure')
  assert.equal(buildSummary({ url, status: 'completed', conclusion: 'timed_out' }), 'Build ended: timed out')
  // a conclusion before completion (not GitHub's way) says nothing new
  assert.equal(buildSummary({ url, status: 'in_progress', conclusion: 'failure' }), 'Build in_progress')
})

test('harnessOriginNotice: null at the configured origin or with none configured, else the configured origin + /qa/', () => {
  assert.equal(harnessOriginNotice('http://127.0.0.1:4100', 'http://127.0.0.1:4100'), null)
  for (const unset of [null, undefined, '']) assert.equal(harnessOriginNotice(unset, 'http://localhost:4100'), null, String(unset))
  assert.equal(harnessOriginNotice('http://127.0.0.1:4100', 'http://localhost:4100'), 'http://127.0.0.1:4100/qa/')
  assert.equal(harnessOriginNotice('https://h.ts.net:8444', 'https://h.ts.net:8446'), 'https://h.ts.net:8444/qa/')
})

// "Open in new tab" must send the harness origin as the Referer the panes
// check: rel="noopener" keeps it, and noreferrer would get every new tab a
// 403 cross-site navigation refused.
test('the "Open in new tab" links keep the Referer: rel="noopener", never noreferrer', () => {
  const html = readFileSync(join(dirname(harnessPath), 'index.html'), 'utf8')
  for (const id of ['baseOpen', 'prOpen']) {
    const tag = html.match(new RegExp(`<a\\b[^>]*\\bid="${id}"[^>]*>`))?.[0]
    assert.ok(tag, id)
    assert.match(tag, /\brel="noopener"/, id)
    assert.doesNotMatch(tag, /noreferrer/i, id)
  }
})

test('esc escapes markup and both quote characters', () => {
  assert.equal(esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  assert.equal(esc(null), '')
})

test('isHttpsUrl accepts only https links (case-insensitive scheme)', () => {
  assert.equal(isHttpsUrl('https://github.com/acme/widget/actions/runs/1'), true)
  assert.equal(isHttpsUrl('HTTPS://github.com/x'), true)
  for (const bad of ['javascript:alert(1)', 'http://x', ' https://x', 'data:text/html,x', '', null, undefined, 42]) {
    assert.equal(isHttpsUrl(bad), false, String(bad))
  }
})

test('LABELS names every boot step generically', () => {
  assert.deepEqual(LABELS, {
    'ensuring-image': 'Building',
    cloning: 'Preparing data',
    migrating: 'Migrating',
    starting: 'Starting',
  })
})


// --- #29: the harness page against a stand-in browser ----------------------------
// harness.js run against a stand-in browser: every element is a recording
// stub, fetch answers from `routes` (an answer, or a function of the request's
// body and headers; `ticks` holds an answer back that many turns), and the
// test reads what the page did: its API calls, EventSource URLs, frame srcs,
// history edits and stored token.

function fakeBrowser({ hash = '#/', stored = null, routes = {} }) {
  const log = [] // ['fetch', method, path, headers, body] | ['replace', url] | ['source', url] | ['set', id, prop, value]
  const listeners = []
  const store = new Map(stored === null ? [] : [['qa-cap', stored]])
  const els = new Map()
  const stub = name => {
    const props = {}
    return new Proxy(function () {}, {
      get(_, k) {
        if (Object.hasOwn(props, k)) return props[k]
        if (k === 'then') return undefined
        if (k === Symbol.iterator) return function* () {}
        if (k === Symbol.toPrimitive) return () => ''
        if (k === 'length') return 0
        if (k === 'matches') return false
        if (k === 'dataset' || k === 'style') return (props[k] = {})
        if (k === 'addEventListener') return (type, fn) => listeners.push([name, type, fn])
        return (props[k] = stub(`${name}.${String(k)}`))
      },
      set(_, k, v) { props[k] = v; log.push(['set', name, k, v]); return true },
      apply() { return stub(`${name}()`) },
    })
  }
  const byId = id => { if (!els.has(id)) els.set(id, stub(id)); return els.get(id) }
  const location = { hash, pathname: '/qa/', search: '', origin: 'https://h.ts.net:8444' }
  const globals = {
    window: { addEventListener: (type, fn) => listeners.push(['window', type, fn]), matchMedia: () => stub('mq') },
    document: {
      getElementById: byId, querySelector: sel => stub(sel), querySelectorAll: () => [], createElement: t => stub(`<${t}>`),
      createTextNode: () => stub('#text'), addEventListener: (type, fn) => listeners.push(['document', type, fn]), body: stub('body'),
    },
    fetch: async (url, opts = {}) => {
      const method = opts.method ?? 'GET'
      const path = String(url).split('?')[0]
      log.push(['fetch', method, path, { ...(opts.headers ?? {}) }, opts.body ? JSON.parse(opts.body) : null])
      const answer = routes[`${method} ${path}`]
      const out = typeof answer === 'function' ? answer(opts.body ? JSON.parse(opts.body) : null, opts.headers ?? {}) : (answer ?? { status: 404 })
      const { status = 200, body = {}, headers = {}, ticks = 0 } = out
      for (let i = 0; i < ticks; i++) await new Promise(r => setImmediate(r))
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
    },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    EventSource: class { static CLOSED = 2; constructor(url) { log.push(['source', url]); this.readyState = 0 } close() {} },
    history: { replaceState: (_s, _t, url) => { log.push(['replace', url]); location.hash = `#${String(url).split('#')[1] ?? ''}` } },
    location,
    navigator: {},
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval: () => {},
  }
  const names = Object.keys(globals)
  new Function(...names, 'module', harnessSrc)(...names.map(n => globals[n]), undefined)
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)) }
  return { log, listeners, store, byId, location, settle }
}

const CAPTURE = { status: 403, body: { error: 'this browser is not enrolled' }, headers: { 'x-qa-refusal': 'capability' } }
const PANES = { base: 'https://h.ts.net:8443/login-base', pr: 'https://h.ts.net:10000/login-pr', baseOrigin: 'https://h.ts.net:8443', prOrigin: 'https://h.ts.net:10000' }
const entryRoute = body => ({ body: { url: `${body.role === 'base' ? PANES.baseOrigin : PANES.prOrigin}/__qa/enter?t=ticket-${body.role}-${body.to.length}` } })

test('the harness sends its token on every API call, and loads each pane only through a pane-entry ticket that carries no token', async () => {
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES, harnessOrigin: 'https://h.ts.net:8444' } },
      'POST /qa/api/pane-entry': entryRoute,
    },
  })
  await b.settle()
  const fetches = b.log.filter(e => e[0] === 'fetch')
  assert.ok(fetches.length >= 3, JSON.stringify(fetches))
  for (const [, method, path, headers] of fetches) assert.equal(headers['x-qa-cap'], 'tok-1', `${method} ${path}`)
  const entries = () => b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/pane-entry').map(e => e[4])
  assert.deepEqual(entries(), [{ role: 'base', to: PANES.base }, { role: 'pr', to: PANES.pr }])
  const srcs = () => b.log.filter(e => e[0] === 'set' && /Frame$/.test(e[1]) && e[2] === 'src').map(e => [e[1], e[3]])
  assert.deepEqual(srcs(), [['baseFrame', `${PANES.baseOrigin}/__qa/enter?t=ticket-base-${PANES.base.length}`], ['prFrame', `${PANES.prOrigin}/__qa/enter?t=ticket-pr-${PANES.pr.length}`]])

  // reload and re-sync go through a new ticket too
  const [, , onPaneRow] = b.listeners.find(([name, type]) => name === '#paneRow' && type === 'click')
  onPaneRow({ target: { closest: () => ({ dataset: { act: 'reload', pane: 'base' } }) } })
  b.byId('resyncBtn').onclick()
  b.byId('resyncLeft').onclick()
  await b.settle()
  assert.deepEqual(entries().slice(2).map(e => e.role), ['base', 'pr', 'base'])
  assert.equal(srcs().length, 5)
  for (const [frame, src] of srcs()) assert.match(src, /^https:\/\/h\.ts\.net:(8443|10000)\/__qa\/enter\?t=ticket-/, frame)
  for (const e of entries()) assert.doesNotMatch(JSON.stringify(e), /tok-1/, 'no token in a pane URL')
})

test('the event stream carries the token as ?cap=', async () => {
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok/2',
    routes: { 'GET /qa/api/state': { body: { status: 'starting', pr: 7 } } },
  })
  await b.settle()
  assert.deepEqual(b.log.filter(e => e[0] === 'source').map(e => e[1]), ['/qa/api/progress?cap=tok%2F2'])
})

test('an invite link leaves the URL before its ticket is used, and a refused one keeps the token this browser has', async () => {
  const ticket = 'T'.repeat(43)
  const fresh = fakeBrowser({
    hash: `#enrol=${ticket}`,
    routes: {
      'POST /qa/api/enrol': body => (body.invite === ticket ? { body: { token: 'tok-new' } } : CAPTURE),
      'GET /qa/api/state': { body: { status: 'idle' } },
      'GET /qa/api/prs': { body: { prs: [], session: null } },
    },
  })
  await fresh.settle()
  const firstReplace = fresh.log.findIndex(e => e[0] === 'replace')
  const enrolCall = fresh.log.findIndex(e => e[0] === 'fetch' && e[2] === '/qa/api/enrol')
  assert.ok(firstReplace !== -1 && firstReplace < enrolCall, 'replaceState before the enrol call')
  assert.doesNotMatch(fresh.log[firstReplace][1], new RegExp(ticket))
  assert.doesNotMatch(fresh.location.hash, new RegExp(ticket))
  assert.deepEqual(fresh.log[enrolCall][4], { invite: ticket })
  assert.equal(fresh.store.get('qa-cap'), 'tok-new')

  // an invite already spent, opened in a browser that is enrolled
  const spent = fakeBrowser({
    hash: `#enrol=${ticket}`,
    stored: 'tok-old',
    routes: { 'POST /qa/api/enrol': CAPTURE },
  })
  await spent.settle()
  assert.equal(spent.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/enrol').length, 1)
  assert.equal(spent.store.get('qa-cap'), 'tok-old')
})


// What reaches a harness nested in a pane (self-QA): the outer pane proxy
// drops X-QA-Refusal, so the refusal says so in its body too.
test('a refusal marked only in its body still makes the harness enrol again', async () => {
  const b = fakeBrowser({
    stored: 'tok-old',
    routes: {
      'GET /qa/api/state': (_, headers) => (headers['x-qa-cap'] === 'tok-new' ? { body: { status: 'idle' } } : { status: 403, body: { error: 'this browser is not enrolled', refusal: 'capability' } }),
      'POST /qa/api/enrol': { body: { token: 'tok-new' } },
      'GET /qa/api/prs': { body: { prs: [], session: null } },
    },
  })
  await b.settle()
  assert.equal(b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/enrol').length, 1)
  assert.equal(b.store.get('qa-cap'), 'tok-new')
})

// A restart revoked the token while the session view made three calls with
// it: the first refusal enrols the browser again, and a later refusal of the
// old token must not drop the new one.
test('a late refusal of a token the harness has already replaced leaves the new one alone', async () => {
  let states = 0
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': (_, headers) => {
        if (++states === 1) return { body: { status: 'ready', pr: 7, panes: PANES } }
        return headers['x-qa-cap'] === 'tok-2' ? { body: { status: 'idle' } } : { ...CAPTURE, ticks: 8 }
      },
      'POST /qa/api/pane-entry': (body, headers) => (headers['x-qa-cap'] === 'tok-2' ? entryRoute(body) : CAPTURE),
      'POST /qa/api/enrol': { body: { token: 'tok-2' } },
      'GET /qa/api/prs': { body: { prs: [], session: null } },
    },
  })
  await b.settle()
  assert.equal(b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/enrol').length, 1)
  assert.equal(b.store.get('qa-cap'), 'tok-2')
  assert.equal(b.byId('enrol').hidden, true, 'no enrolment view')
})

// A pane at a path that starts with // (which its bridge may report) is
// reloaded and re-synced at that path on its own origin, never at //host.
test('reload and re-sync ask for the pane path on the pane origin', async () => {
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES } },
      'POST /qa/api/pane-entry': entryRoute,
    },
  })
  await b.settle()
  const [, , onMessage] = b.listeners.find(([name, type]) => name === 'window' && type === 'message')
  onMessage({ origin: PANES.prOrigin, data: { qa: 1, kind: 'nav', href: '//evil.example/x?y=1' } })
  onMessage({ origin: PANES.baseOrigin, data: { qa: 1, kind: 'nav', href: '/products' } })
  b.byId('resyncLeft').onclick()
  b.byId('resyncBtn').onclick()
  const [, , onPaneRow] = b.listeners.find(([name, type]) => name === '#paneRow' && type === 'click')
  onPaneRow({ target: { closest: () => ({ dataset: { act: 'reload', pane: 'base' } }) } })
  await b.settle()
  const tos = b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/pane-entry').map(e => e[4]).slice(2)
  assert.deepEqual(tos, [
    { role: 'base', to: `${PANES.baseOrigin}//evil.example/x?y=1` },
    { role: 'pr', to: `${PANES.prOrigin}//evil.example/x?y=1` },
    { role: 'base', to: `${PANES.baseOrigin}//evil.example/x?y=1` },
  ])
})
