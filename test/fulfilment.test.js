/*
 * Shipments and the invoice as documents. An order is shipped in parts, each part a
 * shipment with its own number that is created and then posted; the invoice covers the
 * whole order once every line is shipped or closed. Statuses are derived from the
 * quantities, so they cannot drift into an impossible state.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder, setStatus, describeOrder, getOrder, listOrders } = require('../lib/orders')
const {
  confirmOrder, cancelOrder, createShipment, postShipment, closeRemaining, createInvoice,
  listShipments, getShipment, listInvoices, getInvoice, CLOSE_REASONS
} = require('../lib/fulfilment')
const { importProducts, getProduct } = require('../lib/products')
const { pending } = require('../lib/events')
const orders = require('../actions/orders')
const shipments = require('../actions/shipments')
const invoices = require('../actions/invoices')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [
    { sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }, { code: 'east', name: 'East DC', quantity: 20 }] },
    { sku: 'B2', name: 'Shirt', listPrice: 5, warehouses: [{ code: 'default', name: 'Default Source', quantity: 9 }] }
  ])
})

const input = { purchaseOrderByCustomer: '000000042', lines: [{ sku: 'A1', qty: 12, price: 10, customerLineReference: '1' }, { sku: 'B2', qty: 4, price: 5, customerLineReference: '2' }] }

async function confirmed () {
  const order = await createOrder(cols, input)
  return confirmOrder(cols, order.number)
}

test('a shipment is created with its own ten-digit number in the 8000000000 range, and is open until posted', async () => {
  const order = await confirmed()
  const next = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 5 }] })
  assert.equal(next.shipments.length, 1)
  assert.equal(next.shipments[0].number, '8000000001')
  assert.equal(next.shipments[0].status, 'open')
  // Nothing has shipped yet: creating is not posting.
  assert.equal(next.lines[0].shippedQty, 0)
  assert.deepEqual(await pending(cols).then((e) => e.map((x) => x.type)), ['SalesOrder.Changed'])
})

test('posting a shipment moves the shipped quantities and raises the shipment event with THAT shipment\'s items', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 5 }], warehouse: 'east' })
  const posted = await postShipment(cols, order.number, '8000000001')
  assert.equal(posted.shipments[0].status, 'posted')
  assert.ok(posted.shipments[0].postedAt)
  assert.equal(posted.lines[0].shippedQty, 5)
  assert.equal(posted.lines[1].shippedQty, 0)
  const events = await pending(cols)
  const shipped = events.find((e) => e.type === 'OutboundDelivery.GoodsIssueStatusChanged')
  assert.deepEqual(shipped.data.Items, [{ SalesOrderItem: 10, Material: 'A1', Quantity: 5, CustomerLineReference: '1' }])
  // The plant the shipment named, so the customer's side deducts from the matching stock.
  assert.equal(shipped.data.Plant, 'east')
  assert.equal(shipped.data.OutboundDelivery, '8000000001')
  assert.equal(shipped.data.PurchaseOrderByCustomer, '000000042')
  assert.deepEqual([shipped.data.PrevGoodsMovementStatus, shipped.data.GoodsMovementStatus], ['open', 'posted'])
})

test("a shipment with no warehouse named ships from the products' single warehouse, not \"default\"", async () => {
  // A null warehouse became the source "default" in the web shop, where the goods are not,
  // and the ship 400'd. An ERP ships from where the goods are (Bodea's accesspoint is in
  // "northwind", not "default").
  await importProducts(cols, [{ sku: 'NW1', name: 'Access Point', listPrice: 100, warehouses: [{ code: 'northwind', name: 'Northwind Warehouse', quantity: 30 }] }])
  const order = await createOrder(cols, { purchaseOrderByCustomer: '000000099', lines: [{ sku: 'NW1', qty: 2, price: 100, customerLineReference: '9' }] })
  await confirmOrder(cols, order.number)
  const next = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 2 }] })
  assert.equal(next.shipments[0].warehouse, 'northwind')
  await postShipment(cols, order.number, next.shipments[0].number)
  const shipped = (await pending(cols)).find((e) => e.type === 'OutboundDelivery.GoodsIssueStatusChanged')
  assert.equal(shipped.data.Plant, 'northwind')
})

test('a shipment cannot be posted twice, and says when it was', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 5 }] })
  await postShipment(cols, order.number, '8000000001')
  await assert.rejects(postShipment(cols, order.number, '8000000001'), /Shipment 8000000001 was posted on/)
})

test('a shipment cannot take more than remains on a line, and says what remains', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 8 }] })
  await postShipment(cols, order.number, '8000000001')
  await assert.rejects(createShipment(cols, order.number, { lines: [{ item: 10, qty: 5 }] }), /Item 10: 4 EA remain of 12/)
  await assert.rejects(createShipment(cols, order.number, { lines: [] }), /at least one line/)
  await assert.rejects(createShipment(cols, order.number, { lines: [{ item: 99, qty: 1 }] }), /Item 99/)
})

test('an order is shipped only after it is confirmed', async () => {
  const order = await createOrder(cols, input)
  await assert.rejects(createShipment(cols, order.number, { lines: [{ item: 10, qty: 1 }] }), /confirm/i)
})

test('shipping status is derived from the quantities: none, partial, full', async () => {
  const order = await confirmed()
  assert.equal((await describeOrder(cols, await getOrder(cols, order.number))).shippingStatus, 'none')
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 12 }] })
  await postShipment(cols, order.number, '8000000001')
  const partial = await describeOrder(cols, await getOrder(cols, order.number))
  assert.equal(partial.shippingStatus, 'partial')
  assert.equal(partial.status, 'shipped')
  assert.equal(partial.lines[1].openQty, 4)
  await createShipment(cols, order.number, { lines: [{ item: 20, qty: 4 }] })
  await postShipment(cols, order.number, '8000000002')
  const full = await describeOrder(cols, await getOrder(cols, order.number))
  assert.equal(full.shippingStatus, 'full')
  assert.deepEqual(full.nextStatuses, ['invoiced'])
})

test('the invoice is refused until every line is shipped, and names the line that is not', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 12 }] })
  await postShipment(cols, order.number, '8000000001')
  await assert.rejects(createInvoice(cols, order.number), /Item 20: 4 EA are not yet shipped/)
})

test('closing the remainder of a line, with a reason, makes a short-shipped order invoiceable', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 12 }, { item: 20, qty: 1 }] })
  await postShipment(cols, order.number, '8000000001')
  await assert.rejects(closeRemaining(cols, order.number, 20, 'because'), /needs one of these reasons/)
  const closed = await closeRemaining(cols, order.number, 20, CLOSE_REASONS[0])
  assert.equal(closed.lines[1].closedQty, 3)
  assert.equal(closed.lines[1].closeReason, CLOSE_REASONS[0])
  const doc = await describeOrder(cols, closed)
  assert.equal(doc.shippingStatus, 'full')
  assert.equal(doc.lines[1].openQty, 0)
  const invoiced = await createInvoice(cols, order.number)
  assert.equal(invoiced.invoice.number, '9000000001')
})

test('one invoice covers the whole order, once, and raises the invoice event', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 12 }, { item: 20, qty: 4 }] })
  await postShipment(cols, order.number, '8000000001')
  const invoiced = await createInvoice(cols, order.number)
  assert.equal(invoiced.invoice.status, 'open')
  assert.equal(invoiced.invoice.net, 140)
  assert.deepEqual(invoiced.invoice.shipments, ['8000000001'])
  const doc = await describeOrder(cols, invoiced)
  assert.equal(doc.status, 'invoiced')
  assert.equal(doc.billingStatus, 'invoiced')
  assert.equal(doc.overall, 'Completed')
  await assert.rejects(createInvoice(cols, order.number), /already invoiced/)
  const raised = await pending(cols)
  assert.deepEqual(raised.map((e) => e.type), ['SalesOrder.Changed', 'OutboundDelivery.GoodsIssueStatusChanged', 'BillingDocument.Created'])
  const bill = raised[2].data
  assert.deepEqual([bill.BillingDocument, bill.BillingDocumentType, bill.TotalNetAmount, bill.ReferenceBillingDocument], ['9000000001', 'Invoice', 140, null])
  assert.deepEqual(bill.Items.map((i) => [i.SalesOrderItem, i.Quantity, i.CustomerLineReference]), [[10, 12, '1'], [20, 4, '2']])
})

test('a cancellation carries its reason in the sales order event', async () => {
  const order = await createOrder(cols, input)
  await cancelOrder(cols, order.number, 'Duplicate order')
  const event = (await pending(cols)).find((e) => e.type === 'SalesOrder.Changed')
  assert.equal(event.data.Reason, 'Duplicate order')
  assert.deepEqual([event.data.PrevOverallStatus, event.data.OverallStatus], ['created', 'canceled'])
})

test('confirming twice, and cancelling a shipped order, are refused in words', async () => {
  const order = await confirmed()
  await assert.rejects(confirmOrder(cols, order.number), /was confirmed on/)
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 1 }] })
  await postShipment(cols, order.number, '8000000001')
  await assert.rejects(cancelOrder(cols, order.number, 'Customer request'), /shipped/)
})

test('POST orders/:number/status still moves an order the whole-order way, for a caller that knows nothing of shipments', async () => {
  const order = await createOrder(cols, input)
  await setStatus(cols, order.number, 'confirmed')
  const shipped = await setStatus(cols, order.number, 'shipped')
  assert.equal(shipped.shipments.length, 1)
  assert.equal(shipped.shipments[0].status, 'posted')
  assert.deepEqual(shipped.lines.map((l) => l.shippedQty), [12, 4])
  const invoiced = await setStatus(cols, order.number, 'invoiced')
  assert.ok(invoiced.invoice)
  assert.equal((await describeOrder(cols, invoiced)).status, 'invoiced')
})

test('an order stored before shipments existed reads as shipped and invoiced, with its quantities filled in', async () => {
  // The record as the ERP wrote it until 2026-09-23: one status word, no quantities.
  const legacy = {
    _id: '0000000900', number: '0000000900', commerceOrderId: '9', commerceIncrementId: null, partnerId: null,
    lines: [{ sku: 'A1', qty: 3, price: 10, commerceItemId: 1 }], currency: 'USD', total: 30, status: 'invoiced',
    history: [{ status: 'created', at: '2026-09-01T00:00:00.000Z' }, { status: 'invoiced', at: '2026-09-02T00:00:00.000Z' }],
    createdAt: '2026-09-01T00:00:00.000Z'
  }
  await cols.salesOrders.replaceOne({ _id: legacy._id }, legacy, { upsert: true })
  const doc = await describeOrder(cols, await getOrder(cols, '0000000900'))
  assert.equal(doc.status, 'invoiced')
  assert.equal(doc.lines[0].shippedQty, 3)
  assert.equal(doc.shippingStatus, 'full')
  assert.equal(doc.billingStatus, 'invoiced')
  assert.equal(doc.invoice.legacy, true)
  assert.deepEqual(doc.nextStatuses, [])
  assert.equal((await listOrders(cols))[0].status, 'invoiced')
})

test('shipments and invoices are listed and read across orders, each naming its order', async () => {
  const a = await confirmed()
  const b = await confirmOrder(cols, (await createOrder(cols, { ...input, purchaseOrderByCustomer: '43' })).number)
  await createShipment(cols, a.number, { lines: [{ item: 10, qty: 12 }, { item: 20, qty: 4 }], warehouse: 'default' })
  await postShipment(cols, a.number, '8000000001')
  await createShipment(cols, b.number, { lines: [{ item: 20, qty: 1 }] })
  await createInvoice(cols, a.number)

  const list = await listShipments(cols)
  assert.deepEqual(list.map((s) => [s.number, s.orderNumber, s.status]), [['8000000002', b.number, 'open'], ['8000000001', a.number, 'posted']])
  const one = await getShipment(cols, '8000000001')
  assert.equal(one.orderNumber, a.number)
  assert.deepEqual(one.warehouse, { code: 'default', name: 'Default Source' })
  assert.deepEqual(one.lines.map((l) => [l.item, l.sku, l.name, l.qty, l.unit]), [[10, 'A1', 'Trouser', 12, 'EA'], [20, 'B2', 'Shirt', 4, 'EA']])
  assert.equal(await getShipment(cols, 'nope'), null)

  const inv = await listInvoices(cols)
  assert.deepEqual(inv.map((i) => [i.number, i.orderNumber]), [['9000000001', a.number]])
  const doc = await getInvoice(cols, '9000000001')
  assert.equal(doc.total, 140)
  assert.equal(doc.partner, null)
  assert.equal(doc.lines.length, 2)
})

test('the routes: create, post, close, invoice, and the two read-only actions', async () => {
  const created = await invoke(orders, cols, { method: 'POST', body: input })
  const n = created.body.number
  assert.equal((await invoke(orders, cols, { method: 'POST', path: `/${n}/confirm` })).body.header, 'confirmed')
  const ship = await invoke(orders, cols, { method: 'POST', path: `/${n}/shipments`, body: { lines: [{ item: 10, qty: 2 }] } })
  assert.equal(ship.statusCode, 201)
  assert.equal(ship.body.shipments[0].number, '8000000001')
  assert.equal((await invoke(orders, cols, { method: 'POST', path: `/${n}/shipments/8000000001/post` })).body.lines[0].shippedQty, 2)
  assert.equal((await invoke(orders, cols, { method: 'POST', path: `/${n}/lines/10/close`, body: { reason: CLOSE_REASONS[1] } })).body.lines[0].closedQty, 10)
  assert.equal((await invoke(orders, cols, { method: 'POST', path: `/${n}/lines/20/close`, body: { reason: CLOSE_REASONS[1] } })).body.lines[1].closedQty, 4)
  const inv = await invoke(orders, cols, { method: 'POST', path: `/${n}/invoice` })
  assert.equal(inv.statusCode, 201)
  assert.equal(inv.body.invoice.number, '9000000001')
  assert.equal((await invoke(orders, cols, { method: 'POST', path: `/${n}/cancel`, body: { reason: 'Customer request' } })).statusCode, 400)

  assert.equal((await invoke(shipments, cols)).body.items.length, 1)
  assert.equal((await invoke(shipments, cols, { path: '/8000000001' })).body.orderNumber, n)
  assert.equal((await invoke(shipments, cols, { path: '/x' })).statusCode, 404)
  assert.equal((await invoke(invoices, cols)).body.items.length, 1)
  // The invoice is the order as placed — what Commerce invoices — not the 2 that shipped.
  assert.equal((await invoke(invoices, cols, { path: '/9000000001' })).body.net, 140)
  assert.equal((await invoke(invoices, cols, { path: '/x' })).statusCode, 404)
})

test('a product blocked for sales is refused in words when a shipment is created, and again when one is posted', async () => {
  const { patchProduct } = require('../lib/products')
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 20, qty: 2 }] })
  await patchProduct(cols, 'B2', { salesStatus: 'blocked' })
  await assert.rejects(createShipment(cols, order.number, { lines: [{ item: 20, qty: 1 }] }), /Product B2 is blocked for sales\./)
  await assert.rejects(postShipment(cols, order.number, '8000000001'), /Product B2 is blocked for sales\./)
  // The other line still ships: the block is on the product, not the order.
  const next = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 1 }] })
  assert.equal(next.shipments.length, 2)
  await patchProduct(cols, 'B2', { salesStatus: 'sellable' })
  const posted = await postShipment(cols, order.number, '8000000001')
  assert.equal(posted.lines[1].shippedQty, 2)
})

test('a discontinued product ships nothing either, in its own words', async () => {
  const { patchProduct } = require('../lib/products')
  const order = await confirmed()
  await patchProduct(cols, 'B2', { salesStatus: 'discontinued' })
  await assert.rejects(createShipment(cols, order.number, { lines: [{ item: 20, qty: 1 }] }), /Product B2 is discontinued\./)
  const next = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 1 }] })
  assert.equal(next.shipments.length, 1)
})

test('the invoice document carries a due date: the billing date plus the payment terms, and none when the terms name no days', async () => {
  const { importPartners } = require('../lib/partners')
  const { patchPartner } = require('../lib/partners')
  await importPartners(cols, [{ id: 'C9', name: 'Net Fifteen', commerceCompanyId: '9', creditLimit: 10000 }])
  // Payment terms are the ERP's own (an import carries none): set on the partner, as the screen does.
  await patchPartner(cols, 'C9', { paymentTerms: 'NET15' })
  const order = await createOrder(cols, { ...input, purchaseOrderByCustomer: '77', partnerId: 'C9' })
  await confirmOrder(cols, order.number)
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 12 }, { item: 20, qty: 4 }] })
  await postShipment(cols, order.number, '8000000001')
  await createInvoice(cols, order.number)
  const invoice = await getInvoice(cols, '9000000001')
  assert.equal(invoice.paymentDays, 15)
  const due = new Date(invoice.createdAt); due.setUTCDate(due.getUTCDate() + 15)
  assert.equal(invoice.dueDate, due.toISOString())
  // Terms that name no number of days (a real ERP has many) leave the due date unknown, not wrong.
  await patchPartner(cols, 'C9', { paymentTerms: 'Payment in advance' })
  const again = await getInvoice(cols, '9000000001')
  assert.equal(again.paymentDays, null)
  assert.equal(again.dueDate, null)
})

/* Goods issue (AB-63): posting a shipment takes the shipped quantity out of the plant's stock. */
const onHand = async (sku) => Object.fromEntries((await getProduct(cols, sku)).warehouses.map((w) => [w.code, w.quantity]))

