/*
 * Records a deployed ERP stored before contract version 16 keep working (owner: existing data
 * keeps working). They held the web shop's ids under its own names; they read, are found, move
 * and announce themselves in version 16's words, with nothing migrated in place (lib/legacy).
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder, getOrder } = require('../lib/orders')
const { receiveExternalShipment, createInvoice } = require('../lib/fulfilment')
const { createReturn, getReturn } = require('../lib/returns')
const { importProducts } = require('../lib/products')
const { pending } = require('../lib/events')
const orders = require('../actions/orders')

/* A sales order as version 15 stored it: shop ids under the shop's names. */
const V15_ORDER = {
  _id: '0000001001',
  number: '0000001001',
  commerceOrderId: '55',
  commerceIncrementId: '000000042',
  partnerId: null,
  lines: [{ item: 10, sku: 'A1', qty: 2, price: 10, commerceItemId: 7, shippedQty: 2, closedQty: 0 }],
  currency: 'USD',
  total: 20,
  header: 'confirmed',
  status: 'shipped',
  shipments: [{ number: '8000000001', status: 'posted', warehouse: 'default', commerceShipmentId: '900', lines: [{ item: 10, sku: 'A1', qty: 2, commerceItemId: 7 }] }],
  invoice: null,
  creditStatus: null,
  creditReason: null,
  history: [{ status: 'created', at: '2026-09-01T00:00:00.000Z' }],
  createdAt: '2026-09-01T00:00:00.000Z'
}

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  await cols.salesOrders.replaceOne({ _id: V15_ORDER._id }, V15_ORDER, { upsert: true })
})

test('a version 15 order reads with the customer\'s references, and no shop name', async () => {
  const order = await getOrder(cols, '0000001001')
  assert.equal(order.purchaseOrderByCustomer, '000000042')
  assert.equal(order.lines[0].customerLineReference, '7')
  assert.equal(order.shipments[0].externalReference, '900')
  assert.equal(order.shipments[0].lines[0].customerLineReference, '7')
  assert.doesNotMatch(JSON.stringify(order), /commerce/i)
  // The API answers it the same way, and filters it by the customer's reference.
  const listed = await invoke(orders, cols, { params: { reference: '000000042' } })
  assert.deepEqual(listed.body.items.map((o) => o.number), ['0000001001'])
})

test('the same order sent again by its reference finds the version 15 record rather than making a second', async () => {
  const again = await createOrder(cols, { purchaseOrderByCustomer: '000000042', lines: [{ sku: 'A1', qty: 2, price: 10, customerLineReference: '7' }] })
  assert.equal(again.number, '0000001001')
  assert.equal((await cols.salesOrders.find({}).toArray()).length, 1)
})

test('a version 15 order moves on, and its events carry the references', async () => {
  await createInvoice(cols, '0000001001')
  const [bill] = await pending(cols)
  assert.equal(bill.type, 'BillingDocument.Created')
  assert.equal(bill.data.PurchaseOrderByCustomer, '000000042')
  assert.equal(bill.data.Items[0].CustomerLineReference, '7')
  // The shop's echo of the shipment it already had is still matched by its old id.
  const echoed = await receiveExternalShipment(cols, '0000001001', { externalReference: '900', lines: [{ customerLineReference: '7', qty: 2 }], origin: { system: 'Adobe Commerce' } })
  assert.equal(echoed.shipments.length, 1)
})

test('a version 15 return order reads with its shop reference and is found by it', async () => {
  await cols.returnOrders.replaceOne({ _id: '6000000001' }, {
    _id: '6000000001', number: '6000000001', commerceReturnId: '12', commerceReturnIncrementId: '000000012', orderNumber: '0000001001', partnerId: null, status: 'open',
    lines: [{ item: 10, sku: 'A1', qty: 1, price: 10, reason: 'Damaged', reasonCode: 'DAMAGED', commerceItemId: 7 }], creditMemo: null, history: [], createdAt: 'x', receivedAt: null
  }, { upsert: true })
  const read = await getReturn(cols, '6000000001')
  assert.equal(read.customerReturnReference, '12')
  assert.equal(read.lines[0].customerLineReference, '7')
  assert.doesNotMatch(JSON.stringify(read), /commerce/i)
  const again = await createReturn(cols, { customerReturnReference: '12', orderNumber: '0000001001', lines: [{ customerLineReference: '7', qty: 1 }] })
  assert.equal(again.created, false)
  assert.equal(again.returnOrder.number, '6000000001')
})
