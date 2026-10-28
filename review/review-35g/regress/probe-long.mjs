// A secret element whose other attributes run past 1,024 characters, value first.
import { maskValues, HEAD_NAMES, NEW } from './h.mjs'
const S = 'Zq9SeCr3tVal'
const cases = {
  value_first_long_attr: `<add key="DbPassword" value="${S}" description="${'d'.repeat(1100)}"/>`,
  corpus_np_add_long_attr: `<add key="DbPassword" description="${'d'.repeat(1100)}" value="${S}"/>`,
  input_long_class: `<input type="password" value="${S}" class="${'btn '.repeat(260)}">`,
}
const out = maskValues(Object.values(cases))
Object.keys(cases).forEach((n, i) => console.log(n.padEnd(26), HEAD_NAMES.map(h => `${h}:${out[h][i].includes(S) ? 'CLEAR ' : 'masked'}`).join(' '), '| head:', out[NEW][i].slice(0, 90)))
