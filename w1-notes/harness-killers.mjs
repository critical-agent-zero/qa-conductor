
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
