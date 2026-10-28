// Round 4, lens 4: the unreadable flag's reason when the PR's snapshot just
// became its baseline and the base pane has no session diff either.
// Case A: both ready reads fail; the first Snapshot now works in both panes.
// Case B: the PR's ready read fails; at the first Snapshot now the PR's read
// works (its late baseline) and the base's fails.
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const signal = new AbortController().signal
for (const [label, readyFails, nowFails] of [['A', ['base', 'pr'], []], ['B', ['pr'], ['base']]]) {
  let failing = []
  const capture = createDataCapture({
    rules,
    now: (() => { let t = 0; return () => (t += 1000) })(),
    inspector: { open: ({ paneRef }) => ({ snapshot: () => {
      if (failing.includes(paneRef.role)) throw new Error('lock timeout')
      return { collections: { users: { key: ['id'], rows: [{ id: 1 }] } } }
    } }) },
  })
  for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
  failing = readyFails
  await capture.ready({ signal })
  failing = nowFails
  await capture.snapshot()
  const v = capture.view({ isolation: { verdict: 'isolated' } })
  console.log(`${label}: session.flags ${JSON.stringify(v.session.flags)}; errors.session ${JSON.stringify(v.errors.session)}; baselines ${JSON.stringify(v.baselines)}`)
}
