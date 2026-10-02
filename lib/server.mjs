// PR-QA conductor core: harness UI/API + pane proxies, composed over the five
// adapter seams. This module owns NO app, infra or registry policy: a
// consuming platform constructs {cfg, github, fsx, adapters, readBaseEnv} and
// calls startConductor. Containers, env files and log tails belong to the
// Provisioner; PR readiness belongs to the BuildConvention (describePrs);
// origins, ports and verdict labels are config. `github` is used for the PR
// list, PR head/trust lookups and the verdict comment + label.
//
// Browser-facing hardening (defence in depth, not a trust boundary):
// - all three servers listen on cfg.host (loopback by default) and answer 421
//   to a Host header outside the allowlist, so a DNS-rebound page can't reach
//   them;
// - every /api/* request must come from the harness page itself, at the
//   harness origin's host:port (403), and POST bodies must be JSON (415), so
//   another page in the reviewer's browser can't drive or read the API;
// - no other page may frame the harness, only the harness origin (plus
//   cfg.frameAncestors) may frame a pane, and the pane proxies refuse other
//   pages' requests (lib/request-guard.mjs).
//
// The harness origin is cfg.harnessOrigin, else derived as loadConfig does:
// :8444 on cfg.publicHost, else the loopback address the harness listens on
// (per request, so a harness on port 0 uses its bound port).
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { defaultHarnessOrigin, HARNESS_PATH } from './config.mjs'
import { hostPort, requireFetchMetadata, webOrigin } from './net.mjs'
import { createPaneProxy, isAllowedHost, misdirected, panePolicy } from './proxy.mjs'
import { isHarnessHost, isSameOriginRequest } from './request-guard.mjs'
import { formatVerdict } from './verdict.mjs'
import {
  createSession, reduce, touch, isIdle, bootSession, teardownSession, PANE_STAGES,
} from './session.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_PUBLIC_DIR = path.join(HERE, '..', 'public')
const DEFAULT_HOST = '127.0.0.1'
// Harness POST routes whose body must be JSON. A cross-site HTML form can't
// send that type, and a cross-site fetch() with it needs a CORS preflight.
const JSON_ROUTES = new Set(['/api/session', '/api/verdict', '/api/teardown'])
// The harness page starts sessions and posts verdicts in one click, so no
// other page may frame it (clickjacking); a browser that ignores
// frame-ancestors still honours X-Frame-Options. The Referrer-Policy pins
// what the panes' Referer check relies on: the harness origin, sent on its
// iframe loads and new tabs whatever the browser's default.
const HARNESS_FRAME_HEADERS = {
  'content-security-policy': "frame-ancestors 'self'",
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
}

