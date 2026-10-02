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

test('credit exposure is the net of orders not yet invoiced and not canceled, plus the unpaid invoices (v14); available is what is left', async () => {
  const open = await createOrder(cols, { purchaseOrderByCustomer: '1', partnerId: 'C1', lines: [{ sku: 'A1', qty: 2, price: 100 }], total: 216 })
  await setStatus(cols, open.number, 'confirmed')
  const done = await createOrder(cols, { purchaseOrderByCustomer: '2', partnerId: 'C1', lines: [{ sku: 'A1', qty: 1, price: 300 }] })
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, done.number, status)
  const gone = await createOrder(cols, { purchaseOrderByCustomer: '3', partnerId: 'C1', lines: [{ sku: 'A1', qty: 1, price: 500 }] })
  await setStatus(cols, gone.number, 'canceled', undefined, { reason: 'Customer request' })
  await createOrder(cols, { purchaseOrderByCustomer: '4', partnerId: 'P000000', lines: [{ sku: 'A1', qty: 1, price: 50 }] })

  const doc = await describePartner(cols, await getPartner(cols, 'C1'))

  // An open order counts at its net; the invoiced one is an open item until it is paid
  // (contract version 14), at its invoice total (300: no tax was charged on it).
  assert.deepEqual(doc.credit, { limit: 1000, exposure: 500, openOrders: 200, openItems: 300, available: 500, held: 0 })
})

test('an order that would take exposure past the limit is held and not yet counted; released, it counts and available reads below zero', async () => {
  const over = await createOrder(cols, { purchaseOrderByCustomer: '1', partnerId: 'C1', lines: [{ sku: 'A1', qty: 3, price: 400 }] })
  assert.deepEqual((await describePartner(cols, await getPartner(cols, 'C1'))).credit, { limit: 1000, exposure: 0, openOrders: 0, openItems: 0, available: 1000, held: 1 })
  await require('../lib/fulfilment').releaseCredit(cols, over.number)
  assert.deepEqual((await describePartner(cols, await getPartner(cols, 'C1'))).credit, { limit: 1000, exposure: 1200, openOrders: 1200, openItems: 0, available: -200, held: 0 })
})

test('the walk-in customer has no credit — the card is absent, not zero', async () => {
  await createOrder(cols, { purchaseOrderByCustomer: '1', partnerId: 'P000000', lines: [{ sku: 'A1', qty: 1, price: 50 }] })
  const doc = await describePartner(cols, await getPartner(cols, 'P000000'))
  assert.equal(doc.credit, null)
  assert.equal(doc.orders.length, 1)
})

test('the document lists this customer\'s orders newest first, each with its net amount', async () => {
  await createOrder(cols, { purchaseOrderByCustomer: '1', partnerId: 'C1', lines: [{ sku: 'A1', qty: 2, price: 10 }], total: 21.6 })
  await createOrder(cols, { purchaseOrderByCustomer: '2', partnerId: 'C1', lines: [{ sku: 'B2', qty: 1, price: 5 }] })
  await createOrder(cols, { purchaseOrderByCustomer: '3', partnerId: 'P000000', lines: [{ sku: 'A1', qty: 1, price: 50 }] })

  const doc = await describePartner(cols, await getPartner(cols, 'C1'))

  assert.deepEqual(doc.orders.map((o) => [o.number, o.net, o.status]), [['0000001001', 5, 'created'], ['0000001000', 20, 'created']])
  assert.deepEqual(Object.keys(doc.orders[0]).sort(), ['createdAt', 'creditStatus', 'currency', 'net', 'number', 'purchaseOrderByCustomer', 'status'])
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
  await createOrder(cols, { purchaseOrderByCustomer: '1', partnerId: 'C1', lines: [{ sku: 'A1', qty: 1, price: 40 }] })
  const res = await invoke(partners, cols, { path: '/C1' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.name, 'Acme')
  assert.equal(res.body.credit.exposure, 40)
  assert.equal(res.body.orders.length, 1)
  assert.deepEqual(res.body.conditions, [])
  assert.equal((await invoke(partners, cols, { path: '/ZZ' })).statusCode, 404)
})

test('the customer document lists the price lists that apply to it: its own, newest first, then its price group\'s', async () => {
  const { importProducts } = require('../lib/products')
  const { createContract } = require('../lib/contracts')
  const { savePriceGroup } = require('../lib/price-groups')
  const { patchPartner } = require('../lib/partners')
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 100 }])
  await importPartners(cols, [{ id: 'C2', name: 'Other' }])
  await savePriceGroup(cols, { code: 'RETAIL', name: 'Retail' })
  await savePriceGroup(cols, { code: 'TRADE', name: 'Trade' })
  const first = await createContract(cols, { partnerId: 'C1', startingDate: '2026-01-01', lines: [{ sku: 'A1', kind: 'price', price: 80 }] })
  const second = await createContract(cols, { partnerId: 'C1', startingDate: '2026-07-01' })
  const retail = await createContract(cols, { appliesTo: 'priceGroup', priceGroup: 'RETAIL', startingDate: '2026-01-01' })
  await createContract(cols, { appliesTo: 'priceGroup', priceGroup: 'TRADE', startingDate: '2026-01-01' })
  await createContract(cols, { partnerId: 'C2', startingDate: '2026-01-01' })
  await patchPartner(cols, 'C1', { priceGroup: 'RETAIL' })
  const doc = await describePartner(cols, await getPartner(cols, 'C1'))
  assert.equal(doc.priceGroup, 'RETAIL')
  assert.deepEqual(doc.contracts.map((c) => c.number), [second.number, first.number, retail.number])
})
