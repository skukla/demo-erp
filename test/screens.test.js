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
  { key: 'home', heading: /^Home$/ },
  { key: 'orders', heading: /^Sales Orders$/, opens: /^Sales Order \d{10}$/ },
  { key: 'shipments', heading: /^Shipments$/, opens: /^Shipment \d{10}$/ },
  { key: 'invoices', heading: /^Invoices$/, opens: /^Invoice \d{10}$/ },
  { key: 'products', heading: /^Products$/, opens: /.+/ },
  { key: 'partners', heading: /^Customers$/, opens: /.+/ },
  { key: 'pricing', heading: /^Pricing$/ },
  { key: 'events', heading: /^Event Journal$/ },
  { key: 'settings', heading: /^Settings$/ }
]

/* The style properties that describe layout and look without describing text. */
const STYLE_PROPS = [
  // Not width/height as strings: they carry sub-pixels that flicker (34px vs 34.2969px
  // on a Spectrum header cell between two identical runs); the rounded rect below has them.
  'display', 'position', 'padding', 'margin', 'gap',
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
    // What this run saw over what was recorded: a screen whose re-accept was refused
    // (two fresh loads disagreed) keeps its recorded fingerprint rather than vanishing.
    fs.writeFileSync(FIXTURE, `${JSON.stringify({ ...recorded, ...seen }, null, 2)}\n`)
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
  // Park the pointer on empty canvas: a header cell under the mouse grows its resizer.
  await page.mouse.move(VIEWPORT.width - 8, VIEWPORT.height - 8)
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
 * The fingerprint once the screen has stopped moving: three samples 300 ms apart that
 * agree. Spectrum's grids size their columns a frame or two after mount, and a sample
 * taken mid-settle differed between two otherwise identical runs (2026-09-24).
 */
async function fingerprint (page) {
  let rows = await rowsOf(page)
  let agreed = 0
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(300)
    const again = await rowsOf(page)
    if (digest(again) === digest(rows)) {
      agreed += 1
      if (agreed >= 2) return { elements: rows.length, hash: digest(rows), rows }
    } else {
      agreed = 0
      rows = again
    }
  }
  return { elements: rows.length, hash: digest(rows), rows }
}

/** The rows behind the last recorded fingerprint, kept beside the fixture for a diff. */
const ROWS_DIR = path.join(require('os').tmpdir(), 'demo-erp-screen-rows')

const rowsFile = (name, suffix = '') => path.join(ROWS_DIR, `${name.replace(':', '-')}${suffix}.txt`)

/**
 * True when the fingerprint matches the recorded one (or nothing is recorded yet). A
 * changed look is NOT taken on the first sight even when re-accepting: on 2026-09-24 an
 * UPDATE run recorded a one-off sample of a screen the change never touched, and every
 * later run failed on it. `check` below reloads and accepts only what two loads agree on.
 */
function matches (name, actual) {
  const { rows, ...summary } = actual
  fs.mkdirSync(ROWS_DIR, { recursive: true })
  fs.writeFileSync(rowsFile(name), rows.join('\n'))
  const same = recorded[name] && summary.hash === recorded[name].hash && summary.elements === recorded[name].elements
  if (same || !recorded[name]) {
    seen[name] = summary
    return true
  }
  return false
}

/**
 * One screen's fingerprint must match the recorded one. A first mismatch is kept on disk
 * (`<name>.mismatch.txt`, never overwritten by a later pass) and the screen is loaded once
 * more in a fresh page: a look that differs on one load out of two is a render that had
 * not finished, not a change to the screen. Only two mismatches in a row fail.
 */
/**
 * Wait until the page's title matches: a document opened by its address (`orders?open=…`)
 * mounts its LIST first and opens the record in an effect, so `settled` alone can answer
 * with the list's rows. Found 2026-09-24: every document retry had been fingerprinting
 * the list, unseen because no document had changed since its fingerprint was recorded.
 */
async function headed (page, heading, notHeading) {
  // A document's pattern may match the list's title too (`/.+/`), so the list's own title
  // is excluded explicitly: the page has left the list once its title is gone.
  await page.waitForFunction(
    ([source, notSource]) => {
      const text = ((document.querySelector('.erp-content h1') || {}).textContent || '').trim()
      return new RegExp(source).test(text) && !(notSource && new RegExp(notSource).test(text))
    },
    [heading.source, notHeading ? notHeading.source : null],
    { timeout: 15000 }
  )
  await settled(page)
}

async function check (name, hash, first, heading, notHeading) {
  if (matches(name, first)) return
  fs.copyFileSync(rowsFile(name), rowsFile(name, '.mismatch'))
  const again = await open(hash)
  try {
    if (heading) await headed(again.page, heading, notHeading)
    const second = await fingerprint(again.page)
    if (UPDATE) {
      // Re-accepting a changed look: only when the two fresh loads agree with each other.
      const settled = second.hash === first.hash && second.elements === first.elements
      assert.equal(settled, true, `${name}: the look changed, but two fresh loads disagree with each other (${first.hash.slice(0, 8)} vs ${second.hash.slice(0, 8)}); not re-accepted, the recorded fingerprint stands. Run again.`)
      seen[name] = { elements: second.elements, hash: second.hash }
      return
    }
    const message = `${name}: the screen's look changed twice in a row (rows in ${ROWS_DIR}, the first mismatch beside them as .mismatch.txt). If that was intended, re-accept with UPDATE_SCREEN_FINGERPRINTS=1 and review the fixture diff.`
    assert.equal(matches(name, second), true, message)
  } finally {
    await again.context.close()
  }
}

