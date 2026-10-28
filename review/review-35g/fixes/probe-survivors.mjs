// Do the mutants that survive both the corpus and data-diff.test.mjs show a
// secret the unmutated head hides, on realistic shapes?
import { mk, M } from './h.mjs'
const S = 'Zq9SeCr3tVal'
const load = async id => mk(await import(`./mut/${id}/lib/data-diff.mjs`))
const cases = {
  json_depth_1: [JSON.stringify({ a: JSON.stringify([{ name: 'password', value: S }]) }), S],
  json_depth_2: [JSON.stringify({ a: JSON.stringify({ b: JSON.stringify([{ name: 'password', value: S }]) }) }), S],
  json_depth_hdrs: [JSON.stringify({ a: JSON.stringify({ b: JSON.stringify(['Authorization', `Bearer ${S}`]) }) }), S],
  url_case: [`HTTPS://app:${S}@db.example.com/x`, S],
  url_case2: [`Postgres://app:${S}@db:5432/x`, S],
  url_scheme_plus: [`mongodb+srv://app:${S}@cluster0.example.net/db`, S],
  url_scheme_plus2: [`postgresql+psycopg2://app:${S}@db/x`, S],
  url_scheme_digit: [`s3://AKIA:${S}@bucket/x`, S],
  dsn_gt: [`root:pa>ss${S}@tcp(db:3306)/app`, S],
  dsn_lt: [`root:pa<${S}@tcp(db:3306)/app`, S],
  dsn_long: [`root:${'x'.repeat(60)}${S}@tcp(db)/app`, S],
  dsn_user_dash: [`app-user:${S}@tcp(db)/app`, S],
  dsn_user_dot: [`app.user:${S}@tcp(db)/app`, S],
  jwt_dash_sig: [`eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-${S}_x`, S],
  jwt_short_seg: [`eyJhbGci.eyJzdWIi.${S}`, S],
  flag_upper: [`pg_dump --PASSWORD ${S} --host db`, S],
  flag_upper2: [`run --DB-TOKEN=${S}`, S],
  pem_openssh: [`-----BEGIN OPENSSH PRIVATE KEY-----\nb3Bl${S}\n-----END OPENSSH PRIVATE KEY-----`, S],
  pem_ec: [`-----BEGIN EC PRIVATE KEY-----\nMHc${S}\n-----END EC PRIVATE KEY-----`, S],
  tag_long_attrs: [`<add key="DbPassword" description="${'d'.repeat(300)}" value="${S}"/>`, S],
}
const ids = ['order_jwt-before-dsn', 'url_case', 'url_scheme-letters', 'dsn_pw-no-gt', 'dsn_pw-64', 'dsn_user-word', 'dsn_no-lookbehind', 'jwt_8', 'jwt_no-dash', 'tag_256', 'value_bare-no-gt', 'flag_case', 'pem_no-openssh', 'json_depth-1', 'json_depth-2']
const muts = {}
for (const id of ids) { try { muts[id] = await load(id) } catch (e) { console.log('no', id, e.message) } }
for (const [label, [v, sec]] of Object.entries(cases)) {
  const head = M['4033285'].cell(v)
  const leakedBy = Object.entries(muts).filter(([, m]) => m.cell(v).includes(sec)).map(([id]) => id)
  console.log(`${label.padEnd(18)} head ${head.includes(sec) ? 'CLEAR' : 'ok   '} 4ed6449 ${M['4ed6449'].cell(v).includes(sec) ? 'CLEAR' : 'ok   '} mutants showing it: ${leakedBy.join(' ') || '-'}`)
}
