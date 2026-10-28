// Round-6 shapes at 7193877 / 4a284f9 / 4ed6449 (head), neutral field 'note'.
// Prints, per head, CLEAR (any secret part shows) or masked, and head's output.
import * as R4 from '../old79/data-diff.mjs'
import * as R5 from '../old4a/data-diff.mjs'
import * as H from '../head/data-diff.mjs'
const libs = [['7193877', R4], ['4a284f9', R5], ['4ed6449', H]]
const S = 'Zq9SeCr3tVal'
const cases = {
  // DSN password with ':' (README lists it as a miss at head)
  'dsn pw with a colon in the middle': [`root:pa:${S}@tcp(127.0.0.1:3306)/app`, [S, 'pa:']],
  'dsn pw with a colon after the secret': [`root:${S}:x9@tcp(db:3306)/app`, [S]],
  'dsn pw ending in a colon': [`root:${S}:@tcp(db)/app`, [S]],
  'dsn unix, colon in pw': [`app:${S}:k@unix(/tmp/mysql.sock)/db`, [S]],
  'dsn in a log line': [`connecting with root:${S}:x@tcp(10.0.0.5:3306)/orders?parseTime=true`, [S]],
  'dsn pw with a slash (not listed)': [`root:${S}/x@tcp(db)/app`, [S]],
  'dsn pw "/" then @/ ': [`root:p@/${S}@tcp(db)/app`, [S]],
  // attributes
  'attr: < in another attribute': [`<add key="DbPassword" note="a<b" value="${S}" />`, [S]],
  'attr: < in the value': [`<input type="password" value="a<${S}">`, [S]],
  'attr: > in the value (listed)': [`<input type="password" value="a>${S}">`, [S]],
  'attr: dq value with an apostrophe': [`<add key="DbPassword" value="it's${S}" />`, [S]],
  'attr: unquoted name, quoted value': [`<add key=DbPassword value="${S}"/>`, [S]],
  'attr: value before a spaced =': [`<add key="DbPassword" value = '${S}' />`, [S]],
  'attr: data-value only': [`<x name="password" data-value="${S}">`, [S]],
  // escapes before word-only names
  '\\r before pw': [`a=1\\rpw=${S}`, [S]],
  '\\f before pw': [`a=1\\fpw=${S}`, [S]],
  '\\u000a before pw': [`a=1\\u000apw=${S}`, [S]],
  '%0D%0A before pw': [`a%3D1%0D%0Apw%3D${S}`, [S]],
  '&#10; before pw': [`a=1&#10;pw=${S}`, [S]],
  '+ before pin': [`q=1+pin=${S}`, [S]],
  'double-encoded %2526pin%253D': [`next=%2526pin%253D${S}`, [S]],
  // tags
  'tag at end of text, no >': [`log <password`, []],
  'tag: name over 128': [`<${'a'.repeat(129)}password>${S}</x>`, [S]],
  'tag: two namespaces': [`<a:b:password>${S}</a:b:password>`, [S]],
  // pairs
  'pair: name not a string but key is': [[{ name: 7, key: 'password', value: S }], [S]],
  'pair: {Name, value} mixed 7 keys (listed bounded)': [[{ Name: 'password', value: S, a: 1, b: 2, c: 3, d: 4, e: 5 }], [S]],
  'pair: option_name (listed)': [[{ option_name: 'smtp_pass', option_value: S }], [S]],
}
const rowCases = {
  'row: settings key/value': [{ id: 1, key: 'smtp_password', value: S }, [S]],
  'row: settings Name/Value': [{ id: 1, Name: 'db-password', Value: S, a: 1, b: 2, c: 3, d: 4, e: 5 }, [S]],
  'row: settings k/v 7 keys': [{ id: 1, k: 'password', v: S, a: 1, b: 2, c: 3, d: 4 }, [S]],
  'row: settings k/v 6 keys': [{ id: 1, k: 'password', v: S, a: 1, b: 2, c: 3 }, [S]],
  'row: option_name (listed)': [{ option_id: 1, option_name: 'mailserver_pass', option_value: S }, [S]],
  'row: setting_key/setting_value': [{ id: 1, setting_key: 'smtp_password', setting_value: S }, [S]],
  'row: field/val': [{ id: 1, field: 'api_token', val: S }, [S]],
  'row: key + value JSON': [{ id: 1, key: 'oauth_client', value: { client_secret: 'x', note: S } }, [S]],
  'row: key, value null (cleared shows)': [{ id: 1, key: 'smtp_password', value: null }, []],
}
const mk = lib => {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: Buffer.alloc(32, 7), rules })
  return c => lib.sanitizeSnapshot({ collections: c }, { masker, rules })
}
const snaps = libs.map(([n, lib]) => [n, mk(lib)])
console.log(`${''.padEnd(48)} ${libs.map(([n]) => n.padEnd(8)).join(' ')} head output`)
for (const [label, [v, secrets]] of Object.entries(cases)) {
  const outs = snaps.map(([, snap]) => JSON.stringify(snap({ t: { key: ['id'], rows: [{ id: 1, note: v }] } }).collections.t.rows[0].note))
  console.log(`${label.padEnd(48)} ${outs.map(s => (secrets.some(x => s.includes(x)) ? 'CLEAR' : 'masked').padEnd(8)).join(' ')} ${outs[2].slice(0, 120)}`)
}
for (const [label, [r, secrets]] of Object.entries(rowCases)) {
  const outs = snaps.map(([, snap]) => JSON.stringify(snap({ t: { key: ['id'], rows: [r] } }).collections.t.rows[0]))
  console.log(`${label.padEnd(48)} ${outs.map(s => (secrets.some(x => s.includes(x)) ? 'CLEAR' : 'masked').padEnd(8)).join(' ')} ${outs[2].slice(0, 120)}`)
}
