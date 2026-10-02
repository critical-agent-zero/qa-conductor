import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isHarnessHost, isSameOriginRequest, paneRefusal } from '../lib/request-guard.mjs'

const HARNESS = 'https://h.ts.net:8444'
const PANE_HOST = 'h.ts.net:10000'
const req = (headers, method = 'GET', host = PANE_HOST) => ({ method, headers: { host, ...headers } })
const fetchMeta = (site, mode, dest) => ({ 'sec-fetch-site': site, 'sec-fetch-mode': mode, 'sec-fetch-dest': dest })

test('isSameOriginRequest: same-origin, none and no browser headers pass; other sites and foreign Origins do not', () => {
  assert.equal(isSameOriginRequest({ 'sec-fetch-site': 'same-origin' }), true)
  assert.equal(isSameOriginRequest({ 'sec-fetch-site': 'none' }), true)
  assert.equal(isSameOriginRequest({}), true)
  assert.equal(isSameOriginRequest({ origin: 'https://h.ts.net:10000', host: PANE_HOST }), true)
  assert.equal(isSameOriginRequest({ 'sec-fetch-site': 'same-site' }), false)
  assert.equal(isSameOriginRequest({ 'sec-fetch-site': 'cross-site' }), false)
  assert.equal(isSameOriginRequest({ origin: 'https://h.ts.net:8444', host: PANE_HOST }), false)
  assert.equal(isSameOriginRequest({ origin: 'null', host: PANE_HOST }), false)
})

// What another page in the operator's browser can make it send to a pane
// without reading the answer. Each of these used to reach the app, signed in
// as the operator by the proxy's jar.
test('paneRefusal: other pages\' subresource loads and frames are refused', () => {
  const shapes = [
    [fetchMeta('cross-site', 'no-cors', 'image'), 'cross-site request refused'],
    [fetchMeta('cross-site', 'no-cors', 'script'), 'cross-site request refused'],
    [fetchMeta('cross-site', 'no-cors', 'style'), 'cross-site request refused'],
    [fetchMeta('cross-site', 'no-cors', 'empty'), 'cross-site request refused'],
    [fetchMeta('same-site', 'no-cors', 'image'), 'cross-site request refused'],
    [fetchMeta('same-site', 'no-cors', 'font'), 'cross-site request refused'],
    [fetchMeta('same-site', 'navigate', 'iframe'), 'cross-site framing refused'],
    [{ ...fetchMeta('same-site', 'navigate', 'iframe'), referer: 'https://mallory.tail05ae64.ts.net/' }, 'cross-site framing refused'],
    [{ ...fetchMeta('cross-site', 'navigate', 'iframe'), referer: 'https://evil.example/' }, 'cross-site framing refused'],
    [fetchMeta('cross-site', 'navigate', 'document'), 'cross-site navigation refused'],
    [{ ...fetchMeta('same-site', 'navigate', 'document'), referer: 'https://mallory.tail05ae64.ts.net/' }, 'cross-site navigation refused'],
  ]
  for (const [headers, reason] of shapes) {
    assert.equal(paneRefusal(req(headers), HARNESS), reason, JSON.stringify(headers))
  }
})

test('paneRefusal: the harness\'s frames and new tabs, the pane\'s own requests, the operator and curl are served', () => {
  const served = [
    // the harness loads a pane in its iframe, or opens it in a new tab
    { ...fetchMeta('same-site', 'navigate', 'iframe'), referer: `${HARNESS}/` },
    { ...fetchMeta('same-site', 'navigate', 'document'), referer: `${HARNESS}/` },
    // the pane's own page, assets, fetches and a form post
    fetchMeta('same-origin', 'navigate', 'iframe'),
    fetchMeta('same-origin', 'no-cors', 'image'),
    fetchMeta('same-origin', 'cors', 'empty'),
    // the operator types or bookmarks the URL
    fetchMeta('none', 'navigate', 'document'),
    // curl
    {},
  ]
  for (const headers of served) assert.equal(paneRefusal(req(headers), HARNESS), null, JSON.stringify(headers))
  const confirm = { ...fetchMeta('same-origin', 'navigate', 'iframe'), origin: 'https://h.ts.net:10000', 'content-type': 'application/x-www-form-urlencoded' }
  assert.equal(paneRefusal(req(confirm, 'POST'), HARNESS), null)
})

test('paneRefusal: a navigation from another site needs a harness origin to compare its Referer with', () => {
  const fromHarness = { ...fetchMeta('same-site', 'navigate', 'iframe'), referer: `${HARNESS}/` }
  assert.equal(paneRefusal(req(fromHarness)), 'cross-site framing refused')
  // no Referer (rel=noreferrer, a no-referrer policy) and no harness origin
  // don't match each other: both are missing
  assert.equal(paneRefusal(req(fetchMeta('same-site', 'navigate', 'iframe'))), 'cross-site framing refused')
  assert.equal(paneRefusal(req(fetchMeta('cross-site', 'navigate', 'document'))), 'cross-site navigation refused')
  assert.equal(paneRefusal(req({ ...fetchMeta('cross-site', 'navigate', 'iframe'), referer: 'not a url' }), null), 'cross-site framing refused')
  assert.equal(paneRefusal(req(fetchMeta('none', 'navigate', 'document'))), null)
})

