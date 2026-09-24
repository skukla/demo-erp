const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { createOrder, setStatus, nextStatuses, describeOrder } = require('../lib/orders')
const { importPartners, ensureDefaultPartner } = require('../lib/partners')
const { wipe } = require('../lib/admin')
const { pending } = require('../lib/events')

let cols
beforeEach(() => { cols = memoryCollections() })

const input = { commerceOrderId: '42', commerceIncrementId: '000000042', partnerId: 'P1', lines: [{ sku: 'A1', qty: 2, price: 10, commerceItemId: 5 }] }

test('creates an SAP-style ten-digit number and totals the lines', async () => {
  const order = await createOrder(cols, input)
  assert.equal(order.number, '0000001000')
  assert.equal(order.total, 20)
  assert.equal(order.status, 'created')
})

test('the partner is resolved from the buyer hints when no partner id is given', async () => {
  await importPartners(cols, [{ id: 'C2', name: 'Kukla Studios', commerceCompanyId: '2', emailDomain: 'kuklastudios.example' }])
  await ensureDefaultPartner(cols, 'Demo')
  const byEmail = await createOrder(cols, { commerceOrderId: '1', email: 'buyer@kuklastudios.example', lines: [] })
  assert.equal(byEmail.partnerId, 'C2')
  const unknown = await createOrder(cols, { commerceOrderId: '2', email: 'x@nowhere.example', lines: [] })
  assert.equal(unknown.partnerId, 'P000000')
  const none = await createOrder(memoryCollections(), { commerceOrderId: '3', lines: [] })
  assert.equal(none.partnerId, null)
})

test('the same Commerce order posted twice answers the same ERP order', async () => {
  const a = await createOrder(cols, input)
  const b = await createOrder(cols, input)
  assert.equal(a.number, b.number)
  assert.equal(await cols.salesOrders.countDocuments({}), 1)
})

test('the order number never rewinds, not even across a wipe', async () => {
  await createOrder(cols, input)
  await createOrder(cols, { ...input, commerceOrderId: '43' })
  await wipe(cols)
  assert.equal(await cols.salesOrders.countDocuments({}), 0)
  const after = await createOrder(cols, { ...input, commerceOrderId: '44' })
  assert.equal(after.number, '0000001002')
})

test('status moves follow the machine and each move raises the ERP event for that status', async () => {
  const order = await createOrder(cols, input)
  await setStatus(cols, order.number, 'confirmed')
  const shipped = await setStatus(cols, order.number, 'shipped')
  assert.equal(shipped.status, 'shipped')
  assert.deepEqual(shipped.history.map((h) => h.status), ['created', 'confirmed', 'shipped'])
  const entries = await pending(cols)
  assert.deepEqual(entries.map((e) => e.event), ['be-observer.sales_order_status_update', 'be-observer.sales_order_shipment_create'])
  assert.equal(entries[1].value.orderId, 42)
  assert.equal(entries[1].value.erpNumber, '0000001000')
  assert.deepEqual(entries[1].value.items, [{ orderItemId: 5, qty: 2, sku: 'A1' }])
})

test('a move the machine does not allow is refused as a bad request', async () => {
  const order = await createOrder(cols, input)
  await assert.rejects(setStatus(cols, order.number, 'invoiced'), { statusCode: 400 })
  await assert.rejects(setStatus(cols, order.number, 'bogus'), { statusCode: 400 })
  assert.deepEqual(nextStatuses('invoiced'), [])
})

test('an order without a Commerce id is refused', async () => {
  await assert.rejects(createOrder(cols, { lines: [] }), { statusCode: 400 })
})

/*
 * The order document. The list holds a row; the document holds the order as an ERP
 * shows it — the customer named, numbered lines with the product's description and
 * base unit, and the three money figures on the header.
 */
const { importProducts } = require('../lib/products')

test('the document numbers its lines in tens, the way every ERP does', async () => {
  const order = await createOrder(cols, {
    commerceOrderId: '90',
    lines: [{ sku: 'A1', qty: 1, price: 10 }, { sku: 'B2', qty: 2, price: 5 }, { sku: 'C3', qty: 1, price: 1 }]
  })

  const document = await describeOrder(cols, order)

  assert.deepEqual(document.lines.map((l) => l.item), [10, 20, 30])
})

