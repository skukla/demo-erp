/*
 * Home's work list: every cue is counted from the documents' own abilities, so a cue
 * and the list it opens can never disagree.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { createOrder } = require('../lib/orders')
const { confirmOrder, createShipment, postShipment, createInvoice, cancelOrder } = require('../lib/fulfilment')
const { importProducts } = require('../lib/products')
const { importPartners } = require('../lib/partners')
const { emit } = require('../lib/events')
const { workList, recentDocuments } = require('../lib/work')
const { CUES, RAIL_COUNTS } = require('../lib/cues')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  await importPartners(cols, [
    { id: 'C1', name: 'Northwind', commerceCompanyId: '1', creditLimit: 1000 },
    { id: 'C2', name: 'Contoso', commerceCompanyId: '2', creditLimit: 5, blocked: true }
  ])
})

const order = (id, qty = 2) => createOrder(cols, { commerceOrderId: id, partnerId: 'C1', lines: [{ sku: 'A1', qty, price: 10, commerceItemId: Number(id) }] })

test('each cue counts the orders on which that move is open, and nothing else', async () => {
  await order('1') // created: to confirm
  const shipping = await confirmOrder(cols, (await order('2')).number) // confirmed, nothing shipped: to ship
  const posting = await confirmOrder(cols, (await order('3')).number)
  await createShipment(cols, posting.number, { lines: [{ item: 10, qty: 1 }] }) // one shipment open: to post, still to ship
  const invoicing = await confirmOrder(cols, (await order('4')).number)
  const withShipment = await createShipment(cols, invoicing.number, { lines: [{ item: 10, qty: 2 }] })
  await postShipment(cols, invoicing.number, withShipment.shipments[0].number) // fully shipped: to invoice
  const done = await confirmOrder(cols, (await order('5')).number)
  const shipped = await createShipment(cols, done.number, { lines: [{ item: 10, qty: 2 }] })
  await postShipment(cols, done.number, shipped.shipments[0].number)
  await createInvoice(cols, done.number) // invoiced: no cue
  await cancelOrder(cols, (await order('6')).number, 'Customer request') // cancelled: no cue
  await createOrder(cols, { commerceOrderId: '7', partnerId: 'C2', lines: [{ sku: 'A1', qty: 1, price: 10 }] }) // over C2's limit: held

  const { counts, openValue } = await workList(cols)
  assert.equal(counts.toConfirm, 1, 'order 1 waits for confirmation; the held order 7 does not count until released')
  assert.equal(counts.onHold, 1)
  assert.equal(counts.toShip, 2, 'orders 2 and 3 still have open quantity')
  assert.equal(counts.toPost, 1)
  assert.equal(counts.toInvoice, 1)
  assert.equal(counts.blockedCustomers, 1)
  // Not invoiced and not cancelled: orders 1, 2, 3, 4 (20 each) and 7 (10).
  assert.deepEqual(openValue, { amount: 90, currency: 'USD' })
  void shipping
})

test('events not delivered and events waiting are counted from the journal', async () => {
  const entry = await emit(cols, 'product.price', { sku: 'A1', price: 12 })
  await emit(cols, 'product.price', { sku: 'A1', price: 13 })
  await cols.events.replaceOne({ _id: entry._id }, { ...entry, failed: true, attempts: 10 }, { upsert: true })
  const { counts } = await workList(cols)
  assert.equal(counts.eventsFailed, 1)
  assert.equal(counts.eventsPending, 1)
})

test('recent documents are the last five touched, any kind, newest first', () => {
  const orders = [
    { number: '0000001000', createdAt: '2026-09-01T09:00:00Z', history: [{ status: 'created', at: '2026-09-01T09:00:00Z' }, { status: 'confirmed', at: '2026-09-05T09:00:00Z' }], shipments: [{ number: '8000000001', createdAt: '2026-09-06T09:00:00Z', postedAt: '2026-09-07T09:00:00Z' }], invoice: { number: '9000000001', createdAt: '2026-09-08T09:00:00Z' } },
    { number: '0000001001', createdAt: '2026-09-02T09:00:00Z', history: [], shipments: [], invoice: null },
    { number: '0000001002', createdAt: '2026-09-03T09:00:00Z', history: [], shipments: [{ number: '8000000002', createdAt: '2026-09-04T09:00:00Z', postedAt: null }], invoice: null }
  ]
  const recent = recentDocuments(orders)
  assert.deepEqual(recent.map((r) => `${r.kind} ${r.number}`), [
    'invoice 9000000001', 'shipment 8000000001', 'order 0000001000', 'shipment 8000000002', 'order 0000001002'
  ])
  assert.equal(recent[0].title, 'Invoice 9000000001')
})

test('every cue the screen draws has a count, and every rail count names cues that exist', async () => {
  const { counts } = await workList(cols)
  for (const cue of CUES) assert.equal(typeof counts[cue.key], 'number', cue.key)
  for (const keys of Object.values(RAIL_COUNTS)) for (const key of keys) assert.ok(CUES.some((c) => c.key === key), key)
})
