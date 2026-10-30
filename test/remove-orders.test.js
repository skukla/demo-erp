/*
 * POST admin/remove-orders (contract version 23, owner 2026-10-30): the ERP is transient, and a
 * web shop that closes some of its orders (a store wiped for the next demo) has the ERP forget
 * them too, while it keeps everything else: it may serve another demo at the same time. The
 * orders are named by the customer's reference, the web shop's order number the ERP keeps as
 * `purchaseOrderByCustomer`. Each goes with every document on it or pointing at it: its
 * shipments, invoice and credit memos (on the order), its return orders, its payments, a repeat
 * the ERP made of it, and its journal entries. Counters are untouched, so no number is reused.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const admin = require('../actions/admin')
const orders = require('../actions/orders')
const { setStatus } = require('../lib/orders')
const { createReturn, receiveReturn, creditReturn } = require('../lib/returns')
const { postPayment } = require('../lib/payments')
const { repeatOrder } = require('../lib/repeat-order')
const { findAll } = require('../lib/db')
const contract = require('../contract/erp-contract.json')

const ORIGIN = { system: 'Commerce', document: 'order' }

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: {
      projectName: 'Demo',
      products: [{ sku: 'A1', name: 'Widget', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }],
      partners: [{ id: 'P1', name: 'Acme' }]
    }
  })
})

/** A web shop order taken, shipped and invoiced: its shipment, invoice and journal entries. */
async function invoicedOrder (reference) {
  const placed = await invoke(orders, cols, {
    method: 'POST',
    body: { purchaseOrderByCustomer: reference, partnerId: 'P1', lines: [{ sku: 'A1', qty: 2, price: 10, customerLineReference: '1' }], origin: ORIGIN }
  })
  assert.equal(placed.statusCode, 201)
  const { number } = placed.body
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, number, status)
  return number
}

const all = async (name) => findAll(cols[name], {}, { limit: 10000 })
const pointsAt = (entry, number) => (entry.data && entry.data.SalesOrder === number) || (entry.value && entry.value.number === number)

test('the named orders go with their shipments, invoice, credit memo, return order, payment and journal entries; the others stay whole; no counter moves', async () => {
  const gone = await invoicedOrder('000000701')
  const { returnOrder } = await createReturn(cols, { customerReturnReference: '40', orderNumber: gone, lines: [{ customerLineReference: '1', qty: 1 }] })
  await receiveReturn(cols, returnOrder.number)
  await creditReturn(cols, returnOrder.number)
  const kept = await invoicedOrder('000000042')
  const keptOrder = (await all('salesOrders')).find((o) => o.number === kept)
  await postPayment(cols, keptOrder.invoice.number, { amount: 5, reference: 'Check 1' })
  const goneOrder = (await all('salesOrders')).find((o) => o.number === gone)
  await postPayment(cols, goneOrder.invoice.number, { amount: 5, reference: 'Check 2' })
  const counters = await all('counters')
  const keptEvents = (await all('events')).filter((e) => pointsAt(e, kept))
  assert.ok((await all('events')).some((e) => pointsAt(e, gone)), 'control: the order has journal entries to remove')

  const res = await invoke(admin, cols, { method: 'POST', path: '/remove-orders', body: { references: ['000000701', '000000999'] } })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.references, { removed: ['000000701'], notFound: ['000000999'] })
  assert.deepEqual(res.body.removed, {
    salesOrders: 1,
    shipments: 1,
    invoices: 1,
    creditMemos: 1,
    returnOrders: 1,
    payments: 1,
    events: res.body.removed.events
  })
  assert.ok(res.body.removed.events > 0)
  assert.deepEqual((await all('salesOrders')).map((o) => o.number), [kept])
  assert.deepEqual(await all('returnOrders'), [])
  assert.deepEqual((await all('payments')).map((p) => p.orderNumber), [kept])
  assert.equal((await all('events')).filter((e) => pointsAt(e, gone)).length, 0)
  assert.deepEqual((await all('events')).filter((e) => pointsAt(e, kept)), keptEvents)
  assert.deepEqual(await all('counters'), counters)
})

test('a repeat the ERP made of a removed order goes with it: it points at it', async () => {
  const placed = await invoke(orders, cols, {
    method: 'POST',
    body: { purchaseOrderByCustomer: '000000702', partnerId: 'P1', lines: [{ sku: 'A1', qty: 1, price: 10, customerLineReference: '1' }] }
  })
  await setStatus(cols, placed.body.number, 'canceled', undefined, { reason: 'Customer request' })
  await repeatOrder(cols, placed.body.number)
  assert.equal((await all('salesOrders')).length, 2, 'control: the repeat exists')

  const res = await invoke(admin, cols, { method: 'POST', path: '/remove-orders', body: { references: ['000000702'] } })

  assert.equal(res.body.removed.salesOrders, 2)
  assert.deepEqual(await all('salesOrders'), [])
})

test('removing twice removes nothing the second time', async () => {
  await invoicedOrder('000000703')
  await invoke(admin, cols, { method: 'POST', path: '/remove-orders', body: { references: ['000000703'] } })
  const again = await invoke(admin, cols, { method: 'POST', path: '/remove-orders', body: { references: ['000000703'] } })
  assert.equal(again.statusCode, 200)
  assert.deepEqual(again.body.references, { removed: [], notFound: ['000000703'] })
  assert.equal(again.body.removed.salesOrders, 0)
})

test('a call that names no reference is refused, and removes nothing', async () => {
  await invoicedOrder('000000704')
  for (const body of [{}, { references: [] }, { references: 'x' }, { references: [7] }]) {
    const res = await invoke(admin, cols, { method: 'POST', path: '/remove-orders', body })
    assert.equal(res.statusCode, 400, JSON.stringify(body))
  }
  assert.equal((await all('salesOrders')).length, 1)
})

test('from version 23 the contract names the route and the answer the code gives', async () => {
  assert.ok(contract.contractVersion >= 23)
  assert.ok(contract.routes.admin.includes('POST /remove-orders'))
  assert.deepEqual(contract.removeOrders.request, ['references'])
  const res = await invoke(admin, cols, { method: 'POST', path: '/remove-orders', body: { references: ['1'] } })
  assert.deepEqual(Object.keys(res.body.removed), contract.removeOrders.answer.removed)
  assert.deepEqual(Object.keys(res.body.references), contract.removeOrders.answer.references)
})
