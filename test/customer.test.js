/*
 * The customer document. The list holds a row; the document holds the customer as an
 * ERP's business-partner master shows it — the account's facts, its credit, its orders
 * and the pricing agreed with it.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importPartners, ensureDefaultPartner, getPartner, describePartner } = require('../lib/partners')
const { createOrder, setStatus } = require('../lib/orders')
const { upsertCondition } = require('../lib/conditions')
const partners = require('../actions/partners')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importPartners(cols, [{ id: 'C1', name: 'Acme', commerceCompanyId: '7', creditLimit: 1000 }])
  await ensureDefaultPartner(cols, 'Demo')
})

test('credit exposure is the net of orders not yet invoiced and not cancelled; available is what is left', async () => {
  const open = await createOrder(cols, { commerceOrderId: '1', partnerId: 'C1', lines: [{ sku: 'A1', qty: 2, price: 100 }], total: 216 })
  await setStatus(cols, open.number, 'confirmed')
  const done = await createOrder(cols, { commerceOrderId: '2', partnerId: 'C1', lines: [{ sku: 'A1', qty: 1, price: 300 }] })
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, done.number, status)
  const gone = await createOrder(cols, { commerceOrderId: '3', partnerId: 'C1', lines: [{ sku: 'A1', qty: 1, price: 500 }] })
  await setStatus(cols, gone.number, 'cancelled', undefined, { reason: 'Customer request' })
  await createOrder(cols, { commerceOrderId: '4', partnerId: 'P000000', lines: [{ sku: 'A1', qty: 1, price: 50 }] })

  const doc = await describePartner(cols, await getPartner(cols, 'C1'))

  // Net, not what Commerce charged: exposure is what the customer owes for goods.
  assert.deepEqual(doc.credit, { limit: 1000, exposure: 200, available: 800 })
})

test('exposure can exceed the limit, and available then reads below zero rather than hiding it', async () => {
  await createOrder(cols, { commerceOrderId: '1', partnerId: 'C1', lines: [{ sku: 'A1', qty: 3, price: 400 }] })
  const doc = await describePartner(cols, await getPartner(cols, 'C1'))
  assert.deepEqual(doc.credit, { limit: 1000, exposure: 1200, available: -200 })
})

test('a customer with no Commerce company has no credit — the card is absent, not zero', async () => {
  await createOrder(cols, { commerceOrderId: '1', partnerId: 'P000000', lines: [{ sku: 'A1', qty: 1, price: 50 }] })
  const doc = await describePartner(cols, await getPartner(cols, 'P000000'))
  assert.equal(doc.credit, null)
  assert.equal(doc.orders.length, 1)
})

test('the document lists this customer\'s orders newest first, each with its net amount', async () => {
  await createOrder(cols, { commerceOrderId: '1', partnerId: 'C1', lines: [{ sku: 'A1', qty: 2, price: 10 }], total: 21.6 })
  await createOrder(cols, { commerceOrderId: '2', partnerId: 'C1', lines: [{ sku: 'B2', qty: 1, price: 5 }] })
  await createOrder(cols, { commerceOrderId: '3', partnerId: 'P000000', lines: [{ sku: 'A1', qty: 1, price: 50 }] })

  const doc = await describePartner(cols, await getPartner(cols, 'C1'))

  assert.deepEqual(doc.orders.map((o) => [o.number, o.net, o.status]), [['0000001001', 5, 'created'], ['0000001000', 20, 'created']])
  assert.deepEqual(Object.keys(doc.orders[0]).sort(), ['commerceIncrementId', 'commerceOrderId', 'createdAt', 'currency', 'net', 'number', 'status'])
})

test('the document carries the pricing conditions agreed with this customer and no others', async () => {
  await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'C1', percent: 10 })
  await upsertCondition(cols, { kind: 'contractPrice', partnerId: 'C1', sku: 'A1', price: 80 })
  await upsertCondition(cols, { kind: 'maxDiscount', percent: 50 })
  await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'C9', percent: 99 })

  const doc = await describePartner(cols, await getPartner(cols, 'C1'))

  assert.deepEqual(doc.conditions.map((c) => c.kind).sort(), ['contractDiscount', 'contractPrice'])
})

test('GET partners/:id answers the document, and 404s an unknown customer', async () => {
  await createOrder(cols, { commerceOrderId: '1', partnerId: 'C1', lines: [{ sku: 'A1', qty: 1, price: 40 }] })
  const res = await invoke(partners, cols, { path: '/C1' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.name, 'Acme')
  assert.equal(res.body.credit.exposure, 40)
  assert.equal(res.body.orders.length, 1)
  assert.deepEqual(res.body.conditions, [])
  assert.equal((await invoke(partners, cols, { path: '/ZZ' })).statusCode, 404)
})
