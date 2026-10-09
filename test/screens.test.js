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
  { key: 'returns', heading: /^Returns$/, opens: /^Return Order \d{10}$/ },
  { key: 'creditMemos', heading: /^Credit Memos$/, opens: /^Credit Memo \d{10}$/ },
  { key: 'payments', heading: /^Payments$/, opens: /^Payment \d{10}$/ },
  { key: 'products', heading: /^Products$/, opens: /.+/ },
  { key: 'warehouses', heading: /^Warehouses$/ },
  { key: 'partners', heading: /^Customers$/, opens: /.+/ },
  { key: 'contracts', heading: /^Price Lists$/, opens: /^Price List \d{10}$/ },
  { key: 'priceGroups', heading: /^Price Groups$/ },
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

/**
 * A page with a pinned locale and clock, collecting everything the console complains about.
 * `search` is the preview's own query (`?maintenance` opens it inside a maintenance window).
 */
async function open (hash, search = '', viewport = VIEWPORT) {
  const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' })
  const page = await context.newPage()
  const problems = []
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`) })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  await page.goto(`${preview.url}${search}#${hash}`)
  // Park the pointer on empty canvas: a header cell under the mouse grows its resizer.
  await page.mouse.move(viewport.width - 8, viewport.height - 8)
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
    assert.equal(rail.Returns, cues['Returns to receive'] + cues['Returns to credit'])
    assert.equal(rail.Invoices, cues['Invoices to collect'])
    assert.ok(rail.Invoices > 0, 'the preview seeds an invoice partly paid')
    assert.ok(rail.Returns > 0, 'the preview seeds a return to receive and one to credit')
    assert.equal(rail['Event Journal'], cues['Messages not sent'])
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
    assert.match(text, /Shipment 8000000002 of 5 for sales order 0000001002 from default/)
    // Contract version 16: the journal names each event in the ERP's own words (AB-26y).
    assert.match(text, /Sales order changed/)
    assert.match(text, /Goods issue posted/)
    assert.match(text, /Billing document created \(credit memo\)/)
    assert.doesNotMatch(text, /\{"SalesOrder"/, 'no raw JSON in the list')
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
    assert.match(text, /Open orders/)
    assert.match(text, /Open items/)
    assert.match(text, /\d+ open orders? · .* — ordered, not yet invoiced\./)
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

/* Settings is the ERP's setup (AB-59): four sections, and none of the demo's own controls
   (on the ERP's card in Demo Builder) or the SC's appearance (in the user menu, below). */
test('settings is a setup page: four sections, and no wipe, maintenance or appearance', async () => {
  const { page, context, problems } = await open('settings')
  try {
    const titles = await page.locator('.erp-card-header h3').allTextContents()
    assert.deepEqual(titles, ['Company', 'Sales & Receivables', 'Number Series', 'Sales Organizations'])
    const text = await page.locator('.erp-content').textContent()
    for (const gone of ['Wipe all records', 'Start maintenance', 'Appearance', 'Records', 'Last import']) assert.ok(!text.includes(gone), `${gone} is not on the ERP's screen`)
    assert.deepEqual(problems, [], 'settings console')
  } finally {
    await context.close()
  }
})

test('a section edits in place: Edit, change, Save; Cancel puts it back; the seller follows', async () => {
  const { page, context, problems } = await open('settings')
  try {
    await page.getByRole('button', { name: 'Edit company' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Contoso Holdings')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByText('Contoso Holdings').waitFor({ timeout: 5000 })
    await page.getByRole('button', { name: 'Edit company' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Never kept')
    await page.getByRole('button', { name: 'Cancel' }).click()
    assert.ok((await page.locator('.erp-content').textContent()).includes('Contoso Holdings'))
    assert.deepEqual(problems, [], 'company edit console')
  } finally {
    await context.close()
  }
})

test('a refusal is shown in the ERP\'s words: a section keeps what was typed, a number series never goes back', async () => {
  const { page, context, problems } = await open('settings')
  try {
    await page.getByRole('button', { name: 'Edit company' }).click()
    await page.getByRole('textbox', { name: 'Currency' }).fill('dollars')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByText('A currency is a three-letter code, such as USD.').waitFor({ timeout: 5000 })
    assert.equal(await page.getByRole('textbox', { name: 'Currency' }).inputValue(), 'dollars')
    await page.getByRole('button', { name: 'Edit next sales orders number' }).click()
    const field = page.getByRole('textbox', { name: 'Next sales orders number' })
    await field.fill('0000000500')
    await field.press('Enter')
    await page.getByText('A number series never goes back: the next sales order number is 0000001010. Enter 0000001010 or higher.', { exact: false }).waitFor({ timeout: 5000 })
    assert.deepEqual(problems, [], 'refusal console')
  } finally {
    await context.close()
  }
})

test('number series: every editable Next number fits inside its cell, so the table draws no "…" beside it', async () => {
  // AB-65: a table cell clips what does not fit and marks the cut with an ellipsis. The edit
  // button overflowed its 140 px column in every row; where the number was narrow enough
  // (0000001010) the first dot of that ellipsis showed in the gap after the button.
  const { page, context, problems } = await open('settings')
  try {
    const grid = page.getByRole('grid', { name: 'Number series' })
    await grid.waitFor()
    const cut = await grid.evaluate((el) => [...el.querySelectorAll('button[aria-label^="Edit next"]')]
      .map((b) => ({ label: b.getAttribute('aria-label'), over: b.parentElement.scrollWidth - b.parentElement.clientWidth }))
      .filter((c) => c.over > 0))
    assert.deepEqual(cut, [])
    assert.equal(await grid.locator('button[aria-label^="Edit next"]').count(), 7, 'every series was looked at')
    assert.deepEqual(problems, [], 'settings console')
  } finally {
    await context.close()
  }
})

/* What of each body cell of a grid does not fit it: the cells a table would cut with "…" (AB-65). */
async function cutCells (grid) {
  return grid.evaluate((el) => [...el.querySelectorAll('[role="gridcell"], [role="rowheader"]')]
    .map((c) => ({ text: c.innerText.trim(), over: (c.firstElementChild || c).scrollWidth - (c.firstElementChild || c).clientWidth }))
    .filter((c) => c.over > 0))
}

/* How far a grid's header or body scrolls sideways: its columns add up to more than the table. */
async function sideways (grid) {
  return grid.evaluate((el) => [...el.querySelectorAll('*')]
    .filter((n) => ['auto', 'scroll'].includes(getComputedStyle(n).overflowX))
    .map((n) => n.scrollWidth - n.clientWidth)
    .filter((over) => over > 1))
}

/* The column headings of a grid that do not fit: a heading's text is cut with "…" (AB-65).
   Measured in fractions of a pixel too: scrollWidth and clientWidth are whole pixels, and
   "Sales org" ran 0.45 px past its 69 px box — both read 69, and the screen said "SALES O…"
   (2026-10-03). The browser cuts a whole run of letters for any overflow at all. */
async function cutHeaders (grid) {
  return grid.evaluate((el) => [...el.querySelectorAll('[role="columnheader"]')]
    .map((h) => ({
      text: h.innerText.trim(),
      over: Math.max(0, ...[...h.querySelectorAll('*')]
        .filter((n) => getComputedStyle(n).textOverflow === 'ellipsis')
        .map((n) => {
          const range = document.createRange()
          range.selectNodeContents(n)
          const cs = getComputedStyle(n)
          const room = n.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
          const past = Math.round((range.getBoundingClientRect().width - room) * 100) / 100
          return Math.max(n.scrollWidth - n.clientWidth, past)
        }))
    }))
    .filter((h) => h.over > 0))
}

/* The headings of a grid that cannot be dragged: a resizable heading carries Spectrum's menu
   chevron, through which a keyboard resizes it too. The rule is in gridColumns.js. */
async function fixedHeadings (grid) {
  return grid.evaluate((el) => [...el.querySelectorAll('[role="columnheader"]')]
    .filter((h) => !h.querySelector('[class*="spectrum-Table-menuChevron"]'))
    .map((h) => h.textContent.trim()))
}

test('customers: every credit limit edit button and every amount fits its cell, so none is cut', async () => {
  // AB-65's measure, extended: the credit limit's edit button for USD 120,000.00 was 34 px wider
  // than its 140 px column and showed cut mid-digit; Available read "USD 118,71…".
  const { page, context, problems } = await open('partners')
  try {
    const grid = page.getByRole('grid', { name: 'Customers' })
    await grid.waitFor()
    assert.deepEqual(await cutCells(grid), [])
    // The headings too: "CUSTO…", "SALES ORGANI…" and "PAYMEN…" were cut (2026-10-03).
    assert.deepEqual(await cutHeaders(grid), [], 'every heading fits')
    assert.equal(await grid.locator('button[aria-label^="Edit credit limit"]').count(), 5, 'every customer was looked at')
    assert.deepEqual(await sideways(grid), [], 'the wider columns still fit the table')
    assert.deepEqual(await fixedHeadings(grid), [], 'every column can be dragged')
    assert.deepEqual(problems, [], 'customers console')
  } finally {
    await context.close()
  }
})

/* Sales order 1001 can still close a line (the Close column shows); 1009 carries a discount
   (the Discount column shows); 1003 has both: the widest set of order line columns there is. */
const ORDER_LINE_SETS = [
  ['0000001001', 'with its Close column', { close: true }],
  ['0000001009', 'with its Discount column', { discount: true }],
  ['0000001003', 'with both its Discount and its Close column', { close: true, discount: true }]
]
for (const [number, what, has] of ORDER_LINE_SETS) {
  test(`order lines ${what}: every heading and cell fits, and the table does not scroll sideways`, async () => {
    // The columns added up to 34 px more than the table on every order, 204 px with Close: the
    // last column sat past the edge and read "NET AMOU…" and "USD 245." (2026-10-03). With both
    // Discount and Close it still scrolled about 120 px until Qty and Unit were shortened.
    const { page, context, problems } = await open(`orders?open=${number}`)
    try {
      const grid = page.getByRole('grid', { name: 'Order lines' })
      await grid.waitFor()
      assert.deepEqual(await cutHeaders(grid), [], 'every heading fits')
      assert.deepEqual(await cutCells(grid), [], 'every cell fits')
      assert.deepEqual(await sideways(grid), [], 'the columns fit the table')
      assert.equal(await grid.getByRole('button', { name: 'Close remaining' }).count() > 0, Boolean(has.close), 'the Close column is there when it should be')
      assert.equal(await grid.getByRole('columnheader', { name: 'Discount' }).count(), has.discount ? 1 : 0, 'the Discount column is there when it should be')
      // Only the line number and the Close button stay put; the Close heading is blank, and first.
      assert.deepEqual(await fixedHeadings(grid), has.close ? ['', 'Item'] : ['Item'], 'every other column can be dragged')
      assert.deepEqual(problems, [], 'order console')
    } finally {
      await context.close()
    }
  })
}

/* Header widths by heading text, rounded. */
async function columnWidths (grid) {
  return grid.evaluate((el) => Object.fromEntries([...el.querySelectorAll('[role="columnheader"]')]
    .map((h) => [h.textContent.trim(), Math.round(h.getBoundingClientRect().width)])))
}

/* Drag a heading's right edge by dx px, in steps, the way a hand does. */
async function dragEdge (page, grid, heading, dx) {
  const header = grid.locator('[role="columnheader"]', { hasText: heading })
  await header.hover()
  const box = await header.boundingBox()
  const x = box.x + box.width - 3
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.waitForTimeout(200)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y)
  await page.mouse.up()
  await page.waitForTimeout(300)
}

/* Sales orders at 1,440 px has its shares at their minimums, and the order's lines have one
   share: until 2026-10-03 neither Sold-to nor Description could be widened by a drag at all. */
test('a column dragged wider grows, the table still fits, and the width is kept on reload', async () => {
  const { page, context, problems } = await open('orders')
  try {
    const grid = page.getByRole('grid', { name: 'Sales Orders' })
    await grid.waitFor()
    const before = await columnWidths(grid)
    await dragEdge(page, grid, 'Sold-to', 60)
    const after = await columnWidths(grid)
    assert.ok(after['Sold-to'] >= before['Sold-to'] + 55, `Sold-to ${before['Sold-to']} → ${after['Sold-to']}`)
    assert.deepEqual(await sideways(grid), [], 'the columns still fit the table')
    await page.reload()
    await settled(page)
    assert.equal((await columnWidths(grid))['Sold-to'], after['Sold-to'], 'kept on reload')

    await page.goto(`${preview.url}#orders?open=0000001003`)
    const lines = page.getByRole('grid', { name: 'Order lines' })
    await lines.waitFor()
    await settled(page)
    const was = await columnWidths(lines)
    await dragEdge(page, lines, 'Description', 50)
    const now = await columnWidths(lines)
    assert.ok(now.Description >= was.Description + 45, `Description ${was.Description} → ${now.Description}`)
    assert.deepEqual(await sideways(lines), [], 'the lines still fit the table')
    assert.deepEqual(problems, [], 'drag console')
  } finally {
    await context.close()
  }
})

test('sales organizations: every Edit button fits its cell', async () => {
  const { page, context, problems } = await open('settings')
  try {
    const grid = page.getByRole('grid', { name: 'Sales organizations' })
    await grid.waitFor()
    assert.deepEqual(await cutCells(grid), [])
    assert.equal(await grid.locator('button[aria-label^="Edit sales organization"]').count(), 2, 'every sales organization was looked at')
    // The columns added up to 10 px more than the card's table, which scrolled sideways.
    assert.deepEqual(await sideways(grid), [], 'the columns fit the table')
    assert.deepEqual(await cutHeaders(grid), [], 'every heading fits')
    assert.deepEqual(await fixedHeadings(grid), [''], 'every column but Edit can be dragged')
    assert.deepEqual(problems, [], 'settings console')
  } finally {
    await context.close()
  }
})

/* The two lists the 2026-10-03 grid audit left over, at the 1,440 px window: Products
   scrolled 31 px sideways with its shares already at their minimums; Pricing cut its
   "Sales org" heading by 20 px, "Min. qty" by 3, an amount by 3 and its Remove button by 31. */
const LIST_GRIDS = [
  ['products', 'Products', []],
  ['pricing', 'Pricing rules', ['']]
]
for (const [hash, name, fixed] of LIST_GRIDS) {
  test(`${hash}: every heading and cell fits, and the list does not scroll sideways`, async () => {
    const { page, context, problems } = await open(hash)
    try {
      const grid = page.getByRole('grid', { name })
      await grid.waitFor()
      const cells = await grid.locator('[role="gridcell"], [role="rowheader"]').count()
      assert.ok(cells > 0, `${hash} has cells to look at`)
      assert.deepEqual(await cutHeaders(grid), [], 'every heading fits')
      assert.deepEqual(await cutCells(grid), [], 'every cell fits')
      assert.deepEqual(await sideways(grid), [], 'the columns fit the table')
      assert.deepEqual(await fixedHeadings(grid), fixed, 'every column but a button can be dragged')
      assert.deepEqual(problems, [], `${hash} console`)
    } finally {
      await context.close()
    }
  })
}

/* The narrowest window the screen is set for: 1,280 px with the side menu open (gridColumns.js).
   The 2026-10-04 button audit found most lists there scrolling sideways and cutting their last
   heading, a Remove button off every Pricing row, Settings' tables cut in half-width columns,
   and the sales order's flow strip scrolling. Each page here is looked at whole: every grid on it.
   Not here, because it still does not fit (test/column-resizing.test.js says why): a sales
   order's lines with both a discount and a line still to close (0000001003). */
const NARROW = { width: 1280, height: 900 }
const NARROW_PAGES = [
  'orders', 'shipments', 'invoices', 'returns', 'creditMemos', 'payments', 'products', 'warehouses',
  'contracts', 'priceGroups', 'pricing', 'events', 'settings', 'partners',
  'orders?open=0000001001', 'orders?open=0000001002', 'orders?open=0000001009', 'invoices?open=9000000001',
  'creditMemos?open=9500000002', 'partners?open=C000103', 'contracts?open=4000000003'
]
for (const hash of NARROW_PAGES) {
  test(`at 1,280 px with the side menu, ${hash}: every grid fits, no heading or cell is cut`, async () => {
    const { page, context, problems } = await open(hash, '', NARROW)
    try {
      await page.waitForTimeout(300)
      const grids = page.getByRole('grid')
      const count = await grids.count()
      assert.ok(count > 0, `${hash} has a grid to look at`)
      for (let i = 0; i < count; i++) {
        const grid = grids.nth(i)
        const name = await grid.getAttribute('aria-label')
        assert.deepEqual(await sideways(grid), [], `${name}: the columns fit the table`)
        assert.deepEqual(await cutHeaders(grid), [], `${name}: every heading fits`)
        assert.deepEqual(await cutCells(grid), [], `${name}: every cell fits`)
      }
      assert.deepEqual(problems, [], `${hash} console`)
    } finally {
      await context.close()
    }
  })
}

/* Where a button column is: first, so a grid wider than its window still shows it. */
async function firstColumnButtons (grid) {
  return grid.evaluate((el) => {
    const first = [...el.querySelectorAll('[role="row"]')].map((row) => row.querySelector('[role="gridcell"], [role="rowheader"]')).filter(Boolean)
    const box = el.getBoundingClientRect()
    return first.map((cell) => cell.querySelector('button')).filter(Boolean)
      .map((b) => ({ text: b.textContent.trim(), inside: b.getBoundingClientRect().right <= box.right && b.getBoundingClientRect().left >= box.left }))
  })
}

test('at 1,280 px, a button column is the first in its row and in sight: Remove, Edit, Close', async () => {
  for (const [hash, name, button] of [
    ['pricing', 'Pricing rules', 'Remove'],
    ['priceGroups', 'Price groups', 'Remove'],
    ['contracts?open=4000000003', 'Price list lines', 'Remove'],
    ['settings', 'Sales organizations', 'Edit'],
    // Its lines still need more than the card (column-resizing.test.js): the button shows anyway.
    ['orders?open=0000001003', 'Order lines', 'Close']
  ]) {
    const { page, context, problems } = await open(hash, '', NARROW)
    try {
      const grid = page.getByRole('grid', { name })
      await grid.waitFor()
      const buttons = await firstColumnButtons(grid)
      assert.ok(buttons.length > 0, `${name}: its first column holds buttons`)
      assert.deepEqual(buttons.filter((b) => b.text !== button || !b.inside), [], `${name}: every ${button} is first and in sight`)
      assert.deepEqual(problems, [], `${hash} console`)
    } finally {
      await context.close()
    }
  }
})

test('settings is one column at 1,280 and 1,366 px with the side menu, two at 1,440', async () => {
  for (const [width, columns] of [[1280, 1], [1366, 1], [1440, 2]]) {
    const { page, context } = await open('settings', '', { width, height: 900 })
    try {
      const tops = await page.locator('.erp-settings-column').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)))
      assert.equal(new Set(tops).size, columns, `${width} px: ${columns} column(s)`)
    } finally {
      await context.close()
    }
  }
})

test('at 1,280 px the default return reason is on a row of its own, and reads whole', async () => {
  const { page, context, problems } = await open('settings', '', NARROW)
  try {
    await page.getByRole('button', { name: 'Edit sales & receivables' }).click()
    const picker = page.getByRole('button', { name: /Default return reason/ })
    await picker.waitFor()
    const measured = await picker.evaluate((b) => {
      const form = b.closest('.erp-card')
      const value = [...b.querySelectorAll('span')].find((n) => n.textContent.includes('·'))
      return { share: b.getBoundingClientRect().width / form.getBoundingClientRect().width, cut: value ? value.scrollWidth - value.clientWidth : -1 }
    })
    assert.ok(measured.share > 0.8, `the picker spans the card (${measured.share.toFixed(2)})`)
    assert.equal(measured.cut, 0, 'the reason is not cut')
    assert.deepEqual(problems, [], 'settings console')
  } finally {
    await context.close()
  }
})

test('sales organizations: add one, and a code already there is refused in the dialog', async () => {
  const { page, context, problems } = await open('settings')
  try {
    const card = page.locator('.erp-card', { hasText: 'Sales Organizations' })
    await card.getByRole('button', { name: 'Add' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Code' }).fill('2000')
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Again')
    await dialog.getByRole('textbox', { name: 'Currency' }).fill('EUR')
    await dialog.getByRole('button', { name: 'Add' }).click()
    await dialog.getByText('Sales organization 2000 exists already.').waitFor({ timeout: 5000 })
    await dialog.getByRole('textbox', { name: 'Code' }).fill('3000')
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Online UK')
    await dialog.getByRole('button', { name: 'Add' }).click()
    await dialog.waitFor({ state: 'detached', timeout: 5000 })
    await card.getByRole('rowheader', { name: '3000' }).or(card.getByRole('gridcell', { name: '3000' })).first().waitFor({ timeout: 5000 })
    assert.deepEqual(problems, [], 'sales organizations console')
  } finally {
    await context.close()
  }
})

/* How the screen looks is the SC's preference, not the ERP's setup: it lives behind a user
   menu at the end of the shell bar, where Fiori (user menu > Settings > Appearance) and
   Business Central (My Settings) keep it. The ERP has no sign-in, so the button names nobody.
   The hex comes from lib/appearance.js, the catalog the screen paints from. */
const { PALETTES } = require('../lib/appearance')
const accentOf = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
/** The accent once it reads `want` (a repaint lands a frame or two after the click), or what it reads after 5 s. */
async function accentBecomes (page, want) {
  await page.waitForFunction((hex) => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === hex, want, { timeout: 5000 }).catch(() => {})
  return accentOf(page)
}
const ACCENT = Object.fromEntries(Object.entries(PALETTES).map(([id, p]) => [id, p.tokens['--accent']]))

async function openAppearance (page) {
  await page.locator('.erp-shellbar').getByRole('button', { name: 'User menu' }).click()
  await page.getByRole('menuitem', { name: 'Appearance' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 5000 })
  return dialog
}

test('the shell bar ends in a user menu that names nobody and offers Appearance', async () => {
  const { page, context, problems } = await open('home')
  try {
    const button = page.locator('.erp-shellbar').getByRole('button', { name: 'User menu' })
    assert.equal((await button.textContent()).trim(), '', 'no name and no initials')
    await button.click()
    await page.getByRole('menu').waitFor({ timeout: 5000 })
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Appearance'])
    assert.deepEqual(problems, [], 'user menu console')
  } finally {
    await context.close()
  }
})

test('a pick repaints the screen before Save; Cancel, or Escape, puts the saved look back', async () => {
  const { page, context, problems } = await open('home')
  try {
    assert.equal(await accentBecomes(page, ACCENT.teal), ACCENT.teal)
    const dialog = await openAppearance(page)
    await dialog.getByRole('button', { name: 'Plum', exact: true }).click()
    assert.equal(await accentBecomes(page, ACCENT.plum), ACCENT.plum, 'the colour shows before Save')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'detached', timeout: 5000 })
    assert.equal(await accentBecomes(page, ACCENT.teal), ACCENT.teal, 'Cancel restores')

    const again = await openAppearance(page)
    await again.locator('.erp-theme-card', { hasText: 'Meridian' }).click()
    assert.equal(await accentBecomes(page, ACCENT.indigo), ACCENT.indigo)
    await page.locator('.erp-topnav').waitFor({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await again.waitFor({ state: 'detached', timeout: 5000 })
    assert.equal(await accentBecomes(page, ACCENT.teal), ACCENT.teal, 'closing restores')
    await page.locator('.erp-rail').waitFor({ timeout: 5000 })
    assert.deepEqual(problems, [], 'appearance preview console')
  } finally {
    await context.close()
  }
})

test('the panel offers the mark and the menu too, and shows the four themes in one row', async () => {
  const { page, context, problems } = await open('home')
  try {
    const dialog = await openAppearance(page)
    const tops = await dialog.locator('.erp-theme-card').evaluateAll((cards) => cards.map((c) => c.getBoundingClientRect().top))
    assert.equal(tops.length, 4)
    assert.equal(new Set(tops).size, 1, 'one row')
    await dialog.getByRole('radio', { name: 'Top band' }).click()
    await page.locator('.erp-topnav').waitFor({ timeout: 5000 })
    const orbit = dialog.getByRole('button', { name: 'orbit', exact: true })
    await orbit.click()
    assert.equal(await orbit.getAttribute('aria-pressed'), 'true')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'detached', timeout: 5000 })
    await page.locator('.erp-rail').waitFor({ timeout: 5000 })
    assert.deepEqual(problems, [], 'appearance mark and menu console')
  } finally {
    await context.close()
  }
})

test('Save keeps a theme and the colour picked after it: the ERP stores it and health brings it back', async () => {
  const { page, context, problems } = await open('home')
  try {
    const dialog = await openAppearance(page)
    await dialog.locator('.erp-theme-card', { hasText: 'Meridian' }).click()
    await dialog.getByRole('button', { name: 'Plum', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await dialog.waitFor({ state: 'detached', timeout: 5000 })
    // The panel is gone, so the look is health's again: plum on Meridian's top band.
    assert.equal(await accentBecomes(page, ACCENT.plum), ACCENT.plum)
    await page.locator('.erp-topnav').waitFor({ timeout: 5000 })
    const reopened = await openAppearance(page)
    assert.equal(await reopened.getByRole('button', { name: 'Plum', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.deepEqual(problems, [], 'appearance save console')
  } finally {
    await context.close()
  }
})

test('a save refusal shows in the panel in the ERP\'s words, and the panel stays open', async () => {
  const { page, context } = await open('home', '?refuse-appearance')
  try {
    const dialog = await openAppearance(page)
    await dialog.getByRole('button', { name: 'Bronze', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await dialog.getByText('The ERP did not keep the appearance. Try again in a moment.').waitFor({ timeout: 5000 })
    assert.equal(await dialog.isVisible(), true)
    assert.equal(await accentBecomes(page, ACCENT.bronze), ACCENT.bronze, 'what was picked is still showing')
  } finally {
    await context.close()
  }
})

test('in a maintenance window the banner names its end, on any page', async () => {
  const { page, context, problems } = await open('home', '?maintenance')
  try {
    const banner = page.locator('.erp-maintenance-banner')
    await banner.waitFor({ timeout: 5000 })
    assert.match(await banner.textContent(), /is in maintenance until \d\d:\d\d UTC\./)
    assert.deepEqual(problems, [], 'maintenance console')
  } finally {
    await context.close()
  }
})

/* Return orders and credit memos (AB-16e screen slice). The preview seeds, on sales order
   0000001002: return 6000000001 credited by credit memo 9500000001, 6000000002 received,
   6000000003 open; and sales order 0000001008, whose invoice 9000000002 was credited whole
   by credit memo 9500000002. */

/** The buttons on a document's title line. */
async function actionsOf (page) {
  return page.locator('.erp-page-actions button').allTextContents()
}

test('an open return order offers Receive; receiving it turns the offer into Post credit memo', async () => {
  const { page, context, problems } = await open('returns?open=6000000003')
  try {
    await headed(page, /^Return Order 6000000003$/, /^Returns$/)
    assert.deepEqual(await actionsOf(page), ['Receive'])
    const text = await page.locator('.erp-content').textContent()
    assert.match(text, /Open/)
    assert.match(text, /Customer return reference9/, "the customer's reference for the return")
    assert.match(text, /Damaged/, 'a line carries its reason')
    await page.getByRole('button', { name: 'Receive' }).click()
    await page.getByRole('button', { name: 'Post credit memo' }).waitFor({ timeout: 5000 })
    assert.deepEqual(await actionsOf(page), ['Post credit memo'])
    assert.match(await page.locator('.erp-content').textContent(), /Received/)
    assert.deepEqual(problems, [], 'return console')
  } finally {
    await context.close()
  }
})

test('a received return order posts its credit memo after a confirmation, and then offers nothing', async () => {
  const { page, context, problems } = await open('returns?open=6000000002')
  try {
    await headed(page, /^Return Order 6000000002$/, /^Returns$/)
    assert.deepEqual(await actionsOf(page), ['Post credit memo'])
    await page.getByRole('button', { name: 'Post credit memo' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Post credit memo' }).click()
    // The header line and the timeline both say it; the header is enough to wait on.
    await page.getByText(/Credited by credit memo 9500000003/).first().waitFor({ timeout: 5000 })
    assert.deepEqual(await actionsOf(page), [])
    assert.deepEqual(problems, [], 'credit console')
  } finally {
    await context.close()
  }
})

test('a credited return order links its sales order and its credit memo, which opens', async () => {
  const { page, context, problems } = await open('returns?open=6000000001')
  try {
    await headed(page, /^Return Order 6000000001$/, /^Returns$/)
    assert.deepEqual(await actionsOf(page), [])
    const text = await page.locator('.erp-content').textContent()
    assert.match(text, /Sales order 0000001002/)
    assert.match(text, /Timeline/)
    assert.match(text, /Received/)
    await page.locator('.erp-doc-open', { hasText: 'Credit memo 9500000001' }).click()
    await settled(page)
    assert.match((await page.textContent('.erp-content h1')).trim(), /^Credit Memo 9500000001$/)
    const memo = await page.locator('.erp-content').textContent()
    assert.match(memo, /Invoice/)
    assert.match(memo, /9000000001/)
    assert.match(memo, /6000000001/)
    assert.match(memo, /Net amount/)
    assert.deepEqual(problems, [], 'return → credit memo console')
  } finally {
    await context.close()
  }
})

test('an invoice offers Post credit memo, and a refusal is shown in the ERP\'s own words', async () => {
  const { page, context } = await open('invoices?open=9000000001')
  try {
    await headed(page, /^Invoice 9000000001$/, /^Invoices$/)
    // Version 14: something is still open on it, so Post payment is offered first.
    assert.deepEqual(await actionsOf(page), ['Post payment', 'Post credit memo'])
    assert.doesNotMatch(await page.locator('.erp-content').textContent(), /No action yet/)
    await page.getByRole('button', { name: 'Post credit memo' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Post credit memo' }).click()
    await page.getByText('Return order 6000000001 credited part of this invoice (credit memo 9500000001); credit the rest by return.').waitFor({ timeout: 5000 })
  } finally {
    await context.close()
  }
})

test('a credited invoice offers no credit and says which credit memo credited it, which opens', async () => {
  const { page, context, problems } = await open('invoices?open=9000000002')
  try {
    await headed(page, /^Invoice 9000000002$/, /^Invoices$/)
    assert.deepEqual(await actionsOf(page), [])
    await page.getByRole('button', { name: '9500000002' }).click()
    await settled(page)
    assert.match((await page.textContent('.erp-content h1')).trim(), /^Credit Memo 9500000002$/)
    assert.deepEqual(problems, [], 'credited invoice console')
  } finally {
    await context.close()
  }
})

test('the sales order shows its return orders and credit memos among its related documents', async () => {
  const { page, context, problems } = await open('orders?open=0000001002')
  try {
    await headed(page, /^Sales Order 0000001002$/, /^Sales Orders$/)
    const related = await page.locator('.erp-doc-flow').textContent()
    for (const doc of ['Return order 6000000001', 'Return order 6000000002', 'Return order 6000000003', 'Credit memo 9500000001']) assert.match(related, new RegExp(doc))
    await page.locator('.erp-doc-open', { hasText: 'Return order 6000000003' }).click()
    await settled(page)
    assert.match((await page.textContent('.erp-content h1')).trim(), /^Return Order 6000000003$/)
    assert.deepEqual(problems, [], 'order → return console')
  } finally {
    await context.close()
  }
})

test('the return list filters to what a cue counted, and the lists name the sold-to', async () => {
  const { page, context, problems } = await open('returns?work=open')
  try {
    assert.equal(await bodyRows(page), 1)
    const header = await page.locator('[role="columnheader"]').allTextContents()
    assert.ok(header.includes('Sales order') && header.includes('Sold-to') && header.includes('Lines'), `returns: ${header.join(' | ')}`)
    assert.deepEqual(problems, [], 'returns list console')
  } finally {
    await context.close()
  }
  const memos = await open('creditMemos')
  try {
    const header = await memos.page.locator('[role="columnheader"]').allTextContents()
    assert.ok(header.includes('Invoice') && header.includes('Return order') && header.includes('Total'), `credit memos: ${header.join(' | ')}`)
  } finally {
    await memos.context.close()
  }
})

test('the shell search opens a return order and a credit memo by number', async () => {
  const { page, context, problems } = await open('home')
  try {
    const box = page.getByRole('combobox', { name: 'Search the ERP' })
    await box.fill('6000000003')
    const option = page.getByRole('option', { name: /Return Order 6000000003/ })
    await option.waitFor({ timeout: 5000 })
    await option.click()
    await settled(page)
    assert.equal(new URL(page.url()).hash, '#returns?open=6000000003')
    await box.fill('9500000002')
    const memo = page.getByRole('option', { name: /Credit Memo 9500000002/ })
    await memo.waitFor({ timeout: 5000 })
    await memo.click()
    await settled(page)
    assert.equal(new URL(page.url()).hash, '#creditMemos?open=9500000002')
    assert.match((await page.textContent('.erp-content h1')).trim(), /^Credit Memo 9500000002$/)
    assert.deepEqual(problems, [], 'search console')
  } finally {
    await context.close()
  }
})

test('the journal names a received return and a credit memo', async () => {
  const { page, context } = await open('events')
  try {
    const text = await page.locator('.erp-rows-open').textContent()
    assert.match(text, /Return order 6000000002 received/)
    assert.match(text, /Credit memo 9500000001 for sales order 0000001002 \(return order 6000000001\)/)
  } finally {
    await context.close()
  }
})

/* Open items and incoming payments (AB-26s screen slice). The preview seeds invoice
   9000000001 partly paid by payment 7000000001 (EUR 100.00 of 256.00, with return credit
   memo 9500000001 of 12.00 off it: 144.00 open) and invoice 9000000003 paid in full by
   payment 7000000002. */

test('a partly paid invoice shows what is open and offers Post payment, prefilled with the open amount', async () => {
  const { page, context, problems } = await open('invoices?open=9000000001')
  try {
    await headed(page, /^Invoice 9000000001$/, /^Invoices$/)
    assert.deepEqual(await actionsOf(page), ['Post payment', 'Post credit memo'])
    const text = await page.locator('.erp-content').textContent()
    assert.match(text, /Payment status/)
    assert.match(text, /Partly paid/)
    assert.match(text, /Open amount\s*EUR\s*144\.00/)
    assert.match(await page.locator('.erp-doc-flow').textContent(), /Payment 7000000001/)
    await page.getByRole('button', { name: 'Post payment' }).click()
    const amount = page.getByRole('dialog').getByRole('textbox', { name: 'Amount' })
    assert.match(await amount.inputValue(), /144\.00/)
    assert.deepEqual(problems, [], 'invoice console')
  } finally {
    await context.close()
  }
})

test('a payment over the open amount is refused in the ERP\'s words; the rest paid, the invoice reads paid', async () => {
  const { page, context, problems } = await open('invoices?open=9000000001')
  try {
    await headed(page, /^Invoice 9000000001$/, /^Invoices$/)
    await page.getByRole('button', { name: 'Post payment' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Amount' }).fill('1000')
    await dialog.getByRole('textbox', { name: 'Reference' }).fill('Wire 77')
    await dialog.getByRole('button', { name: 'Post payment' }).click()
    await page.getByText('Invoice 9000000001 has 144.00 open; a payment of 1,000.00 is more than that.').waitFor({ timeout: 5000 })
    // Now the whole open amount, as prefilled.
    await page.getByRole('button', { name: 'Post payment' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Post payment' }).click()
    await page.locator('.erp-doc-flow', { hasText: 'Payment 7000000003' }).waitFor({ timeout: 5000 })
    assert.deepEqual(await actionsOf(page), ['Post credit memo'])
    assert.match(await page.locator('.erp-content').textContent(), /Paid/)
    assert.deepEqual(problems, [], 'payment console')
  } finally {
    await context.close()
  }
})

test('a paid invoice offers no payment, and its payment opens as a document of its own', async () => {
  const { page, context, problems } = await open('invoices?open=9000000003')
  try {
    await headed(page, /^Invoice 9000000003$/, /^Invoices$/)
    assert.ok(!(await actionsOf(page)).includes('Post payment'))
    // Its order was paid by card at checkout (contract version 18): the invoice says so.
    assert.match(await page.locator('.erp-content').textContent(), /Paid by card · Visa ending 4242 · reference 8FK21345TX901234A/)
    await page.locator('.erp-doc-open', { hasText: 'Payment 7000000002' }).click()
    await settled(page)
    assert.match((await page.textContent('.erp-content h1')).trim(), /^Payment 7000000002$/)
    const text = await page.locator('.erp-content').textContent()
    assert.match(text, /9000000003/)
    assert.match(text, /Web shop · Visa ending 4242 · 8FK21345TX901234A/)
    assert.match(text, /USD\s*199\.40/)
    assert.deepEqual(problems, [], 'paid invoice → payment console')
  } finally {
    await context.close()
  }
})

test('the invoice list says what is open and filters to what the cue counted', async () => {
  const { page, context, problems } = await open('invoices?work=toCollect')
  try {
    assert.equal(await bodyRows(page), 1)
    const header = await page.locator('[role="columnheader"]').allTextContents()
    assert.ok(header.includes('Open amount') && header.includes('Payment status'), `invoices: ${header.join(' | ')}`)
    assert.match(await page.locator('[role="grid"]').textContent(), /9000000001/)
    assert.deepEqual(problems, [], 'invoice list console')
  } finally {
    await context.close()
  }
})

test('the customer page splits exposure into open orders and open items, and lists the open items', async () => {
  const { page, context, problems } = await open('partners?open=C000103')
  try {
    await headed(page, /^Fabrikam Retail$/, /^Customers$/)
    const text = await page.locator('.erp-content').textContent()
    assert.match(text, /Open orders/)
    assert.match(text, /1 open item · EUR\s*144\.00 — invoiced, not yet paid\./)
    const items = page.locator('[role="grid"][aria-label="This customer\'s open items"]')
    assert.match(await items.textContent(), /9000000001/)
    assert.match(await items.textContent(), /Partly paid/)
    await items.locator('.erp-key', { hasText: '9000000001' }).click()
    await settled(page)
    assert.match((await page.textContent('.erp-content h1')).trim(), /^Invoice 9000000001$/)
    assert.deepEqual(problems, [], 'customer open items console')
  } finally {
    await context.close()
  }
})

test('the shell search opens a payment by number, and the sales order shows it in its flow', async () => {
  const { page, context, problems } = await open('home')
  try {
    const box = page.getByRole('combobox', { name: 'Search the ERP' })
    await box.fill('7000000002')
    const option = page.getByRole('option', { name: /Payment 7000000002/ })
    await option.waitFor({ timeout: 5000 })
    await option.click()
    await settled(page)
    assert.equal(new URL(page.url()).hash, '#payments?open=7000000002')
    assert.match((await page.textContent('.erp-content h1')).trim(), /^Payment 7000000002$/)
    assert.deepEqual(problems, [], 'search console')
  } finally {
    await context.close()
  }
  const order = await open('orders?open=0000001009')
  try {
    await headed(order.page, /^Sales Order 0000001009$/, /^Sales Orders$/)
    assert.match(await order.page.locator('.erp-doc-flow').textContent(), /Payment 7000000002/)
    assert.match(await order.page.locator('.erp-content').textContent(), /Payment 7000000002 posted/)
  } finally {
    await order.context.close()
  }
})

test('the journal names a posted payment', async () => {
  const { page, context } = await open('events')
  try {
    assert.match(await page.locator('.erp-rows-open').textContent(), /Payment 7000000001 of EUR 100\.00 against invoice 9000000001 for sales order 0000001002/)
  } finally {
    await context.close()
  }
})

/* ---- The process flow strip (screen/src/components/ProcessFlow.js, orderFlow.js) ---- */

test('a sales order opens with its process flow: one stage is current, a done stage opens its document', async () => {
  const { page, context, problems } = await open('orders?open=0000001003')
  try {
    await headed(page, /^Sales Order 0000001003$/, /^Sales Orders$/)
    const flow = page.locator('.erp-flow')
    assert.equal(await flow.count(), 1)
    assert.deepEqual(await flow.locator('ol > li .erp-flow-label').allTextContents(), ['Received', 'Confirmed', 'Delivery created', 'Goods issued', 'Invoiced', 'Paid'])
    const current = flow.locator('[aria-current="step"]')
    assert.equal(await current.count(), 1)
    assert.match(await current.textContent(), /Goods issued.*4 of 6 shipped/)
    // The next move, posting shipment 8000000004, is the page's own button now: no line under the strip.
    assert.equal(await flow.locator('.erp-flow-next').count(), 0)
    // The strip sits between the title line and the header fields.
    const [title, strip, header] = await Promise.all(['.erp-page-header', '.erp-flow', '.erp-card'].map((s) => page.locator(s).first().boundingBox()))
    assert.ok(title.y < strip.y && strip.y < header.y, 'title line, then the strip, then the header card')
    await flow.getByRole('button', { name: /Delivery created/ }).click()
    await settled(page)
    assert.match((await page.textContent('.erp-content h1')).trim(), /^Shipment 8000000003$/)
    assert.deepEqual(problems, [], 'order flow console')
  } finally {
    await context.close()
  }
})

/* The order page's main button is the next step, even when that step is made on another
   document (owner 2026-10-09): Post shipment for the shipment waiting to be posted, Post
   payment for an invoice with money open. Sales order 0000001003 has shipment 8000000004 open
   for 1 of item 20's 2; 0000001002's invoice 9000000001 has EUR 144.00 open. */

test('an order with a shipment waiting offers Post shipment, not Create shipment; posting it offers Create shipment for the rest', async () => {
  const { page, context, problems } = await open('orders?open=0000001003', '', { width: 1280, height: 900 })
  try {
    await headed(page, /^Sales Order 0000001003$/, /^Sales Orders$/)
    assert.deepEqual(await actionsOf(page), ['Post shipment 8000000004'])
    // The new button sits inside the window at 1,280 px, not pushed past its edge.
    const box = await page.getByRole('button', { name: 'Post shipment 8000000004' }).boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 1280, `button at ${box.x}+${box.width}`)
    await page.getByRole('button', { name: 'Post shipment 8000000004' }).click()
    const flow = page.locator('.erp-flow')
    await flow.locator('[aria-current="step"]', { hasText: '5 of 6 shipped' }).waitFor({ timeout: 5000 })
    // One unit of item 20 is on no shipment: creating one for it is the next step.
    assert.deepEqual(await actionsOf(page), ['Create shipment'])
    assert.equal(await flow.locator('.erp-flow-next').count(), 0)
    assert.deepEqual(problems, [], 'post shipment from the order console')
  } finally {
    await context.close()
  }
})

test('Close on a line offers only what no shipment covers: 1 of item 20, since its other unit waits on shipment 8000000004', async () => {
  const { page, context, problems } = await open('orders?open=0000001003')
  try {
    await headed(page, /^Sales Order 0000001003$/, /^Sales Orders$/)
    // Item 10 has shipped whole: no Close on it.
    assert.equal(await page.getByRole('button', { name: 'Close remaining quantity on line 10' }).count(), 0)
    await page.getByRole('button', { name: 'Close remaining quantity on line 20' }).click()
    const dialog = page.getByRole('dialog')
    assert.match(await dialog.getByRole('heading').first().textContent(), /^Close 1 EA on Item 20\?$/)
    await dialog.getByRole('button', { name: 'Close remaining' }).click()
    await page.getByRole('button', { name: 'Close remaining quantity on line 20' }).waitFor({ state: 'detached', timeout: 5000 })
    // The waiting shipment still carries its unit, and is still the next step.
    assert.deepEqual(await actionsOf(page), ['Post shipment 8000000004'])
    assert.deepEqual(problems, [], 'close with a shipment waiting console')
  } finally {
    await context.close()
  }
})

test('canceling an order with a shipment waiting says the shipment is removed, and removes it', async () => {
  const { page, context, problems } = await open('orders?open=0000001001')
  try {
    await headed(page, /^Sales Order 0000001001$/, /^Sales Orders$/)
    await page.getByRole('button', { name: 'Create shipment' }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^Create shipment/ }).click()
    await page.getByRole('button', { name: /^Post shipment \d{10}$/ }).waitFor({ timeout: 5000 })
    const waiting = (await page.getByRole('button', { name: /^Post shipment \d{10}$/ }).textContent()).replace('Post shipment ', '')
    await page.getByRole('button', { name: 'Cancel order' }).click()
    const dialog = page.getByRole('dialog')
    assert.match(await dialog.textContent(), new RegExp(`Shipment ${waiting} is waiting to be posted; it is removed too, since nothing has left\\.`))
    await dialog.getByRole('button', { name: 'Cancel order' }).click()
    await page.getByText(`Order canceled — shipment ${waiting} removed`).waitFor({ timeout: 5000 })
    const timeline = await page.locator('.erp-content').textContent()
    assert.match(timeline, new RegExp(`Canceled — Customer request\\. Shipment ${waiting} removed: nothing had left\\.`))
    assert.deepEqual(await actionsOf(page), ['Repeat order'])
    assert.deepEqual(problems, [], 'cancel with a shipment waiting console')
  } finally {
    await context.close()
  }
})

test('an invoiced order with money open offers Post payment, prefilled with the open amount, and posts it on the invoice', async () => {
  const { page, context, problems } = await open('orders?open=0000001002', '', { width: 1280, height: 900 })
  try {
    await headed(page, /^Sales Order 0000001002$/, /^Sales Orders$/)
    assert.deepEqual(await actionsOf(page), ['Post payment'])
    assert.equal(await page.locator('.erp-flow-next').count(), 0)
    await page.getByRole('button', { name: 'Post payment' }).click()
    const dialog = page.getByRole('dialog')
    assert.match(await dialog.getByRole('textbox', { name: 'Amount' }).inputValue(), /144\.00/)
    await dialog.getByRole('button', { name: 'Post payment' }).click()
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('.erp-page-actions button')).some((b) => b.textContent === 'Post payment'), null, { timeout: 5000 })
    assert.deepEqual(await actionsOf(page), [])
    assert.deepEqual(problems, [], 'post payment from the order console')
  } finally {
    await context.close()
  }
})

test('an order on credit hold stands at its credit check with no line under the strip (Release and Reject are on the page); releasing it moves the strip on', async () => {
  const { page, context, problems } = await open('orders?open=0000001007')
  try {
    await headed(page, /^Sales Order 0000001007$/, /^Sales Orders$/)
    const flow = page.locator('.erp-flow')
    const current = flow.locator('[aria-current="step"]')
    assert.equal(await current.count(), 1)
    assert.match(await current.textContent(), /Credit check.*On hold/)
    assert.match(await current.getAttribute('class'), /erp-flow-attention/)
    assert.equal(await flow.locator('.erp-flow-next').count(), 0)
    // The strip is the whole band (its 1px border above and below): no empty line where a hint would be.
    const [band, stages] = await Promise.all([flow.boundingBox(), flow.locator('ol').boundingBox()])
    assert.equal(Math.round(band.height - stages.height), 2, `band ${band.height} vs stages ${stages.height}`)
    await page.getByRole('button', { name: 'Release' }).click()
    await flow.locator('[aria-current="step"]', { hasText: 'Confirmed' }).waitFor({ timeout: 5000 })
    assert.match(await flow.textContent(), /Credit check.*Released/)
    assert.equal(await flow.locator('.erp-flow-next').count(), 0)
    assert.deepEqual(problems, [], 'held order flow console')
  } finally {
    await context.close()
  }
})

test('a canceled order ends at Canceled, with no stage current and no line under the strip', async () => {
  const { page, context, problems } = await open('orders?open=0000001004')
  try {
    await headed(page, /^Sales Order 0000001004$/, /^Sales Orders$/)
    const flow = page.locator('.erp-flow')
    assert.deepEqual(await flow.locator('ol > li .erp-flow-label').allTextContents(), ['Received', 'Canceled'])
    assert.equal(await flow.locator('[aria-current="step"]').count(), 0)
    assert.equal(await flow.locator('.erp-flow-next').count(), 0)
    assert.deepEqual(problems, [], 'canceled order flow console')
  } finally {
    await context.close()
  }
})

test('a return order has its own strip: created, goods received, credited', async () => {
  const { page, context, problems } = await open('returns?open=6000000002')
  try {
    await headed(page, /^Return Order 6000000002$/, /^Returns$/)
    const flow = page.locator('.erp-flow')
    assert.deepEqual(await flow.locator('ol > li .erp-flow-label').allTextContents(), ['Return created', 'Goods received', 'Credited'])
    assert.match(await flow.locator('[aria-current="step"]').textContent(), /Credited/)
    // Post credit memo is a button on this page, so the strip carries no line.
    assert.equal(await flow.locator('.erp-flow-next').count(), 0)
    assert.deepEqual(problems, [], 'return flow console')
  } finally {
    await context.close()
  }
})

test('at 1,280 px with the side menu, a returned and credited order\'s strip fits its band in one row', async () => {
  const { page, context } = await open('orders?open=0000001002', '', NARROW)
  try {
    await headed(page, /^Sales Order 0000001002$/, /^Sales Orders$/)
    const measured = await page.evaluate(() => {
      const strip = document.querySelector('.erp-flow ol')
      const tops = [...strip.children].map((li) => Math.round(li.getBoundingClientRect().top))
      return { stages: strip.children.length, rows: new Set(tops).size, stripScrolls: strip.scrollWidth > strip.clientWidth }
    })
    assert.deepEqual(measured, { stages: 8, rows: 1, stripScrolls: false })
  } finally {
    await context.close()
  }
})

test('on a narrow window the strip stays one row and scrolls inside its band, not the page', async () => {
  const { page, context } = await open('orders?open=0000001002')
  try {
    await headed(page, /^Sales Order 0000001002$/, /^Sales Orders$/)
    await page.setViewportSize({ width: 900, height: 900 })
    await page.waitForTimeout(300)
    const measured = await page.evaluate(() => {
      const strip = document.querySelector('.erp-flow ol')
      const content = document.querySelector('.erp-content')
      const tops = [...strip.children].map((li) => Math.round(li.getBoundingClientRect().top))
      return { stages: strip.children.length, rows: new Set(tops).size, stripScrolls: strip.scrollWidth > strip.clientWidth, pageOverflows: content.scrollWidth > content.clientWidth }
    })
    assert.deepEqual(measured, { stages: 8, rows: 1, stripScrolls: true, pageOverflows: false })
  } finally {
    await context.close()
  }
})
