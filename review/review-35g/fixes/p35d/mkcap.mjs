// pr36old/: #36's capture with 2ec0bba's engine; pr36fix/: with tagfix's.
import { copyFileSync, mkdirSync } from 'node:fs'
const here = new URL('.', import.meta.url).pathname
for (const [dir, engine] of [['pr36old', 'old2ec/data-diff.mjs'], ['pr36fix', 'tagfix/data-diff.mjs']]) {
  mkdirSync(`${here}${dir}`, { recursive: true })
  copyFileSync(`${here}pr36lib/data-capture.mjs`, `${here}${dir}/data-capture.mjs`)
  copyFileSync(`${here}${engine}`, `${here}${dir}/data-diff.mjs`)
}
console.log('ok')
