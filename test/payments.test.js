/*
 * Incoming payments (contract version 14, AB-26s): POST invoices/:number/payments posts a
 * payment against an open invoice — Business Central's cash receipt applied to the invoice,
 * SAP's incoming payment clearing the open item. A partial payment leaves the rest open. Each
 * payment is a document numbered from 7000000001, readable at GET payments, and raises
 * payment.posted. Refusals are in words a person can act on.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const contract = require('../contract/erp-contract.json')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder, setStatus, getOrder } = require('../lib/orders')
const { importProducts } = require('../lib/products')
const { importPartners } = require('../lib/partners')
const { pending, EVENT_NAMES } = require('../lib/events')
const { STARTS, peek } = require('../lib/counters')
const { describeEvent, KIND_NAMES } = require('../lib/journal')
const invoices = require('../actions/invoices')
const payments = require('../actions/payments')
const orders = require('../actions/orders')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', creditLimit: 1000 }])
})

/* Net 40, total 42.42: the invoice total the refusal example in the brief names. */
async function invoiced (commerceOrderId = '42') {
  const order = await createOrder(cols, { commerceOrderId, commerceIncrementId: `0000000${commerceOrderId}`, partnerId: 'C1', currency: 'USD', total: 42.42, lines: [{ sku: 'A1', qty: 4, price: 10, commerceItemId: 1 }] })
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, order.number, status)
  return getOrder(cols, order.number)
}

const pay = (invoiceNumber, body) => invoke(invoices, cols, { method: 'POST', path: `${invoiceNumber}/payments`, body })
const invoiceDoc = async (number) => (await invoke(invoices, cols, { path: number })).body

test('payments have a number range of their own, from 7000000001', async () => {
  assert.equal(STARTS.payment, 7000000001)
  assert.equal((await peek(cols)).payment, '7000000001')
})

test('paying the whole open amount answers 201 with the payment document, and the invoice reads paid', async () => {
  const order = await invoiced()
  const res = await pay(order.invoice.number, { amount: 42.42, reference: '  Wire 4711  ' })
  assert.equal(res.statusCode, 201)
  assert.deepEqual(Object.keys(res.body).sort(), [...contract.payments.response].sort())
  assert.equal(res.body.number, '7000000001')
  assert.equal(res.body.partnerId, 'C1')
  assert.equal(res.body.orderNumber, order.number)
  assert.equal(res.body.invoiceNumber, order.invoice.number)
  assert.equal(res.body.amount, 42.42)
  assert.equal(res.body.currency, 'USD')
  assert.equal(res.body.reference, 'Wire 4711')
  const invoice = await invoiceDoc(order.invoice.number)
  assert.deepEqual([invoice.openAmount, invoice.paidAmount, invoice.paymentStatus, invoice.payments], [0, 42.42, 'paid', ['7000000001']])
})

test('a partial payment leaves the rest open; a second one pays it', async () => {
  const order = await invoiced()
  await pay(order.invoice.number, { amount: 20 })
  let invoice = await invoiceDoc(order.invoice.number)
  assert.deepEqual([invoice.openAmount, invoice.paidAmount, invoice.paymentStatus], [22.42, 20, 'partly paid'])
  const second = await pay(order.invoice.number, { amount: '22.42' })
  assert.equal(second.statusCode, 201)
  assert.equal(second.body.number, '7000000002')
  assert.equal(second.body.reference, null, 'no reference given')
  invoice = await invoiceDoc(order.invoice.number)
  assert.deepEqual([invoice.openAmount, invoice.paidAmount, invoice.paymentStatus, invoice.payments], [0, 42.42, 'paid', ['7000000001', '7000000002']])
})

