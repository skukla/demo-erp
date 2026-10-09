/*
 * Changes made IN ANOTHER SYSTEM (the customer's web shop admin) reach the ERP (bidirectional
 * review, item 1 and G4): a shipment, an invoice, a cancellation, a hold. Each arrives with
 * `origin: { system, document? }` (contract version 16) and is recorded and journaled.
 *
 * Contract version 19 (AB-26y step 5): the ERP raises its outbound event for each, as for a
 * move made here — a real ERP raises its events for every change, whoever made it. Knowing
 * that the event echoes a change it sent is the subscriber's business. A move that changes
 * nothing (a redelivery, the ERP's own shipment coming back) raises nothing.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder } = require('../lib/orders')
const { confirmOrder, receiveExternalShipment, createInvoice, cancelOrder, holdExternal, releaseCredit } = require('../lib/fulfilment')
const { importProducts, getProduct } = require('../lib/products')
const { importPartners } = require('../lib/partners')
const { pending, recent } = require('../lib/events')
const orders = require('../actions/orders')

const SYSTEM = 'Adobe Commerce'
const origin = (document) => ({ origin: { system: SYSTEM, document, eventId: `evt-${document}` } })
const SHIPMENT = 'shipment'
const INVOICE = 'invoice'
const ORDER = 'order 000000042'
const SHOP_CANCEL = 'Canceled in the web shop'

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [
    { sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }, { code: 'east', name: 'East DC', quantity: 20 }] },
    { sku: 'B2', name: 'Shirt', listPrice: 5, warehouses: [{ code: 'default', name: 'Default Source', quantity: 9 }] }
  ])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', commerceCompanyId: '7', creditLimit: 100000 }])
})

const input = { purchaseOrderByCustomer: '000000042', partnerId: 'C1', lines: [{ sku: 'A1', qty: 12, price: 10, customerLineReference: '1' }, { sku: 'B2', qty: 4, price: 5, customerLineReference: '2' }] }
const outbound = async () => (await pending(cols)).map((e) => e.type)

test('a shipment posted in the web shop becomes a posted ERP shipment by customer line reference and plant, confirms a created order, raises its goods issue event, and is journaled', async () => {
  const order = await createOrder(cols, input)
  const next = await receiveExternalShipment(cols, order.number, { externalReference: 501, lines: [{ customerLineReference: '1', qty: 5 }, { customerLineReference: '2', qty: 4 }], warehouse: 'east', ...origin(SHIPMENT) })
  assert.equal(next.header, 'confirmed')
  assert.equal(next.shipments.length, 1)
  const [shipment] = next.shipments
  assert.equal(shipment.status, 'posted')
  assert.equal(shipment.warehouse, 'east')
  assert.equal(shipment.externalReference, '501')
  assert.deepEqual(shipment.lines.map((l) => [l.item, l.sku, l.qty]), [[10, 'A1', 5], [20, 'B2', 4]])
  assert.deepEqual(next.lines.map((l) => l.shippedQty), [5, 4])
  assert.equal(next.status, 'shipped')
  const [event] = await pending(cols)
  assert.deepEqual(await outbound(), ['OutboundDelivery.GoodsIssueStatusChanged'], 'raised like any posted shipment')
  assert.deepEqual([event.data.OutboundDelivery, event.data.Plant, event.data.GoodsMovementStatus, event.data.PrevGoodsMovementStatus], [shipment.number, 'east', 'posted', 'open'])
  assert.deepEqual(event.data.Items.map((i) => [i.CustomerLineReference, i.Quantity]), [['1', 5], ['2', 4]])
  const entry = (await recent(cols)).find((e) => e.direction === 'in')
  assert.equal(entry.direction, 'in')
  assert.deepEqual(entry.origin, { system: SYSTEM, document: SHIPMENT })
  assert.equal(entry.eventId, `evt-${SHIPMENT}`)
  assert.equal(entry.summary, `Goods issue posted from ${SYSTEM}: shipment ${shipment.number} for sales order ${order.number} (9 shipped from east)`)
})

test('the same shipment from the web shop delivered twice is recorded once; one without its reference or its origin is refused; a wrong line is refused', async () => {
  const order = await createOrder(cols, input)
  const body = { externalReference: '501', lines: [{ customerLineReference: '1', qty: 5 }], ...origin(SHIPMENT) }
  await receiveExternalShipment(cols, order.number, body)
  const again = await receiveExternalShipment(cols, order.number, body)
  assert.equal(again.shipments.length, 1)
  assert.deepEqual(await outbound(), ['OutboundDelivery.GoodsIssueStatusChanged'], 'a redelivery records nothing, so raises nothing')
  assert.deepEqual(again.lines.map((l) => l.shippedQty), [5, 0])
  await assert.rejects(receiveExternalShipment(cols, order.number, { lines: [{ customerLineReference: '1', qty: 1 }], ...origin(SHIPMENT) }), /externalReference/)
  await assert.rejects(receiveExternalShipment(cols, order.number, { externalReference: '9', lines: [{ customerLineReference: '1', qty: 1 }] }), /origin\.system/)
  // The old origin shape, a web shop's event name, is not a system: refused, not read.
  await assert.rejects(receiveExternalShipment(cols, order.number, { externalReference: '9', lines: [{ customerLineReference: '1', qty: 1 }], origin: { event: 'observer.sales_order_shipment_save_after' } }), /origin\.system/)
  await assert.rejects(receiveExternalShipment(cols, order.number, { externalReference: '9', lines: [{ customerLineReference: '77', qty: 1 }], ...origin(SHIPMENT) }), /reference 77 is not on this order/)
})

test('an invoice made in the web shop invoices the ERP order and raises the invoice event, keeps its external reference, and is nothing to do twice', async () => {
  const order = await createOrder(cols, input)
  await receiveExternalShipment(cols, order.number, { externalReference: '1', lines: [{ customerLineReference: '1', qty: 12 }, { customerLineReference: '2', qty: 4 }], ...origin(SHIPMENT) })
  const invoiced = await createInvoice(cols, order.number, undefined, { externalReference: 77, ...origin(INVOICE) })
  assert.equal(invoiced.status, 'invoiced')
  assert.equal(invoiced.invoice.externalReference, '77')
  assert.deepEqual(await outbound(), ['OutboundDelivery.GoodsIssueStatusChanged', 'BillingDocument.Created'])
  assert.equal((await pending(cols))[1].data.BillingDocument, invoiced.invoice.number)
  const again = await createInvoice(cols, order.number, undefined, { ...origin(INVOICE) })
  assert.equal(again.invoice.number, invoiced.invoice.number)
  assert.equal((await outbound()).length, 2, 'nothing to do twice raises nothing')
  const entries = await recent(cols)
  assert.ok(entries.some((e) => e.summary === `Invoice ${invoiced.invoice.number} for sales order ${order.number} posted from ${SYSTEM}`))
})

test('an invoice the ERP makes itself raises its event, as one from the web shop does', async () => {
  const order = await confirmOrder(cols, (await createOrder(cols, input)).number)
  await receiveExternalShipment(cols, order.number, { externalReference: '1', lines: [{ customerLineReference: '1', qty: 12 }, { customerLineReference: '2', qty: 4 }], ...origin(SHIPMENT) })
  await createInvoice(cols, order.number)
  assert.deepEqual(await outbound(), ['SalesOrder.Changed', 'OutboundDelivery.GoodsIssueStatusChanged', 'BillingDocument.Created'])
})

test('a cancellation made in the web shop cancels the ERP order with its own reason, raises the cancel with that reason, and is nothing to do twice', async () => {
  const order = await createOrder(cols, input)
  const cancelled = await cancelOrder(cols, order.number, SHOP_CANCEL, undefined, origin(ORDER))
  assert.equal(cancelled.header, 'canceled')
  assert.equal(cancelled.cancelReason, SHOP_CANCEL)
  const [event] = await pending(cols)
  assert.deepEqual([event.type, event.data.OverallStatus, event.data.PrevOverallStatus, event.data.Reason], ['SalesOrder.Changed', 'canceled', 'created', SHOP_CANCEL])
  const again = await cancelOrder(cols, order.number, SHOP_CANCEL, undefined, origin(ORDER))
  assert.equal(again.header, 'canceled')
  assert.equal((await outbound()).length, 1, 'nothing to do twice raises nothing')
  assert.equal((await recent(cols)).filter((e) => e.direction === 'in').length, 1, 'journaled once')
})

test('a hold made in the web shop holds the ERP order with that system as the reason and raises the credit block; Confirm then refuses; a release from it lifts the block; a second hold is nothing to do', async () => {
  const order = await createOrder(cols, input)
  const held = await holdExternal(cols, order.number, undefined, origin(ORDER))
  assert.equal(held.creditStatus, 'held')
  assert.equal(held.creditReason, `Put on hold in ${SYSTEM}`)
  await assert.rejects(confirmOrder(cols, order.number), /Put on hold in Adobe Commerce\. Release the order first\./)
  assert.equal((await holdExternal(cols, order.number, undefined, origin(ORDER))).history.filter((h) => h.status === 'held').length, 1)
  const released = await releaseCredit(cols, order.number, undefined, origin(ORDER))
  assert.equal(released.creditStatus, 'released')
  const raised = (await pending(cols)).map((e) => [e.type, e.data.CreditBlock, e.data.PrevCreditBlock, e.data.Reason])
  assert.deepEqual(raised, [['SalesOrder.Changed', true, false, `Put on hold in ${SYSTEM}`], ['SalesOrder.Changed', false, true, null]], 'one hold, one release: the second hold changed nothing')
  // The shop says released about an order the ERP does not hold: nothing to do, not an error.
  assert.equal((await releaseCredit(cols, order.number, undefined, origin(ORDER))).creditStatus, 'released')
  await assert.rejects(holdExternal(cols, order.number, undefined, {}), /origin\.system/)
})

test('the routes: external-shipment and external-invoice answer 201 for a new document and 200 for one already recorded, cancel and credit/hold and credit/release take the origin', async () => {
  const created = await invoke(orders, cols, { method: 'POST', body: input })
  const number = created.body.number
  const shipped = await invoke(orders, cols, { method: 'POST', path: `/${number}/external-shipment`, body: { externalReference: 5, lines: [{ customerLineReference: '1', qty: 12 }, { customerLineReference: '2', qty: 4 }], warehouse: 'default', ...origin(SHIPMENT) } })
  assert.equal(shipped.statusCode, 201)
  assert.equal(shipped.body.shipments[0].warehouse, 'default')
  const shippedAgain = await invoke(orders, cols, { method: 'POST', path: `/${number}/external-shipment`, body: { externalReference: 5, lines: [{ customerLineReference: '1', qty: 12 }, { customerLineReference: '2', qty: 4 }], warehouse: 'default', ...origin(SHIPMENT) } })
  assert.equal(shippedAgain.statusCode, 200, 'already recorded: nothing new')
  const invoiced = await invoke(orders, cols, { method: 'POST', path: `/${number}/external-invoice`, body: { externalReference: 9, ...origin(INVOICE) } })
  assert.equal(invoiced.statusCode, 201)
  assert.equal(invoiced.body.invoice.externalReference, '9')
  const invoicedAgain = await invoke(orders, cols, { method: 'POST', path: `/${number}/external-invoice`, body: { externalReference: 9, ...origin(INVOICE) } })
  assert.equal(invoicedAgain.statusCode, 200, 'already invoiced: nothing new')
  const second = await invoke(orders, cols, { method: 'POST', body: { ...input, purchaseOrderByCustomer: '43' } })
  const held = await invoke(orders, cols, { method: 'POST', path: `/${second.body.number}/credit/hold`, body: { reason: 'Payment review', ...origin(ORDER) } })
  assert.equal(held.statusCode, 200)
  assert.equal(held.body.credit.reason, 'Payment review')
  const released = await invoke(orders, cols, { method: 'POST', path: `/${second.body.number}/credit/release`, body: origin(ORDER) })
  assert.equal(released.body.credit.status, 'released')
  const cancelled = await invoke(orders, cols, { method: 'POST', path: `/${second.body.number}/cancel`, body: { reason: SHOP_CANCEL, ...origin(ORDER) } })
  assert.equal(cancelled.body.status, 'canceled')
  assert.deepEqual(await outbound(), ['OutboundDelivery.GoodsIssueStatusChanged', 'BillingDocument.Created', 'SalesOrder.Changed', 'SalesOrder.Changed', 'SalesOrder.Changed'])
})

test("the ERP's own shipment, shipped in the web shop by the integration, comes back as an external shipment and is matched, not shipped twice", async () => {
  const { createShipment, postShipment } = require('../lib/fulfilment')
  const order = await confirmOrder(cols, (await createOrder(cols, input)).number)
  const withOwn = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 5 }], warehouse: 'east' })
  const posted = await postShipment(cols, order.number, withOwn.shipments[0].number)
  assert.deepEqual(await outbound(), ['SalesOrder.Changed', 'OutboundDelivery.GoodsIssueStatusChanged'])
  // The shop's shipment for the one the integration made from the ERP's: same lines, no external reference yet.
  const matched = await receiveExternalShipment(cols, order.number, { externalReference: '900', lines: [{ customerLineReference: '1', qty: 5 }], warehouse: 'east', ...origin(SHIPMENT) })
  assert.equal(matched.shipments.length, 1)
  assert.equal(matched.shipments[0].number, posted.shipments[0].number)
  assert.equal(matched.shipments[0].externalReference, '900')
  assert.deepEqual(matched.lines.map((l) => l.shippedQty), [5, 0], 'nothing shipped twice')
  assert.deepEqual(await outbound(), ['SalesOrder.Changed', 'OutboundDelivery.GoodsIssueStatusChanged'], 'nothing new, so nothing raised')
  const back = await invoke(orders, cols, { method: 'POST', path: `/${order.number}/external-shipment`, body: { externalReference: '900', lines: [{ customerLineReference: '1', qty: 5 }], warehouse: 'east', ...origin(SHIPMENT) } })
  assert.equal(back.statusCode, 200, 'the route says nothing new was recorded')
  // A genuinely new shipment from the shop for the rest is still recorded.
  const more = await receiveExternalShipment(cols, order.number, { externalReference: '901', lines: [{ customerLineReference: '1', qty: 7 }, { customerLineReference: '2', qty: 4 }], ...origin(SHIPMENT) })
  assert.equal(more.shipments.length, 2)
  assert.deepEqual(more.lines.map((l) => l.shippedQty), [12, 4])
  assert.equal((await outbound()).length, 3, 'the new one raises its goods issue')
  assert.equal((await recent(cols)).find((e) => e.direction === 'in' && /is ERP shipment/.test(e.summary)).summary, `Shipment 900 in ${SYSTEM} is ERP shipment ${posted.shipments[0].number} on sales order ${order.number}; nothing shipped twice`)
})

/* Goods issue (AB-63): a shipment made in the web shop takes the ERP's stock down once. */
const onHand = async (sku) => Object.fromEntries((await getProduct(cols, sku)).warehouses.map((w) => [w.code, w.quantity]))

