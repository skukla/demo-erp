/* One search across every document, best match first. */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder } = require('../lib/orders')
const { confirmOrder, createShipment } = require('../lib/fulfilment')
const { importProducts } = require('../lib/products')
const { importPartners } = require('../lib/partners')
const { search, LIMIT } = require('../lib/search')
const action = require('../actions/search')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'P000001', name: 'Wide-leg trouser', listPrice: 89 }, { sku: 'P000002', name: 'Trouser press', listPrice: 40 }])
  await importPartners(cols, [{ id: 'C000101', name: 'Northwind Trading', commerceCompanyId: '4' }])
  const order = await createOrder(cols, { commerceOrderId: '700', commerceIncrementId: '000000300', partnerId: 'C000101', lines: [{ sku: 'P000001', qty: 1, price: 89 }] })
  await confirmOrder(cols, order.number)
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 1 }] })
})

test('an exact number comes first, then what merely contains the text', async () => {
  const hits = await search(cols, 'P000001')
  assert.equal(hits[0].kind, 'product')
  assert.equal(hits[0].number, 'P000001')
  const byName = await search(cols, 'trouser')
  assert.deepEqual(byName.map((h) => h.number).sort(), ['P000001', 'P000002'])
})

test('orders are found by ERP number, Commerce number and customer name; shipments by their order', async () => {
  assert.equal((await search(cols, '0000001000'))[0].kind, 'order')
  assert.equal((await search(cols, '000000300'))[0].kind, 'order')
  const byCustomer = await search(cols, 'northwind')
  assert.deepEqual(byCustomer.map((h) => h.kind).sort(), ['customer', 'order'])
  const shipments = (await search(cols, '0000001000')).filter((h) => h.kind === 'shipment')
  assert.equal(shipments.length, 1)
  assert.equal(shipments[0].subtitle, 'for sales order 0000001000')
})

test('fewer than two characters answers nothing, and the list is capped', async () => {
  assert.deepEqual(await search(cols, 'P'), [])
  assert.deepEqual(await search(cols, ''), [])
  assert.ok(LIMIT <= 20)
})

test('the search action answers the list for ?q=', async () => {
  const res = await invoke(action, cols, { params: { q: 'north' } })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.items[0].title, 'Northwind Trading')
})