test('posting a shipment takes the shipped quantity out of the warehouse the shipment names, line by line, and each partial shipment takes its own', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 5 }], warehouse: 'east' })
  assert.deepEqual(await onHand('A1'), { default: 50, east: 20 }, 'creating a shipment moves nothing')
  await postShipment(cols, order.number, '8000000001')
  assert.deepEqual(await onHand('A1'), { default: 50, east: 15 })
  assert.deepEqual(await onHand('B2'), { default: 9 }, 'a line not on the shipment keeps its stock')
  // The rest, from the other warehouse.
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 7 }, { item: 20, qty: 4 }], warehouse: 'default' })
  await postShipment(cols, order.number, '8000000002')
  assert.deepEqual(await onHand('A1'), { default: 43, east: 15 })
  assert.deepEqual(await onHand('B2'), { default: 5 })
})

test('a goods issue raises no ProductStock.Changed: the delivery event is what tells the web shop, which deducts the same units itself', async () => {
  const order = await confirmed()
  await setStatus(cols, order.number, 'shipped')
  assert.deepEqual(await onHand('B2'), { default: 5 })
  assert.deepEqual((await pending(cols)).map((e) => e.type), ['SalesOrder.Changed', 'OutboundDelivery.GoodsIssueStatusChanged'])
})

