// Which key 4a284f9 reads in a percent-encoded line that later heads don't.
import { maskValues, HEAD_NAMES } from './h.mjs'
import { pctAll } from './gen.mjs'
const t = pctAll('spring.dat@mq.locaasource.pa)sswo\\"rd=+aXwW&3U NnkbHW$=BROKER=snowflake://ci-bot:EmqEV6gQ@dBR7wQ{mvx3LFLu.8mqfX(@mq.local/app"}{\\"password\\": \\"QGex5@o9ateVU@ouMtKdpe*\\"}')
console.log(t)
const QUOTE4a = String.raw`(?:\\*["'\x60]|&(?:quot|apos|#0{0,4}3[49]|#x0{0,4}2[27]);|%2[27])`
const K4a = new RegExp(String.raw`(?<![\w.-])(?<!\\(?=\\))${QUOTE4a}?([\w.-]{1,128})${QUOTE4a}?\]?\s{0,32}(?:[:=]|%3[ad])`, 'gi')
const K4e = new RegExp(String.raw`(?:(?<![\w.-])|(?<=%[0-9a-f]{2}))(?<!\\(?=\\))${QUOTE4a}?([\w.-]{1,128})${QUOTE4a}?\]?\s{0,32}(?:[:=]|%3[ad])`, 'gi')
console.log('4a284f9 keys:', [...t.matchAll(K4a)].map(m => m[1]).join(' | '))
console.log('4ed6449 keys:', [...t.matchAll(K4e)].map(m => m[1]).join(' | '))
// smaller shapes
const small = {
  pct_pw_after_pct_key: 'a%3D1%26pa%29sswo%3Dx%26%7B%5C%22password%5C%22%3A%20%5C%22Zq9SeCr3tVal',
  plain_pct_json_bs: '%7B%5C%22password%5C%22%3A%20%5C%22Zq9SeCr3tVal%5C%22%7D',
  plain_pct_json_bs_after_key: 'x%3Dy%7B%5C%22password%5C%22%3A%20%5C%22Zq9SeCr3tVal%5C%22%7D',
}
const out = maskValues(Object.values(small))
Object.keys(small).forEach((n, i) => console.log(n.padEnd(30), HEAD_NAMES.map(h => `${h}:${out[h][i].includes('Zq9SeCr3tVal') ? 'CLEAR ' : 'masked'}`).join(' ')))
