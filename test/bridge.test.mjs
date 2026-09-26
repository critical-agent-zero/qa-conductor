import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// bridge.js is a plain browser script with a CommonJS export guard
// (`if (typeof module !== 'undefined' && module.exports)`). The platform
// package.json declares "type": "module", so require()ing the .js file
// directly would parse it as ESM and the guard would never fire — evaluate
// it through the CJS wrapper shape instead. `window` stays undefined here,
// which keeps the runtime IIFE inert.
const bridgePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'bridge.js')
const source = readFileSync(bridgePath, 'utf8')
const cjsModule = { exports: {} }
new Function('module', 'exports', source)(cjsModule, cjsModule.exports)
const { buildSelector, resolveSelector, harnessOriginFromHash } = cjsModule.exports

// --- minimal DOM stub (no jsdom) ------------------------------------------
// Supports only what the bridge helpers use: querySelector (attribute-equals
// form), getAttribute, tagName, textContent, parentNode, children.

class StubElement {
  constructor(tagName, attrs = {}, children = []) {
    this.tagName = tagName.toUpperCase()
    this.attrs = attrs
    this.id = attrs.id || ''
    this.parentNode = null
    this.children = children
    this.ownText = attrs.text || ''
    for (const child of children) child.parentNode = this
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }

  get textContent() {
    let out = this.ownText
    for (const child of this.children) out += child.textContent
    return out
  }
}

class StubDocument {
  constructor(body) {
    this.body = body
  }

  querySelector(selector) {
    const m = /^\[([a-z-]+)="((?:[^"\\]|\\.)*)"\]$/i.exec(selector)
    if (!m) return null
    const value = m[2].replace(/\\(.)/g, '$1')
    const stack = [this.body]
    while (stack.length) {
      const el = stack.shift()
      if (el.getAttribute(m[1]) === value) return el
      stack.push(...el.children)
    }
    return null
  }
}

const h = (tag, attrs = {}, children = []) => new StubElement(tag, attrs, children)

// Two structurally identical pages (base pane / PR pane): selectors built in
// one must resolve to the twin element in the other.
function makePage() {
  const refs = {}
  refs.testidBtn = h('button', { 'data-testid': 'submit-order', id: 'submit', 'aria-label': 'Submit order', text: 'Submit' })
  refs.idInput = h('input', { id: 'email', 'aria-label': 'Email address' })
  refs.ariaNav = h('nav', { 'aria-label': 'Main menu' })
  refs.textLink = h('a', { text: '  Docs  ' })
  refs.plainSpan = h('span', { text: 'hi' })
  refs.heading = h('h2', { text: 'Items' })
  refs.para1 = h('p', { text: 'a' })
  refs.para2 = h('p', { text: 'b' })
  refs.item1 = h('li', { text: 'one' })
  refs.item2 = h('li', { text: 'two' })
  refs.list = h('ul', {}, [refs.item1, refs.item2])
  refs.section = h('div', {}, [refs.heading, refs.para1, refs.para2, refs.list])
  const body = h('body', {}, [refs.testidBtn, refs.idInput, refs.ariaNav, refs.textLink, refs.plainSpan, refs.section])
  return { document: new StubDocument(body), refs }
}

// --- ladder rung round-trips ----------------------------------------------

test('rung 1: data-testid wins over id, aria-label and text', () => {
  const a = makePage()
  const b = makePage()
  const desc = buildSelector(a.refs.testidBtn)
  assert.deepEqual(desc, { t: 'testid', v: 'submit-order' })
  assert.equal(resolveSelector(desc, b.document), b.refs.testidBtn)
})

test('rung 2: id when no data-testid', () => {
  const a = makePage()
  const b = makePage()
  const desc = buildSelector(a.refs.idInput)
  assert.deepEqual(desc, { t: 'id', v: 'email' })
  assert.equal(resolveSelector(desc, b.document), b.refs.idInput)
})

