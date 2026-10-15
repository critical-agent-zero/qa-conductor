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
const {
  esc, isHttpsUrl, LABELS, harnessOriginNotice, buildSummary, buildFromEvent, inviteFromHash, isCapabilityRefusal, isolationLabel,
  cellText, trustLabel, flagText, dataBadge, dataNodes, actionsFresh, mergeActions, actionsNodes,
} = cjsModule.exports
const harnessSrc = readFileSync(harnessPath, 'utf8')

test('the CJS guard exports the pure helpers only', () => {
  assert.deepEqual(Object.keys(cjsModule.exports).sort(), [
    'LABELS', 'actionsFresh', 'actionsNodes', 'buildFromEvent', 'buildSummary', 'cellText', 'dataBadge', 'dataNodes', 'esc', 'flagText',
    'harnessOriginNotice', 'inviteFromHash', 'isCapabilityRefusal', 'isHttpsUrl', 'isolationLabel', 'mergeActions', 'trustLabel',
  ])
})

test('isolationLabel: nothing before a verdict, else what it says, its reasons as the title', () => {
  assert.equal(isolationLabel(null), null)
  assert.equal(isolationLabel(undefined), null)
  assert.deepEqual(isolationLabel({ verdict: 'isolated', reasons: [] }), { text: 'isolated', warn: false, title: 'The PR pane can\'t reach the base pane, so the base pane shows what the base did' })
  assert.deepEqual(isolationLabel({ verdict: 'reachable', reasons: ['a', 'b'] }), { text: 'not isolated', warn: true, title: 'a; b' })
  assert.deepEqual(isolationLabel({ verdict: 'unknown', reasons: ['c'] }), { text: 'isolation unknown', warn: true, title: 'c' })
  assert.deepEqual(isolationLabel({ verdict: 'shared-host', reasons: ['d'] }), { text: 'shared host', warn: true, title: 'd' })
  assert.deepEqual(isolationLabel({ verdict: 'bogus', reasons: [] }), { text: 'isolation unknown', warn: true, title: '' })
  // strict mode, said beside the verdict
  const STRICT = 'QA_REQUIRE_ISOLATION=1 refuses a session that isn\'t isolated'
  assert.deepEqual(isolationLabel({ verdict: 'reachable', reasons: ['a'] }, true), { text: 'not isolated · strict', warn: true, title: `a — ${STRICT}` })
  assert.deepEqual(isolationLabel({ verdict: 'bogus', reasons: [] }, true), { text: 'isolation unknown · strict', warn: true, title: STRICT })
  assert.equal(isolationLabel({ verdict: 'isolated', reasons: [] }, true).text, 'isolated · strict')
  assert.equal(isolationLabel(null, true), null)
  // a verdict named like an Object member is just unknown
  for (const verdict of ['constructor', 'toString', '__proto__']) {
    assert.deepEqual(isolationLabel({ verdict, reasons: [] }), { text: 'isolation unknown', warn: true, title: '' }, verdict)
  }
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

function fakeBrowser({ hash = '#/', stored = null, routes = {}, elements = {}, clock = null }) {
  const log = [] // ['fetch', method, path, headers, body, query] | ['replace', url] | ['source', url] | ['set', id, prop, value]
  const listeners = []
  const intervals = [] // { fn, ms }, in the order set; none ever runs by itself
  const store = new Map(stored === null ? [] : [['qa-cap', stored]])
  const els = new Map(Object.entries(elements))
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
        // one element per selector, as a DOM that doesn't change gives
        if (k === 'querySelector') {
          const found = new Map()
          return (props[k] = sel => { if (!found.has(sel)) found.set(sel, stub(`${name} ${sel}`)); return found.get(sel) })
        }
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
      log.push(['fetch', method, path, { ...(opts.headers ?? {}) }, opts.body ? JSON.parse(opts.body) : null, String(url).split('?')[1] ?? ''])
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
    ...(clock ? { performance: { now: () => clock.perf() }, Date: class extends Date { static now() { return clock.wall() } } } : {}),
    setTimeout: () => 0,
    setInterval: (fn, ms) => intervals.push({ fn, ms }),
    clearInterval: () => {},
  }
  const names = Object.keys(globals)
  new Function(...names, 'module', harnessSrc)(...names.map(n => globals[n]), undefined)
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)) }
  return { log, listeners, store, byId, location, settle, intervals }
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

test('the header chip shows the session\'s isolation verdict, with its reasons as the title, and none while idle', async () => {
  const chip = b => Object.fromEntries(b.log.filter(e => e[0] === 'set' && e[1] === 'isolationChip').map(e => [e[2], e[3]]))
  const ready = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES, isolation: { verdict: 'reachable', reasons: ['a', 'b'] } } },
      'POST /qa/api/pane-entry': entryRoute,
    },
  })
  await ready.settle()
  const shown = chip(ready)
  assert.deepEqual([shown.hidden, shown.textContent, shown.title], [false, 'not isolated', 'a; b'])
  const idle = fakeBrowser({
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'idle', isolation: { verdict: 'isolated', reasons: [] } } },
      'GET /qa/api/prs': { body: { prs: [], session: null } },
    },
  })
  await idle.settle()
  assert.equal(chip(idle).hidden, true)

  // strict mode, as /api/state says it, beside the verdict
  const strict = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES, requireIsolation: true, isolation: { verdict: 'isolated', reasons: [] } } },
      'POST /qa/api/pane-entry': entryRoute,
    },
  })
  await strict.settle()
  assert.equal(chip(strict).textContent, 'isolated · strict')
})

