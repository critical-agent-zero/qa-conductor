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
const { withQaFragment, esc, isHttpsUrl, LABELS } = cjsModule.exports

const HARNESS = 'https://qa.example.ts.net'
const QA = `qa=${encodeURIComponent(HARNESS)}`

test('withQaFragment: a URL with no fragment gets #qa=<encoded origin>', () => {
  assert.equal(withQaFragment('https://pane:8443/login?t=1', HARNESS), `https://pane:8443/login?t=1#${QA}`)
  // an empty fragment is no fragment
  assert.equal(withQaFragment('https://pane:8443/#', HARNESS), `https://pane:8443/#${QA}`)
})

test('withQaFragment: an existing fragment gets &qa=… appended', () => {
  assert.equal(withQaFragment('https://pane/#key=K', HARNESS), `https://pane/#key=K&${QA}`)
  assert.equal(withQaFragment('https://pane/#a=1&b=2', HARNESS), `https://pane/#a=1&b=2&${QA}`)
})

test('withQaFragment: a fragment that already has a qa param is returned unchanged', () => {
  const url = 'https://pane/#key=K&qa=https%3A%2F%2Fother'
  assert.equal(withQaFragment(url, HARNESS), url)
  assert.equal(withQaFragment('https://pane/#qa=x', HARNESS), 'https://pane/#qa=x')
})

test('withQaFragment: a value that merely contains qa= is not a qa param', () => {
  assert.equal(withQaFragment('https://pane/#next=/a?qa=1', HARNESS), `https://pane/#next=/a?qa=1&${QA}`)
  assert.equal(withQaFragment('https://pane/#token=abcqa=', HARNESS), `https://pane/#token=abcqa=&${QA}`)
  assert.equal(withQaFragment('https://pane/#aqa=1', HARNESS), `https://pane/#aqa=1&${QA}`)
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