test('each line carries the product description and base unit, and falls back when the product is gone', async () => {
  await importProducts(cols, [{ sku: 'A1', name: 'Wide-leg trouser', unit: 'PC', listPrice: 89 }])
  const order = await createOrder(cols, {
    commerceOrderId: '91',
    lines: [{ sku: 'A1', qty: 2, price: 89 }, { sku: 'GONE', qty: 1, price: 4 }]
  })

  const document = await describeOrder(cols, order)

  assert.deepEqual(
    document.lines.map((l) => ({ name: l.name, unit: l.unit })),
    [{ name: 'Wide-leg trouser', unit: 'PC' }, { name: 'GONE', unit: 'EA' }]
  )
})

test('net is the lines, total is what Commerce charged, and tax is the difference', async () => {
  const order = await createOrder(cols, {
    commerceOrderId: '92',
    lines: [{ sku: 'A1', qty: 4, price: 89 }, { sku: 'B2', qty: 10, price: 34.2 }],
    total: 755.59
  })

  const document = await describeOrder(cols, order)

  assert.equal(document.net, 698)
  assert.equal(document.total, 755.59)
  assert.equal(document.tax, 57.59)
})

test('an order Commerce sent no total for is its lines, and carries no tax', async () => {
  const order = await createOrder(cols, { commerceOrderId: '93', lines: [{ sku: 'A1', qty: 3, price: 19.99 }] })

  const document = await describeOrder(cols, order)

  assert.equal(document.net, 59.97)
  assert.equal(document.total, 59.97)
  assert.equal(document.tax, 0)
})

test('the document names the customer, and says so plainly when there is none', async () => {
  await importPartners(cols, [{ id: 'C2', name: 'Northwind Trading', creditLimit: 50000 }])
  const withPartner = await describeOrder(cols, await createOrder(cols, { commerceOrderId: '94', partnerId: 'C2', lines: [] }))
  assert.deepEqual(withPartner.partner, { id: 'C2', name: 'Northwind Trading', paymentTerms: 'NET30' })
  assert.equal(withPartner.salesOrg, '1000')

  const none = await describeOrder(cols, await createOrder(memoryCollections(), { commerceOrderId: '95', lines: [] }))
  assert.equal(none.partner, null)
})

test('the document says where the order may go next', async () => {
  const order = await createOrder(cols, { commerceOrderId: '96', lines: [] })

  assert.deepEqual((await describeOrder(cols, order)).nextStatuses, ['confirmed', 'cancelled'])
  const cancelled = await setStatus(cols, order.number, 'cancelled', undefined, { reason: 'Out of stock' })
  assert.deepEqual((await describeOrder(cols, cancelled)).nextStatuses, [])
})

test('a line amount is money, not float dust', async () => {
  const order = await createOrder(cols, { commerceOrderId: '97', lines: [{ sku: 'A1', qty: 3, price: 0.1 }] })

  const document = await describeOrder(cols, order)

  assert.equal(document.lines[0].amount, 0.3)
  assert.equal(document.net, 0.3)
})

test('an order cannot be cancelled without a reason from the ERP\'s own list', async () => {
  const order = await createOrder(cols, { commerceOrderId: '98', lines: [] })

  await assert.rejects(() => setStatus(cols, order.number, 'cancelled'), /needs one of these reasons/)
  await assert.rejects(
    () => setStatus(cols, order.number, 'cancelled', undefined, { reason: 'because I said so' }),
    /needs one of these reasons/
  )
  assert.equal((await cols.salesOrders.findOne({ _id: order.number })).status, 'created')
})

test('a cancellation records why, on the order and in its history', async () => {
  const order = await createOrder(cols, { commerceOrderId: '99', lines: [] })

  const cancelled = await setStatus(cols, order.number, 'cancelled', undefined, { reason: 'Credit rejected' })

  assert.equal(cancelled.cancelReason, 'Credit rejected')
  assert.deepEqual(cancelled.history.at(-1).reason, 'Credit rejected')
})

test('a reason is recorded only where it belongs: moving forward carries none', async () => {
  const order = await createOrder(cols, { commerceOrderId: '100', lines: [] })

  const confirmed = await setStatus(cols, order.number, 'confirmed', undefined, { reason: 'Customer request' })

  assert.equal(confirmed.cancelReason, undefined)
  assert.equal(confirmed.history.at(-1).reason, undefined)
})

test('the document offers the ERP\'s own cancellation reasons, and stops offering them', async () => {
  const { CANCEL_REASONS } = require('../lib/orders')
  const order = await createOrder(cols, { commerceOrderId: '101', lines: [] })

  assert.deepEqual((await describeOrder(cols, order)).cancelReasons, CANCEL_REASONS)

  const cancelled = await setStatus(cols, order.number, 'cancelled', undefined, { reason: 'Duplicate order' })
  assert.deepEqual((await describeOrder(cols, cancelled)).cancelReasons, [])
})
