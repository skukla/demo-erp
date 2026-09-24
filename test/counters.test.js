/*
 * Document number ranges: each document type has its own, the next value can be read
 * without reserving it (the Settings screen's Document numbering card), and a counter
 * never rewinds — not even across a wipe.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { next, peek, STARTS, formatDocumentNumber } = require('../lib/counters')
const { importProducts } = require('../lib/products')
const { createOrder } = require('../lib/orders')
const { confirmOrder, createShipment, postShipment, createInvoice } = require('../lib/fulfilment')
const { wipe } = require('../lib/admin')

let cols
beforeEach(() => { cols = memoryCollections() })

test('each document type starts in its own range, and peeking reserves nothing', async () => {
  assert.deepEqual(STARTS, { salesOrder: 1000, shipment: 8000000001, invoice: 9000000001 })
  const fresh = await peek(cols)
  assert.deepEqual(fresh, { salesOrder: '0000001000', shipment: '8000000001', invoice: '9000000001' })
  // Peeking twice answers the same numbers: nothing was taken.
  assert.deepEqual(await peek(cols), fresh)
  assert.equal(formatDocumentNumber(await next(cols, 'salesOrder', STARTS.salesOrder)), '0000001000')
  assert.equal((await peek(cols)).salesOrder, '0000001001')
})

test('the real documents draw from those ranges, and the next numbers survive a wipe', async () => {
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  const order = await createOrder(cols, { commerceOrderId: '1', lines: [{ sku: 'A1', qty: 2, price: 10 }] })
  await confirmOrder(cols, order.number)
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 2 }] })
  await postShipment(cols, order.number, '8000000001')
  await createInvoice(cols, order.number)
  assert.deepEqual(await peek(cols), { salesOrder: '0000001001', shipment: '8000000002', invoice: '9000000002' })
  await wipe(cols)
  assert.deepEqual(await peek(cols), { salesOrder: '0000001001', shipment: '8000000002', invoice: '9000000002' })
})
