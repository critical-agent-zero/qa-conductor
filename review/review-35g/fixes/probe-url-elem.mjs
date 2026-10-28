// The URL rule still runs before the element rule. Its password class
// [^\s/] crosses '>' and quotes, so a URL with a port (or user:pw) in a later
// attribute of a secret element, followed by minified markup holding an
// '@' before any whitespace or '/', eats the element's '>' and the element
// rule never sees it. Same class as round 6's DSN high, via the URL rule.
import { M, mk } from './h.mjs'
const EF = mk(await import('./mut/order_element-first/lib/data-diff.mjs'))
const S = 'Zq9SeCr3tVal'
const heads = ['2ec0bba', '7193877', '4a284f9', '4ed6449', '4033285']
const cases = {
  probe_elem_35f: `<input type="password" value="${S}" data-u="https://a:b"><b>c@host</b>`,
  port_then_email: `<input type="password" name="pw" value="${S}" data-api="http://api:8080"><small>help@corp.com</small>`,
  placeholder_port: `<input name="api_key" value="${S}" placeholder="https://host:443"><p>Contact:support@example.com</p>`,
  hidden_token_link: `<input type="hidden" name="csrf_token" value="${S}" data-href="https://example.com:8443"><span>admin@example.com</span>`,
  add_key_conn: `<add key="DbPassword" value="${S}" uri="redis://cache:6379"><x>ops@corp</x>`,
  // controls
  space_before_at: `<input type="password" value="${S}" data-api="http://api:8080"> help@corp.com`,
  slash_after_port: `<input type="password" value="${S}" data-api="http://api:8080/v1"><small>help@corp.com</small>`,
  no_at_after: `<input type="password" value="${S}" data-api="http://api:8080"><small>help</small>`,
}
for (const [label, v] of Object.entries(cases)) {
  const st = heads.map(h => [h, M[h].cell(v)])
  const ef = EF.cell(v)
  console.log(`${label.padEnd(20)} ${st.map(([h, o]) => `${h} ${o.includes(S) ? 'CLEAR' : 'ok'}`).join(' | ')} | elem-first ${ef.includes(S) ? 'CLEAR' : 'ok'}`)
  console.log(`   4033285 ${st[4][1].slice(0, 200)}`)
}