test('refusals, in words', async () => {
  const order = await invoiced()
  const number = order.invoice.number
  const missing = await pay('9000000099', { amount: 1 })
  assert.equal(missing.statusCode, 404)
  assert.equal(missing.body.errorMessage, 'Invoice 9000000099 was not found.')
  for (const amount of [undefined, 0, -5, 'abc', null, Infinity]) {
    const res = await pay(number, { amount })
    assert.equal(res.statusCode, 400, `amount ${amount}`)
    assert.equal(res.body.errorMessage, 'A payment needs an amount: a number more than 0.')
  }
  const over = await pay(number, { amount: 50 })
  assert.equal(over.statusCode, 400)
  assert.equal(over.body.errorMessage, `Invoice ${number} has 42.42 open; a payment of 50.00 is more than that.`)
  await pay(number, { amount: 42.42 })
  const paid = await pay(number, { amount: 1 })
  assert.equal(paid.statusCode, 400)
  assert.equal(paid.body.errorMessage, `Invoice ${number} is paid; nothing is open on it.`)
  // Nothing was posted by a refusal: one payment, numbered first.
  assert.deepEqual((await invoke(payments, cols)).body.items.map((p) => p.number), ['7000000001'])
})

test('a credited invoice has nothing open to pay', async () => {
  const order = await invoiced()
  await invoke(orders, cols, { method: 'POST', path: `${order.number}/credit-memo` })
  const res = await pay(order.invoice.number, { amount: 1 })
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.errorMessage, `Invoice ${order.invoice.number} was credited; nothing is open on it.`)
})

test('payment.posted carries the order fields, the payment and its invoice', async () => {
  const order = await invoiced()
  await pay(order.invoice.number, { amount: 12.5, reference: 'Check 1001' })
  const event = (await pending(cols)).find((e) => e.kind === 'payment.posted')
  assert.equal(event.event, 'be-observer.sales_order_payment_create')
  assert.equal(EVENT_NAMES['payment.posted'], 'be-observer.sales_order_payment_create')
  assert.deepEqual(event.value, {
    id: 42,
    orderId: 42,
    incrementId: '000000042',
    erpNumber: order.number,
    paymentNumber: '7000000001',
    invoiceNumber: order.invoice.number,
    amount: 12.5,
    currency: 'USD',
    partnerId: 'C1',
    reference: 'Check 1001'
  })
})

test('GET payments lists them newest first; GET payments/:number answers one in its contract shape', async () => {
  const first = await invoiced('42')
  const second = await invoiced('43')
  await pay(first.invoice.number, { amount: 10 })
  await pay(second.invoice.number, { amount: 5 })
  const list = await invoke(payments, cols)
  assert.equal(list.statusCode, 200)
  assert.deepEqual(list.body.items.map((p) => [p.number, p.invoiceNumber, p.partnerName]), [
    ['7000000002', second.invoice.number, 'Acme'],
    ['7000000001', first.invoice.number, 'Acme']
  ])
  const one = await invoke(payments, cols, { path: '7000000001' })
  assert.deepEqual(Object.keys(one.body).sort(), [...contract.payments.response].sort())
  assert.equal(one.body.amount, 10)
  const none = await invoke(payments, cols, { path: '7000000099' })
  assert.equal(none.statusCode, 404)
  assert.equal(none.body.errorMessage, 'Payment 7000000099 was not found.')
})

test('the journal names a posted payment and links its sales order', () => {
  assert.equal(KIND_NAMES['payment.posted'], 'Payment posted')
  const described = describeEvent({ direction: 'out', event: 'be-observer.sales_order_payment_create', value: { erpNumber: '0000001002', paymentNumber: '7000000001', invoiceNumber: '9000000001', amount: 12.5, currency: 'USD' } })
  assert.equal(described.name, 'Payment posted')
  assert.equal(described.text, 'Payment 7000000001 of USD 12.50 against invoice 9000000001 for sales order 0000001002')
  assert.deepEqual(described.links, [{ kind: 'order', number: '0000001002' }])
})

test('the sales order document lists its payments', async () => {
  const order = await invoiced()
  await pay(order.invoice.number, { amount: 10 })
  const doc = (await invoke(orders, cols, { path: order.number })).body
  assert.deepEqual(doc.payments.map((p) => [p.number, p.amount]), [['7000000001', 10]])
  assert.equal(doc.payments[0]._id, undefined, 'no storage key on the document')
})
