/*
 * Credit exposure from contract version 14 (owner, 2026-09-27): the customer's open orders
 * PLUS its open items, the invoices it has not yet paid. Before, an order left exposure the
 * moment it was invoiced, paid or not. The credit check at placement and the credit decision
 * on a new order both read it, so an unpaid invoice can hold a new order and paying it
 * releases the room.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importPartners, ensureDefaultPartner, exposureOf, withCredit, listPartners, describePartner, getPartner } = require('../lib/partners')
const { importProducts } = require('../lib/products')
const { createOrder, setStatus, getOrder } = require('../lib/orders')
const { postPayment } = require('../lib/payments')
const partners = require('../actions/partners')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 100, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', creditLimit: 1000 }])
  await ensureDefaultPartner(cols, 'Demo')
})

const order = (id, qty, total) => createOrder(cols, { commerceOrderId: id, partnerId: 'C1', total, lines: [{ sku: 'A1', qty, price: 100, commerceItemId: 1 }] })

/** An order taken all the way to its invoice; its total carries 8% tax. */
async function invoiced (id, qty) {
  const placed = await order(id, qty, qty * 108)
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, placed.number, status)
  return getOrder(cols, placed.number)
}

const listed = async () => (await withCredit(cols, await listPartners(cols))).find((p) => p.id === 'C1')

test('exposure is open orders plus open items, and the list and the document agree', async () => {
  await order('1', 2)                       // open order: net 200
  const billed = await invoiced('2', 5)     // open item: total 540 (net 500 + tax)
  assert.equal(await exposureOf(cols, 'C1'), 740)
  assert.equal((await listed()).exposure, 740)
  const doc = await describePartner(cols, await getPartner(cols, 'C1'))
  assert.equal(doc.credit.exposure, 740)
  assert.equal(doc.credit.openOrders, 200)
  assert.equal(doc.credit.openItems, 540)
  assert.equal(doc.credit.available, 260)
  // A partial payment lowers it by what was paid, everywhere.
  await postPayment(cols, billed.invoice.number, { amount: 140 })
  assert.equal(await exposureOf(cols, 'C1'), 600)
  assert.equal((await listed()).exposure, 600)
  assert.equal((await describePartner(cols, await getPartner(cols, 'C1'))).credit.openItems, 400)
})

test("the customer document lists its open items: invoice, billing date, due date by its terms, what is open", async () => {
  const billed = await invoiced('2', 5)
  await postPayment(cols, billed.invoice.number, { amount: 40 })
  const paidOff = await invoiced('3', 1)
  await postPayment(cols, paidOff.invoice.number, { amount: 108 })
  const doc = await describePartner(cols, await getPartner(cols, 'C1'))
  // Only what is still open; the paid invoice is not an open item.
  assert.equal(doc.openItems.length, 1)
  const [item] = doc.openItems
  assert.equal(item.invoiceNumber, billed.invoice.number)
  assert.equal(item.orderNumber, billed.number)
  assert.equal(item.createdAt, billed.invoice.createdAt)
  // NET30 is the imported customer's terms: due thirty days after the billing date.
  const due = new Date(billed.invoice.createdAt)
  due.setUTCDate(due.getUTCDate() + 30)
  assert.equal(item.dueDate, due.toISOString())
  assert.deepEqual([item.total, item.openAmount, item.paymentStatus, item.currency], [540, 500, 'partly paid', 'USD'])
})

test('an unpaid invoice pushes a credit check over the limit; a payment brings it back under', async () => {
  const billed = await invoiced('2', 8)     // open item 864
  const check = (net) => invoke(partners, cols, { method: 'POST', path: 'C1/credit-check', body: { net } })
  const over = await check(200)
  assert.equal(over.body.status, 'held')
  assert.equal(over.body.exposure, 864)
  assert.equal(over.body.reason, 'Credit limit USD 1,000.00 exceeded by USD 64.00')
  await postPayment(cols, billed.invoice.number, { amount: 864 })
  const under = await check(200)
  assert.equal(under.body.status, 'approved')
  assert.equal(under.body.exposure, 0)
})

test("an unpaid invoice holds the customer's next order; once paid, the next one is approved", async () => {
  const billed = await invoiced('2', 8)     // open item 864
  const held = await order('3', 2)          // 864 + 200 > 1000
  assert.equal(held.creditStatus, 'held')
  assert.equal(held.creditReason, 'Credit limit USD 1,000.00 exceeded by USD 64.00')
  await postPayment(cols, billed.invoice.number, { amount: 864 })
  const approved = await order('4', 2)
  assert.equal(approved.creditStatus, 'approved')
})

test('a credited invoice is not an open item', async () => {
  const billed = await invoiced('2', 5)
  await invoke(require('../actions/orders'), cols, { method: 'POST', path: `${billed.number}/credit-memo` })
  assert.equal(await exposureOf(cols, 'C1'), 0)
  assert.deepEqual((await describePartner(cols, await getPartner(cols, 'C1'))).openItems, [])
})
