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
const { importProducts } = require('../lib/products')
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

const input = { commerceOrderId: '42', commerceIncrementId: '000000042', lines: [{ sku: 'A1', qty: 12, price: 10, commerceItemId: 1 }, { sku: 'B2', qty: 4, price: 5, commerceItemId: 2 }] }

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
  assert.deepEqual(await pending(cols).then((e) => e.map((x) => x.kind)), ['order.confirmed'])
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
  const shipped = events.find((e) => e.kind === 'order.shipped')
  assert.deepEqual(shipped.value.items, [{ orderItemId: 1, qty: 5, sku: 'A1' }])
  // The warehouse the shipment named, so Commerce deducts from the matching source.
  assert.equal(shipped.value.stockSourceCode, 'east')
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
  const kinds = (await pending(cols)).map((e) => e.kind)
  assert.deepEqual(kinds, ['order.confirmed', 'order.shipped', 'order.invoiced'])
})

test('a cancellation carries its reason to Commerce', async () => {
  const order = await createOrder(cols, input)
  await cancelOrder(cols, order.number, 'Duplicate order')
  const event = (await pending(cols)).find((e) => e.kind === 'order.cancelled')
  assert.equal(event.value.reason, 'Duplicate order')
  assert.equal(event.value.status, 'cancelled')
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
  const b = await confirmOrder(cols, (await createOrder(cols, { ...input, commerceOrderId: '43' })).number)
  await createShipment(cols, a.number, { lines: [{ item: 10, qty: 12 }, { item: 20, qty: 4 }], warehouse: 'east' })
  await postShipment(cols, a.number, '8000000001')
  await createShipment(cols, b.number, { lines: [{ item: 20, qty: 1 }] })
  await createInvoice(cols, a.number)

  const list = await listShipments(cols)
  assert.deepEqual(list.map((s) => [s.number, s.orderNumber, s.status]), [['8000000002', b.number, 'open'], ['8000000001', a.number, 'posted']])
  const one = await getShipment(cols, '8000000001')
  assert.equal(one.orderNumber, a.number)
  assert.deepEqual(one.warehouse, { code: 'east', name: 'East DC' })
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
