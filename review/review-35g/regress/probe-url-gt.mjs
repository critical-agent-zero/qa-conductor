// The URL rule runs past a '>' too: a later attribute's URL with a port,
// then an address in the next element, swallows the secret element's '>'.
import { maskValues, HEAD_NAMES, NEW } from './h.mjs'
const S = 'Zq9SeCr3tVal'
const cases = {
  url_port_then_mailto: `<input type="password" value="${S}" data-src="https://x.com:443"><b>me@x.com</b>`,
  url_port_then_at_space: `<input type="password" value="${S}" data-src="https://x.com:443"> me@x.com`,
  round6_variant: `<input type="password" value="${S}" data-u="https://a:b"><b>c@host`,
  ini_pct_space: 'password%20%3D%20' + S,
  oracle_ez: `scott/${S}@//db.example.com:1521/ORCL`,
  meta_csrf: `<meta name="csrf-token" content="${S}">`,
  url_pct_whole: `next=postgres%3A%2F%2Fapp%3A${S}%40db%2Fapp`,
}
const out = maskValues(Object.values(cases))
Object.keys(cases).forEach((n, i) => console.log(n.padEnd(24), HEAD_NAMES.map(h => `${h}:${out[h][i].includes(S) ? 'CLEAR ' : 'masked'}`).join(' '), '| head:', out[NEW][i].slice(0, 110)))