test('a shipment that needs more than the warehouse has on hand is refused in words when posted, and nothing moves', async () => {
  await importProducts(cols, [{ sku: 'C3', name: 'Belt', listPrice: 8, warehouses: [{ code: 'default', name: 'Default Source', quantity: 40 }, { code: 'east', name: 'East DC', quantity: 3 }] }])
  const order = await confirmOrder(cols, (await createOrder(cols, { purchaseOrderByCustomer: '000000077', lines: [{ sku: 'C3', qty: 6, price: 8, customerLineReference: '1' }] })).number)
  const made = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 5 }], warehouse: 'east' })
  const number = made.shipments[0].number
  await assert.rejects(postShipment(cols, order.number, number), /^Error: Item 10: 3 EA of C3 are on hand in warehouse east; this shipment needs 5\.$/)
  const after = await getOrder(cols, order.number)
  assert.equal(after.shipments[0].status, 'open')
  assert.equal(after.lines[0].shippedQty, 0)
  assert.deepEqual(await onHand('C3'), { default: 40, east: 3 })
  assert.equal((await pending(cols)).some((e) => e.type === 'OutboundDelivery.GoodsIssueStatusChanged'), false)
  // A warehouse the product is not kept in has none on hand.
  const order2 = await confirmed()
  await createShipment(cols, order2.number, { lines: [{ item: 20, qty: 4 }], warehouse: 'east' })
  await assert.rejects(postShipment(cols, order2.number, (await getOrder(cols, order2.number)).shipments[0].number), /Item 20: 0 EA of B2 are on hand in warehouse east; this shipment needs 4\./)
})

