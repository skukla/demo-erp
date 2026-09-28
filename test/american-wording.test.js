/*
 * The words a person reads are American English: the audience is American (owner,
 * 2026-09-28). Stored values, field names, event names and the contract stay as they
 * are — `cancelled` is a status value other programs compare, and "Cancelled in Commerce"
 * is a reason the integration sends — so those are given a display word instead.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { memoryCollections } = require('./helpers/memory-db')
const { createOrder, setStatus } = require('../lib/orders')
const { cancelOrder, confirmOrder } = require('../lib/fulfilment')
const { importProducts } = require('../lib/products')
const { recent } = require('../lib/events')
const { describeEvent, KIND_NAMES } = require('../lib/journal')

const displayWords = () => import('../screen/src/displayWords.js')

/* British spellings, each as a whole word. A camelCase identifier (OrganisationCard) is
   code, not text, so a letter right after the word excludes it. */
const BRITISH = /(?<![A-Za-z])(organisations?|colours?|coloured|catalogues?|behaviours?|centres?|licences?|favou?rs?|recognis\w+|analys(?:e|ed|es|ing)|labelled|modelled|cancelled|cancelling|grey)(?![A-Za-z])/gi

/* The cancel reason the integration sends, pinned by the contract. */
const STORED_REASON = 'Cancelled in Commerce'

/* A stored value or a key — compared by code, never shown as it stands. */
function isValue (source, index, word) {
  const before = source[index - 1]
  const after = source[index + word.length]
  if (before === "'" && after === "'") return true
  if (after === ':') return true
  if (source.startsWith(`'${STORED_REASON}'`, index - 1)) return true
  return source.slice(index - 6, index) === 'order.'
}

function stripComments (source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '')
}

function screenFiles (dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return screenFiles(full)
    return entry.name.endsWith('.js') ? [full] : []
  })
}

/** Every British word in a file's code (not its comments), other than stored values. */
function britishIn (file) {
  const source = stripComments(fs.readFileSync(file, 'utf8'))
  const found = []
  for (const match of source.matchAll(BRITISH)) {
    if (!isValue(source, match.index, match[0])) found.push(match[0])
  }
  return found
}

test('the scan finds a British word it is shown (positive control)', () => {
  const sample = "const a = 'x'\n<Field label='Sales organisation'>Colour</Field>\n"
  const found = [...stripComments(sample).matchAll(BRITISH)].map((m) => m[0])
  assert.deepEqual(found, ['organisation', 'Colour'])
})

test('the screen shows no British spelling', () => {
  const root = path.join(__dirname, '..', 'screen', 'src')
  const files = screenFiles(root)
  assert.ok(files.length > 20, `read the screen's files (${files.length})`)
  const offenders = files
    .map((file) => [path.relative(root, file), britishIn(file)])
    .filter(([, words]) => words.length > 0)
  assert.deepEqual(offenders, [])
})

test('a stored British word is shown American, and anything else as it stands', async () => {
  const { displayWord } = await displayWords()
  assert.equal(displayWord('Cancelled'), 'Canceled')
  assert.equal(displayWord('Cancelled in Commerce'), 'Canceled in Commerce')
  assert.equal(displayWord('Out of stock'), 'Out of stock')
  assert.equal(displayWord(undefined), undefined)
})

test('the Event Journal names a cancellation in American words, its stored reason included', () => {
  assert.equal(KIND_NAMES['order.cancelled'], 'Order canceled')
  const out = (value) => ({ direction: 'out', kind: 'order.cancelled', value })
  assert.equal(describeEvent(out({ erpNumber: '0000001001', reason: 'Out of stock' })).text, 'Sales order 0000001001 canceled: Out of stock')
  assert.equal(describeEvent(out({ erpNumber: '0000001001', reason: 'Cancelled in Commerce' })).text, 'Sales order 0000001001 canceled: Canceled in Commerce')
})

test('the API refuses a canceled order, and a cancel after an invoice, in American words', async () => {
  const cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  const gone = await createOrder(cols, { commerceOrderId: '1', lines: [{ sku: 'A1', qty: 1, price: 10 }] })
  await setStatus(cols, gone.number, 'cancelled', undefined, { reason: 'Out of stock' })
  await assert.rejects(() => confirmOrder(cols, gone.number), /^Error: This order was canceled on /)

  const billed = await confirmOrder(cols, (await createOrder(cols, { commerceOrderId: '2', lines: [] })).number)
  const stored = await cols.salesOrders.findOne({ _id: billed.number })
  await cols.salesOrders.replaceOne({ _id: billed.number }, { ...stored, invoice: { number: '9000000001' } })
  await assert.rejects(() => cancelOrder(cols, billed.number, 'Out of stock'), { message: 'This order was invoiced (9000000001) and cannot be canceled.' })
})

test('a cancellation from Commerce is journaled in American words', async () => {
  const cols = memoryCollections()
  const order = await createOrder(cols, { commerceOrderId: '3', lines: [] })
  const origin = { origin: { event: 'observer.sales_order_save_commit_after', eventId: 'evt-1' } }
  await cancelOrder(cols, order.number, 'Cancelled in Commerce', undefined, origin)
  const entry = (await recent(cols)).find((e) => e.direction === 'in')
  assert.equal(entry.summary, `Sales order ${order.number} canceled in Commerce`)
})