// #prList as the DOM has it, so far as the picker uses it: setting its text
// detaches every row, and a row is shown only while it is appended.
function fakeList(text = 'Loading…') {
  const list = {
    text, children: [], listeners: [], texts: [],
    appendChild(child) { child.parentNode = list; list.children.push(child); return child },
    get textContent() { return list.text },
    set textContent(value) { for (const child of list.children) child.parentNode = null; list.children = []; list.text = String(value); list.texts.push(list.text) },
    addEventListener(type, fn) { list.listeners.push([type, fn]) },
    querySelectorAll: () => [],
  }
  return list
}

// A restart revokes every token. The picker's ↻ then gets a refusal, the
// browser enrols again, and the picker must show the rows, not the refusal.
test('after a restart, refreshing the picker enrols the browser again and shows the PRs', async () => {
  let token = 'tok-1'
  const prList = fakeList()
  const prs = [{ number: 7, title: 'a', imageStatus: 'built' }, { number: 8, title: 'b', imageStatus: 'built' }]
  const enrolled = answer => (_, headers) => (headers['x-qa-cap'] === token ? answer : CAPTURE)
  const b = fakeBrowser({
    stored: 'tok-1',
    elements: { prList },
    routes: {
      'GET /qa/api/state': enrolled({ body: { status: 'idle' } }),
      'GET /qa/api/prs': enrolled({ body: { prs, session: null } }),
      'POST /qa/api/enrol': () => ({ body: { token } }),
    },
  })
  await b.settle()
  assert.deepEqual(prList.children.map(row => row.dataset.pr), [7, 8])
  assert.equal(prList.textContent, '')

  token = 'tok-2' // the conductor restarted
  b.byId('refreshBtn').onclick()
  await b.settle()
  assert.equal(b.store.get('qa-cap'), 'tok-2')
  assert.equal(b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/enrol').length, 1)
  assert.deepEqual(prList.children.map(row => row.dataset.pr), [7, 8])
  assert.equal(prList.textContent, '', 'no refusal left in the list')
  assert.ok(prList.children.every(row => row.parentNode === prList))
  assert.ok(!prList.texts.some(text => /Failed|not enrolled/.test(text)), `never told it isn't enrolled: ${JSON.stringify(prList.texts)}`)
})

// Text that stood in for the rows (an error, "No open PRs.") goes once there
// are rows again, and the rows it detached come back.
test('the picker brings back its rows after an error or an empty list stood in for them', async () => {
  let answer = { body: { prs: [{ number: 7, title: 'a' }], session: null } }
  const prList = fakeList()
  const b = fakeBrowser({
    stored: 'tok-1',
    elements: { prList },
    routes: { 'GET /qa/api/state': { body: { status: 'idle' } }, 'GET /qa/api/prs': () => answer },
  })
  await b.settle()
  const shown = () => [prList.textContent, prList.children.map(row => row.dataset.pr)]
  assert.deepEqual(shown(), ['', [7]])
  answer = { status: 502, body: { error: 'GitHub is down' } }
  b.byId('refreshBtn').onclick(); await b.settle()
  assert.deepEqual(shown(), ['Failed to load PRs: GitHub is down', []])
  answer = { body: { prs: [{ number: 7, title: 'a' }, { number: 9, title: 'c' }], session: null } }
  b.byId('refreshBtn').onclick(); await b.settle()
  assert.deepEqual(shown(), ['', [7, 9]])
  answer = { body: { prs: [], session: null } }
  b.byId('refreshBtn').onclick(); await b.settle()
  assert.deepEqual(shown(), ['No open PRs.', []])
  answer = { body: { prs: [{ number: 9, title: 'c' }], session: null } }
  b.byId('refreshBtn').onclick(); await b.settle()
  assert.deepEqual(shown(), ['', [9]])
})

// Open QA on a picker row: the delegated click, as the picker gets it. Once
// the click is handled, the button is detached, as a re-render of the row
// (a re-enrolment's, say) leaves it.
function clickOpen(prList, num) {
  const row = { attrs: {}, err: {}, setAttribute(k, v) { row.attrs[k] = v }, removeAttribute(k) { delete row.attrs[k] }, querySelector: () => row.err }
  let attached = true
  const btn = { dataset: { open: String(num) }, closest: sel => (sel === '.pr' && attached ? row : null) }
  row.btn = btn
  const [, onClick] = prList.listeners.find(([type]) => type === 'click')
  onClick({ target: { closest: () => btn } })
  attached = false
  return row
}

// A restart revoked the token, and with it any session: Open QA's refused
// POST /api/session enrols the browser again, then is sent once more.
test('after a restart, Open QA enrols the browser again and asks for the session once more, with the new token', async () => {
  for (const retryRefused of [false, true]) {
    let token = 'tok-1'
    const sessions = []
    const prList = fakeList()
    const enrolled = answer => (_, headers) => (headers['x-qa-cap'] === token ? answer : CAPTURE)
    const b = fakeBrowser({
      stored: 'tok-1',
      elements: { prList },
      routes: {
        'GET /qa/api/state': enrolled({ body: { status: 'idle' } }),
        'GET /qa/api/prs': enrolled({ body: { prs: [{ number: 7, title: 'a' }], session: null } }),
        'POST /qa/api/enrol': () => ({ body: { token } }),
        'POST /qa/api/session': (body, headers) => {
          sessions.push([headers['x-qa-cap'], body])
          return headers['x-qa-cap'] === token && !retryRefused ? { status: 202, body: { ok: true } } : CAPTURE
        },
      },
    })
    await b.settle()
    token = 'tok-2' // the conductor restarted
    const row = clickOpen(prList, 7)
    await b.settle()
    assert.deepEqual(sessions, [['tok-1', { pr: 7 }], ['tok-2', { pr: 7 }]], 'once more, and only once')
    if (!retryRefused) {
      assert.equal(b.location.hash, '#/pr/7/boot')
    } else {
      // a token refused just after it was given: the row says so, and the
      // enrolment view takes over
      assert.equal(b.location.hash, '#/')
      assert.equal(row.err.textContent, 'this browser is not enrolled')
      assert.equal(row.attrs['aria-busy'], undefined)
      assert.equal(b.byId('enrol').hidden, false)
    }
  }
})

// Any other refusal is the row's error, as before.
// After a restart someone else's session already runs, so the window is
// shut: the browser can't enrol again, and Open QA isn't sent once more.
test('Open QA after a restart whose re-enrolment is refused shows why, and asks once', async () => {
  let token = 'tok-1'
  const sessions = []
  const prList = fakeList()
  const enrolled = answer => (_, headers) => (headers['x-qa-cap'] === token ? answer : CAPTURE)
  const shut = { status: 403, body: { error: 'enrolment is closed: a session is running', reason: 'a session is running', refusal: 'capability' }, headers: { 'x-qa-refusal': 'capability' } }
  let open = true
  const b = fakeBrowser({
    stored: 'tok-1',
    elements: { prList },
    routes: {
      'GET /qa/api/state': enrolled({ body: { status: 'idle' } }),
      'GET /qa/api/prs': enrolled({ body: { prs: [{ number: 7, title: 'a' }], session: null } }),
      'POST /qa/api/enrol': () => (open ? { body: { token } } : shut),
      'POST /qa/api/session': (body, headers) => { sessions.push(headers['x-qa-cap']); return headers['x-qa-cap'] === token ? { status: 202, body: { ok: true } } : CAPTURE },
    },
  })
  await b.settle()
  token = 'tok-2' // the conductor restarted
  open = false // and a session started before this browser came back
  const row = clickOpen(prList, 7)
  await b.settle()
  assert.deepEqual(sessions, ['tok-1'], 'not sent again')
  assert.equal(b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/enrol').length, 1)
  assert.equal(b.byId('enrol').hidden, false)
  assert.equal(b.byId('enrolReason').textContent, 'Enrolment is closed: a session is running.')
  assert.equal(row.err.textContent, 'this browser is not enrolled')
  assert.equal(row.attrs['aria-busy'], undefined)
  assert.equal(b.location.hash, '#/')
})

test('Open QA refused for another reason shows it on the row and asks once', async () => {
  const sessions = []
  const prList = fakeList()
  const b = fakeBrowser({
    stored: 'tok-1',
    elements: { prList },
    routes: {
      'GET /qa/api/state': { body: { status: 'idle' } },
      'GET /qa/api/prs': { body: { prs: [{ number: 7, title: 'a' }], session: null } },
      'POST /qa/api/session': body => { sessions.push(body); return { status: 503, body: { error: 'shutting down' } } },
    },
  })
  await b.settle()
  const row = clickOpen(prList, 7)
  await b.settle()
  assert.equal(sessions.length, 1)
  assert.equal(row.err.textContent, 'shutting down')
  assert.equal(b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/enrol').length, 0)
})

// A second restart, or 32 newer browsers, refuses the token the browser got
// a moment ago, while the view after enrolling is still being drawn.
test('a token refused while the view after enrolling is drawn shows the enrolment view', async () => {
  let good = 'tok-1'
  const prList = fakeList()
  const enrolled = answer => (_, headers) => (headers['x-qa-cap'] === good ? answer : CAPTURE)
  const b = fakeBrowser({
    stored: 'tok-1',
    elements: { prList },
    routes: {
      'GET /qa/api/state': enrolled({ body: { status: 'idle' } }),
      'GET /qa/api/prs': enrolled({ body: { prs: [{ number: 7, title: 'a' }], session: null } }),
      'POST /qa/api/enrol': () => ({ body: { token: 'tok-2' } }),
    },
  })
  await b.settle()
  good = 'nobody' // a restart, and tok-2 refused as soon as it is given
  b.byId('refreshBtn').onclick()
  await b.settle()
  assert.equal(b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/enrol').length, 1, 'no loop')
  assert.equal(b.store.get('qa-cap'), undefined)
  assert.equal(b.byId('enrol').hidden, false)
})

// "End #8 and open #9", refused by a restart: once enrolled again, the try
// once more must not end a session someone started meanwhile.
test('a takeover a restart refused is sent again without takeover, so a new session gets the conflict card', async () => {
  let token = 'tok-1'
  const sessions = []
  const prList = fakeList()
  const conflictSlot = { children: [], innerHTML: '', appendChild(child) { conflictSlot.children.push(child); return child } }
  const enrolled = answer => (_, headers) => (headers['x-qa-cap'] === token ? answer : CAPTURE)
  const running = { pr: 8, status: 'ready' }
  const b = fakeBrowser({
    stored: 'tok-1',
    elements: { prList, conflictSlot },
    routes: {
      'GET /qa/api/state': enrolled({ body: { status: 'idle' } }),
      'GET /qa/api/prs': enrolled({ body: { prs: [{ number: 9, title: 'c' }], session: null } }),
      'POST /qa/api/enrol': () => ({ body: { token } }),
      'POST /qa/api/session': (body, headers) => {
        sessions.push([headers['x-qa-cap'], body])
        if (headers['x-qa-cap'] !== token) return CAPTURE
        return body.takeover ? { status: 202, body: { ok: true } } : { status: 409, body: { error: 'session already active', session: running } }
      },
    },
  })
  await b.settle()
  clickOpen(prList, 9)
  await b.settle()
  const card = conflictSlot.children.at(-1)
  assert.ok(card, 'the conflict card')
  token = 'tok-2' // the conductor restarted, and someone opened #8 again since
  const takeover = card.querySelector('[data-takeover]')
  takeover.onclick() // arm
  takeover.onclick() // confirm
  await b.settle()
  assert.deepEqual(sessions.slice(1), [['tok-1', { pr: 9, takeover: true }], ['tok-2', { pr: 9 }]])
  assert.equal(conflictSlot.children.length, 2, 'a new conflict card, rather than #8 ended unseen')
})

test('a takeover refused for another reason says so, rather than failing unseen', async () => {
  const prList = fakeList()
  const conflictSlot = { children: [], innerHTML: '', appendChild(child) { conflictSlot.children.push(child); return child } }
  const b = fakeBrowser({
    stored: 'tok-1',
    elements: { prList, conflictSlot },
    routes: {
      'GET /qa/api/state': { body: { status: 'idle' } },
      'GET /qa/api/prs': { body: { prs: [{ number: 9, title: 'c' }], session: null } },
      'POST /qa/api/session': body => (body.takeover ? { status: 503, body: { error: 'shutting down' } } : { status: 409, body: { error: 'session already active', session: { pr: 8, status: 'ready' } } }),
    },
  })
  await b.settle()
  clickOpen(prList, 9)
  await b.settle()
  const takeover = conflictSlot.children.at(-1).querySelector('[data-takeover]')
  takeover.onclick(); takeover.onclick()
  await b.settle()
  assert.equal(b.byId('announcerAssertive').textContent, "Couldn't open #9: shutting down")
})

// While one Open QA is on its way (a restart's re-enrolment included), the
// redrawn rows take no other.
test('a click on another row while an Open QA is on its way does nothing', async () => {
  let token = 'tok-1'
  const prList = fakeList()
  const enrolled = answer => (_, headers) => (headers['x-qa-cap'] === token ? answer : CAPTURE)
  const b = fakeBrowser({
    stored: 'tok-1',
    elements: { prList },
    routes: {
      'GET /qa/api/state': enrolled({ body: { status: 'idle' } }),
      'GET /qa/api/prs': enrolled({ body: { prs: [{ number: 7, title: 'a' }, { number: 8, title: 'b' }], session: null } }),
      'POST /qa/api/enrol': () => ({ body: { token }, ticks: 6 }),
      'POST /qa/api/session': (_, headers) => (headers['x-qa-cap'] === token ? { status: 202, body: { ok: true } } : CAPTURE),
    },
  })
  await b.settle()
  token = 'tok-2'
  clickOpen(prList, 7)
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r))
  const other = clickOpen(prList, 8)
  assert.deepEqual([other.attrs['aria-busy'], other.btn.textContent], [undefined, undefined])
  await b.settle()
  assert.deepEqual([other.attrs['aria-busy'], other.btn.textContent], [undefined, undefined])
  assert.equal(b.location.hash, '#/pr/7/boot')
})

// A browser showing a session learns it ended, or was opened again (by
// another browser, say), on its next idle poll: the new session's panes
// take new pane cookies, so it enters them again.
test('a session view whose session ended or was opened again elsewhere notices on its next idle poll', async () => {
  let state = { status: 'ready', pr: 7, panes: PANES, startedAt: 1000, lastActivity: 1000, idleMinutes: 30 }
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': () => ({ body: state }),
      'GET /qa/api/prs': { body: { prs: [], session: null } },
      'POST /qa/api/pane-entry': entryRoute,
    },
  })
  await b.settle()
  const entries = () => b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/pane-entry').length
  const poll = async () => { b.intervals.filter(i => i.ms === 60000).at(-1).fn(); await b.settle() }
  assert.equal(entries(), 2)
  await poll()
  assert.equal(entries(), 2, 'the same session: nothing to do')
  state = { ...state, startedAt: 2000 }
  await poll()
  assert.equal(entries(), 4, 'opened again: both panes entered again')
  assert.equal(b.location.hash, '#/pr/7')
  state = { status: 'idle', pr: null }
  await poll()
  assert.equal(entries(), 4)
  assert.equal(b.location.hash, '#/', 'ended: back to the picker')
})

