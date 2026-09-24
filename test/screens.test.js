/*
 * Every screen, looked at by a machine (plan slice T-2, backlog AB-26d).
 *
 * Unit tests cannot see a screen fail. On 2026-09-24 Spectrum's table crashed the whole
 * order document when a Column vanished between renders, and 184 unit tests stayed green.
 * This test starts the preview (the real components against stand-in records), drives a
 * headless browser through every area and the first document behind each list, and
 * asserts three things per screen: it rendered (its heading is there), the console is
 * clean (no errors, no uncaught exceptions), and its computed-style FINGERPRINT equals
 * the one checked in — so a CSS or layout change has to be accepted on purpose.
 *
 * Re-accept fingerprints after an intended change:
 *   UPDATE_SCREEN_FINGERPRINTS=1 node --test test/screens.test.js
 * and read the diff of test/fixtures/screen-fingerprints.json before committing it.
 *
 * Never the owner's browser: Playwright's own headless Chromium. Locale and time zone are
 * pinned so dates print the same on every machine.
 */
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { chromium } = require('playwright')
const { startPreview } = require('../scripts/preview')

const FIXTURE = path.join(__dirname, 'fixtures', 'screen-fingerprints.json')
const UPDATE = process.env.UPDATE_SCREEN_FINGERPRINTS === '1'
const VIEWPORT = { width: 1440, height: 900 }

/* The areas, and for a list, how to open the first document behind it. */
const SCREENS = [
  { key: 'dashboard', heading: /^Dashboard$/ },
  { key: 'orders', heading: /^Sales Orders$/, opens: /^Sales Order \d{10}$/ },
  { key: 'shipments', heading: /^Shipments$/, opens: /^Shipment \d{10}$/ },
  { key: 'invoices', heading: /^Invoices$/, opens: /^Invoice \d{10}$/ },
  { key: 'products', heading: /^Products$/, opens: /.+/ },
  { key: 'partners', heading: /^Customers$/, opens: /.+/ },
  { key: 'pricing', heading: /^Pricing Rules$/ },
  { key: 'events', heading: /^Event Journal$/ },
  { key: 'settings', heading: /^Settings$/ }
]

/* The style properties that describe layout and look without describing text. */
const STYLE_PROPS = [
  'display', 'position', 'width', 'height', 'padding', 'margin', 'gap',
  'color', 'background-color', 'border-color', 'border-radius',
  'font-size', 'font-weight', 'text-transform', 'letter-spacing', 'opacity'
]

let preview
let browser
let recorded = {}
const seen = {}

before(async () => {
  preview = await startPreview({ port: 0 })
  browser = await chromium.launch()
  if (fs.existsSync(FIXTURE)) recorded = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
})

after(async () => {
  if (browser) await browser.close()
  if (preview) await preview.close()
  if (UPDATE || !fs.existsSync(FIXTURE)) {
    fs.writeFileSync(FIXTURE, `${JSON.stringify(seen, null, 2)}\n`)
  }
})

/** A page with a pinned locale and clock, collecting everything the console complains about. */
async function open (hash) {
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US', timezoneId: 'UTC' })
  const page = await context.newPage()
  const problems = []
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`) })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  await page.goto(`${preview.url}#${hash}`)
  await settled(page)
  return { page, context, problems }
}

/** The stand-in api answers after 350 ms; the spinner is gone when the screen has its data. */
async function settled (page) {
  await page.waitForSelector('.erp-content h1', { timeout: 15000 })
  await page.waitForSelector('[role="progressbar"]', { state: 'detached', timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(150)
}

/**
 * The screen as rows: every element's tag, classes, chosen computed styles and rounded
 * size, in document order. Same build, same records, same rows.
 */
async function rowsOf (page) {
  return page.evaluate((props) => {
    const out = []
    for (const el of document.querySelectorAll('.erp-content *')) {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      out.push([el.tagName, el.className && typeof el.className === 'string' ? el.className : '', ...props.map((p) => cs.getPropertyValue(p)), Math.round(r.width), Math.round(r.height)].join('|'))
    }
    return out
  }, STYLE_PROPS)
}

const digest = (rows) => crypto.createHash('sha256').update(rows.join('\n')).digest('hex')

/**
 * The fingerprint once the screen has stopped moving: two samples 300 ms apart that
 * agree. Spectrum's grids size their columns a frame or two after mount, and a sample
 * taken mid-settle differed between two otherwise identical runs (2026-09-24).
 */
async function fingerprint (page) {
  let rows = await rowsOf(page)
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(300)
    const again = await rowsOf(page)
    if (digest(again) === digest(rows)) return { elements: rows.length, hash: digest(rows), rows }
    rows = again
  }
  return { elements: rows.length, hash: digest(rows), rows }
}

/** The rows behind the last recorded fingerprint, kept beside the fixture for a diff. */
const ROWS_DIR = path.join(require('os').tmpdir(), 'demo-erp-screen-rows')

function check (name, actual) {
  const { rows, ...summary } = actual
  seen[name] = summary
  fs.mkdirSync(ROWS_DIR, { recursive: true })
  fs.writeFileSync(path.join(ROWS_DIR, `${name.replace(':', '-')}.txt`), rows.join('\n'))
  if (UPDATE || !recorded[name]) return
  assert.deepEqual(summary, recorded[name], `${name}: the screen's look changed (rows written to ${ROWS_DIR}). If that was intended, re-accept with UPDATE_SCREEN_FINGERPRINTS=1 and review the fixture diff.`)
}

for (const screen of SCREENS) {
  test(`${screen.key}: renders, console clean, fingerprint unchanged`, async () => {
    const { page, context, problems } = await open(screen.key)
    try {
      const heading = await page.textContent('.erp-content h1')
      assert.match(heading.trim(), screen.heading)
      assert.deepEqual(problems, [], `${screen.key} console`)
      check(screen.key, await fingerprint(page))

      if (screen.opens) {
        // Rows that open a record say so with erp-key; the first one is enough.
        await page.click('.erp-rows-open .erp-key')
        await settled(page)
        const docHeading = await page.textContent('.erp-content h1')
        assert.match(docHeading.trim(), screen.opens, `${screen.key}: opening the first row`)
        assert.deepEqual(problems, [], `${screen.key} document console`)
        check(`${screen.key}:document`, await fingerprint(page))
      }
    } finally {
      await context.close()
    }
  })
}