test('a shipment posted in the web shop takes the stock out of the plant it names, once: a redelivery takes nothing more, and no stock event goes out (the goods issue says what left)', async () => {
  const order = await createOrder(cols, input)
  const body = { externalReference: '501', lines: [{ customerLineReference: '1', qty: 5 }], warehouse: 'east', ...origin(SHIPMENT) }
  await receiveExternalShipment(cols, order.number, body)
  assert.deepEqual(await onHand('A1'), { default: 50, east: 15 })
  await receiveExternalShipment(cols, order.number, body)
  assert.deepEqual(await onHand('A1'), { default: 50, east: 15 }, 'the same external reference again moves nothing')
  assert.deepEqual(await outbound(), ['OutboundDelivery.GoodsIssueStatusChanged'])
})

test("the ERP's own shipment coming back from the web shop takes no stock a second time", async () => {
  const { createShipment, postShipment } = require('../lib/fulfilment')
  const order = await confirmOrder(cols, (await createOrder(cols, input)).number)
  const withOwn = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 5 }], warehouse: 'east' })
  await postShipment(cols, order.number, withOwn.shipments[0].number)
  assert.deepEqual(await onHand('A1'), { default: 50, east: 15 })
  await receiveExternalShipment(cols, order.number, { externalReference: '900', lines: [{ customerLineReference: '1', qty: 5 }], warehouse: 'east', ...origin(SHIPMENT) })
  assert.deepEqual(await onHand('A1'), { default: 50, east: 15 })
})