// #8: each action a pane's bridge reports becomes a mark in the session's
// action log: the pane and the kind of action, never the element or a value.
test('a click, submit, change or Enter a pane reports is marked, value-free, mirrored or not, at most one of each kind a pane each 100 ms', async () => {
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES } },
      'POST /qa/api/pane-entry': entryRoute,
      'POST /qa/api/actions/mark': { body: { recorded: true } },
    },
  })
  await b.settle()
  const [, , onMessage] = b.listeners.find(([name, type]) => name === 'window' && type === 'message')
  const marks = () => b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/actions/mark').map(e => e[4])
  const event = (origin, data) => onMessage({ origin, data: { qa: 1, kind: 'event', selector: '#card-number', value: '4111 SECRET', ...data } })
  event(PANES.baseOrigin, { type: 'click' })
  event(PANES.baseOrigin, { type: 'submit' }) // the submit the click set off: another kind
  event(PANES.baseOrigin, { type: 'click' }) // the same kind within 100 ms
  event(PANES.prOrigin, { type: 'submit' })
  await new Promise(r => setTimeout(r, 110))
  // after a gap, on its own: not an action
  event(PANES.baseOrigin, { type: 'keydown', key: 'Escape' })
  await new Promise(r => setTimeout(r, 110))
  event(PANES.baseOrigin, { type: 'input' }) // nor this
  event(PANES.baseOrigin, { type: 'scroll' })
  event(PANES.baseOrigin, { type: 'keydown', key: 'Enter' })
  await new Promise(r => setTimeout(r, 110))
  b.byId('mirrorBtn').onclick() // mirroring off: still marked
  event(PANES.prOrigin, { type: 'change' })
  // a message from anywhere else is no pane's
  event('https://evil.example', { type: 'click' })
  onMessage({ origin: PANES.prOrigin, data: { qa: 1, kind: 'nav', href: '/x' } })
  await b.settle()
  assert.deepEqual(marks(), [
    { pane: 'base', type: 'click' }, { pane: 'base', type: 'submit' }, { pane: 'pr', type: 'submit' }, { pane: 'base', type: 'enter' }, { pane: 'pr', type: 'change' },
  ])
  assert.doesNotMatch(JSON.stringify(b.log.filter(e => e[0] === 'fetch')), /SECRET|card-number/)
})