test('rung 3: aria-label when no data-testid or id', () => {
  const a = makePage()
  const b = makePage()
  const desc = buildSelector(a.refs.ariaNav)
  assert.deepEqual(desc, { t: 'aria', v: 'Main menu' })
  assert.equal(resolveSelector(desc, b.document), b.refs.ariaNav)
})

test('rung 4: trimmed link/button text', () => {
  const a = makePage()
  const b = makePage()
  const desc = buildSelector(a.refs.textLink)
  assert.deepEqual(desc, { t: 'text', tag: 'A', v: 'Docs' })
  assert.equal(resolveSelector(desc, b.document), b.refs.textLink)
})

test('rung 4: text of a button spans its descendants', () => {
  const button = h('button', { text: 'Sa' }, [h('span', { text: 've' })])
  const page = new StubDocument(h('body', {}, [button]))
  const desc = buildSelector(button)
  assert.deepEqual(desc, { t: 'text', tag: 'BUTTON', v: 'Save' })
  assert.equal(resolveSelector(desc, page), button)
})

test('rung 4 is skipped when the text repeats: a list of identical buttons falls to the path', () => {
  // Found by qa-conductor QA-ing itself: five "Open QA" buttons, one per PR.
  // A text descriptor would match all five in the peer pane (a non-match by
  // design), so the click was never mirrored.
  const page = () => {
    const rows = [1, 2, 3].map(n => h('li', {}, [h('span', { text: `#10${n}` }), h('button', { text: 'Open QA' })]))
    const doc = new StubDocument(h('body', {}, [h('ul', {}, rows)]))
    return { doc, second: rows[1].children[1] }
  }
  const a = page()
  const b = page()
  const desc = buildSelector(a.second)
  assert.deepEqual(desc, { t: 'path', v: 'UL:nth-of-type(1)>LI:nth-of-type(2)>BUTTON:nth-of-type(1)' })
  assert.equal(resolveSelector(desc, b.doc), b.second)
})

test('rung 4 still applies when the text is unique among same-tag elements', () => {
  const save = h('button', { text: 'Save' })
  const doc = new StubDocument(h('body', {}, [h('button', { text: 'Cancel' }), save, h('a', { text: 'Save' })]))
  assert.deepEqual(buildSelector(save), { t: 'text', tag: 'BUTTON', v: 'Save' })
  assert.equal(resolveSelector(buildSelector(save), doc), save)
})

test('rung 5: structural path for anonymous elements', () => {
  const a = makePage()
  const b = makePage()
  const desc = buildSelector(a.refs.item2)
  assert.deepEqual(desc, { t: 'path', v: 'DIV:nth-of-type(1)>UL:nth-of-type(1)>LI:nth-of-type(2)' })
  assert.equal(resolveSelector(desc, b.document), b.refs.item2)
})

test('rung 5: nth-of-type counts same-tag siblings only', () => {
  const a = makePage()
  const b = makePage()
  // para2 is the third child of the section but only the second <p>
  const desc = buildSelector(a.refs.para2)
  assert.deepEqual(desc, { t: 'path', v: 'DIV:nth-of-type(1)>P:nth-of-type(2)' })
  assert.equal(resolveSelector(desc, b.document), b.refs.para2)
})

// --- ladder fallthrough ----------------------------------------------------

test('non-button/link elements skip the text rung', () => {
  const a = makePage()
  const b = makePage()
  const desc = buildSelector(a.refs.plainSpan)
  assert.deepEqual(desc, { t: 'path', v: 'SPAN:nth-of-type(1)' })
  assert.equal(resolveSelector(desc, b.document), b.refs.plainSpan)
})

test('button text longer than 60 chars falls through to path', () => {
  const long = 'x'.repeat(61)
  const button = h('button', { text: long })
  h('body', {}, [button])
  assert.deepEqual(buildSelector(button), { t: 'path', v: 'BUTTON:nth-of-type(1)' })
})

test('button text of exactly 60 chars still uses the text rung', () => {
  const text = 'y'.repeat(60)
  const button = h('button', { text })
  h('body', {}, [button])
  assert.deepEqual(buildSelector(button), { t: 'text', tag: 'BUTTON', v: text })
})

