// C2: masking at 2ec0bba. Round-2 items re-checked, then new ways around.
import { createMasker, sanitizeSnapshot, validateRules, SECRET_NAME, diffSnapshots, flagChanges, divergence } from './repo/lib/data-diff.mjs'

const KEY = Buffer.alloc(32, 7)
const snap = (collections, rulesIn = {}, limits) => {
  const rules = validateRules(rulesIn)
  return sanitizeSnapshot({ collections }, { masker: createMasker({ key: KEY, rules }), rules, limits })
}
const show = (label, v, secret) => {
  const s = JSON.stringify(v)
  const leak = secret ? (Array.isArray(secret) ? secret : [secret]).filter(x => s.includes(x)) : []
  console.log(`${leak.length ? 'LEAK ' : 'ok   '}${label}: ${s.slice(0, 220)}`)
}

console.log('--- round-2 item 2: Set/Map in secret, classify-secret, pii fields')
{
  const rules = { classify: [{ collection: 'c', fields: ['vault'], as: 'secret' }, { collection: 'c', fields: ['emails'], as: 'pii' }] }
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, recovery_codes: new Set(['RC-1111', 'RC-2222']), vault: new Map([['k', 'vault-secret']]), emails: new Set(['jane@example.org']) }] } }, rules).collections.c.rows
  show('recovery_codes Set', row.recovery_codes, 'RC-1111')
  show('classify-secret Map', row.vault, 'vault-secret')
  show('pii Set', row.emails, 'jane@example.org')
}

console.log('--- round-2 item 4: escaped / double-encoded / bracketed')
{
  const dbl = JSON.stringify(JSON.stringify({ password: 'dbl-secret', user: 'a' }))
  const triple = JSON.stringify(dbl)
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, dbl, triple, log: 'level=info msg="login" body="{\\"password\\":\\"log-secret\\"}"', form: 'user[name]=a&user[password]=form-secret', nested: { inner: dbl } }] } }).collections.c.rows
  show('dbl', row.dbl, 'dbl-secret')
  show('triple-encoded', row.triple, 'dbl-secret')
  show('log line JSON', row.log, 'log-secret')
  show('user[password]=', row.form, 'form-secret')
  show('dbl inside JSON', row.nested, 'dbl-secret')
}

console.log('--- round-2 lows: names, URL userinfo, Bearer, pairs, rawHeaders, <password>')
{
  for (const n of ['ssh_key', 'redis_url', 'backup_codes']) console.log(`  SECRET_NAME ${n}: ${SECRET_NAME.test(n)}`)
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1,
    har: [{ name: 'Authorization', value: 'Bearer har-secret-1234' }, { name: 'Cookie', value: 'sid=har-cookie' }],
    rawHeaders: ['Authorization', 'Bearer raw-secret-1234'],
    raw2: { h: ['Authorization', 'Bearer raw-secret-1234'] },
    callback: 'postgres://app:pg-pw@db:5432/app',
    xml: '<password>xml-secret</password>',
  }] } }).collections.c.rows
  show('HAR pairs', row.har, ['har-secret', 'har-cookie'])
  show('rawHeaders (field name is secret-looking? no)', row.rawHeaders, 'raw-secret')
  show('rawHeaders nested', row.raw2, 'raw-secret')
  show('DSN in callback', row.callback, 'pg-pw')
  show('<password>', row.xml, 'xml-secret')
}