test('a web shop shipment that names no plant, or one the product is not kept in, takes the stock from the default warehouse', async () => {
  const order = await createOrder(cols, input)
  await receiveExternalShipment(cols, order.number, { externalReference: '1', lines: [{ customerLineReference: '1', qty: 2 }], ...origin(SHIPMENT) })
  assert.deepEqual(await onHand('A1'), { default: 48, east: 20 })
  await receiveExternalShipment(cols, order.number, { externalReference: '2', lines: [{ customerLineReference: '2', qty: 4 }], warehouse: 'east', ...origin(SHIPMENT) })
  assert.deepEqual(await onHand('B2'), { default: 5 })
})

test('a web shop shipment of more than the ERP has on hand is still recorded (the goods have left): on hand stops at zero and the journal says how many were missing', async () => {
  await importProducts(cols, [{ sku: 'C3', name: 'Belt', listPrice: 8, warehouses: [{ code: 'default', name: 'Default Source', quantity: 3 }] }])
  const order = await createOrder(cols, { purchaseOrderByCustomer: '000000077', partnerId: 'C1', lines: [{ sku: 'C3', qty: 5, price: 8, customerLineReference: '1' }] })
  const next = await receiveExternalShipment(cols, order.number, { externalReference: '77', lines: [{ customerLineReference: '1', qty: 5 }], warehouse: 'default', ...origin(SHIPMENT) })
  assert.equal(next.lines[0].shippedQty, 5)
  assert.deepEqual(await onHand('C3'), { default: 0 })
  const [entry] = await recent(cols)
  assert.equal(entry.summary, `Goods issue posted from ${SYSTEM}: shipment ${next.shipments[0].number} for sales order ${order.number} (5 shipped from default). On hand was short: C3 had 3 EA in default, 2 fewer than shipped.`)
})

