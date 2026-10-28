// The element rule after the DSN and URL rules: when an earlier rule's
// match runs past the element's '>', the element rule no longer sees it.
import { M } from './h.mjs'

const S = 'Zq9SeCr3tVal'
const cases = {
  'style ":" then @media( (minified CSS)': `<input type="password" name="pw" value="${S}" style="width:100%"><style>@media(max-width:600px){input{width:50%}}</style>`,
  'style ":" then @supports(': `<input type="hidden" name="api_token" value="${S}" style="display:none"><style>@supports(display:grid){a{b:c}}</style>`,
  'class ":" then @/ (webpack alias)': `<input type="password" value="${S}" class="sm:w-full"><b>@/components</b>`,
  'mailto then @x(': `<x id="secret" value="${S}" href="mailto:a@b.c"><i>x@y(z)</i>`,
  'same, @tcp( (4a284f9 had it)': `<input type="password" value="${S}" style="color:red"><b>a@tcp(h)</b>`,
  'URL rule eats it (pre-existing)': `<input type="password" value="${S}" data-u="https://a:b"><b>c@host</b>`,
  'self-closing (control)': `<add key="DbPassword" value="${S}" x="a:b"/>@/`,
  'space before @ (control)': `<input type="password" value="${S}" style="color:red"> @media(x)`,
}
const heads = ['7193877', '4a284f9', '4ed6449']
for (const [label, v] of Object.entries(cases)) {
  const st = heads.map(h => { const o = M[h].cell(v); return [h, o.includes(S) ? 'CLEAR' : 'masked', o] })
  console.log(`${label}\n  ${st.map(([h, s]) => `${h} ${s}`).join(' | ')}\n  4ed6449 ${st[2][2].slice(0, 180)}`)
}