// --- #8: the Data and Actions panels ----------------------------------------------
// What they show comes from the panes, which PR code controls: built as plain
// nodes, drawn with textContent only.

// Every text a node tree holds, depth first.
const textsOf = nodes => nodes.flatMap(n => [...(n.text === undefined ? [] : [String(n.text)]), ...(n.title ? [n.title] : []), ...textsOf(n.children || [])])
const actsOf = nodes => nodes.flatMap(n => [...(n.act ? [n.act] : []), ...actsOf(n.children || [])])
const HOSTILE = '<img src=x onerror=alert(1)>'

test('cellText: a value as text; a secret only as one; personal data as its fingerprint', () => {
  assert.equal(cellText(null), 'null')
  assert.equal(cellText(undefined), 'null')
  assert.equal(cellText('a "b"'), '"a \\"b\\""')
  assert.equal(cellText(3), '3')
  assert.equal(cellText(false), 'false')
  assert.equal(cellText({ t: 'json', s: '{"a":1}' }), '{"a":1}')
  assert.equal(cellText({ t: 'long', s: 'abc', len: 900, d: 'x' }), 'abc… (900 characters)')
  assert.equal(cellText({ t: 'blob', len: 9, d: 'x' }), '(9 bytes)')
  assert.equal(cellText({ t: 'secret', d: '0123456789abcdef' }), '(secret)')
  assert.equal(cellText({ t: 'pii', fp: 'deadbeef', type: 'string', len: 16 }), '(personal data deadbeef, string, 16)')
  for (const odd of [{ t: 'other' }, {}, Symbol('x'), () => 1]) assert.equal(cellText(odd), '?')
})

