// Random secrets in real-world shapes, each with the fragments that must not
// show. A fragment is an alphanumeric run of the secret, at least 4 long,
// with an upper-case letter past its first character and a letter past f, so
// it never matches a digest or the template's words.
export function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const r = {
    f: next,
    int: n => Math.floor(next() * n),
    pick: list => list[Math.floor(next() * list.length)],
    chance: p => next() < p,
  }
  return r
}

const UP = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LO = 'abcdefghijkmnopqrstuvwxyz'
const DIG = '23456789'
const ALNUM = UP + LO + DIG
const NONHEX = 'GHJKLMNPQRSTUVWXYZ'

export function frag(r, { len, digits = true } = {}) {
  const n = len ?? 5 + r.int(4)
  const pool = digits ? ALNUM : UP + LO
  let s = ''
  for (let i = 0; i < n; i++) s += pool[r.int(pool.length)]
  // an upper-case non-hex letter past the first character
  const at = 1 + r.int(n - 1)
  s = s.slice(0, at) + NONHEX[r.int(NONHEX.length)] + s.slice(at + 1)
  if (digits && !/\d/.test(s) && r.chance(0.7)) {
    const k = r.int(n)
    s = s.slice(0, k) + DIG[r.int(DIG.length)] + s.slice(k + 1)
  }
  return s
}

// alnum runs of 4+ with an upper-case letter past the first
export function fragsOf(s) {
  return [...new Set((s.match(/[A-Za-z0-9]{4,}/g) ?? []).filter(x => /.[A-Z]/.test(x) && /[g-zG-Z]/.test(x)))]
}

export const SEPS = [':', '@', '/', '<', '>', '"', "'", '\\', '=', '&', '%', '#', '?', '!', '$', '*', '+', ',', ';', '(', ')', '[', ']', '{', '}', '|', '~', '^', '-', '_', '.', '`']
const SEPS_URLSAFE = ['-', '_', '.', '~', '!', '$', '*', '+', ',', ';', '=', ':', '@', '&']

export function secret(r, style = r.pick(['alnum', 'alnum', 'sep', 'sep', 'colon', 'at', 'angle', 'quote', 'bs', 'urlsafe', 'nodigit', 'long', 'space'])) {
  const parts = [frag(r, { digits: style !== 'nodigit' })]
  const n = style === 'alnum' || style === 'nodigit' ? 0 : style === 'long' ? 4 + r.int(4) : 1 + r.int(3)
  for (let i = 0; i < n; i++) {
    let sep
    switch (style) {
      case 'colon': sep = r.chance(0.7) ? ':' : r.pick(SEPS); break
      case 'at': sep = r.chance(0.7) ? '@' : r.pick(SEPS); break
      case 'angle': sep = r.pick(['<', '>', '<', '>', '"', "'"]); break
      case 'quote': sep = r.pick(['"', "'", '`', '\\"', "\\'"]); break
      case 'bs': sep = r.pick(['\\', '\\\\', '\\n', '\\"', '/']); break
      case 'urlsafe': sep = r.pick(SEPS_URLSAFE); break
      case 'space': sep = r.pick([' ', ' ', '\t']); break
      default: sep = r.pick(SEPS)
    }
    parts.push(sep, frag(r, { digits: style !== 'nodigit' }))
  }
  // sometimes a separator at either end
  if (style !== 'alnum' && style !== 'nodigit' && r.chance(0.2)) parts.unshift(r.pick(SEPS))
  if (style !== 'alnum' && style !== 'nodigit' && r.chance(0.2)) parts.push(r.pick(SEPS))
  return parts.join('')
}