function isJsonRequest(headers) {
  return String(headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() === 'application/json'
}

// The harness origin as configured, or as derivable at start, after checking
// the origins in cfg. Throws on what would otherwise fail open: a harness
// origin or extra frame ancestor that isn't an http(s) origin, a harness or
// pane origin set at start that browsers send no Fetch Metadata to (plain
// http off loopback: the request guards would take other pages for curl),
// and a harness origin equal to a pane origin (PR code would be same-origin
// with the harness). Equal pane origins are left to loadConfig: the demo's
// placeholders are equal until its proxies listen.
function startHarnessOrigin(cfg, host) {
  const configured = cfg.harnessOrigin == null ? null : webOrigin(cfg.harnessOrigin, 'cfg.harnessOrigin')
  for (const value of [].concat(cfg.frameAncestors ?? [])) webOrigin(value, 'cfg.frameAncestors')
  // A derived origin is https or loopback.
  if (configured !== null) requireFetchMetadata(configured, 'cfg.harnessOrigin', 'harness API guard')
  const origin = configured ?? defaultHarnessOrigin({ publicHost: cfg.publicHost, host, port: cfg.ports.harness })
  for (const [role, value] of Object.entries(cfg.paneOrigins ?? {})) {
    let pane
    try { pane = webOrigin(value) } catch { continue } // not an origin yet: nothing to check
    requireFetchMetadata(pane, `cfg.paneOrigins.${role}`, 'pane request guard')
    if (pane === origin) {
      throw new Error(`startConductor: the harness origin ${origin} is also the ${role} pane's origin; the harness and each pane need an origin of their own`)
    }
  }
  return origin
}

export function startConductor({ cfg, github, fsx, adapters, readBaseEnv, publicDir = DEFAULT_PUBLIC_DIR, log = console }) {
  const host = cfg.host ?? DEFAULT_HOST
  const startOrigin = startHarnessOrigin(cfg, host)
  let session = createSession()
let buildRun = null
// AbortController for the in-flight boot. Teardown/takeover abort it so a
// stale boot can never write state or tear down a newer session's panes.
let bootAbort = null
// Each pane's reserved primary-service port for the ready session; the pane
// proxies route to it and answer 503 while it is null.
let upstreams = { base: null, pr: null }
const sseClients = new Set()
const progressLog = []
// Set by shutdown(): writes are refused, no boot starts, and a server whose
// listen completes afterwards closes at once.
let closing = false

// Remove orphans a previous conductor run left behind (e.g. a deploy restarted
// the conductor mid-session), if the Provisioner can. Boots wait for it: a
// session started while the sweep is still running would otherwise collide
// with the orphans' fixed names, or have its fresh containers and network
// removed by the sweep. Never rejects (a sweep that throws synchronously, or
// rejects with a non-Error, included), so a failed sweep doesn't block boots.
// No timeout.
let sweeping = typeof adapters.provisioner.sweep === 'function'
const startupSweep = sweeping
  ? (async () => adapters.provisioner.sweep())()
      .then(() => log.log('[qa] startup sweep complete'))
      .catch(err => log.error('[qa] startup sweep failed:', err?.message ?? String(err)))
      .finally(() => { sweeping = false })
  : Promise.resolve()

function broadcast(event) {
  const stamped = { at: Date.now(), ...event }
  progressLog.push(stamped)
  const line = `data: ${JSON.stringify(stamped)}\n\n`
  for (const res of sseClients) res.write(line)
}

// The origin viewers open the harness at. Without one at start, a loopback
// harness derives it from its bound port once listening; until then, and off
// loopback with no public host, it is null.
function harnessOrigin() {
  if (startOrigin !== null) return startOrigin
  return defaultHarnessOrigin({ publicHost: null, host, port: harness.listening ? harness.address().port : 0 })
}

// Hostnames (beyond loopback) the servers answer to. Read per request: a
// platform may assign cfg.paneOrigins after the proxies are listening.
function allowedHostnames() {
  const out = []
  if (cfg.publicHost) out.push(cfg.publicHost)
  const harnessAt = harnessOrigin()
  if (harnessAt) out.push(new URL(harnessAt).hostname)
  for (const origin of Object.values(cfg.paneOrigins ?? {})) {
    try { out.push(new URL(origin).hostname) } catch { /* not a URL: contributes nothing */ }
  }
  return out.concat(cfg.allowedHosts ?? [])
}

// loginUrls are per-pane SessionResults from the AuthBootstrap adapter; the
// landingUrl carries the magic-link token (homefree's degenerate case — no
// cookies/replay needed by the proxy yet).
function paneUrls(loginUrls) {
  return {
    base: loginUrls.base.landingUrl,
    pr: loginUrls.pr.landingUrl,
    baseOrigin: cfg.paneOrigins.base,
    prOrigin: cfg.paneOrigins.pr,
  }
}

// `lastStep` is the step this boot already broadcast (startBoot sends
// ensuring-image before the sweep wait). A repeat isn't sent again: the
// harness times each step, and the boot, from its step event's `at`.
function sessionDeps(signal, lastStep = null) {
  return {
    signal,
    adapters,
    readBaseEnv,
    env: { operatorEmail: cfg.operatorEmail, paneOrigins: cfg.paneOrigins },
    onProgress: step => {
      if (signal.aborted) return
      session = reduce(session, { type: 'step', step })
      if (step === lastStep) return
      lastStep = step
      broadcast({ kind: 'step', step })
    },
    // Build progress: a CI run (runUrl/runStatus) and/or a plain-text message.
    onBuild: ({ runUrl = null, runStatus = null, message = null } = {}) => {
      if (signal.aborted) return
      buildRun = { url: runUrl, status: runStatus, message }
      broadcast({ kind: 'build', runUrl, runStatus, message })
    },
  }
}

async function startBoot(pr) {
  if (closing) return
  bootAbort?.abort()
  const ac = new AbortController()
  bootAbort = ac
  progressLog.length = 0
  buildRun = null
  broadcast({ kind: 'step', step: 'ensuring-image' })
  const deps = sessionDeps(ac.signal, 'ensuring-image')
  try {
    // Say so while the startup sweep holds the boot back, and once it's done,
    // so the message isn't left standing while the build runs.
    const waited = sweeping
    if (waited) deps.onBuild({ message: 'waiting for startup cleanup…' })
    await startupSweep
    if (ac.signal.aborted) return // torn down or taken over while waiting
    if (waited) deps.onBuild({ message: 'startup cleanup done' })
    const out = await bootSession(deps, pr)
    if (ac.signal.aborted) return // superseded: result belongs to no session
    session = reduce(session, { type: 'tags', baseTag: out.baseTag, prTag: out.prTag })
    session = reduce(session, { type: 'ready', now: Date.now(), tokens: out.loginUrls })
    upstreams = { base: out.upstreams?.base ?? null, pr: out.upstreams?.pr ?? null }
    broadcast({ kind: 'ready', pr, panes: paneUrls(out.loginUrls), baseTag: out.baseTag, prTag: out.prTag })
  } catch (err) {
    if (ac.signal.aborted) return // superseded: must not touch the current session
    const step = session.status
    session = reduce(session, { type: 'error', step, message: String(err.message ?? err) })
    // bootSession read the failing pane's tail before tearing down; a
    // BuildConvention may attach one too. Else ask the Provisioner now.
    const logTail = typeof err?.logTail === 'string' ? err.logTail : await tailForStep(step).catch(() => '')
    broadcast({ kind: 'error', step, message: session.error?.message, logTail, runUrl: buildRun?.url ?? null })
  }
}

// Best-effort log tail for a failed pane stage, if the Provisioner offers one.
// async so a synchronous logs() (return or throw) still yields a promise.
async function tailForStep(step) {
  if (!PANE_STAGES.includes(step) || typeof adapters.provisioner.logs !== 'function') return ''
  const tail = await adapters.provisioner.logs({ paneRef: { role: 'pr' }, stage: step, lines: 40 })
  return typeof tail === 'string' ? tail : ''
}

async function doTeardown() {
  bootAbort?.abort()
  bootAbort = null
  upstreams = { base: null, pr: null }
  session = reduce(session, { type: 'teardown' })
  await teardownSession({ provisioner: adapters.provisioner }).catch(() => {})
  session = reduce(session, { type: 'torn-down' })
  buildRun = null
  broadcast({ kind: 'torn-down' })
}

function sessionSummary() {
  return { pr: session.pr, status: session.status, startedAt: session.startedAt, lastActivity: session.lastActivity }
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return {} }
}

function json(res, status, body) {
  const buf = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(buf) })
  res.end(buf)
}

