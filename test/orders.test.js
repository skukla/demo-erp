const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { createOrder, setStatus, nextStatuses } = require('../lib/orders')
const { importPartners, ensureDefaultPartner } = require('../lib/partners')
const { wipe } = require('../lib/admin')
const { pending } = require('../lib/outbox')

let cols
beforeEach(() => { cols = memoryCollections() })

const input = { commerceOrderId: '42', commerceIncrementId: '000000042', partnerId: 'P1', lines: [{ sku: 'A1', qty: 2, price: 10 }] }

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

test('status moves follow the machine and each move lands in the outbox', async () => {
  const order = await createOrder(cols, input)
  await setStatus(cols, order.number, 'confirmed')
  const shipped = await setStatus(cols, order.number, 'shipped')
  assert.equal(shipped.status, 'shipped')
  assert.deepEqual(shipped.history.map((h) => h.status), ['created', 'confirmed', 'shipped'])
  const entries = await pending(cols)
  assert.deepEqual(entries.map((e) => [e.kind, e.status]), [['order.status', 'confirmed'], ['order.status', 'shipped']])
  assert.equal(entries[0].commerceOrderId, '42')
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