for (const screen of SCREENS) {
  test(`${screen.key}: renders, console clean, fingerprint unchanged`, async () => {
    const { page, context, problems } = await open(screen.key)
    try {
      const heading = await page.textContent('.erp-content h1')
      assert.match(heading.trim(), screen.heading)
      assert.deepEqual(problems, [], `${screen.key} console`)
      await check(screen.key, screen.key, await fingerprint(page), screen.heading)

      if (screen.opens) {
        // Rows that open a record say so with erp-key; the first one is enough. Its key is
        // kept: a click opens the record on the page's own trail WITHOUT writing it into the
        // address bar, so a retry has to reopen it by `?open=<key>` — reading the hash back
        // after the click gave the LIST's address, and every document retry had been
        // fingerprinting the list (found 2026-09-24, masked while no document changed).
        const key = (await page.textContent('.erp-rows-open .erp-key')).trim()
        await page.click('.erp-rows-open .erp-key')
        await settled(page)
        const docHeading = await page.textContent('.erp-content h1')
        assert.match(docHeading.trim(), screen.opens, `${screen.key}: opening the first row`)
        assert.deepEqual(problems, [], `${screen.key} document console`)
        await check(`${screen.key}:document`, `${screen.key}?open=${encodeURIComponent(key)}`, await fingerprint(page), screen.opens, screen.heading)
      }
    } finally {
      await context.close()
    }
  })
}

/* Body rows of the one grid on the page: Spectrum numbers header and body rows alike, from 1. */
async function bodyRows (page) {
  return page.locator('.erp-rows-open [role="row"][aria-rowindex]').evaluateAll((rows) => rows.filter((r) => Number(r.getAttribute('aria-rowindex')) > 1).length)
}

test('home: a cue opens its list filtered to exactly the rows it counted', async () => {
  const { page, context, problems } = await open('home')
  try {
    // The first cue is Orders to confirm; its number is what the filtered list must show.
    const cue = page.locator('.erp-cue').first()
    const count = Number(await cue.locator('.erp-cue-count').textContent())
    assert.ok(count > 0, 'the preview seeds orders waiting for confirmation')
    await cue.click()
    await settled(page)
    assert.equal(new URL(page.url()).hash, '#orders?work=toConfirm')
    assert.equal(await bodyRows(page), count)
    assert.deepEqual(problems, [], 'home → orders console')
  } finally {
    await context.close()
  }
})

test('the rail counts the work behind each item, from the same numbers as the cues', async () => {
  const { page, context } = await open('home')
  try {
    const cues = await page.locator('.erp-cue').evaluateAll((nodes) => Object.fromEntries(nodes.map((n) => [n.querySelector('.erp-cue-label').textContent, Number(n.querySelector('.erp-cue-count').textContent)])))
    const rail = await page.locator('.erp-rail button').evaluateAll((nodes) => Object.fromEntries(nodes.map((n) => [n.textContent.replace(/\d+$/, ''), Number((n.querySelector('.erp-rail-count') || {}).textContent || 0)])))
    assert.equal(rail['Sales Orders'], cues['Orders to confirm'] + cues['Orders on credit hold'] + cues['Orders to ship'] + cues['Orders to invoice'])
    assert.equal(rail.Shipments, cues['Shipments to post'])
    assert.equal(rail['Event Journal'], cues['Events not delivered'])
  } finally {
    await context.close()
  }
})

test('the shell search opens a document from anywhere', async () => {
  const { page, context, problems } = await open('products')
  try {
    const box = page.getByRole('combobox', { name: 'Search the ERP' })
    await box.fill('0000001003')
    // The list opens on "Loading..." first; the answer replaces it a moment later.
    const option = page.getByRole('option', { name: /Sales Order 0000001003/ })
    await option.waitFor({ timeout: 5000 })
    await option.click()
    await settled(page)
    assert.equal(new URL(page.url()).hash, '#orders?open=0000001003')
    assert.match((await page.textContent('.erp-content h1')).trim(), /^Sales Order 0000001003$/)
    assert.deepEqual(problems, [], 'search console')
  } finally {
    await context.close()
  }
})

