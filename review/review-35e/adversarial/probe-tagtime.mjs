// CPU time of the tag scan's worst shapes: the head's pattern against the
// proposed lookahead form, regex alone and through sanitizeSnapshot.
import * as NEW from './new/data-diff.mjs'
import * as FIX from './fix/data-diff.mjs'
const cpu = f => { const a = process.cpuUsage(); f(); const b = process.cpuUsage(a); return ((b.user + b.system) / 1000).toFixed(0) }
const heads = {
  new: /<(?:[\w.-]{1,64}:)?([\w.-]{1,128})(?:\s[^<>]{0,256})?>/g,
  fix: /<(?:[\w.-]{1,64}:)?([\w.-]{1,128})(?=[\s/>])/g,
  old7193877: /<(?:[\w.-]{1,64}:)?([\w.-]{1,128})(?:\s[^>]{0,256})?>/g,
}
const cells = {
  '<a ': '<a '.repeat(87_000),
  '<a:a ': '<a:a '.repeat(52_000),
  '<a b="1" ': '<a b="1" '.repeat(29_000),
  ['<' + 'a'.repeat(128) + ' ']: ('<' + 'a'.repeat(128) + ' ').repeat(2000),
  ['<a:' + 'b'.repeat(127)]: ('<a:' + 'b'.repeat(127)).repeat(2000),
}
for (const [label, s] of Object.entries(cells)) {
  const row = Object.entries(heads).map(([k, re]) => `${k} ${cpu(() => { for (let i = 0; i < 3; i++) [...s.matchAll(re)] })} ms`).join(', ')
  console.log(`regex x3 on ${JSON.stringify(label).slice(0, 24).padEnd(24)} (${s.length} chars): ${row}`)
}
for (const [name, lib] of [['new', NEW], ['fix', FIX]]) {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: Buffer.alloc(32, 7), rules })
  const rows = Array.from({ length: 20 }, (_, id) => ({ id, v: cells['<a '] })).concat(Array.from({ length: 4 }, (_, id) => ({ id: 20 + id, v: cells['<a:a '] })))
  let kept
  const ms = cpu(() => { kept = lib.sanitizeSnapshot({ collections: { c: { key: ['id'], rows } } }, { masker, rules }).collections.c.rows })
  console.log(`sanitizeSnapshot, the test's 24 cells, ${name}: ${ms} ms CPU; kinds ${kept[0].v.t}/${kept[23].v.t}`)
}
