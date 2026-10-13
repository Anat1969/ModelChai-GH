// Runs docs/reference/umbilic-pavilion.html in Chromium with three.js r128 served locally (the CDN is not
// reachable from CI), and writes the reference model's own metrics JSON to tests/e2e/reference-metrics.json.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const local = {
  'three.min.js': root + 'node_modules/three-r128/build/three.min.js',
  'OrbitControls.js': root + 'node_modules/three-r128/examples/js/controls/OrbitControls.js',
}
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
await page.route('**/*', (route) => {
  const url = route.request().url()
  for (const [name, path] of Object.entries(local)) {
    if (url.endsWith(name)) return route.fulfill({ body: readFileSync(path), contentType: 'application/javascript' })
  }
  if (url.startsWith('file:')) return route.continue()
  return route.fulfill({ status: 204, body: '' })
})
page.on('pageerror', (e) => console.error('page error:', e.message))
await page.goto('file://' + root + 'docs/reference/umbilic-pavilion.html')
await page.waitForFunction(() => document.getElementById('jsonOut')?.value?.length > 10, null, { timeout: 30000 })
const json = JSON.parse(await page.$eval('#jsonOut', (el) => el.value))
writeFileSync(root + 'tests/e2e/reference-metrics.json', JSON.stringify(json, null, 2) + '\n')
console.log(JSON.stringify(json, null, 2))
await browser.close()