test('whitespace-only button text falls through to path', () => {
  const button = h('button', { text: '   ' })
  h('body', {}, [button])
  assert.deepEqual(buildSelector(button), { t: 'path', v: 'BUTTON:nth-of-type(1)' })
})

// --- resolution strictness --------------------------------------------------

test('ambiguous text resolves to null', () => {
  const one = h('button', { text: 'Save' })
  const two = h('button', { text: 'Save' })
  const page = new StubDocument(h('body', {}, [one, h('div', {}, [two])]))
  assert.equal(resolveSelector({ t: 'text', tag: 'BUTTON', v: 'Save' }, page), null)
})

test('unique text among many same-tag elements resolves', () => {
  const save = h('button', { text: 'Save' })
  const cancel = h('button', { text: 'Cancel' })
  const page = new StubDocument(h('body', {}, [save, cancel]))
  assert.equal(resolveSelector({ t: 'text', tag: 'BUTTON', v: 'Cancel' }, page), cancel)
})

test('unresolvable descriptors return null', () => {
  const { document } = makePage()
  assert.equal(resolveSelector({ t: 'testid', v: 'nope' }, document), null)
  assert.equal(resolveSelector({ t: 'id', v: 'nope' }, document), null)
  assert.equal(resolveSelector({ t: 'aria', v: 'nope' }, document), null)
  assert.equal(resolveSelector({ t: 'text', tag: 'BUTTON', v: 'nope' }, document), null)
  assert.equal(resolveSelector({ t: 'path', v: 'DIV:nth-of-type(1)>TABLE:nth-of-type(1)' }, document), null)
  assert.equal(resolveSelector({ t: 'path', v: 'DIV:nth-of-type(9)' }, document), null)
  assert.equal(resolveSelector({ t: 'bogus', v: 'x' }, document), null)
  assert.equal(resolveSelector(null, document), null)
})

test('selector for body itself round-trips as an empty path', () => {
  const a = makePage()
  const b = makePage()
  const desc = buildSelector(a.document.body)
  assert.deepEqual(desc, { t: 'path', v: '' })
  assert.equal(resolveSelector(desc, b.document), b.document.body)
})

// --- module shape (heartbeat lives in the inert IIFE) ----------------------
// The heartbeat setInterval runs only inside the browser IIFE, which stays
// dormant here (window is undefined). Guard that adding it left the pure-helper
// exports intact so the harness can still build and resolve selectors.

test('the CJS guard still exports the pure helpers', () => {
  assert.equal(typeof buildSelector, 'function')
  assert.equal(typeof resolveSelector, 'function')
  assert.equal(typeof harnessOriginFromHash, 'function')
  assert.deepEqual(Object.keys(cjsModule.exports).sort(), ['buildSelector', 'harnessOriginFromHash', 'resolveSelector'])
})

// --- the #qa= mirroring contract (reader side of harness.js withQaFragment) --

const ORIGIN = 'https://qa.example.ts.net'
const ENC = encodeURIComponent(ORIGIN)

test('harnessOriginFromHash reads the qa param of an &-separated fragment', () => {
  assert.equal(harnessOriginFromHash(`#qa=${ENC}`), ORIGIN)
  assert.equal(harnessOriginFromHash(`#key=K&qa=${ENC}`), ORIGIN)
  assert.equal(harnessOriginFromHash(`qa=${ENC}&x=1`), ORIGIN, 'leading # optional')
})

test('harnessOriginFromHash ignores qa= inside another param\'s value', () => {
  assert.equal(harnessOriginFromHash(`#next=/a?qa=1&qa=${ENC}`), ORIGIN)
  assert.equal(harnessOriginFromHash(`#token=abcqa==&qa=${ENC}`), ORIGIN)
  assert.equal(harnessOriginFromHash('#token=abcqa=1'), null)
})