test('the journal names the document each entry belongs to, and opens it', async () => {
  const { page, context } = await open('events')
  try {
    const text = await page.locator('.erp-rows-open').textContent()
    assert.match(text, /Shipment of 5 for sales order 0000001002 from default/)
    assert.match(text, /Order confirmed/)
    assert.doesNotMatch(text, /\{"erpNumber"/, 'no raw JSON in the list')
    await page.locator('.erp-journal-link').first().click()
    await settled(page)
    assert.match(new URL(page.url()).hash, /^#orders\?open=/)
  } finally {
    await context.close()
  }
})

test('the product page is a master record: basic data, open orders, committed and available; a blocked product says so', async () => {
  const { page, context, problems } = await open('products')
  try {
    // The list: Available beside On hand, and the blocked stand-in's status in words.
    const header = await page.locator('[role="columnheader"]').allTextContents()
    assert.ok(header.includes('Available') && header.includes('On hand'), `columns: ${header.join(' | ')}`)
    const blocked = page.getByRole('row', { name: /P000010/ })
    assert.match(await blocked.textContent(), /Blocked for sales/)
    // A product with open orders: P000001 is on the stand-in orders' first lines.
    await page.getByRole('row', { name: /P000001/ }).getByText('P000001').click()
    await settled(page)
    const text = await page.locator('.erp-content').textContent()
    assert.match(text, /Basic data/)
    assert.match(text, /Open orders/)
    assert.match(text, /On hand \d+ · Committed \d+ · Available -?\d+/)
    assert.match(text, /Finished good/)
    // The configurable parent: its variants, its type in ERP words, and no crash.
    await page.goto(`${preview.url}#products?open=P000004`)
    await settled(page)
    const parentText = await page.locator('.erp-content').textContent()
    assert.match(parentText, /Variants/)
    assert.match(parentText, /Generic article/)
    assert.match(parentText, /P000004-M/)
    assert.deepEqual(problems, [], 'product page console')
  } finally {
    await context.close()
  }
})

test('the lists say what the document behind each row is in the middle of', async () => {
  const headers = async (hash) => {
    const { page, context, problems } = await open(hash)
    try {
      const text = await page.locator('[role="columnheader"]').allTextContents()
      assert.deepEqual(problems, [], `${hash} console`)
      return text
    } finally {
      await context.close()
    }
  }
  const orders = await headers('orders')
  assert.ok(orders.includes('Shipping') && orders.includes('Billing') && !orders.includes('Lines'), `orders: ${orders.join(' | ')}`)
  const shipments = await headers('shipments')
  assert.ok(shipments.includes('Sold-to'), `shipments: ${shipments.join(' | ')}`)
  const invoices = await headers('invoices')
  assert.ok(invoices.includes('Sold-to'), `invoices: ${invoices.join(' | ')}`)
  const customers = await headers('partners')
  assert.ok(customers.includes('Exposure') && customers.includes('Available'), `customers: ${customers.join(' | ')}`)
  // The shipment's ship-from prints the ERP's own name for the plant, not Commerce's source name.
  const { page, context } = await open('shipments')
  try {
    assert.match(await page.locator('[role="grid"]').textContent(), /Plant 1000 · Seattle DC/)
  } finally {
    await context.close()
  }
})

test('the documents carry their timeline, due date, credit meter and open items', async () => {
  const { page, context, problems } = await open('orders?open=0000001003')
  try {
    const text = await page.locator('.erp-content').textContent()
    assert.match(text, /Timeline/)
    assert.match(text, /Shipment 8000000003 posted/)
    // A line's SKU is a link that opens the product on the same trail.
    await page.locator('[role="grid"][aria-label="Order lines"] .erp-link').first().click()
    await settled(page)
    assert.match((await page.textContent('.erp-content h1')).trim(), /Merino crew knit|Wool overcoat/)
    assert.deepEqual(problems, [], 'order → product console')
  } finally {
    await context.close()
  }
  const invoice = await open('invoices?open=9000000001')
  try {
    const text = await invoice.page.locator('.erp-content').textContent()
    assert.match(text, /Due date/)
    assert.match(text, /15 days/)
    assert.deepEqual(invoice.problems, [], 'invoice console')
  } finally {
    await invoice.context.close()
  }
  const customer = await open('partners?open=C000102')
  try {
    assert.equal(await customer.page.getByRole('meter').count(), 1)
    const text = await customer.page.locator('.erp-content').textContent()
    assert.match(text, /Open items/)
    assert.match(text, /the exposure above is this list/)
    assert.deepEqual(customer.problems, [], 'customer console')
  } finally {
    await customer.context.close()
  }
})

test('the title line stays while a long list scrolls under it', async () => {
  const { page, context } = await open('products')
  try {
    const before = await page.locator('.erp-content h1').boundingBox()
    // A shorter window, so the twenty stand-in products overflow by a few hundred pixels.
    await page.setViewportSize({ width: VIEWPORT.width, height: 560 })
    const scrolled = await page.locator('.erp-content').evaluate((el) => { el.scrollTop = 300; return el.scrollTop })
    assert.ok(scrolled >= 250, `the products list scrolled ${scrolled}px; it should be long enough to scroll 300`)
    await page.waitForTimeout(150)
    const after = await page.locator('.erp-content h1').boundingBox()
    const content = await page.locator('.erp-content').boundingBox()
    assert.ok(after.y >= content.y && after.y <= before.y, `title moved from ${before.y} to ${after.y}; content top ${content.y}`)
    assert.ok(after.y < content.y + 80, 'the title is within the top of the content, not scrolled away')
  } finally {
    await context.close()
  }
})