test('the contract says so from version 19: an external move raises its event, and the two document routes answer 201 or 200', () => {
  const contract = require('../contract/erp-contract.json')
  assert.ok(contract.contractVersion >= 19)
  assert.match(contract.order.external.note, /version 19/)
  assert.match(contract.order.external.note, /raises its outbound event for such a move exactly as for its own/)
  assert.match(contract.order.external.note, /201 when they record a new document and 200 when it was already recorded/)
})

/* Contract version 21: a shipment posted in the web shop while an ERP shipment waits to be
   posted for the same goods. The web shop's goods have left, so it is recorded, never refused;
   the waiting ERP shipment would then carry goods no longer open and could never post, so the
   ERP takes the difference off it (the newest waiting first), removes it when nothing is left on
   it, and says so in the journal entry. Nothing on a waiting shipment had moved stock. */

test('a web shop shipment for goods on a waiting ERP shipment is recorded, and the waiting shipment is removed', async () => {
  const { createShipment, postShipment } = require('../lib/fulfilment')
  const order = await confirmOrder(cols, (await createOrder(cols, input)).number)
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 12 }] })
  const next = await receiveExternalShipment(cols, order.number, { externalReference: 'S-1', lines: [{ customerLineReference: '1', qty: 12 }], ...origin(SHIPMENT) })
  assert.deepEqual(next.shipments.map((s) => [s.number, s.status, s.externalReference ?? null]), [['8000000002', 'posted', 'S-1']])
  assert.equal(next.lines[0].shippedQty, 12)
  const entry = (await recent(cols)).find((e) => e.direction === 'in')
  assert.match(entry.summary, /shipment 8000000001, waiting to be posted, removed: its goods left in Adobe Commerce/)
  // Nothing is stuck: the order has no shipment to post and item 20 can still ship.
  const { describeOrder, getOrder } = require('../lib/orders')
  const can = (await describeOrder(cols, await getOrder(cols, order.number))).can
  assert.deepEqual([can.post, can.ship], [false, true])
  void postShipment
})

test('a web shop shipment for part of a waiting ERP shipment\'s goods reduces it, and the rest still posts', async () => {
  const { createShipment, postShipment } = require('../lib/fulfilment')
  const order = await confirmOrder(cols, (await createOrder(cols, input)).number)
  await createShipment(cols, order.number, { lines: [{ item: 10, qty: 10 }] }) // 2 of 12 on no shipment
  const next = await receiveExternalShipment(cols, order.number, { externalReference: 'S-2', lines: [{ customerLineReference: '1', qty: 5 }], ...origin(SHIPMENT) })
  // 5 left in the web shop: 2 were on no shipment, 3 come off 8000000001, which keeps 7.
  const waiting = next.shipments.find((s) => s.number === '8000000001')
  assert.deepEqual([waiting.status, waiting.lines[0].qty], ['open', 7])
  const entry = (await recent(cols)).find((e) => e.direction === 'in')
  assert.match(entry.summary, /shipment 8000000001, waiting to be posted, reduced by 3: its goods left in Adobe Commerce/)
  const posted = await postShipment(cols, order.number, '8000000001')
  assert.equal(posted.lines[0].shippedQty, 12)
})
