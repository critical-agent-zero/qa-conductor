// Round 4, lens 1 and 5: the fallback answer (built without lists), forced
// the way the author's test does (JSON.stringify fails for an answer with
// lists), and the cache around it.
//  1. a session whose PR read failed plus a boot delete: does the fallback
//     keep every red flag kind (unreadable, delete) and count them?
//  2. after the first build fails, the cache serves the fallback until the
//     state changes; a later Snapshot now gives the full answer again;
//  3. both builds fail: the failure is cached; a later state builds again;
//  4. a fallback span with no red flag reads red (unlisted) with badge >= 1;
//  5. the fallback's 20 red flags at the s1 shape (1,000 PR-only tables
//     dropped in the session, users deleted): is users' delete among them?
//  6. a view() that throws (not JSON): does the fallback survive it?
import { readFileSync } from 'node:fs'
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const cjs = { exports: {} }
new Function('module', 'exports', readFileSync(new URL('../harness37.js', import.meta.url), 'utf8'))(cjs, cjs.exports)
const { dataBadge } = cjs.exports
const rules = validateRules({})
const realStringify = JSON.stringify
let failLists = false
let failAll = false
let builds = 0
JSON.stringify = function (value, ...rest) {
  if (value && typeof value === 'object' && 'problemsCount' in value) {
    builds++
    const unlisted = value.boot?.unlisted || value.session?.unlisted
    if (failAll || (failLists && !unlisted)) throw new RangeError('Invalid string length (forced)')
  }
  return realStringify.call(JSON, value, ...rest)
}
const signal = new AbortController().signal
const users = n => ({ key: ['id'], fields: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i })) })
const pad = n => Object.fromEntries(Array.from({ length: n }, (_, t) => [`a${String(t).padStart(5, '0')}`, { key: ['id'], fields: ['id'], rows: [{ id: 1 }] }]))

async function make({ prFailsNow = false, padding = 0 } = {}) {
  let phase = 'seed'
  const capture = createDataCapture({
    rules,
    inspector: { open: ({ paneRef }) => ({ snapshot: () => {
      if (paneRef.role === 'base' || phase === 'seed') return { collections: { users: users(20) } }
      if (phase === 'ready') return { collections: { users: users(18), ...pad(padding) } }
      if (prFailsNow) throw new Error('lock timeout')
      return { collections: { users: users(5) } }
    } }) },
  })
  for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
  phase = 'ready'
  await capture.ready({ signal })
  phase = 'now'
  return { capture, now: () => capture.snapshot() }
}
const brief = s => s && { unlisted: s.unlisted, flags: s.flags.map(f => `${f.collection}:${f.kind}:${f.severity}${f.reason ? `(${f.reason})` : ''}`), flagsCount: s.flagsCount, pr: s.pr === null ? null : 'listed' }
const iso = { isolation: { verdict: 'isolated' } }

{
  const { capture, now } = await make({ prFailsNow: true })
  await now()
  failLists = true
  const v = JSON.parse(capture.viewJson(iso))
  console.log('1. fallback, PR read failed at now:', realStringify({ boot: brief(v.boot), session: brief(v.session) }), 'badge', dataBadge(v))
  failLists = false
  const again = JSON.parse(capture.viewJson(iso))
  console.log('2. same state, failure gone: still the fallback?', Boolean(again.boot.unlisted))
  await capture.snapshot()
  const later = JSON.parse(capture.viewJson(iso))
  console.log('2. after another Snapshot now: full answer?', !later.boot.unlisted, 'session', realStringify(brief(later.session)))
}
{
  const { capture, now } = await make()
  await now()
  failAll = true
  builds = 0
  let first = null
  try { capture.viewJson(iso) } catch (err) { first = err.message }
  try { capture.viewJson(iso) } catch { /* cached */ }
  console.log(`3. both fail: '${first}', builds tried ${builds} (then cached)`)
  failAll = false
  await capture.snapshot()
  const v = JSON.parse(capture.viewJson(iso))
  console.log('3. after a later state: built?', !v.boot.unlisted, 'badge', dataBadge(v))
}
{
  // no destructive change at all: the base and PR both unchanged
  let phase = 'seed'
  const capture = createDataCapture({ rules, inspector: { open: () => ({ snapshot: () => ({ collections: { users: users(20) } }) }) } })
  for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
  await capture.ready({ signal })
  await capture.snapshot()
  failLists = true
  const v = JSON.parse(capture.viewJson(iso))
  failLists = false
  console.log('4. fallback with nothing destructive:', realStringify({ boot: brief(v.boot), session: brief(v.session) }), 'badge', dataBadge(v))
}
{
  const { capture, now } = await make({ padding: 1000 })
  // the session drops the padding (s1 shape): now() returns users(5) only
  await now()
  failLists = true
  const v = JSON.parse(capture.viewJson(iso))
  failLists = false
  console.log('5. fallback at the s1 shape: session flags', v.session.flags.length, 'first 4', realStringify(v.session.flags.slice(0, 4).map(f => `${f.collection}:${f.kind}`)), 'flagsCount', realStringify(v.session.flagsCount))
}
JSON.stringify = realStringify