test('trustLabel: trusted only when the session is isolated, else advisory, which warns', () => {
  assert.deepEqual([trustLabel('trusted').text, trustLabel('trusted').warn], ['trusted', false])
  for (const t of ['advisory', undefined, 'TRUSTED', null]) assert.deepEqual([trustLabel(t).text, trustLabel(t).warn], ['advisory', true], String(t))
  assert.match(trustLabel('advisory').title, /excuses nothing/)
})

test('flagText and dataBadge: the badge counts the red flags the base didn\'t share, both spans', () => {
  assert.equal(flagText({ collection: 'saved_carts', kind: 'delete', severity: 'red', pr: 3, base: 0 }), 'saved_carts: rows deleted, PR 3, base 0')
  assert.equal(flagText({ collection: 'users', kind: 'cleared', severity: 'amber', pr: 1, base: 0, field: 'email' }), 'users: value cleared (email), PR 1, base 0')
  assert.equal(flagText({ collection: 'c', kind: 'constructor', pr: 1, base: 0 }), 'c: constructor, PR 1, base 0')
  const flags = [
    { collection: 'a', kind: 'delete', severity: 'red', pr: 1, base: 0 },
    { collection: 'a', kind: 'emptied', severity: 'red', pr: 1, base: 1 }, // advisory: red, but the base did it too
    { collection: 'b', kind: 'cleared', severity: 'amber', pr: 1, base: 0 },
  ]
  assert.equal(dataBadge({ active: true, boot: { flags }, session: { flags: [flags[0]] } }), 2)
  assert.equal(dataBadge({ active: true, boot: null, session: null }), 0)
  for (const none of [null, undefined, { available: false }, { available: true, active: false }]) assert.equal(dataBadge(none), 0)
})

