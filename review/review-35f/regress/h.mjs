// Shared helpers: the four heads, and a cell/row sanitizer for each.
import * as V2ec from './v2ec0bba/data-diff.mjs'
import * as V719 from './v7193877/data-diff.mjs'
import * as V4a2 from './v4a284f9/data-diff.mjs'
import * as V4ed from './v4ed6449/data-diff.mjs'

export const LIBS = { '2ec0bba': V2ec, '7193877': V719, '4a284f9': V4a2, '4ed6449': V4ed }
export const KEY = Buffer.alloc(32, 7)

export function mk(lib) {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: KEY, rules })
  const snap = collections => lib.sanitizeSnapshot({ collections }, { masker, rules })
  return {
    lib,
    rules,
    snap,
    // one value in a neutral field
    cell: (v, field = 'note') => JSON.stringify(snap({ c: { key: ['id'], rows: [{ id: 1, [field]: v }] } }).collections.c.rows[0][field]),
    // a whole row
    row: (r, name = 'c', key = null) => JSON.stringify(snap({ [name]: { key, rows: [r] } }).collections[name]?.rows[0]),
  }
}
export const M = Object.fromEntries(Object.entries(LIBS).map(([k, lib]) => [k, mk(lib)]))
export const leaks = (s, secrets) => secrets.filter(x => s.includes(x))
