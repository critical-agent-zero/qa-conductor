// The tag pattern's attribute run can read past the next '<'; bounding it
// to [^<>] keeps each '<' to its own tag. Time both, check both mask.
import { TAG_IN_TEXT } from './exp/data-diff.mjs'
const FIXED = /<(?:[\w.-]{1,64}:)?([\w.-]{1,128})(?:\s[^<>]{0,256})?>/g
const K = 256 * 1024
const fill = unit => unit.repeat(Math.ceil(K / unit.length)).slice(0, K)
const scan = (re, s) => { let n = 0; for (const m of s.matchAll(re)) n++; return n }
const best = (re, s) => { let b = Infinity; for (let i = 0; i < 5; i++) { const t = performance.now(); scan(re, s); b = Math.min(b, performance.now() - t) } return b }
for (const [name, s] of [['<a  x 87K', fill('<a ')], ['<a:a  x 52K', fill('<a:a ')], ['<a + 255 spaces', fill('<a' + ' '.repeat(255))], ['<a x="1"> real tags', fill('<a x="1">')]]) {
  console.log(`${name.padEnd(22)} head ${best(TAG_IN_TEXT, s).toFixed(1)} ms   [^<>] ${best(FIXED, s).toFixed(1)} ms`)
}
for (const t of ['<wsse:Password Type="PasswordText">x</wsse:Password>', '<password type="text">x</password>', '<Password>x</Password>', '<ns:api_key a="1" b=\'2\'>x']) {
  const a = [...t.matchAll(TAG_IN_TEXT)].map(m => m[1]); const b = [...t.matchAll(FIXED)].map(m => m[1])
  console.log(`${t.slice(0, 40).padEnd(40)} head ${JSON.stringify(a)}  fixed ${JSON.stringify(b)}`)
}