test('a product the ERP does not keep has no stock to move, and its shipment still posts', async () => {
  const order = await confirmOrder(cols, (await createOrder(cols, { purchaseOrderByCustomer: '000000078', lines: [{ sku: 'NOT-KEPT', qty: 2, price: 1, customerLineReference: '1' }] })).number)
  const shipped = await setStatus(cols, order.number, 'shipped')
  assert.equal(shipped.lines[0].shippedQty, 2)
})

/* ---- The next step on the order page (owner 2026-10-09; contract version 21) ----
   A created shipment is not shipped until it is posted, so the order kept reading every line
   open and offered Create shipment again: a second open shipment for the same goods. Now
   quantity on an OPEN shipment is reserved for it: the order offers Post shipment (the oldest
   waiting first), offers Create shipment only for what no shipment covers, and the ERP refuses
   a shipment for reserved quantity in words, so the API and an agent cannot make the duplicate
   either. Once invoiced with money open, the order offers Post payment. */

const canOf = async (number) => (await describeOrder(cols, await getOrder(cols, number))).can

test('an open shipment for everything: the order offers Post shipment for it, and no Create shipment', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 12 }, { item: 20, qty: 4 }] })
  const can = await canOf(order.number)
  assert.equal(can.post, '8000000001')
  assert.equal(can.ship, false, 'the open shipment covers every unit still open')
  // Listed orders carry the same abilities as the document.
  assert.deepEqual((await listOrders(cols))[0].can, can)
})