const b64 = s => Buffer.from(s).toString('base64')
const b64url = s => Buffer.from(s).toString('base64url')
export const pct = s => encodeURIComponent(s)
export const pctAll = s => [...Buffer.from(s)].map(b => (/[A-Za-z0-9]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('')
export const htmlEsc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
export const jsonInner = s => JSON.stringify(s).slice(1, -1)

const USERS = ['root', 'app', 'admin', 'u', 'svc_api', 'deploy', 'postgres', 'default', 'bob.smith', 'ci-bot']
const HOSTS = ['db', '127.0.0.1', 'db.internal:5432', 'cache:6379', '10.0.0.5:3306', 'mq.local', 'cluster0.ab1cd.mongodb.net', '[::1]:3306', 'localhost']
const DRIVERS = ['postgres', 'postgresql', 'mysql', 'mongodb', 'mongodb+srv', 'redis', 'rediss', 'amqp', 'amqps', 'mssql', 'sqlserver', 'clickhouse', 'snowflake', 'ftp', 'sftp', 'https', 'http', 'smtp', 'ldap', 'nats', 'kafka', 'cockroachdb', 'mariadb', 'oracle', 'git+ssh', 'ssh', 'jdbc:postgresql', 'jdbc:mysql']
const NETS = ['tcp', 'tcp6', 'udp', 'unix', 'cloudsql', 'TCP', 'memsql']
const SCHEMES = ['Bearer', 'bearer', 'BEARER', 'Basic', 'basic', 'Token', 'token', 'BeArEr']
const LEVELS = ['INFO', 'WARN', 'ERROR', 'DEBUG', 'level=info', '[error]']

// A secret-bearing template: (r, s) -> text, where s is the raw secret.
// Each also says which fragments to check (default: the secret's).
export const TEMPLATES = {
  // URLs with userinfo
  url_pw: (r, s) => `${r.pick(DRIVERS)}://${r.pick(USERS)}:${r.pick([s, pct(s), s])}@${r.pick(HOSTS)}/${r.pick(['app', 'db?sslmode=require', '', '0', 'admin?authSource=admin'])}`,
  url_empty_user: (r, s) => `${r.pick(['redis', 'rediss', 'https'])}://:${r.pick([s, pct(s)])}@${r.pick(HOSTS)}/0`,
  url_token_user: (r, s) => `https://${s}${r.pick(['', ':x-oauth-basic', ':'])}@github.com/o/r.git`,
  url_in_log: (r, s) => `${r.pick(LEVELS)} ${r.pick(['connecting to', 'dial', 'retry', 'opened'])} ${r.pick(DRIVERS)}://${r.pick(USERS)}:${s}@${r.pick(HOSTS)}/app ${r.pick(['ok', 'failed: timeout', '(attempt 2)', ''])}`,
  url_in_quotes: (r, s) => `${r.pick(['"', "'", '`', '('])}${r.pick(DRIVERS)}://${r.pick(USERS)}:${s}@${r.pick(HOSTS)}${r.pick(['"', "'", '`', ')'])}`,
  // Go DSNs and other DSNs
  go_dsn: (r, s) => `${r.pick(USERS)}:${s}@${r.pick(NETS)}(${r.pick(HOSTS)})/${r.pick(['app', 'app?parseTime=true&loc=UTC', 'orders'])}`,
  go_dsn_slash: (r, s) => `${r.pick(USERS)}:${s}@/${r.pick(['app', 'db?charset=utf8mb4'])}`,
  go_dsn_paren: (r, s) => `${r.pick(USERS)}:${s}@(${r.pick(HOSTS)})/app`,
  go_dsn_log: (r, s) => `${r.pick(LEVELS)} ${r.pick(['dsn', 'opening', 'mysql:', 'conn='])} ${r.pick(USERS)}:${s}@${r.pick(NETS)}(${r.pick(HOSTS)})/app`,
  go_dsn_in_json_text: (r, s) => `{"driver":"mysql","conn":"${r.pick(USERS)}:${jsonInner(s)}@tcp(${r.pick(HOSTS)})/app"}`,
  env_dsn: (r, s) => `${r.pick(['MYSQL', 'DB', 'CONN', 'MAIN_DB'])}=${r.pick(USERS)}:${s}@tcp(${r.pick(HOSTS)})/app`,
  oracle_ez: (r, s) => `${r.pick(USERS)}/${s}@//${r.pick(HOSTS)}:1521/ORCL`,
  // Authorization schemes
  auth_header: (r, s) => `${r.pick(['Authorization', 'authorization', 'Proxy-Authorization'])}: ${r.pick(SCHEMES)} ${s}`,
  auth_free: (r, s) => `${r.pick(['sent', 'header', 'using', 'got', 'curl -H "X:'])} ${r.pick(SCHEMES)} ${s} ${r.pick(['ok', 'to api', '"', ''])}`,
  auth_basic_b64: (r, s) => `${r.pick(['auth', 'hdr', 'sent'])}=${r.pick(['Basic', 'basic', 'BASIC'])} ${b64(`${r.pick(USERS)}:${s}`)}`,
  auth_curl: (r, s) => `curl -H 'Authorization: ${r.pick(SCHEMES)} ${s}' https://api.example.com/v1`,
  // JWTs
  jwt: (r, s) => `${r.pick(['token is ', 'jwt ', 'id_token=', 'Cookie x=', ''])}eyJhbGciOiJIUzI1NiJ9.eyJ${b64url(`{"sub":"${s}"}`).slice(3)}.${b64url(s)}${r.pick(['', ' ok', ';'])}`,
  // HTTP headers
  hdr_api_key: (r, s) => `${r.pick(['X-Api-Key', 'x-api-key', 'Api-Key', 'X-Auth-Token', 'Private-Token'])}: ${s}`,
  hdr_cookie: (r, s) => `${r.pick(['Cookie', 'Set-Cookie'])}: ${r.pick(['session', 'sid', 'auth_token', '_csrf'])}=${s}; Path=/; HttpOnly`,
  hdr_block: (r, s) => `GET /v1 HTTP/1.1\r\nHost: api\r\n${r.pick(['Authorization: Bearer ', 'X-Api-Key: ', 'Cookie: session='])}${s}\r\nAccept: */*`,
  // config files
  ini: (r, s) => `[${r.pick(['database', 'smtp', 'client'])}]\nhost = db\n${r.pick(['password', 'pass', 'secret', 'api_key', 'token'])} = ${s}\nport = 5432`,
  yaml: (r, s) => `${r.pick(['db', 'spring.datasource', 'redis'])}:\n  user: app\n  ${r.pick(['password', 'secret', 'token', 'apiKey'])}: ${r.pick([s, `"${jsonInner(s)}"`, `'${s}'`])}\n`,
  dotenv: (r, s) => `${r.pick(['DB_PASSWORD', 'STRIPE_SECRET_KEY', 'GITHUB_TOKEN', 'API_KEY', 'SESSION_SECRET'])}=${r.pick([s, `"${s}"`, `'${s}'`])}`,
  dotenv_url: (r, s) => `${r.pick(['DATABASE_URL', 'REDIS_URL', 'MONGO_URI', 'BROKER'])}=${r.pick(DRIVERS)}://${r.pick(USERS)}:${s}@${r.pick(HOSTS)}/app`,
  props: (r, s) => `${r.pick(['spring.datasource.password', 'db.pass', 'mail.smtp.password'])}=${s}`,
  toml: (r, s) => `[server]\n${r.pick(['password', 'token', 'secret_key'])} = "${jsonInner(s)}"`,
  // XML / HTML
  xml_add: (r, s) => `<add ${r.pick(['key', 'name', 'KEY'])}="${r.pick(['DbPassword', 'ApiToken', 'ClientSecret'])}" ${r.pick(['value', 'VALUE'])}="${htmlEsc(s)}" />`,
  xml_add_unq: (r, s) => `<add key=${r.pick(['DbPassword', 'ApiToken'])} value=${s}>`,
  xml_tag: (r, s) => `<${r.pick(['password', 'wsse:Password', 'apiKey', 'secret', 'db-password', 'token'])}${r.pick(['', ' type="text"', ' Type="PasswordText"'])}>${htmlEsc(s)}</x>`,
  html_input: (r, s) => `<input type="${r.pick(['password', 'hidden'])}" name="${r.pick(['pw', 'api_token', 'secret', 'csrf'])}" value="${htmlEsc(s)}"${r.pick(['', ' style="width:100%"', ' class="sm:w-full"', ' autocomplete="off"'])}>`,
  html_input_unq: (r, s) => `<input type=password name=pw value=${s}>`,
  html_min: (r, s) => `<form action="/login"><input type="password" name="pw" value="${htmlEsc(s)}" style="color:red"><style>@media(max-width:600px){a{b:c}}</style></form>`,
  html_meta: (r, s) => `<meta name="${r.pick(['csrf-token', 'api-key'])}" content="${htmlEsc(s)}">`,
  spring_prop: (r, s) => `<property name="password" value="${htmlEsc(s)}"/>`,
  conn_str: (r, s) => `<add name="Main" connectionString="Server=db;Database=app;User Id=sa;Password=${htmlEsc(s)};" providerName="System.Data.SqlClient"/>`,
  // JSON in text
  json_text: (r, s) => `${r.pick(['payload ', 'body=', 'resp: ', ''])}{"user":"a","${r.pick(['password', 'token', 'secret', 'apiKey', 'client_secret'])}":"${jsonInner(s)}"}`,
  json_esc: (r, s) => `{\\"${r.pick(['password', 'token'])}\\": \\"${jsonInner(jsonInner(s))}\\"}`,
  html_ent_json: (r, s) => `data-config="{&quot;${r.pick(['password', 'token'])}&quot;:&quot;${htmlEsc(s)}&quot;}"`,
  // CLI
  cli_flag: (r, s) => `${r.pick(['pg_dump', 'run', 'tool', 'docker login'])} ${r.pick(['--password', '--token', '--db-token', '-password', '--api-key', '--secret'])}${r.pick([' ', '=', '\t'])}${s} ${r.pick(['--host db', '-v', ''])}`,
  cli_mysql_p: (r, s) => `${r.pick(['mysql', 'mysqldump', 'MYSQL', 'mariadb'])} -u root -p${s} app`,
  cli_env: (r, s) => `${r.pick(['PGPASSWORD', 'MYSQL_PWD', 'AWS_SECRET_ACCESS_KEY'])}=${s} psql -h db`,
  // SQL
  sql_update: (r, s) => `UPDATE users SET ${r.pick(['password', 'api_token', '`password`', '"secret"'])} = '${s.replace(/'/g, "''")}' WHERE id = 1`,
  sql_where: (r, s) => `SELECT * FROM t WHERE ${r.pick(['token', 'password_hash'])}='${s.replace(/'/g, "''")}'`,
  // percent-encoded
  form: (r, s) => `grant_type=password&username=a&${r.pick(['password', 'client_secret', 'pw', 'token'])}=${pct(s)}`,
  pct_json: (r, s) => `/cb?state=${pctAll(`{"${r.pick(['password', 'token', 'pw'])}":"${s}"}`)}`,
  pct_query: (r, s) => `redirect=${pctAll(`/login?user=bob&${r.pick(['password', 'token', 'pin'])}=${s}`)}`,
  // PEM / PGP
  pem: (r, s) => `-----BEGIN ${r.pick(['RSA ', 'EC ', 'OPENSSH ', 'ENCRYPTED ', ''])}PRIVATE KEY-----\nMIIE${b64(s)}\n-----END PRIVATE KEY-----`,
  pgp: (r, s) => `-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nlQ${b64(s)}\n-----END PGP PRIVATE KEY BLOCK-----`,
}

// Templates whose fragments are those of the base64 of their secret
export const B64_TEMPLATES = new Set(['auth_basic_b64', 'pem', 'pgp'])

// non-secret ids and keys, to watch for new over-masking
export const ID_TEMPLATES = {
  urn: r => `urn:${r.pick(['isbn', 'uuid', 'acct', 'org'])}:${r.int(1e6)}${r.pick(['', ':' + r.int(99)])}@${r.pick(['/org', 'tcp(x)', '(y)', 'example.com'])}`,
  email: r => `${r.pick(USERS)}@${r.pick(['example.com', 'corp.local'])}`,
  colon_id: r => `${r.pick(['acct', 'user', 'tenant', 'repo'])}:${r.int(1e5)}:${r.pick(['main', 'x', 'dev'])}@/${r.pick(['org', 'a/b'])}`,
  sha_ref: r => `${r.pick(['commit', 'ref', 'tag'])} ${[...Array(40)].map(() => '0123456789abcdef'[r.int(16)]).join('')}`,
  ts_kv: r => `ts=2026-10-22T10:${r.int(60)}:00Z host=${r.pick(HOSTS)} user=${r.pick(USERS)}`,
  path: r => `/${r.pick(['api', 'v1', 'users'])}/${r.int(1e4)}:${r.pick(['edit', 'view'])}@${r.pick(['/', '(x)'])}`,
  docker_ref: r => `${r.pick(['ghcr.io/o/app', 'repo/app'])}:${r.pick(['1.2.3', 'latest'])}@sha256:${[...Array(16)].map(() => '0123456789abcdef'[r.int(16)]).join('')}`,
  ipv6: r => `[${r.pick(['::1', 'fe80::1', '2001:db8::5'])}]:${r.int(65535)}`,
  css: r => `a:hover{color:red}@media(max-width:${r.int(900)}px){b{c:d}}`,
  scheme_word: r => `${r.pick(SCHEMES)} ${r.pick(['introduction', 'plan', 'expired again', 'auth flow'])}`,
}