const DIFF = (collections) => ({ collections })
const coll = (extra = {}) => ({ status: 'changed', key: ['id'], inserted: [], updated: [], deleted: [], fieldsDropped: [], fieldsAdded: [], countBefore: 3, countAfter: 0, truncated: false, ...extra })
function sampleData(extra = {}) {
  const name = `saved_carts${HOSTILE}`
  const pr = DIFF({
    [name]: coll({
      deleted: [{ key: '[1]', row: { id: 1, owner: { t: 'pii', fp: 'cafe0123', type: 'string', len: 15 }, note: HOSTILE, token: { t: 'secret', d: 'f'.repeat(16) } } }],
      updated: [{ key: '[2]', fields: [{ field: 'token', before: { t: 'secret', d: 'a'.repeat(16) }, after: { t: 'secret', d: 'b'.repeat(16) } }, { field: 'n', before: 1, after: 2 }] }],
    }),
  })
  const base = DIFF({ [name]: coll({ status: 'same', countAfter: 3 }) })
  const divergence = DIFF({
    [name]: {
      status: 'pr-only', truncated: false,
      counts: { base: { inserted: 0, updated: 0, deleted: 0 }, pr: { inserted: 0, updated: 1, deleted: 1 } },
      changes: [{ kind: 'delete', key: '[1]', status: 'pr-only', base: null, pr: null }, { kind: 'update', key: '[2]', status: 'pr-only', base: null, pr: [{ field: 'n', before: 1, after: 2 }] }],
    },
  })
  const flags = [{ collection: name, kind: 'delete', severity: 'red', pr: 1, base: 0 }]
  return {
    available: true, active: true, trust: 'advisory', baselineAt: 1, rebaselined: false, comparedAt: 2,
    errors: { base: `no route to db ${HOSTILE}`, pr: null }, problems: { base: [], pr: [`odd${HOSTILE}: rows must be an array`] },
    boot: null, session: { base, pr, divergence, flags }, ...extra,
  }
}

test('dataNodes: the trust chip, Snapshot now and Re-baseline, the span and view toggles, errors, flags and the collections', () => {
  const ui = { span: 'session', view: 'divergence', open: null }
  const nodes = dataNodes(sampleData(), ui)
  const texts = textsOf(nodes)
  assert.ok(texts.includes('advisory'))
  assert.ok(texts.includes(trustLabel('advisory').title))
  assert.ok(texts.includes(`BASE: no route to db ${HOSTILE}`))
  assert.ok(texts.includes(`PR: odd${HOSTILE}: rows must be an array`))
  assert.ok(texts.includes(`saved_carts${HOSTILE}: rows deleted, PR 1, base 0`))
  assert.ok(texts.includes('PR only'))
  assert.deepEqual(actsOf(nodes), ['snapshot', 'rebaseline', 'span:session', 'span:boot', 'view:divergence', 'view:base', 'view:pr', 'open:0'])
  // a collection opened: its changes, by key
  const open = textsOf(dataNodes(sampleData(), { ...ui, open: 0 }))
  assert.ok(open.includes('delete [1]: PR only · base — · PR —'))
  assert.ok(open.includes('update [2]: PR only · base — · PR n: 1 → 2'))
  // the PR pane's own view: rows, a secret only as changed, personal data as a fingerprint
  const pr = textsOf(dataNodes(sampleData(), { span: 'session', view: 'pr', open: 0 }))
  assert.ok(pr.includes(`[1]: id: 1, owner: (personal data cafe0123, string, 15), note: ${JSON.stringify(HOSTILE)}, token: (secret)`))
  assert.ok(pr.includes('[2]: token: (secret, changed), n: 1 → 2'))
  assert.equal(pr.some(t => t.includes('ffffffff') || t.includes('aaaaaaaa')), false, 'no digest shows')
  // trusted, and nothing to compare yet
  assert.ok(textsOf(dataNodes(sampleData({ trust: 'trusted', session: null }), ui)).includes('Nothing to compare yet: take a snapshot with Snapshot now.'))
  assert.ok(textsOf(dataNodes(sampleData(), { ...ui, span: 'boot' })).includes('No boot span: a pane has no seeded or ready snapshot.'))
  assert.deepEqual(textsOf(dataNodes({ available: false }, ui)), ['There is no inspector, so there are no data checks.'])
  assert.deepEqual(textsOf(dataNodes({ available: true, active: false }, ui)), ['No session is ready.'])
})

test('dataNodes shows at most 50 rows a list, and says how many more', () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ key: `[${i}]`, row: { id: i } }))
  const data = sampleData({ session: { base: DIFF({ c: coll({ deleted: rows }) }), pr: DIFF({ c: coll() }), divergence: DIFF({}), flags: [] } })
  const texts = textsOf(dataNodes(data, { span: 'session', view: 'base', open: 0 }))
  assert.equal(texts.filter(t => /^\[\d+\]: id: \d+$/.test(t)).length, 50)
  assert.ok(texts.includes('and 20 more'))
})