test('an open shipment for part: Post shipment is offered, and Create shipment for the uncovered rest', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 4 }] })
  const can = await canOf(order.number)
  assert.equal(can.post, '8000000001')
  assert.equal(can.ship, true, '8 of item 10 and all 4 of item 20 are on no shipment')
})

test('with several shipments waiting, the oldest is posted first', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 4 }] })
  await createShipment(cols, order.number, { lines: [{ item: 20, qty: 4 }] })
  assert.equal((await canOf(order.number)).post, '8000000001')
  await postShipment(cols, order.number, '8000000001')
  assert.equal((await canOf(order.number)).post, '8000000002')
  await postShipment(cols, order.number, '8000000002')
  assert.equal((await canOf(order.number)).post, false)
})

test('nothing waiting to post: post is false, and a new order offers neither post nor pay', async () => {
  const order = await confirmed()
  const can = await canOf(order.number)
  assert.equal(can.post, false)
  assert.equal(can.pay, false)
  assert.equal(can.ship, true)
})

test('a shipment for quantity already on an open shipment is refused, naming the shipment waiting to be posted', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 12 }] })
  await assert.rejects(
    createShipment(cols, order.number, { lines: [{ item: 10, qty: 1 }] }),
    /Item 10: the 12 EA still open are on shipment 8000000001, waiting to be posted\. Post that shipment instead of creating another\./
  )
  // The refusal is the API's too: the route answers 400 with the same words.
  const res = await invoke(orders, cols, { method: 'POST', path: `/${order.number}/shipments`, body: { lines: [{ item: 10, qty: 12 }] } })
  assert.equal(res.statusCode, 400)
  assert.match(JSON.stringify(res.body), /shipment 8000000001, waiting to be posted/)
  assert.equal((await getOrder(cols, order.number)).shipments.length, 1, 'no second shipment was made')
})