console.log('--- NEW: forms the fix misses')
{
  const cases = {
    redis_empty_user: ['cache at redis://:redis-pw-9@cache:6379/0', 'redis-pw-9'],
    pw_with_at: ['postgres://app:p@ss-word-9@db:5432/app', 'ss-word-9'],
    token_as_user: ['git remote https://ghp_AAAABBBBCCCCDDDDEEEE@github.com/o/r.git', 'ghp_AAAABBBBCCCCDDDDEEEE'],
    lowercase_bearer: ['sent authorization header bearer abcdefghij123456 ok', 'abcdefghij123456'],
    upper_bearer: ['BEARER abcdefghij123456', 'abcdefghij123456'],
    soap: ['<soap:Header><wsse:UsernameToken><wsse:Username>a</wsse:Username><wsse:Password Type="PasswordText">soap-secret-9</wsse:Password></wsse:UsernameToken></soap:Header>', 'soap-secret-9'],
    xml_attr: ['<password type="text">attr-secret-9</password>', 'attr-secret-9'],
    html_escaped_json: ['data-config="{&quot;password&quot;:&quot;html-secret-9&quot;}"', 'html-secret-9'],
    url_encoded: ['GET /cb?next=%2Fhome%3Faccess_token%3Durlenc-secret-9 200', 'urlenc-secret-9'],
    yaml_list: ['- name: DB_PASSWORD\n  value: yaml-secret-9', 'yaml-secret-9'],
    env_export: ['export PGPASSWORD hunter-env-9', 'hunter-env-9'],
    space_before_colon: ['password          : spaced-secret-9', 'spaced-secret-9'],
    ruby_hash: ['{:password=>"ruby-secret-9"}', 'ruby-secret-9'],
  }
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...Object.fromEntries(Object.entries(cases).map(([k, [v]]) => [k, v])) }] } }).collections.c.rows
  for (const [k, [, secret]] of Object.entries(cases)) show(k, row[k], secret)
  const json = {
    aws_pairs: [[{ Name: 'db-password', Value: 'aws-secret-9' }], 'aws-secret-9'],
    aws_tags: [[{ Key: 'api_token', Value: 'tag-secret-9' }], 'tag-secret-9'],
    header_field: [[{ header: 'Authorization', value: 'Bearer hdr-secret-9xx' }], 'hdr-secret-9xx'],
    field_val: [[{ field: 'password', val: 'fv-secret-9' }], 'fv-secret-9'],
    k_v: [[{ k: 'password', v: 'kv-secret-9' }], 'kv-secret-9'],
    set_of_objects: [new Set([{ password: 'set-obj-secret-9' }]), 'set-obj-secret-9'],
    map_secret_key: [new Map([['password', 'map-secret-9']]), 'map-secret-9'],
    map_nested: [{ m: new Map([['api_key', { v: 'map-nested-9' }]]) }, 'map-nested-9'],
    headers_obj_lower: [{ headers: { authorization: 'Bearer obj-secret-9xx' } }, 'obj-secret-9xx'],
    set_cookie_list: [['set-cookie', 'sid=cookie-list-9'], 'cookie-list-9'],
  }
  const [jrow] = snap({ c: { key: ['id'], rows: [{ id: 1, ...Object.fromEntries(Object.entries(json).map(([k, [v]]) => [k, v])) }] } }).collections.c.rows
  for (const [k, [, secret]] of Object.entries(json)) show(k, jrow[k], secret)
}

console.log('--- NEW: over-masking (plain data turned into digests)')
{
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1,
    roles: ['viewer', 'session_manager', 'admin'],
    columns: ['id', 'password_hash', 'email'],
    mapping: [{ name: 'token_count', value: 42 }],
    doc: 'Basic introduction to the topic of this article',
    note: 'Token holders of record were notified',
  }] } }).collections.c.rows
  show('roles list (admin after session_manager)', row.roles)
  show('columns list (email after password_hash)', row.columns)
  show('pair named token_count', row.mapping)
  show('prose "Basic introduction…"', row.doc)
  show('prose "Token holders…"', row.note)
}

console.log('--- NEW: double-encoded and plain JSON text now look the same, so a migration that double-encodes every cell shows no change')
{
  const one = '{"theme":"dark","n":1}'
  const s0 = snap({ prefs: { key: ['id'], rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, data: one })) } })
  const s1 = snap({ prefs: { key: ['id'], rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, data: JSON.stringify(one) })) } })
  const pr = diffSnapshots(s0, s1)
  console.log('  cells', JSON.stringify(s0.collections.prefs.rows[0].data), JSON.stringify(s1.collections.prefs.rows[0].data))
  console.log('  PR diff updated', pr.collections.prefs.updated.length, 'flags', JSON.stringify(flagChanges(diffSnapshots(s0, s0), pr, validateRules({}), { trusted: true })))
  // same at 79e3efc?
  const OLD = await import('./old79/data-diff.mjs')
  const r = OLD.validateRules({})
  const o0 = OLD.sanitizeSnapshot({ collections: { prefs: { key: ['id'], rows: [{ id: 1, data: one }] } } }, { masker: OLD.createMasker({ key: KEY, rules: r }), rules: r })
  const o1 = OLD.sanitizeSnapshot({ collections: { prefs: { key: ['id'], rows: [{ id: 1, data: JSON.stringify(one) }] } } }, { masker: OLD.createMasker({ key: KEY, rules: r }), rules: r })
  console.log('  at 79e3efc cells', JSON.stringify(o0.collections.prefs.rows[0].data), JSON.stringify(o1.collections.prefs.rows[0].data))
}
