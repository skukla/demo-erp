/*
 * What the LISTS carry (screen-realism plan, UI audit §lists): a row must say what the
 * document behind it is in the middle of, without being opened. Sales orders carry their
 * shipping and billing state and the overall word; shipments and invoices name the
 * sold-to; a shipment names its warehouse by the ERP's own name; customers carry the
 * credit exposure and what is left, by the same rule the customer document uses.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importProducts } = require('../lib/products')
const { importPartners, ensureDefaultPartner } = require('../lib/partners')
const { updateSettings } = require('../lib/settings')
const { createOrder } = require('../lib/orders')
const { confirmOrder, createShipment, postShipment, createInvoice } = require('../lib/fulfilment')
const orders = require('../actions/orders')
const shipments = require('../actions/shipments')
const invoices = require('../actions/invoices')
const partners = require('../actions/partners')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'east', name: 'East DC', quantity: 50 }] }])
  await importPartners(cols, [
    { id: 'C1', name: 'Acme', commerceCompanyId: '7', creditLimit: 1000, blocked: false },
    { id: 'C2', name: 'Bolt', commerceCompanyId: '8', creditLimit: 500, blocked: false }
  ])
  await ensureDefaultPartner(cols, 'Demo')
  await updateSettings(cols, { warehouses: { east: { name: 'Plant 2000 · Boston' } } })
})

async function shippedAndInvoiced (partnerId, id) {
  const order = await createOrder(cols, { commerceOrderId: id, commerceIncrementId: `00${id}`, partnerId, lines: [{ sku: 'A1', qty: 3, price: 10 }] })
  await confirmOrder(cols, order.number)
  const withShipment = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 3 }], warehouse: 'east' })
  await postShipment(cols, order.number, withShipment.shipments[0].number)
  await createInvoice(cols, order.number)
  return order
}

test('a sales order row says how far it has shipped and been billed, and the overall word', async () => {
  const done = await shippedAndInvoiced('C1', '1')
  const fresh = await createOrder(cols, { commerceOrderId: '2', partnerId: 'C1', lines: [{ sku: 'A1', qty: 4, price: 10 }] })
  await confirmOrder(cols, fresh.number)
  const half = await createShipment(cols, fresh.number, { lines: [{ item: 10, qty: 1 }] })
  await postShipment(cols, fresh.number, half.shipments[0].number)
  const rows = (await invoke(orders, cols, { method: 'GET' })).body.items
  const byNumber = Object.fromEntries(rows.map((r) => [r.number, r]))
  assert.deepEqual(
    [byNumber[done.number].shippingStatus, byNumber[done.number].billingStatus, byNumber[done.number].overall],
    ['full', 'invoiced', 'Completed']
  )
  assert.deepEqual(
    [byNumber[fresh.number].shippingStatus, byNumber[fresh.number].billingStatus, byNumber[fresh.number].overall],
    ['partial', 'none', 'In process']
  )
})

test('a shipment row names its sold-to and its warehouse by the ERP\'s own name; an invoice row names its sold-to', async () => {
  await shippedAndInvoiced('C2', '3')
  const [shipment] = (await invoke(shipments, cols, { method: 'GET' })).body.items
  assert.equal(shipment.partnerName, 'Bolt')
  assert.deepEqual(shipment.warehouseName, 'Plant 2000 · Boston')
  assert.equal(shipment.warehouse, 'east')
  const [invoice] = (await invoke(invoices, cols, { method: 'GET' })).body.items
  assert.equal(invoice.partnerName, 'Bolt')
})

test('a customer row carries the credit exposure and what is left, by the document\'s rule; the walk-in account has no credit', async () => {
  // C1: one invoiced order (no longer open) and one open order of 40 → exposure 40.
  await shippedAndInvoiced('C1', '4')
  await createOrder(cols, { commerceOrderId: '5', partnerId: 'C1', lines: [{ sku: 'A1', qty: 4, price: 10 }] })
  // C2: an order over its limit is created and HELD, and a held order is not yet owed for.
  await createOrder(cols, { commerceOrderId: '6', partnerId: 'C2', lines: [{ sku: 'A1', qty: 60, price: 10 }] })
  const rows = (await invoke(partners, cols, { method: 'GET' })).body.items
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  assert.deepEqual([byId.C1.exposure, byId.C1.available], [40, 960])
  assert.deepEqual([byId.C2.exposure, byId.C2.available], [0, 500])
  assert.deepEqual([byId.P000000.exposure, byId.P000000.available], [null, null])
})