test('an open shipment for 4 of 12 leaves 8 creatable, and 9 is refused with what remains', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 4 }] })
  await assert.rejects(
    createShipment(cols, order.number, { lines: [{ item: 10, qty: 9 }] }),
    /Item 10: 4 EA are on shipment 8000000001, waiting to be posted; 8 EA of 12 remain for a new shipment\./
  )
  const next = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 8 }] })
  assert.deepEqual(next.shipments.map((s) => [s.number, s.status, s.lines[0].qty]), [['8000000001', 'open', 4], ['8000000002', 'open', 8]])
  const can = await canOf(order.number)
  assert.equal(can.post, '8000000001')
  assert.equal(can.ship, true, 'item 20 is on no shipment yet')
})

test('a posted shipment is subtracted once: as shipped, not also as reserved', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 4 }] })
  await postShipment(cols, order.number, '8000000001')
  // 4 shipped, 8 open, none reserved: the whole 8 may go on a new shipment.
  const next = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 8 }, { item: 20, qty: 4 }] })
  assert.equal(next.shipments.length, 2)
  let can = await canOf(order.number)
  assert.deepEqual([can.post, can.ship, can.invoice], ['8000000002', false, false])
  await postShipment(cols, order.number, '8000000002')
  can = await canOf(order.number)
  assert.deepEqual([can.post, can.ship, can.invoice], [false, false, true])
})

