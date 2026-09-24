/*
 * Changes made IN Commerce Admin reach the ERP (bidirectional review, item 1 and G4): a
 * shipment, an invoice, a cancellation, a hold. Each arrives with `origin: { event }`, is
 * recorded and journaled, and raises NO outbound event — Commerce already has the change,
 * and the ERP's own event would have made Commerce do it a second time.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder, getOrder } = require('../lib/orders')
const { confirmOrder, receiveShipment, createInvoice, cancelOrder, holdFromCommerce, releaseCredit } = require('../lib/fulfilment')
const { importProducts } = require('../lib/products')
const { importPartners } = require('../lib/partners')
const { pending, recent } = require('../lib/events')
const orders = require('../actions/orders')

const SHIPMENT_EVENT = 'observer.sales_order_shipment_save_after'
const INVOICE_EVENT = 'observer.sales_order_invoice_save_after'
const ORDER_EVENT = 'observer.sales_order_save_commit_after'
const origin = (event) => ({ origin: { event, eventId: `evt-${event}` } })

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [
    { sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }, { code: 'east', name: 'East DC', quantity: 20 }] },
    { sku: 'B2', name: 'Shirt', listPrice: 5, warehouses: [{ code: 'default', name: 'Default Source', quantity: 9 }] }
  ])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', commerceCompanyId: '7', creditLimit: 100000 }])
})

const input = { commerceOrderId: '42', commerceIncrementId: '000000042', partnerId: 'C1', lines: [{ sku: 'A1', qty: 12, price: 10, commerceItemId: 1 }, { sku: 'B2', qty: 4, price: 5, commerceItemId: 2 }] }
const outbound = async () => (await pending(cols)).map((e) => e.kind)

test('a shipment made in Commerce becomes a posted ERP shipment by Commerce item id and source, confirms a created order, raises no event, and is journaled', async () => {
  const order = await createOrder(cols, input)
  const next = await receiveShipment(cols, order.number, { commerceShipmentId: 501, items: [{ orderItemId: 1, qty: 5 }, { orderItemId: 2, qty: 4 }], sourceCode: 'east', ...origin(SHIPMENT_EVENT) })
  assert.equal(next.header, 'confirmed')
  assert.equal(next.shipments.length, 1)
  const [shipment] = next.shipments
  assert.equal(shipment.status, 'posted')
  assert.equal(shipment.warehouse, 'east')
  assert.equal(shipment.commerceShipmentId, '501')
  assert.deepEqual(shipment.lines.map((l) => [l.item, l.sku, l.qty]), [[10, 'A1', 5], [20, 'B2', 4]])
  assert.deepEqual(next.lines.map((l) => l.shippedQty), [5, 4])
  assert.equal(next.status, 'shipped')
  assert.deepEqual(await outbound(), [], 'nothing goes back to Commerce: it made the shipment')
  const [entry] = await recent(cols)
  assert.equal(entry.direction, 'in')
  assert.equal(entry.event, SHIPMENT_EVENT)
  assert.equal(entry.eventId, `evt-${SHIPMENT_EVENT}`)
  assert.equal(entry.summary, `Shipment ${shipment.number} for sales order ${order.number} received from Commerce (9 shipped from east)`)
})

test('the same Commerce shipment delivered twice is recorded once; one without its id or its event is refused; a wrong item is refused', async () => {
  const order = await createOrder(cols, input)
  const body = { commerceShipmentId: '501', items: [{ orderItemId: 1, qty: 5 }], ...origin(SHIPMENT_EVENT) }
  await receiveShipment(cols, order.number, body)
  const again = await receiveShipment(cols, order.number, body)
  assert.equal(again.shipments.length, 1)
  assert.deepEqual(again.lines.map((l) => l.shippedQty), [5, 0])
  await assert.rejects(receiveShipment(cols, order.number, { items: [{ orderItemId: 1, qty: 1 }], ...origin(SHIPMENT_EVENT) }), /commerceShipmentId/)
  await assert.rejects(receiveShipment(cols, order.number, { commerceShipmentId: '9', items: [{ orderItemId: 1, qty: 1 }] }), /origin\.event/)
  await assert.rejects(receiveShipment(cols, order.number, { commerceShipmentId: '9', items: [{ orderItemId: 77, qty: 1 }], ...origin(SHIPMENT_EVENT) }), /item 77 is not on this order/)
})

test('an invoice made in Commerce invoices the ERP order without raising the invoice event, keeps the Commerce invoice id, and is nothing to do twice', async () => {
  const order = await createOrder(cols, input)
  await receiveShipment(cols, order.number, { commerceShipmentId: '1', items: [{ orderItemId: 1, qty: 12 }, { orderItemId: 2, qty: 4 }], ...origin(SHIPMENT_EVENT) })
  const invoiced = await createInvoice(cols, order.number, undefined, { commerceInvoiceId: 77, ...origin(INVOICE_EVENT) })
  assert.equal(invoiced.status, 'invoiced')
  assert.equal(invoiced.invoice.commerceInvoiceId, '77')
  assert.deepEqual(await outbound(), [])
  const again = await createInvoice(cols, order.number, undefined, { ...origin(INVOICE_EVENT) })
  assert.equal(again.invoice.number, invoiced.invoice.number)
  const entries = await recent(cols)
  assert.ok(entries.some((e) => e.summary === `Invoice ${invoiced.invoice.number} for sales order ${order.number} received from Commerce`))
})

test('an invoice the ERP makes itself still raises its event: the origin is what silences it', async () => {
  const order = await confirmOrder(cols, (await createOrder(cols, input)).number)
  await receiveShipment(cols, order.number, { commerceShipmentId: '1', items: [{ orderItemId: 1, qty: 12 }, { orderItemId: 2, qty: 4 }], ...origin(SHIPMENT_EVENT) })
  await createInvoice(cols, order.number)
  assert.deepEqual(await outbound(), ['order.confirmed', 'order.invoiced'])
})

test('a cancellation made in Commerce cancels the ERP order with its own reason, raises no event, and is nothing to do twice', async () => {
  const order = await createOrder(cols, input)
  const cancelled = await cancelOrder(cols, order.number, 'Cancelled in Commerce', undefined, origin(ORDER_EVENT))
  assert.equal(cancelled.header, 'cancelled')
  assert.equal(cancelled.cancelReason, 'Cancelled in Commerce')
  assert.deepEqual(await outbound(), [])
  const again = await cancelOrder(cols, order.number, 'Cancelled in Commerce', undefined, origin(ORDER_EVENT))
  assert.equal(again.header, 'cancelled')
  assert.equal((await recent(cols)).filter((e) => e.direction === 'in').length, 1, 'journaled once')
})

test('a hold made in Commerce holds the ERP order with Commerce as the reason; Confirm then refuses; a release from Commerce clears it without an event; a second hold is nothing to do', async () => {
  const order = await createOrder(cols, input)
  const held = await holdFromCommerce(cols, order.number, undefined, origin(ORDER_EVENT))
  assert.equal(held.creditStatus, 'held')
  assert.equal(held.creditReason, 'Put on hold in Commerce')
  await assert.rejects(confirmOrder(cols, order.number), /Put on hold in Commerce\. Release the order first\./)
  assert.equal((await holdFromCommerce(cols, order.number, undefined, origin(ORDER_EVENT))).history.filter((h) => h.status === 'held').length, 1)
  const released = await releaseCredit(cols, order.number, undefined, origin(ORDER_EVENT))
  assert.equal(released.creditStatus, 'released')
  assert.deepEqual(await outbound(), [], 'Commerce did both; nothing goes back')
  // Commerce says released about an order the ERP does not hold: nothing to do, not an error.
  assert.equal((await releaseCredit(cols, order.number, undefined, origin(ORDER_EVENT))).creditStatus, 'released')
  await assert.rejects(holdFromCommerce(cols, order.number, undefined, {}), /origin\.event/)
})

test('the routes: commerce-shipment and commerce-invoice answer 201, cancel and credit/hold and credit/release take the origin', async () => {
  const created = await invoke(orders, cols, { method: 'POST', body: input })
  const number = created.body.number
  const shipped = await invoke(orders, cols, { method: 'POST', path: `/${number}/commerce-shipment`, body: { commerceShipmentId: 5, items: [{ orderItemId: 1, qty: 12 }, { orderItemId: 2, qty: 4 }], sourceCode: 'default', ...origin(SHIPMENT_EVENT) } })
  assert.equal(shipped.statusCode, 201)
  assert.equal(shipped.body.shipments[0].warehouse, 'default')
  const invoiced = await invoke(orders, cols, { method: 'POST', path: `/${number}/commerce-invoice`, body: { commerceInvoiceId: 9, ...origin(INVOICE_EVENT) } })
  assert.equal(invoiced.statusCode, 201)
  assert.equal(invoiced.body.invoice.commerceInvoiceId, '9')
  const second = await invoke(orders, cols, { method: 'POST', body: { ...input, commerceOrderId: '43' } })
  const held = await invoke(orders, cols, { method: 'POST', path: `/${second.body.number}/credit/hold`, body: { reason: 'Payment review', ...origin(ORDER_EVENT) } })
  assert.equal(held.statusCode, 200)
  assert.equal(held.body.credit.reason, 'Payment review')
  const released = await invoke(orders, cols, { method: 'POST', path: `/${second.body.number}/credit/release`, body: origin(ORDER_EVENT) })
  assert.equal(released.body.credit.status, 'released')
  const cancelled = await invoke(orders, cols, { method: 'POST', path: `/${second.body.number}/cancel`, body: { reason: 'Cancelled in Commerce', ...origin(ORDER_EVENT) } })
  assert.equal(cancelled.body.status, 'cancelled')
  assert.deepEqual(await outbound(), [])
})

test("the ERP's own shipment, shipped in Commerce by the integration, comes back as a Commerce shipment event and is matched, not shipped twice", async () => {
  const { createShipment, postShipment } = require('../lib/fulfilment')
  const order = await confirmOrder(cols, (await createOrder(cols, input)).number)
  const withOwn = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 5 }], warehouse: 'east' })
  const posted = await postShipment(cols, order.number, withOwn.shipments[0].number)
  assert.deepEqual(await outbound(), ['order.confirmed', 'order.shipped'])
  // Commerce's event for the shipment the integration made from the ERP's: same lines, no Commerce id yet.
  const matched = await receiveShipment(cols, order.number, { commerceShipmentId: '900', items: [{ orderItemId: 1, qty: 5 }], sourceCode: 'east', ...origin(SHIPMENT_EVENT) })
  assert.equal(matched.shipments.length, 1)
  assert.equal(matched.shipments[0].number, posted.shipments[0].number)
  assert.equal(matched.shipments[0].commerceShipmentId, '900')
  assert.deepEqual(matched.lines.map((l) => l.shippedQty), [5, 0], 'nothing shipped twice')
  // A genuinely new Commerce shipment for the rest is still recorded.
  const more = await receiveShipment(cols, order.number, { commerceShipmentId: '901', items: [{ orderItemId: 1, qty: 7 }, { orderItemId: 2, qty: 4 }], ...origin(SHIPMENT_EVENT) })
  assert.equal(more.shipments.length, 2)
  assert.deepEqual(more.lines.map((l) => l.shippedQty), [12, 4])
  assert.equal((await recent(cols)).find((e) => e.direction === 'in' && /is ERP shipment/.test(e.summary)).summary, `Commerce shipment 900 is ERP shipment ${posted.shipments[0].number} on sales order ${order.number}; nothing shipped twice`)
})
