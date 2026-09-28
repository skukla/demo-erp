/*
 * The words a person reads are American English: the audience is American (owner,
 * 2026-09-28). So are the values the ERP and the integration exchange (contract version 10):
 * the status `canceled`, the event kind `order.canceled` and the reason "Canceled in
 * Commerce". The British spellings are refused on the wire; orders and journal entries
 * stored with them before version 10 read as the American ones.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { memoryCollections } = require('./helpers/memory-db')
const { createOrder, setStatus, getOrder, listOrders, overallStatus } = require('../lib/orders')
const { cancelOrder, confirmOrder } = require('../lib/fulfilment')
const { importProducts } = require('../lib/products')
const { importPartners, describePartner } = require('../lib/partners')
const { EVENT_NAMES, recent, pending, retryPending } = require('../lib/events')
const { describeEvent, KIND_NAMES } = require('../lib/journal')

/* British spellings, each as a whole word. A camelCase identifier (OrganisationCard) is
   code, not text, so a letter right after the word excludes it. */
const BRITISH = /(?<![A-Za-z])(organisations?|colours?|coloured|catalogues?|behaviours?|centres?|licences?|favou?rs?|recognis\w+|analys(?:e|ed|es|ing)|labelled|modelled|cancelled|cancelling|grey)(?![A-Za-z])/gi