const answer = (extra = {}) => ({
  active: true, log: 'log-a', seq: 0, more: false, resync: false, marks: [], requests: [],
  dropped: { base: 0, pr: 0 }, refused: { base: {}, pr: {} }, marksDropped: { base: 0, pr: 0 }, ...extra,
})
const req = (seq, pane, path, mark = null) => ({ seq, pane, at: 1_000 + seq, method: 'GET', path, status: 200, ms: 5, bytes: 10, aborted: false, mark })

test('mergeActions reads on from its cursor, replaces a request given again, and starts over for another log, resync, or no session', () => {
  let s = mergeActions(actionsFresh(), answer({ seq: 3, marks: [{ seq: 2, pane: 'base', at: 1_002, type: 'click' }], requests: [req(1, 'base', '/'), req(3, 'pr', '/x')] }))
  assert.deepEqual([s.log, s.seq, s.requests.size, s.marks.size, s.again], ['log-a', 3, 2, 1, false])
  s = mergeActions(s, answer({ seq: 4, requests: [req(3, 'pr', '/x', 2), req(4, 'base', '/y', 2)] }))
  assert.deepEqual([s.seq, s.requests.get(3).mark, s.requests.size], [4, 2, 3], 'regrouped in place')
  for (const other of [answer({ log: 'log-b', seq: 9 }), answer({ resync: true })]) {
    const again = mergeActions(s, other)
    assert.deepEqual([again.again, again.seq, again.log, again.requests.size], [true, 0, null, 0])
  }
  for (const gone of [answer({ active: false }), null]) {
    const none = mergeActions(s, gone)
    assert.deepEqual([none.active, none.again, none.seq, none.requests.size], [false, false, 0, 0])
  }
  // a first read takes whatever log it finds
  assert.equal(mergeActions(actionsFresh(), answer({ log: 'log-z' })).log, 'log-z')
  // what it keeps is bounded: the newest requests stay
  const many = Array.from({ length: 4_100 }, (_, i) => req(i + 1, 'base', '/p'))
  const kept = mergeActions(actionsFresh(), answer({ seq: 4_100, requests: many }))
  assert.deepEqual([kept.requests.size, Math.min(...kept.requests.keys())], [4_000, 101])
})

test('actionsNodes: the landing, then each action with the requests it set off, and the counts', () => {
  const s = mergeActions(actionsFresh(), answer({
    seq: 6,
    marks: [{ seq: 2, pane: 'pr', at: Date.UTC(2026, 9, 15, 12, 0, 0), type: 'submit' }],
    requests: [req(1, 'base', '/'), req(3, 'pr', `/x/${HOSTILE}`, 2), { ...req(4, 'base', '/slow', 2), status: 0, aborted: true }, req(6, 'base', '/later', 5)],
    dropped: { base: 1, pr: 0 }, refused: { base: { capability: 2 }, pr: {} }, marksDropped: { base: 0, pr: 3 },
  }))
  const texts = textsOf(actionsNodes(s))
  assert.equal(texts[0], 'Landing, before any action')
  assert.equal(texts[1], 'BASE GET / 200 5 ms')
  assert.match(texts[2], /^\d\d:\d\d:\d\d submit, reported by the PR pane$/)
  assert.equal(texts[3], `PR GET /x/${HOSTILE} 200 5 ms`)
  assert.equal(texts[4], 'BASE GET /slow — 5 ms (aborted)')
  assert.equal(texts[5], 'an earlier action', 'a mark no longer kept')
  assert.equal(texts.at(-1), 'dropped: BASE 1, PR 0 · refused: BASE capability 2; PR none · marks dropped: BASE 0, PR 3')
  assert.deepEqual(textsOf(actionsNodes(actionsFresh())), ['No session is ready.'])
  assert.deepEqual(textsOf(actionsNodes(mergeActions(actionsFresh(), answer()))).slice(0, 1), ['Nothing yet: the panes\' requests show here.'])
  // at most 100 actions, the newest
  const marks = Array.from({ length: 120 }, (_, i) => ({ seq: i + 1, pane: 'base', at: i, type: 'click' }))
  const busy = textsOf(actionsNodes(mergeActions(actionsFresh(), answer({ seq: 120, marks, requests: [req(200, 'base', '/')] }))))
  assert.equal(busy[0], '20 earlier actions not shown')
  assert.equal(busy.includes('Landing, before any action'), false, 'the landing is earlier still')
})

// The page draws the nodes with textContent, never markup: a hostile name
// reaches the DOM only as text.
test('the panels draw with textContent only: no innerHTML in their code, and a hostile name lands as text', async () => {
  // the page's part (indented, in the UI script) and the pure part (top level)
  const start = harnessSrc.indexOf('\n  // --- #8: the Data and Actions panels')
  const end = harnessSrc.indexOf('function startDotPoll()')
  const panels = harnessSrc.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.doesNotMatch(panels, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bsrc\s*=|\bhref\s*=/)
  const pure = harnessSrc.slice(harnessSrc.indexOf('\n// --- #8: the Data and Actions panels'), harnessSrc.indexOf('// The ticket an invite link carries'))
  assert.ok(pure.length > 1_000)
  assert.doesNotMatch(pure, /innerHTML|outerHTML|insertAdjacentHTML|document\./)

  const data = sampleData()
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES, data: { available: true } } },
      'POST /qa/api/pane-entry': entryRoute,
      'GET /qa/api/data': { body: data },
    },
  })
  await b.settle()
  const sets = b.log.filter(e => e[0] === 'set')
  const hostile = sets.filter(e => String(e[3]).includes(HOSTILE))
  assert.ok(hostile.length > 0, 'the data was drawn')
  for (const [, , prop] of hostile) assert.equal(prop, 'textContent')
  assert.equal(b.log.some(e => e[0] === 'set' && /HTML/.test(String(e[2])) && String(e[3]).includes('saved_carts')), false)
})

