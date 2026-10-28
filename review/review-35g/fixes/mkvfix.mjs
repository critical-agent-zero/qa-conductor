// vfix2: 4033285 with the order scheme -> element -> URL -> DSN -> JWT (the
// URL rule moved after the element rule), to test whether the URL variant
// can be fixed without the element-first regression.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const D = new URL('./', import.meta.url).pathname
const src = readFileSync(`${D}v4033285/data-diff.mjs`, 'utf8')
const a = src.indexOf('    const withUrls = head.replace(URL_USERINFO,')
const b = src.indexOf("    const masked = authValues(withUrls, value => hidden('a', value))\n")
const urlBlock = src.slice(a, b) // const withUrls = head.replace(URL_USERINFO, ... })\n
const urlFn = urlBlock.slice(urlBlock.indexOf('(_, scheme, user, pw, token) =>'), urlBlock.lastIndexOf('})') + 1)
let out = src.slice(0, a) + "    const masked = authValues(head, value => hidden('a', value))\n" + src.slice(b + "    const masked = authValues(withUrls, value => hidden('a', value))\n".length)
out = out.replace(`        : tag))\n      .replace(DSN_USERINFO,`, `        : tag))\n      .replace(URL_USERINFO, ${urlFn.replace(/\n/g, '\n  ')})\n      .replace(DSN_USERINFO,`)
mkdirSync(`${D}vfix2`, { recursive: true })
writeFileSync(`${D}vfix2/data-diff.mjs`, out)
