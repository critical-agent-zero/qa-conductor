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
const { esc, isHttpsUrl, LABELS, harnessOriginNotice } = cjsModule.exports

test('the CJS guard exports the pure helpers only', () => {
  assert.deepEqual(Object.keys(cjsModule.exports).sort(), ['LABELS', 'esc', 'harnessOriginNotice', 'isHttpsUrl'])
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
