import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
let call = 0
const stores = {}
const c = createDataCapture({
  inspector: {
    open: ({ paneRef, db }) => {
      stores[paneRef.role] = db
      return { snapshot: () => { call++; if (paneRef.role === 'pr' && call > 2) throw new Error('t'); return { collections: structuredClone(stores[paneRef.role]) } } }
    },
  },
  rules: validateRules({}),
})
const s = new AbortController().signal
const db = () => ({ c: { key: ['id'], rows: [{ id: 1 }] } })
await c.seeded({ paneRef: { role: 'base' }, db: db(), databases: [], signal: s })
await c.seeded({ paneRef: { role: 'pr' }, db: db(), databases: [], signal: s })
await c.ready({ signal: s })
const v = c.view({})
console.log(JSON.stringify(v.errors), v.boot === null, call)