test('the whole-order route ships through a waiting shipment rather than around it', async () => {
  const order = await confirmed()
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 4 }] })
  const shipped = await setStatus(cols, order.number, 'shipped')
  assert.deepEqual(shipped.shipments.map((s) => [s.number, s.status]), [['8000000001', 'posted'], ['8000000002', 'posted']])
  assert.deepEqual(shipped.lines.map((l) => l.shippedQty), [12, 4])
})

test('invoiced with money open, the order offers Post payment; paid, or credited, it does not', async () => {
  const { postPayment } = require('../lib/payments')
  const { creditInvoice } = require('../lib/credit-memos')
  let placed = 0
  const invoicedOrder = async () => {
    const order = await createOrder(cols, { ...input, purchaseOrderByCustomer: `PO-${++placed}` })
    await confirmOrder(cols, order.number)
    await createShipment(cols, order.number, { lines: [{ item: 10, qty: 12 }, { item: 20, qty: 4 }] })
    await postShipment(cols, order.number, (await getOrder(cols, order.number)).shipments[0].number)
    return createInvoice(cols, order.number)
  }
  const open = await invoicedOrder()
  assert.equal((await canOf(open.number)).pay, true)
  assert.equal((await listOrders(cols)).find((o) => o.number === open.number).can.pay, true)
  await postPayment(cols, open.invoice.number, { amount: 40 })
  assert.equal((await canOf(open.number)).pay, true, 'partly paid: 100 still open')
  await postPayment(cols, open.invoice.number, { amount: 100 })
  assert.equal((await canOf(open.number)).pay, false, 'paid')
  assert.equal((await listOrders(cols)).find((o) => o.number === open.number).can.pay, false)
  const credited = await invoicedOrder()
  await creditInvoice(cols, credited.number)
  assert.equal((await canOf(credited.number)).pay, false, 'credited in full')
})