async function serveStatic(res, file, type) {
  try {
    const buf = await fsx.readFile(path.join(publicDir, file))
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(buf)
  } catch {
    res.writeHead(404).end('not found')
  }
}

// Build readiness per PR from the BuildConvention, if it can describe it.
// Failures and a missing describePrs degrade to 'none' (the picker still works).
async function describePrs(prs) {
  if (typeof adapters.build.describePrs !== 'function') return new Map()
  try {
    return new Map((await adapters.build.describePrs(prs)).map(d => [d.number, d]))
  } catch {
    return new Map()
  }
}

// The open-PR list, enriched with build readiness. `reason` explains a
// 'blocked' status (e.g. an untrusted head) in plain text.
async function enrichedPrs() {
  const prs = await github.listOpenPrs()
  const readiness = await describePrs(prs)
  return prs.map(pr => ({
    number: pr.number, title: pr.title, headRef: pr.headRef, author: pr.author,
    imageStatus: readiness.get(pr.number)?.status ?? 'none',
    runUrl: readiness.get(pr.number)?.runUrl ?? null,
    reason: readiness.get(pr.number)?.reason ?? null,
  }))
}

// The describePrs item for one PR: with trust data when github can give it.
async function prForDescribe(pr) {
  if (typeof github.prInfo !== 'function') return { number: pr, headSha: await github.prHead(pr) }
  const { headSha, author, authorAssociation, headRepo, headOwner } = await github.prInfo(pr)
  return { number: pr, headSha, author, authorAssociation, headRepo, headOwner }
}

// Refusals that apply before any harness route runs (the Host check runs
// earlier still, before the URL is parsed). Returns true when the request was
// answered.
function refused(req, res, p) {
  // Every API request, reads and the event stream too, must come from the
  // harness page itself: another page can't read the answers, but its writes
  // would run, and each /api/prs or /api/build-status spends GitHub API calls
  // on the conductor's token. The page itself (/ and /harness.js) stays open
  // to any navigation.
  if (p.startsWith('/api/')) {
    if (!isSameOriginRequest(req.headers)) {
      json(res, 403, { error: 'cross-site request refused' })
      return true
    }
    // The harness page shows its banner from harnessOrigin. No other page can
    // read the answer, and the origin is no secret: every pane sends it.
    if (!isHarnessHost(req.headers, harnessOrigin())) {
      json(res, 403, { error: 'not the harness origin', harnessOrigin: harnessOrigin() })
      return true
    }
  }
  const write = req.method !== 'GET' && req.method !== 'HEAD'
  // A write accepted during shutdown could start a boot nothing tears down.
  if (write && closing) {
    json(res, 503, { error: 'shutting down' })
    return true
  }
  if (req.method === 'POST' && JSON_ROUTES.has(p) && !isJsonRequest(req.headers)) {
    json(res, 415, { error: 'content-type must be application/json' })
    return true
  }
  return false
}