// --- loopback http (the demo, self-QA, a laptop) ------------------------------
// Browsers treat 127.0.0.1 and localhost as trustworthy, so they send
// Sec-Fetch-* there too, and every other port of the same host is same-site.

const LOOP = 'http://127.0.0.1:4100'
const LOOP_PANE = '127.0.0.1:4101'
const loopReq = (headers, method = 'GET') => req(headers, method, LOOP_PANE)

test('loopback http: a harness at 127.0.0.1:P framing or opening a pane on :Q is served', () => {
  for (const dest of ['iframe', 'document']) {
    for (const referer of [`${LOOP}/`, `${LOOP}/qa/`]) {
      const headers = { ...fetchMeta('same-site', 'navigate', dest), referer }
      assert.equal(paneRefusal(loopReq(headers), LOOP), null, JSON.stringify(headers))
    }
  }
})

test('loopback http: the same request with Referer http://localhost:P/ is refused', () => {
  // the harness opened at localhost: another site than the panes on 127.0.0.1
  for (const site of ['cross-site', 'same-site']) {
    const frame = { ...fetchMeta(site, 'navigate', 'iframe'), referer: 'http://localhost:4100/' }
    assert.equal(paneRefusal(loopReq(frame), LOOP), 'cross-site framing refused', site)
    const tab = { ...fetchMeta(site, 'navigate', 'document'), referer: 'http://localhost:4100/' }
    assert.equal(paneRefusal(loopReq(tab), LOOP), 'cross-site navigation refused', site)
  }
})

test('loopback http: a page on another loopback port is refused', () => {
  // the other pane (or anything else listening on loopback) is same-site
  const other = 'http://127.0.0.1:4102'
  assert.equal(paneRefusal(loopReq({ ...fetchMeta('same-site', 'navigate', 'iframe'), referer: `${other}/` }), LOOP), 'cross-site framing refused')
  assert.equal(paneRefusal(loopReq({ ...fetchMeta('same-site', 'navigate', 'document'), referer: `${other}/` }), LOOP), 'cross-site navigation refused')
  assert.equal(paneRefusal(loopReq({ ...fetchMeta('same-site', 'no-cors', 'image'), referer: `${other}/` }), LOOP), 'cross-site request refused')
  assert.equal(paneRefusal(loopReq({ ...fetchMeta('same-site', 'cors', 'empty'), origin: other }, 'POST'), LOOP), 'cross-site request refused')
  assert.equal(paneRefusal(loopReq({ origin: other }, 'POST'), LOOP), 'cross-site request refused', 'Origin alone')
})

test('a cross-site harness (localhost) whose Referer is the configured origin is served', () => {
  const harness = 'http://localhost:4100'
  for (const dest of ['iframe', 'document']) {
    const headers = { ...fetchMeta('cross-site', 'navigate', dest), referer: `${harness}/` }
    assert.equal(paneRefusal(loopReq(headers), harness), null, dest)
  }
})

// --- the harness API's host:port check -----------------------------------------

test('isHarnessHost: a browser request at another port or host of a non-loopback harness origin is refused; the origin\'s own host:port (default port omitted), a loopback Host, a non-browser client and a null origin pass', () => {
  const browsers = [{ 'sec-fetch-site': 'same-origin' }, { origin: 'https://h.ts.net:8446' }, { 'sec-fetch-site': 'same-origin', origin: 'https://h.ts.net:8444' }]
  for (const browser of browsers) {
    const at = host => isHarnessHost({ ...browser, host }, HARNESS)
    const label = JSON.stringify(browser)
    // a stale or foreign serve handler on another port, or another host
    for (const host of ['h.ts.net:8446', 'h.ts.net', 'h.ts.net:443', 'other.ts.net:8444', 'h.ts.net.evil:8444', '', undefined, 'evil@h.ts.net:8444', 'h.ts.net:8444/x']) {
      assert.equal(at(host), false, `${label} ${host}`)
    }
    for (const host of ['h.ts.net:8444', 'H.TS.NET:8444']) assert.equal(at(host), true, `${label} ${host}`)
    // loopback Hosts: the localhost banner, a port-0 harness and a nested demo
    for (const host of ['127.0.0.1:3100', 'localhost:3100', 'LOCALHOST', '[::1]:3100', '127.0.0.2']) assert.equal(at(host), true, `${label} ${host}`)
  }
  // a default port is omitted on both sides
  for (const host of ['h.ts.net', 'h.ts.net:443']) assert.equal(isHarnessHost({ 'sec-fetch-site': 'same-origin', host }, 'https://h.ts.net'), true, host)
  assert.equal(isHarnessHost({ 'sec-fetch-site': 'same-origin', host: 'h.ts.net:8444' }, 'https://h.ts.net'), false)
  assert.equal(isHarnessHost({ 'sec-fetch-site': 'same-origin', host: 'box.lan:80' }, 'http://box.lan'), true)
  // a non-browser client (curl, a platform's script) and a null origin pass
  assert.equal(isHarnessHost({ host: 'h.ts.net:8446' }, HARNESS), true)
  assert.equal(isHarnessHost({ 'sec-fetch-site': 'same-origin', host: 'h.ts.net:8446' }, null), true)
})
