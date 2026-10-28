// Make tagfix/data-diff.mjs: 7193877's engine with TAG_IN_TEXT's attributes
// kept from crossing another '<'.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const here = new URL('.', import.meta.url).pathname
const src = readFileSync(`${here}repo/lib/data-diff.mjs`, 'utf8')
const from = 'const TAG_IN_TEXT = /<(?:[\\w.-]{1,64}:)?([\\w.-]{1,128})(?:\\s[^>]{0,256})?>/g'
const to = 'const TAG_IN_TEXT = /<(?:[\\w.-]{1,64}:)?([\\w.-]{1,128})(?:\\s[^<>]{0,256})?>/g'
if (!src.includes(from)) throw new Error('TAG_IN_TEXT not found')
mkdirSync(`${here}tagfix`, { recursive: true })
writeFileSync(`${here}tagfix/data-diff.mjs`, src.replace(from, to))
console.log('written', `${here}tagfix/data-diff.mjs`)