// Set before any handler runs, so every harness response carries them: the
// 421s and 403s, errors and the event stream. No harness response sets its
// own Content-Security-Policy to merge with.
const harnessHeaders = handler => (req, res) => {
  for (const [name, value] of Object.entries(HARNESS_FRAME_HEADERS)) res.setHeader(name, value)
  return handler(req, res)
}

// Likewise for each pane, so a response the proxy doesn't make itself still
// carries the pane's frame policy. The proxy's own responses send the policy
// through writeHead, whose headers take precedence.
const paneHeaders = handler => (req, res) => {
  res.setHeader('content-security-policy', panePolicy(harnessOrigin(), cfg.frameAncestors ?? []))
  res.setHeader('x-content-type-options', 'nosniff')
  return handler(req, res)
}

const harness = http.createServer(harnessHeaders(async (req, res) => {
  if (!isAllowedHost(req.headers.host, allowedHostnames())) return misdirected(res)
  // A request target like `//x:99999` is not a parseable URL; left uncaught it
  // rejects this async handler and takes the process down.
  let url
  try { url = new URL(req.url, 'http://x') } catch { return json(res, 400, { error: 'bad request target' }) }
  // tailscale serve --set-path may or may not strip the /qa prefix; accept both.
  const p = url.pathname.replace(/^\/qa(?=\/|$)/, '') || '/'
  try {
    if (refused(req, res, p)) return
    if (req.method === 'GET' && p === '/') return await serveStatic(res, 'index.html', 'text/html; charset=utf-8')
    if (req.method === 'GET' && p === '/harness.js') return await serveStatic(res, 'harness.js', 'text/javascript')
    if (req.method === 'GET' && p === '/api/state') {
      return json(res, 200, {
        status: session.status, pr: session.pr, error: session.error,
        baseTag: session.baseTag, prTag: session.prTag,
        startedAt: session.startedAt, lastActivity: session.lastActivity, idleMinutes: cfg.idleMinutes,
        buildRun,
        panes: session.status === 'ready' && session.tokens ? paneUrls(session.tokens) : null,
        harnessOrigin: harnessOrigin(),
      })
    }
    if (req.method === 'GET' && p === '/api/prs') {
      const prs = await enrichedPrs()
      return json(res, 200, { prs, session: sessionSummary() })
    }
    if (req.method === 'GET' && p === '/api/build-status') {
      const pr = Number(url.searchParams.get('pr'))
      if (!Number.isInteger(pr)) return json(res, 400, { error: 'pr required' })
      let d = null
      try {
        d = (await describePrs([await prForDescribe(pr)])).get(pr) ?? null
      } catch { /* return what we have */ }
      const status = d?.status ?? 'none'
      const body = { pr, status, exists: status === 'built', runUrl: d?.runUrl ?? null }
      // Only a blocked status adds a field, so the shape is otherwise unchanged.
      if (status === 'blocked') body.reason = String(d.reason ?? '')
      return json(res, 200, body)
    }
    if (req.method === 'GET' && p === '/api/progress') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      for (const e of progressLog) res.write(`data: ${JSON.stringify(e)}\n\n`)
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }
    if (req.method === 'POST' && p === '/api/session') {
      const { pr, takeover } = await readBody(req)
      if (!Number.isInteger(pr)) return json(res, 400, { error: 'pr (number) required' })
      const active = session.status !== 'idle' && session.status !== 'error'
      if (active && session.pr !== pr && !takeover) {
        return json(res, 409, { error: `session already active (pr #${session.pr}, ${session.status})`, session: sessionSummary() })
      }
      if (active && takeover) await doTeardown()
      // shutdown() may have begun while the takeover teardown ran
      if (closing) return json(res, 503, { error: 'shutting down' })
      session = reduce(session, { type: 'open', pr })
      startBoot(pr)
      return json(res, 202, { ok: true })
    }
    if (req.method === 'GET' && p === '/api/verdict/preview') {
      if (session.pr == null) return json(res, 409, { error: 'no session' })
      const verdict = url.searchParams.get('verdict')
      if (verdict !== 'accept' && verdict !== 'reject') return json(res, 400, { error: 'verdict must be accept|reject' })
      const notes = url.searchParams.get('notes') ?? ''
      const durationMin = session.startedAt ? Math.round((Date.now() - session.startedAt) / 60000) : 0
      const body = formatVerdict({ verdict, notes, pr: session.pr, baseTag: session.baseTag, prTag: session.prTag, durationMin })
      const { accept, reject } = cfg.verdictLabels
      const applies = verdict === 'accept' ? accept : reject
      const removes = verdict === 'accept' ? reject : accept
      return json(res, 200, { body, applies, removes })
    }
    if (req.method === 'POST' && p === '/api/verdict') {
      const { verdict, notes } = await readBody(req)
      if (session.pr == null) return json(res, 409, { error: 'no session' })
      if (verdict !== 'accept' && verdict !== 'reject') return json(res, 400, { error: 'verdict must be accept|reject' })
      const durationMin = session.startedAt ? Math.round((Date.now() - session.startedAt) / 60000) : 0
      const body = formatVerdict({ verdict, notes: notes ?? '', pr: session.pr, baseTag: session.baseTag, prTag: session.prTag, durationMin })
      const url2 = await github.postComment(session.pr, body)
      await github.setQaLabel(session.pr, verdict === 'accept' ? cfg.verdictLabels.accept : cfg.verdictLabels.reject)
      return json(res, 200, { url: url2 })
    }
    if (req.method === 'POST' && p === '/api/teardown') {
      await doTeardown()
      return json(res, 200, { ok: true })
    }
    res.writeHead(404).end('not found')
  } catch (err) {
    json(res, 500, { error: String(err.message ?? err) })
  }
}))

  const onActivity = () => { session = touch(session, Date.now()) }
  const bridgePath = path.join(publicDir, 'bridge.js')
  const paneProxy = role => http.createServer(paneHeaders(createPaneProxy({
    upstreamPort: () => upstreams[role],
    bridgePath,
    onActivity,
    httpMod: http,
    allowedHosts: allowedHostnames,
    harnessOrigin,
    frameAncestors: cfg.frameAncestors ?? [],
  })))
  const baseProxy = paneProxy('base')
  const prProxy = paneProxy('pr')
  const servers = { harness, baseProxy, prProxy }

  const reaper = setInterval(() => {
    if (isIdle(session, Date.now(), cfg.idleMinutes * 60_000)) {
      log.log('[qa] idle session — tearing down')
      doTeardown().catch(err => log.error('[qa] teardown failed:', err.message))
    }
  }, 60_000)

  function listen(server, port, label) {
    server.listen(port, host, () => {
      if (closing) return server.close()
      log.log(`[qa] ${label} on ${hostPort(host, server.address().port)}`)
      if (server !== harness) return
      const origin = harnessOrigin()
      if (origin) log.log(`[qa] harness at ${origin}${HARNESS_PATH}/`)
      else log.error('[qa] no harness origin (set QA_HARNESS_ORIGIN): only a pane can frame itself and the mirror is off')
      // panePolicy leaves an IPv6 literal out (a CSP source can't name one), so
      // no harness could frame the panes. A `::1` bind derives one.
      const hostname = origin ? new URL(origin).hostname : ''
      if (hostname.startsWith('[')) {
        log.error(
          `[qa] the harness origin ${origin} is an IPv6 literal, which frame-ancestors cannot name: ` +
            `the panes will stay blank; set QA_HARNESS_ORIGIN=${origin.replace(hostname, 'localhost')}`,
        )
      }
    })
  }
  listen(harness, cfg.ports.harness, 'harness')
  listen(baseProxy, cfg.ports.base, 'base pane proxy')
  listen(prProxy, cfg.ports.pr, 'pr pane proxy')

  // Stop accepting, drop keep-alive and SSE sockets, resolve once closed.
  function closeServer(server) {
    return new Promise(resolve => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  let shuttingDown = null
  async function shutdown() {
    closing = true
    clearInterval(reaper)
    await doTeardown()
    // closing keeps new boots out; this catches any that slipped in anyway.
    if (bootAbort) await doTeardown()
    for (const res of sseClients) res.end()
    sseClients.clear()
    await Promise.all(Object.values(servers).map(closeServer))
  }

  return {
    servers,
    stop() {
      clearInterval(reaper)
      harness.close()
      baseProxy.close()
      prProxy.close()
    },
    // Graceful exit for CLIs (call it on SIGINT/SIGTERM): tears the session
    // down (aborting an in-flight boot) and closes all three servers.
    shutdown() {
      shuttingDown ??= shutdown()
      return shuttingDown
    },
  }
}