test('harnessOriginFromHash: absent, empty or malformed gives null', () => {
  for (const hash of ['', '#', '#key=K', '#qa=', '#qa', '#qa=%E0%A4%A', undefined, null]) {
    assert.equal(harnessOriginFromHash(hash), null, String(hash))
  }
})

// --- runtime trust: the IIFE against a stub window ----------------------------
// The fragment is attacker-writable (any page can frame or open a pane URL), so
// the bridge trusts it only inside a frame and only talks to that frame's
// parent, at the qa= origin.

function runBridge({ framed = true, hash = `#qa=${ENC}`, stored = null, parentPost = null } = {}) {
  const listeners = {}
  const posted = []
  const clicks = []
  const store = stored ? { qaHarnessOrigin: stored } : {}
  const button = { tagName: 'BUTTON', click: () => clicks.push('go') }
  const doc = {
    addEventListener() {},
    querySelector: sel => (sel === '[id="go"]' ? button : null),
  }
  const parent = { postMessage: parentPost ?? ((msg, target) => posted.push({ msg, target, to: 'parent' })) }
  const win = {
    location: { hash, pathname: '/p', search: '' },
    sessionStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v } },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn) },
    history: { pushState() {}, replaceState() {} },
    postMessage: (msg, target) => posted.push({ msg, target, to: 'self' }),
  }
  win.parent = framed ? parent : win
  const mod = { exports: {} }
  new Function('module', 'exports', 'window', 'document', 'setInterval', 'requestAnimationFrame', source)(
    mod, mod.exports, win, doc, () => 0, () => 0,
  )
  const message = ev => { for (const fn of listeners.message ?? []) fn(ev) }
  const replay = { qa: 1, kind: 'replay', type: 'click', selector: { t: 'id', v: 'go' } }
  return { posted, clicks, message, parent, win, store, replay }
}

test('framed: posts to the parent at the qa= origin, never "*"', () => {
  const b = runBridge()
  assert.deepEqual(b.posted, [{ msg: { qa: 1, kind: 'nav', href: '/p' }, target: ORIGIN, to: 'parent' }])
  assert.equal(b.store.qaHarnessOrigin, ORIGIN)
})

test('framed: a replay is applied only from the parent at the qa= origin', () => {
  const b = runBridge()
  b.message({ origin: ORIGIN, source: {}, data: b.replay })
  assert.deepEqual(b.clicks, [], 'another window at the harness origin')
  b.message({ origin: 'https://evil.example', source: b.parent, data: b.replay })
  assert.deepEqual(b.clicks, [], 'the parent at another origin')
  b.message({ origin: ORIGIN, source: b.parent, data: b.replay })
  assert.deepEqual(b.clicks, ['go'])
})

test('not framed (e.g. window.open with #qa=): no trust, no mirroring', () => {
  const b = runBridge({ framed: false })
  b.message({ origin: ORIGIN, source: b.win, data: b.replay })
  b.message({ origin: ORIGIN, source: {}, data: b.replay })
  assert.deepEqual(b.clicks, [])
  assert.deepEqual(b.posted, [])
  assert.equal(b.store.qaHarnessOrigin, undefined, 'the fragment is not remembered either')

  const stale = runBridge({ framed: false, hash: '', stored: ORIGIN })
  stale.message({ origin: ORIGIN, source: stale.win, data: stale.replay })
  assert.deepEqual([stale.clicks, stale.posted], [[], []], 'nor is a remembered origin used')
})

test('framed without a qa= origin: nothing is posted; a remembered origin still works', () => {
  assert.deepEqual(runBridge({ hash: '#key=K' }).posted, [])
  const later = runBridge({ hash: '', stored: ORIGIN })
  assert.deepEqual(later.posted.map(p => p.target), [ORIGIN])
})

test('a malformed qa= origin (postMessage throws SyntaxError) does not break install', () => {
  assert.doesNotThrow(() => runBridge({
    hash: '#qa=not%20an%20origin',
    parentPost: () => { throw new SyntaxError('Invalid target origin') },
  }))
})
