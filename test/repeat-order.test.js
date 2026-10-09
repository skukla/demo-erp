/*
 * Repeat order (AB-26r; erp-screen-realism §6.4, owner O4 2026-09-24): a canceled order is
 * terminal — it cannot be reinstated — and the way back is a NEW sales order with the same
 * lines, made in the ERP from the canceled one (SAP's "create with reference").
 *
 * The new order is the ERP's own: the customer's web shop never had it, so it carries no
 * customer reference (purchaseOrderByCustomer null) and no line references, and nothing the
 * web shop paid at checkout (the web shop owns the gateway; the ERP takes no card). It goes
 * through the credit check like any order.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder, setStatus, getOrder, describeOrder } = require('../lib/orders')
const { repeatOrder } = require('../lib/repeat-order')
const { importProducts } = require('../lib/products')
const { importPartners, patchPartner } = require('../lib/partners')
const { pending } = require('../lib/events')
const orders = require('../actions/orders')

const CARD = { method: 'card', reference: 'TX1', cardBrand: 'Visa', cardLastFour: '4242', amount: 46 }

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }, { sku: 'B2', name: 'Shirt', listPrice: 5, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', creditLimit: 1000 }])
})

/* Net 40 - 2 + 10 = 48 less nothing; total 51.84 (the web shop's tax on top). */
const placed = (extra = {}) => createOrder(cols, {
  purchaseOrderByCustomer: '000000042',
  partnerId: 'C1',
  currency: 'EUR',
  salesOrg: '2000',
  salesOrgName: 'Europe',
  total: 51.84,
  lines: [{ sku: 'A1', qty: 4, price: 10, discount: 2, customerLineReference: '7' }, { sku: 'B2', qty: 2, price: 5, customerLineReference: '8' }],
  ...extra
})

async function canceled (extra) {
  const order = await placed(extra)
  await setStatus(cols, order.number, 'canceled', undefined, { reason: 'Customer request' })
  return order
}

test('a canceled order repeats as a new sales order with the same lines, customer, sales organization, currency and total, and no reference of the web shop', async () => {
  const original = await canceled()
  const repeat = await repeatOrder(cols, original.number)
  assert.notEqual(repeat.number, original.number)
  assert.equal(repeat.status, 'created')
  assert.equal(repeat.partnerId, 'C1')
  assert.equal(repeat.salesOrg, '2000')
  assert.equal(repeat.salesOrgName, 'Europe')
  assert.equal(repeat.currency, 'EUR')
  assert.equal(repeat.total, 51.84)
  assert.equal(repeat.purchaseOrderByCustomer, null)
  assert.equal(repeat.payment, null)
  assert.equal(repeat.repeatOf, original.number)
  assert.deepEqual(
    repeat.lines.map((l) => [l.item, l.sku, l.qty, l.price, l.discount, l.customerLineReference, l.shippedQty, l.closedQty]),
    [[10, 'A1', 4, 10, 2, null, 0, 0], [20, 'B2', 2, 5, 0, null, 0, 0]]
  )
  assert.deepEqual(repeat.history.map((h) => [h.status, h.repeatOf]), [['created', original.number]])
})

test('the canceled order stays canceled and names the order that repeated it', async () => {
  const original = await canceled()
  const repeat = await repeatOrder(cols, original.number)
  const after = await getOrder(cols, original.number)
  assert.equal(after.status, 'canceled')
  assert.equal(after.repeatedAs, repeat.number)
  assert.deepEqual(after.history.map((h) => h.status), ['created', 'canceled', 'repeated'])
  assert.equal(after.history.at(-1).order, repeat.number)
})

test('only a canceled order repeats, and only once: each refusal says why', async () => {
  const open = await placed()
  await assert.rejects(repeatOrder(cols, open.number), { statusCode: 400, message: `Sales order ${open.number} is not canceled; only a canceled order is repeated.` })
  const original = await canceled({ purchaseOrderByCustomer: '000000043' })
  const repeat = await repeatOrder(cols, original.number)
  await assert.rejects(repeatOrder(cols, original.number), (e) => e.statusCode === 400 && new RegExp(`^This order was repeated as sales order ${repeat.number} on `).test(e.message))
  await assert.rejects(repeatOrder(cols, '0000009999'), { statusCode: 404 })
})

test('the repeat is not paid at checkout: it goes through the credit check like an order on account', async () => {
  const original = await canceled({ payment: CARD })
  assert.equal(original.payment.reference, 'TX1')
  await patchPartner(cols, 'C1', { creditLimit: 10 })
  const repeat = await repeatOrder(cols, original.number)
  assert.equal(repeat.payment, null)
  assert.equal(repeat.creditStatus, 'held')
})

test('a repeat raises no event of its own; its moves raise their events with no customer reference, so a subscriber can tell the web shop never had it', async () => {
  const original = await canceled()
  const before = (await pending(cols)).length
  const repeat = await repeatOrder(cols, original.number)
  assert.equal((await pending(cols)).length, before)
  await setStatus(cols, repeat.number, 'confirmed')
  const [confirmed] = (await pending(cols)).slice(before)
  assert.equal(confirmed.data.SalesOrder, repeat.number)
  assert.equal(confirmed.data.PurchaseOrderByCustomer, null)
  assert.deepEqual(confirmed.data.Items.map((i) => i.CustomerLineReference), [null, null])
})

test('the route: POST orders/:number/repeat answers the new order\'s document, 201; the canceled document offers Repeat once', async () => {
  const original = await canceled()
  assert.equal((await describeOrder(cols, await getOrder(cols, original.number))).can.repeat, true)
  const res = await invoke(orders, cols, { method: 'POST', path: `/${original.number}/repeat` })
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.repeatOf, original.number)
  assert.equal(res.body.status, 'created')
  assert.ok(Array.isArray(res.body.lines) && res.body.lines[0].name === 'Trouser', 'the document, not the record')
  assert.equal((await describeOrder(cols, await getOrder(cols, original.number))).can.repeat, false)
  const open = await describeOrder(cols, await getOrder(cols, res.body.number))
  assert.equal(open.can.repeat, false)
})

test('the contract is at version 19: the repeat route, and repeatOf and repeatedAs on every order', async () => {
  const contract = require('../contract/erp-contract.json')
  assert.ok(contract.contractVersion >= 19)
  assert.ok(contract.routes.orders.includes('POST /:number/repeat'))
  assert.match(contract.order.repeatNote, /version 19/)
  const plain = await placed()
  const answered = (await invoke(orders, cols, { path: `/${plain.number}` })).body
  for (const key of ['repeatOf', 'repeatedAs']) {
    assert.ok(contract.order.response.includes(key), key)
    assert.equal(answered[key], null, `${key} is null on an order that is no repeat`)
  }
})
