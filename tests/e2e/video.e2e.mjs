/**
 * The clip from chosen views (DECISIONS.md 116–118), in Chromium against the production build:
 * `npx vite build && node tests/e2e/video.e2e.mjs`. Prints every measured number and writes
 * docs/screenshots/video-shots.png. Port 4303 only.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shots = root + 'docs/screenshots/'
mkdirSync(shots, { recursive: true })
const PORT = 4303
const URL_ = `http://localhost:${PORT}/#/studio`

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

/** Duration in seconds and sample count, from an MP4's mvhd and stsz boxes. */
function mp4Info(buf) {
  const mvhd = buf.indexOf(Buffer.from('mvhd'))
  const v1 = buf[mvhd + 4] === 1
  const timescale = v1 ? buf.readUInt32BE(mvhd + 24) : buf.readUInt32BE(mvhd + 16)
  const duration = v1 ? Number(buf.readBigUInt64BE(mvhd + 28)) : buf.readUInt32BE(mvhd + 20)
  const stsz = buf.indexOf(Buffer.from('stsz'))
  return { seconds: duration / timescale, samples: buf.readUInt32BE(stsz + 12) }
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

const stage = (page) => page.$eval('[data-testid=stage]', (el) => ({ camera: el.dataset.camera, builds: el.dataset.buildCount, level: el.dataset.level, recording: el.dataset.recording }))
const order = (page) => page.$$eval('[data-testid=shot]', (els) => els.map((e) => e.dataset.id))
/** Sets a range input the way a drag does, so React sees it. */
const setRange = (page, el, value) =>
  el.evaluate((input, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(v))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true })
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  // No server in this test: the clip has no account to keep it in, so it downloads.
  await page.route(/supabase\.co/, (r) => r.abort())
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(URL_)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > 0, null, { timeout: 90000 })
  await page.waitForTimeout(1500)

  // ---------- the views ----------
  await page.click('[data-testid=tab-video]')
  await page.waitForSelector('[data-testid=shot-empty]')
  const empty = await page.$eval('[data-testid=video-total]', (el) => [Number(el.dataset.seconds), Number(el.dataset.frames)])
  check('with no views, the clip is the quarter turn: 4 s, 120 frames', empty[0] === 4 && empty[1] === 120, empty.join(' s, ') + ' frames')

  const poses = []
  for (const cam of ['eye_level_oblique', 'aerial', 'courtyard']) {
    await page.click(`[data-testid=camera-${cam}]`)
    await page.waitForTimeout(1200)
    poses.push((await stage(page)).camera)
    await page.click('[data-testid=shot-add]')
    await page.waitForTimeout(600)
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=shot] img').length === 3, null, { timeout: 30000 })
  const ids = await order(page)
  check('three views from three camera presets, each with a thumbnail', ids.length === 3 && new Set(poses).size === 3, `${ids.length} views`)
  const thumb = await page.$eval('[data-testid=shot] img', (img) => [img.naturalWidth, img.naturalHeight])
  check('the thumbnail is 3:2', thumb[0] * 2 === thumb[1] * 3, thumb.join(' × '))

  // Reorder: the first view later, then the last one earlier.
  await page.locator('[data-testid=shot]').nth(0).locator('[data-testid=shot-later]').click()
  const afterLater = await order(page)
  await page.locator('[data-testid=shot]').nth(2).locator('[data-testid=shot-earlier]').click()
  const afterEarlier = await order(page)
  check('"מאוחר יותר" and "מוקדם יותר" reorder the views', afterLater.join() === [ids[1], ids[0], ids[2]].join() && afterEarlier.join() === [ids[1], ids[2], ids[0]].join(), afterEarlier.join(' → '))

  // One second each: a 3-second clip, 90 frames.
  const ranges = page.locator('[data-testid=shot-seconds]')
  for (let i = 0; i < 3; i++) await setRange(page, ranges.nth(i), 1)
  const total = await page.$eval('[data-testid=video-total]', (el) => [Number(el.dataset.seconds), Number(el.dataset.frames)])
  check('3 views × 1 s make 3 s and 90 frames', total[0] === 3 && total[1] === 90, `${total[0]} s, ${total[1]} frames`)
  const timeline = await page.$eval('[data-testid=cliptime]', (el) => ({ seconds: Number(el.dataset.seconds), keys: el.querySelectorAll('.cliptime-key').length, parts: [...el.querySelectorAll('.cliptime-part')].map((p) => `${p.classList[1]} ${p.dataset.seconds}`) }))
  check('the timeline under the model shows 3 s and marks the 3 views', timeline.seconds === 3 && timeline.keys === 3, `${timeline.parts.join(', ')}; ${timeline.keys} marks`)

  // Kept on the device, per project, as small JSON.
  const stored = await page.evaluate(() => localStorage.getItem('mathcreator-shots:draft'))
  const plan = JSON.parse(stored)
  check('the views are kept under mathcreator-shots:draft as small JSON', plan.shots.length === 3 && stored.length < 600, `${stored.length} characters`)

  // ---------- the level options ----------
  await page.click('[data-testid=level-mode-bare]')
  const bareOnly = await page.$$eval('.cliptime-part', (els) => els.map((e) => e.classList[1]))
  await page.click('[data-testid=level-mode-realistic]')
  const realOnly = await page.$$eval('.cliptime-part', (els) => els.map((e) => e.classList[1]))
  await page.click('[data-testid=level-mode-blend]')
  await setRange(page, page.locator('[data-testid=blend-from]'), 0.5)
  await setRange(page, page.locator('[data-testid=blend-to]'), 2)
  const blend = await page.$$eval('.cliptime-part', (els) => els.map((e) => `${e.classList[1]} ${e.dataset.seconds}`))
  check('"ערום בלבד", "ריאליסטי בלבד" and a chosen blend window read on the timeline', bareOnly.join() === 'bare' && realOnly.join() === 'realistic' && blend.join() === 'bare 0.5,blend 1.5,realistic 1', `${bareOnly} | ${realOnly} | ${blend.join(', ')}`)

  // ---------- preview ----------
  await page.click('[data-testid=camera-eye_level_oblique]')
  await page.waitForTimeout(1200)
  const before = await stage(page)
  await page.click('[data-testid=preview-clip]')
  const seen = new Set()
  const marks = []
  const t0 = Date.now()
  let shot = false
  while (Date.now() - t0 < 2500) {
    const s = await stage(page)
    seen.add(s.camera)
    const m = await page.$('[data-testid=cliptime-marker]')
    if (m) marks.push(Number(await m.getAttribute('data-progress')))
    if (!shot && Date.now() - t0 > 700) {
      // Mid-preview, with the list in view: the picture for DECISIONS.md 116.
      shot = true
      await page.$eval('.side-scroll', (el) => el.scrollTo(0, 0))
      await page.screenshot({ path: shots + 'video-shots.png' })
    }
    await page.waitForTimeout(150)
  }
  check('the preview moves the camera and the marker along the timeline', seen.size >= 3 && marks.length >= 2 && marks.at(-1) > marks[0], `${seen.size} poses, marker ${marks[0]?.toFixed(0)}% → ${marks.at(-1)?.toFixed(0)}%`)
  if (await page.$('[data-testid=stop-preview]')) await page.click('[data-testid=stop-preview]')
  await page.waitForSelector('[data-testid=preview-clip]')
  await page.waitForTimeout(500)
  const after = await stage(page)
  check('"עצירה" puts the camera and the level back', after.camera === before.camera && after.level === before.level && !(await page.$('[data-testid=cliptime-marker]')), `${before.camera} → ${after.camera}`)

  // The list survives a reload.
  await page.reload()
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > 0, null, { timeout: 90000 })
  await page.click('[data-testid=tab-video]')
  const reloaded = await order(page)
  check('the views and their order come back after a reload', reloaded.join() === afterEarlier.join(), reloaded.join(' → '))
  const fits = await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)
  check('the studio still fits the screen without scrolling', fits)

  // ---------- the clip ----------
  await page.waitForTimeout(1500)
  const pre = await stage(page)
  const started = Date.now()
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 1500000 }), page.click('[data-testid=video-make]')])
  const mp4 = readFileSync(await dl.path())
  const info = mp4Info(mp4)
  const status = await page.textContent('[data-testid=video-status]').catch(() => '')
  check('the clip is 3.0 s and 90 frames', Math.abs(info.seconds - 3) < 0.05 && info.samples === 90, `${info.seconds} s, ${info.samples} frames, ${(mp4.length / 1e6).toFixed(2)} MB in ${Math.round((Date.now() - started) / 1000)} s; ${dl.suggestedFilename()}; ${status}`)
  await page.waitForFunction(() => document.querySelector('[data-testid=stage]')?.dataset.recording === 'false')
  const post = await stage(page)
  check('making the clip builds nothing and leaves the window as it was', post.builds === pre.builds && post.level === pre.level && post.camera === pre.camera, `builds ${pre.builds} → ${post.builds}, level ${pre.level} → ${post.level}`)

  // ---------- the entry ----------
  await page.click('[data-testid=shot-clear]')
  await page.click('[data-testid=shot-preset-entry]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=shot] img').length === 4, null, { timeout: 30000 })
  const entry = await page.$eval('[data-testid=video-total]', (el) => Number(el.dataset.seconds))
  const heights = await page.$$eval('[data-testid=shot] .shot-meta .num', (els) => els.map((e) => e.textContent))
  check('"מעבר כניסה" adds 4 views at eye height through the passage, 9 s', entry === 9 && heights.every((h) => h === '1.6'), `${entry} s, heights ${heights.join(', ')}`)
} catch (e) {
  failed++
  console.log('FAIL  the run stopped:', e)
} finally {
  await browser.close()
  server.kill()
}
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
