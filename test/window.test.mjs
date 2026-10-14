// The enrolment window over random interleavings: a real conductor whose fake
// Provisioner calls randomly ignore the boot's AbortSignal (and so start PR
// code after a teardown), fail, or are slow, whose teardowns randomly fail,
// and whose logger may throw, driven by random boots, takeovers, teardowns and
// enrolment attempts. At each enrolment, checked synchronously inside the
// conductor (from the log line it writes as it enrols a browser):
//   1. no PR pane code is running, nor being launched;
//   2. no boot that had started by then ever launches PR code afterwards.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import { startConductor } from '../lib/server.mjs'
import { createCapability } from '../lib/capability.mjs'

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

function request(port, method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      host: '127.0.0.1', port, method, path, agent: false,
      headers: { host: `127.0.0.1:${port}`, ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers },
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(data ?? undefined)
  })
}

// One run. `boots` counts boot starts as the conductor makes them: each one
// writes a single ensuring-image step to the event stream before it awaits
// anything (see the hook in the test).
async function run(seed, counter, { loggerThrows, sweep }) {
  const r = rng(seed)
  const delay = () => tick(Math.floor(r() * 4))
  const bootOf = new WeakMap() // a boot's signal -> how many boots had started when it did
  const live = new Set() // pane roles with code running
  let launchingPr = 0
  const enrols = [] // counter.boots at each enrolment
  const launches = [] // { boot, enrolsBefore }
  const violations = []
  const tag = signal => {
    if (signal && !bootOf.has(signal)) bootOf.set(signal, counter.boots)
    return bootOf.get(signal)
  }
  const maybeAbort = (signal, ignore) => { if (!ignore && signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }
  const fail = p => { if (r() < p) throw new Error('random failure') }
  let armed = false
  const onLine = line => {
    if (/^\[qa\] a browser enrolled \(/.test(line)) {
      enrols.push(counter.boots)
      if (live.has('pr') || launchingPr > 0) violations.push({ seed, at: 'enrolment', livePr: live.has('pr'), launchingPr })
    }
    if (loggerThrows && armed && r() < 0.3) throw new Error('the logger failed')
  }
  const log = { log: (...a) => onLine(a.join(' ')), error: (...a) => onLine(a.join(' ')) }
  const capability = createCapability({ maxBrowsers: 100000 })
  const c = startConductor({
    cfg: {
      host: '127.0.0.1', idleMinutes: 30, ports: { harness: 0, base: 0, pr: 0 },
      paneOrigins: { base: 'http://127.0.0.1:1', pr: 'http://127.0.0.1:2' },
      verdictLabels: { accept: 'ok', reject: 'nope' }, exposure: 'none',
    },
    github: { listOpenPrs: async () => [], prHead: async () => 'abc', postComment: async () => 'u', setQaLabel: async () => {} },
    fsx: { readFile: async () => 'x' },
    readBaseEnv: async () => ({}),
    log,
    capability,
    adapters: {
      build: {
        migrationStrategy: 'on-boot',
        ensureBuilt: async (pr, { signal } = {}) => { tag(signal); await delay(); maybeAbort(signal, r() < 0.5); fail(0.1) },
        resolveBaseImages: async () => ({ services: { app: 'img:base' }, migrate: null }),
        resolvePrImages: async pr => ({ services: { app: `img:pr-${pr}` }, migrate: null }),
      },
      provisioner: {
        ...(sweep ? { sweep: async () => { await delay(); await delay(); fail(0.2) } } : {}),
        provisionDatabase: async ({ signal }) => { tag(signal); await delay(); maybeAbort(signal, r() < 0.5); fail(0.05); return { dsn: 'd', db: {} } },
        reserveServices: async ({ signal }) => { tag(signal); await delay(); return { app: { url: 'http://127.0.0.1:9', port: 9 } } },
        launchServices: async ({ paneRef, signal }) => {
          const boot = tag(signal)
          const pr = paneRef.role === 'pr'
          if (pr) launchingPr++
          try {
            await delay()
            maybeAbort(signal, r() < 0.6) // often ignores the abort: launches after a teardown
            live.add(paneRef.role)
            if (pr) launches.push({ boot, enrolsBefore: [...enrols] })
          } finally { if (pr) launchingPr-- }
          await delay()
          fail(0.15)
        },
        waitHealthy: async ({ signal }) => { tag(signal); await delay(); maybeAbort(signal, r() < 0.5); fail(0.05) },
        teardown: async ({ paneRef }) => {
          await delay()
          if (r() < 0.1) throw new Error('teardown failed') // and removes nothing
          live.delete(paneRef.role)
          await delay()
        },
      },
      seed: { databases: [], seedPane: async () => {} },
      envTransform: { derivePaneEnv: () => ({ app: {} }) },
      auth: { requiresDb: false, establishSession: async ({ pane }) => ({ landingUrl: `/login-${pane.ref.role}` }) },
    },
  })
  await Promise.all(Object.values(c.servers).map(s => (s.listening ? null : once(s, 'listening'))))
  armed = true
  const port = c.servers.harness.address().port
  const operator = capability.enrol()
  const api = (method, path, body) => request(port, method, `/qa/api${path}`, { body, headers: { 'x-qa-cap': operator } }).catch(() => {})
  // what PR code on loopback sends
  const enrol = () => request(port, 'POST', '/qa/api/enrol', { body: {}, headers: { 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` } }).catch(() => {})
  // an open event stream, so every boot start is written
  const stream = http.get({ host: '127.0.0.1', port, path: `/qa/api/progress?cap=${operator}`, agent: false })
  stream.on('error', () => {})
  try {
    await tick(30)
    let pr = 1
    const ops = []
    for (let i = 0; i < 60; i++) {
      const x = r()
      if (x < 0.25) {
        if (r() >= 0.4) pr++ // else the same PR again
        ops.push(api('POST', '/session', { pr, takeover: r() < 0.4 }))
      } else if (x < 0.37) ops.push(api('POST', '/teardown', {}))
      else ops.push(enrol())
      await tick(Math.floor(r() * 12))
    }
    await Promise.all(ops)
    for (let i = 0; i < 40; i++) {
      await tick(5)
      if (r() < 0.3) await api('POST', '/teardown', {})
      await enrol()
    }
  } finally {
    stream.destroy()
    c.stop()
    for (const s of Object.values(c.servers)) s.closeAllConnections()
  }
  // 2: a boot that had started before an enrolment launched PR code after it
  for (const l of launches) {
    for (const bootsThen of l.enrolsBefore) if (l.boot !== undefined && l.boot <= bootsThen) violations.push({ seed, at: 'launch', boot: l.boot, bootsThen })
  }
  return { violations, enrols: enrols.length, launches: launches.length }
}

test('no browser enrols while PR code runs or can still start, over random interleavings', async t => {
  const counter = { boots: 0 }
  const write = http.ServerResponse.prototype.write
  t.after(() => { http.ServerResponse.prototype.write = write })
  http.ServerResponse.prototype.write = function (chunk, ...rest) {
    if (typeof chunk === 'string' && chunk.includes('"kind":"step","step":"ensuring-image"')) counter.boots++
    return write.call(this, chunk, ...rest)
  }
  let enrols = 0
  let launches = 0
  const violations = []
  for (const seed of SEEDS) {
    const out = await run(seed, counter, { loggerThrows: seed % 3 === 0, sweep: seed % 2 === 0 })
    enrols += out.enrols
    launches += out.launches
    violations.push(...out.violations)
  }
  assert.deepEqual(violations.slice(0, 5), [])
  // the runs exercised both sides
  assert.ok(enrols > 50, `${enrols} enrolments`)
  assert.ok(launches > 5, `${launches} PR launches`)
})