test('the Data panel: shown with an inspector, read as the session mounts, and Snapshot now and Re-baseline post', async () => {
  const data = sampleData()
  const posts = []
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES, data: { available: true } } },
      'POST /qa/api/pane-entry': entryRoute,
      'GET /qa/api/data': { body: data },
      'POST /qa/api/data/snapshot': body => { posts.push(body); return { body: { ...data, comparedAt: 3 } } },
    },
  })
  await b.settle()
  assert.ok(b.log.some(e => e[0] === 'fetch' && e[2] === '/qa/api/data'), 'read for the badge')
  assert.ok(b.log.some(e => e[0] === 'set' && e[1] === 'dataBtn' && e[2] === 'hidden' && e[3] === false))
  assert.ok(b.log.some(e => e[0] === 'set' && e[1] === 'dataBadge' && e[2] === 'textContent' && e[3] === '1'))
  const [, , onClick] = b.listeners.find(([name, type]) => name === 'dataBody' && type === 'click')
  const click = act => onClick({ target: { closest: () => ({ dataset: { act } }) } })
  click('snapshot')
  await b.settle()
  click('rebaseline')
  await b.settle()
  assert.deepEqual(posts, [{ rebaseline: false }, { rebaseline: true }])
  // no inspector: no Data button, and nothing read
  const none = fakeBrowser({
    hash: '#/pr/7', stored: 'tok-1',
    routes: { 'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES, data: { available: false } } }, 'POST /qa/api/pane-entry': entryRoute },
  })
  await none.settle()
  assert.ok(none.log.some(e => e[0] === 'set' && e[1] === 'dataBtn' && e[2] === 'hidden' && e[3] === true))
  assert.equal(none.log.some(e => e[0] === 'fetch' && e[2] === '/qa/api/data'), false)
})

test('the Actions panel reads on from its cursor while open, and from 0 again for another log or resync', async () => {
  const reads = []
  let next = [answer({ seq: 2, requests: [req(1, 'base', '/'), req(2, 'pr', '/')] })]
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES } },
      'POST /qa/api/pane-entry': entryRoute,
      'GET /qa/api/actions': () => ({ body: next.shift() ?? answer({ seq: 2 }) }),
    },
  })
  await b.settle()
  assert.equal(b.log.some(e => e[0] === 'fetch' && e[2] === '/qa/api/actions'), false, 'not read while closed')
  b.byId('actionsBtn').onclick()
  await b.settle()
  const poll = b.intervals.find(i => i.ms === 2000)
  assert.ok(poll, 'polled while open')
  // another session's log: start over from 0 at once
  next = [answer({ log: 'log-b', seq: 5 }), answer({ log: 'log-b', seq: 1, requests: [req(1, 'base', '/fresh')] })]
  poll.fn()
  await b.settle()
  // resync: the same
  next = [answer({ log: 'log-b', resync: true }), answer({ log: 'log-b', seq: 1, requests: [req(1, 'base', '/fresh')] })]
  poll.fn()
  await b.settle()
  for (const e of b.log) if (e[0] === 'fetch' && e[2] === '/qa/api/actions') reads.push(e[5])
  assert.deepEqual(reads, ['after=0&limit=500', 'after=2&limit=500', 'after=0&limit=500', 'after=1&limit=500', 'after=0&limit=500'])
  // closed: no more polling
  b.byId('actionsBtn').onclick()
  assert.ok(b.log.some(e => e[0] === 'set' && e[1] === 'actionsPanel' && e[2] === 'hidden' && e[3] === true))
})

// The throttle runs on a monotonic clock: the wall clock stepping back an
// hour holds no mark back, and the first mark goes at once, however soon
// after the page loaded.
test('the mark throttle runs on a monotonic clock', async () => {
  let perf = 50
  let wall = 1_000_000_000
  const b = fakeBrowser({
    hash: '#/pr/7',
    stored: 'tok-1',
    routes: {
      'GET /qa/api/state': { body: { status: 'ready', pr: 7, panes: PANES } },
      'POST /qa/api/pane-entry': entryRoute,
      'POST /qa/api/actions/mark': { body: { recorded: true } },
    },
    clock: { perf: () => perf, wall: () => wall },
  })
  await b.settle()
  const [, , onMessage] = b.listeners.find(([name, type]) => name === 'window' && type === 'message')
  const marks = () => b.log.filter(e => e[0] === 'fetch' && e[2] === '/qa/api/actions/mark')
  const click = () => onMessage({ origin: PANES.baseOrigin, data: { qa: 1, kind: 'event', type: 'click' } })
  click() // 50 ms after the page started
  perf += 150
  wall -= 3_600_000
  click() // 150 ms on, the wall clock an hour back
  perf += 50
  click() // 50 ms on: held back
  await b.settle()
  assert.equal(marks().length, 2)
})
