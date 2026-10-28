// New code paths at 4a284f9: the pair rule at row level vs inside JSON, the
// element-value rule's edges, flags with a tab, PGP keys, and the pair
// rule's first-name pick.
import * as NEW from './new/data-diff.mjs'
const S = 'Zq9SeCr3tVal'
const rules = NEW.validateRules({})
const masker = NEW.createMasker({ key: Buffer.alloc(32, 7), rules })
const snap = (name, rows) => NEW.sanitizeSnapshot({ collections: { [name]: { key: ['id'], rows, count: rows.length } } }, { masker, rules }).collections[name].rows
const report = (label, out) => console.log(`${JSON.stringify(out).includes(S) ? 'CLEAR ' : 'masked'} ${label.padEnd(58)} ${JSON.stringify(out).slice(0, 150)}`)

console.log('--- the same name/value pair, as a row and inside JSON')
report('settings row {key, value}', snap('settings', [{ id: 1, key: 'smtp_password', value: S }]))
report('settings row {name, value}', snap('settings', [{ id: 1, name: 'STRIPE_SECRET_KEY', value: S }]))
report('wp_options row {option_name, option_value}', snap('wp_options', [{ id: 1, option_name: 'mailserver_pass', option_value: S }]))
report('the same {key, value} inside a JSON column', snap('t', [{ id: 1, doc: { key: 'smtp_password', value: S } }]))
report('a HAR cookie inside JSON (8 keys)', snap('t', [{ id: 1, doc: { name: 'session', value: S, path: '/', domain: 'x', expires: null, httpOnly: true, secure: true, sameSite: 'Lax' } }]))

console.log('--- the pair rule picks the first name-like key')
report('{key: id, name: secret label, value} in JSON', snap('t', [{ id: 1, doc: { key: 'setting_42', name: 'SMTP password', value: S, updated: 1 } }]))
report('{name: secret label, key: id, value} in JSON', snap('t', [{ id: 1, doc: { name: 'SMTP password', key: 'setting_42', value: S, updated: 1 } }]))

console.log('--- element values')
report("<add key='DbPassword' value='a\"b...'/> (single-quoted, a double quote in it)", snap('t', [{ id: 1, note: `<add key='DbPassword' value='a"${S}'/>` }]))
report('<input type="password" value="a>b..."> (a > in the value)', snap('t', [{ id: 1, note: `<input type="password" value="a>${S}">` }]))
report('<add key="DbPassword" value=unquoted />', snap('t', [{ id: 1, note: `<add key="DbPassword" value=${S} />` }]))
report('<add key="DbPassword" description="1,100 chars" value="..."/>', snap('t', [{ id: 1, note: `<add key="DbPassword" description="${'d'.repeat(1100)}" value="${S}"/>` }]))
report('<add key="DbPassword" value="..."/> (control)', snap('t', [{ id: 1, note: `<add key="DbPassword" value="${S}"/>` }]))

console.log('--- flags and keys')
report('--password<TAB>secret', snap('t', [{ id: 1, note: `pg_dump --password\t${S} --host db` }]))
report('-----BEGIN PGP PRIVATE KEY BLOCK-----', snap('t', [{ id: 1, note: `-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n${S}\n-----END PGP PRIVATE KEY BLOCK-----` }]))
report('PuTTY-User-Key-File-2 Private-Lines', snap('t', [{ id: 1, note: `PuTTY-User-Key-File-2: ssh-rsa\nEncryption: none\nPrivate-Lines: 14\n${S}` }]))
