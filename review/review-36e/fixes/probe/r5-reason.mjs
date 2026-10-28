// Round 5: the unreadable flag's reason, in the cases the nit named and
// their mirror. Each case scripts which pane's read fails at ready and at
// Snapshot now; prints the session span's flags and errors.
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const users = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
async function scenario(label, fails) {
  // fails: { ready: Set(panes), now: Set(panes), now2?: Set(panes) }
  let phase = 'seed'
  const capture = createDataCapture({
    rules,
    inspector: { open: ({ paneRef }) => ({ snapshot: () => {
      if (fails[phase]?.has(paneRef.role)) throw new Error(`${paneRef.role} ${phase} failed`)
      return { collections: { users: users(phase === 'seed' ? 20 : 10) } }
    } }) },
  })
  const signal = new AbortController().signal
  for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
  phase = 'ready'
  await capture.ready({ signal })
  phase = 'now'
  await capture.snapshot()
  const v = capture.view({})
  const s = v.session
  console.log(`${label}: session flags ${JSON.stringify(s?.flags.map(f => `${f.kind}:${f.reason ?? ''}`))}; base diff ${s?.base ? 'yes' : 'null'}, pr diff ${s?.pr ? 'yes' : 'null'}; errors.session ${JSON.stringify(v.errors.session)}; baselines ${JSON.stringify(v.baselines)}`)
}
const S = (...p) => new Set(p)
await scenario('A both ready fail, both now work (nit case A)', { ready: S('base', 'pr'), now: S() })
await scenario('B PR ready fails; now: PR works, base fails (nit case B)', { ready: S('pr'), now: S('base') })
await scenario('C base ready fails; now: base works (its late baseline), PR fails (mirror)', { ready: S('base'), now: S('pr') })
await scenario('D both ready fail; now: base works, PR fails', { ready: S('base', 'pr'), now: S('pr') })
await scenario('E both ready work; now: both fail', { ready: S(), now: S('base', 'pr') })
await scenario('F both ready work; now: PR fails', { ready: S(), now: S('pr') })