/* A key — compared by code, never shown as it stands. */
function isValue (source, index, word) {
  return source[index + word.length] === ':'
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

test('the values the ERP exchanges are American: canceled, order.canceled, Canceled in Commerce', async () => {
  assert.ok(EVENT_NAMES['order.canceled'])
  assert.equal(EVENT_NAMES['order.cancelled'], undefined)
  assert.equal(KIND_NAMES['order.canceled'], 'Order canceled')

  const cols = memoryCollections()
  const order = await createOrder(cols, { commerceOrderId: '1', lines: [] })
  await setStatus(cols, order.number, 'confirmed')
  const gone = await setStatus(cols, order.number, 'canceled', undefined, { reason: 'Out of stock' })
  assert.equal(gone.header, 'canceled')
  assert.equal(gone.status, 'canceled')
  assert.equal(gone.history.at(-1).status, 'canceled')
  const event = (await pending(cols)).find((e) => e.event === 'be-observer.sales_order_cancel')
  assert.equal(event.kind, 'order.canceled')
  assert.equal(event.value.status, 'canceled')

  const fromCommerce = await createOrder(cols, { commerceOrderId: '2', lines: [] })
  const origin = { origin: { event: 'observer.sales_order_save_commit_after' } }
  const canceled = await cancelOrder(cols, fromCommerce.number, 'Canceled in Commerce', undefined, origin)
  assert.equal(canceled.cancelReason, 'Canceled in Commerce')
})

test('the British spellings are refused on the wire, not read as the American ones', async () => {
  const cols = memoryCollections()
  const order = await createOrder(cols, { commerceOrderId: '1', lines: [] })
  await assert.rejects(() => setStatus(cols, order.number, 'cancelled', undefined, { reason: 'Out of stock' }), /status must be one of created, confirmed, shipped, invoiced, canceled/)
  await assert.rejects(() => cancelOrder(cols, order.number, 'Cancelled in Commerce'), /needs one of these reasons/)
  assert.equal((await getOrder(cols, order.number)).header, 'created')
})

test('the Event Journal names a cancellation in American words', () => {
  const out = (value) => ({ direction: 'out', kind: 'order.canceled', value })
  assert.equal(describeEvent(out({ erpNumber: '0000001001', reason: 'Out of stock' })).text, 'Sales order 0000001001 canceled: Out of stock')
  assert.equal(describeEvent(out({ erpNumber: '0000001001', reason: 'Canceled in Commerce' })).text, 'Sales order 0000001001 canceled: Canceled in Commerce')
})

test('the API refuses a canceled order, and a cancel after an invoice, in American words', async () => {
  const cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  const gone = await createOrder(cols, { commerceOrderId: '1', lines: [{ sku: 'A1', qty: 1, price: 10 }] })
  await setStatus(cols, gone.number, 'canceled', undefined, { reason: 'Out of stock' })
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
  await cancelOrder(cols, order.number, 'Canceled in Commerce', undefined, origin)
  const entry = (await recent(cols)).find((e) => e.direction === 'in')
  assert.equal(entry.summary, `Sales order ${order.number} canceled in Commerce`)
})

test("an order's overall status word is American English in the API itself (owner, 2026-09-28)", () => {
  assert.equal(overallStatus({ header: 'canceled' }), 'Canceled')
})

/* An order an ERP stored before contract version 10, canceled from Commerce: every British
   value it can hold. */
const OLD_ORDER = {
  _id: '0000001001',
  number: '0000001001',
  commerceOrderId: '7',
  partnerId: 'C1',
  lines: [{ sku: 'A1', qty: 2, price: 10, item: 10, shippedQty: 0, closedQty: 0 }],
  header: 'cancelled',
  status: 'cancelled',
  cancelReason: 'Cancelled in Commerce',
  creditStatus: 'held',
  history: [{ status: 'created', at: '2026-09-01T10:00:00.000Z' }, { status: 'cancelled', at: '2026-09-02T10:00:00.000Z', reason: 'Cancelled in Commerce' }],
  createdAt: '2026-09-01T10:00:00.000Z'
}

test('an order stored with the British spellings reads as canceled, wherever it is read', async () => {
  const cols = memoryCollections()
  await importPartners(cols, [{ id: 'C1', name: 'Acme', creditLimit: 1000 }])
  await cols.salesOrders.replaceOne({ _id: OLD_ORDER._id }, OLD_ORDER, { upsert: true })

  const order = await getOrder(cols, OLD_ORDER.number)
  assert.equal(order.header, 'canceled')
  assert.equal(order.status, 'canceled')
  assert.equal(order.cancelReason, 'Canceled in Commerce')
  assert.deepEqual(order.history.map((h) => [h.status, h.reason]), [['created', undefined], ['canceled', 'Canceled in Commerce']])
  assert.equal((await listOrders(cols))[0].status, 'canceled')
  assert.equal((await listOrders(cols))[0].can.cancel, false)

  const partner = await describePartner(cols, await cols.businessPartners.findOne({ _id: 'C1' }))
  assert.equal(partner.orders[0].status, 'canceled')
  // A canceled order is not a held one, however it was spelled when it was stored.
  assert.equal(partner.credit.held, 0)

  // A legacy (header-less) record keeps its stored word as the header.
  const { header: _h, ...legacy } = OLD_ORDER
  await cols.salesOrders.replaceOne({ _id: '0000001002' }, { ...legacy, _id: '0000001002', number: '0000001002' }, { upsert: true })
  assert.equal((await getOrder(cols, '0000001002')).header, 'canceled')
})

/* A journal entry an ERP stored before contract version 10, still waiting to be delivered. */
const OLD_ENTRY = {
  _id: 'old-1',
  at: '2026-09-02T10:00:00.000Z',
  direction: 'out',
  kind: 'order.cancelled',
  event: 'be-observer.sales_order_cancel',
  value: { id: 7, orderId: 7, incrementId: '000000007', erpNumber: '0000001001', status: 'cancelled', items: [], notifyCustomer: false, reason: 'Cancelled in Commerce' },
  delivered: false,
  failed: false,
  attempts: 1
}

test('a journal entry stored with the British spellings reads, and is delivered, as the American ones', async () => {
  const cols = memoryCollections()
  await cols.events.replaceOne({ _id: OLD_ENTRY._id }, OLD_ENTRY, { upsert: true })
  const { kind: _k, ...kindless } = OLD_ENTRY
  await cols.events.replaceOne({ _id: 'old-2' }, { ...kindless, _id: 'old-2', delivered: true }, { upsert: true })

  const [read] = await pending(cols)
  assert.equal(read.kind, 'order.canceled')
  assert.equal(read.value.status, 'canceled')
  assert.equal(read.value.reason, 'Canceled in Commerce')
  const listed = await recent(cols)
  assert.deepEqual(listed.map((e) => describeEvent(e).name), ['Order canceled', 'Order canceled'])
  assert.equal(describeEvent(listed.find((e) => e._id === 'old-2')).text, 'Sales order 0000001001 canceled: Canceled in Commerce')

  const posts = []
  const fetch = async (url, init) => { posts.push(JSON.parse(init.body)); return { ok: true, status: 200 } }
  await retryPending(cols, { EVENTS_WEBHOOK_URL: 'https://erp.example/webhook' }, { fetch, headers: {} })
  assert.equal(posts.length, 1)
  assert.equal(posts[0].data.value.status, 'canceled')
  assert.equal(posts[0].data.value.reason, 'Canceled in Commerce')
  const stored = await cols.events.findOne({ _id: 'old-1' })
  assert.equal(stored.kind, 'order.canceled')
})
