/*
 * Paid at checkout (contract version 18, AB-26s card half; owner 2026-10-02, flow 1): the
 * customer's web shop took the money (a card, through its own gateway) and the order arrives
 * with a PAYMENT REFERENCE — method, the gateway's transaction id, card brand, last four
 * digits, amount — never a card number. The ERP keeps the reference on the order, and when it
 * posts the invoice it posts an incoming payment carrying that reference, so the invoice
 * closes with nothing open (Business Central's web-shop pattern). The money is the web
 * shop's story: the ERP raises no payment event for it, and counts none of it as credit.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const contract = require('../contract/erp-contract.json')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder, setStatus, getOrder } = require('../lib/orders')
const { importProducts } = require('../lib/products')
const { importPartners, exposureOf, describePartner, getPartner } = require('../lib/partners')
const { pending } = require('../lib/events')
const { listPayments } = require('../lib/payments')
const { createReturn, receiveReturn, creditReturn } = require('../lib/returns')
const orders = require('../actions/orders')
const invoices = require('../actions/invoices')
const payments = require('../actions/payments')

const CARD = { method: 'payment_services_paypal_hosted_fields', reference: '8FK21345TX901234A', cardBrand: 'Visa', cardLastFour: '4242', amount: 42.42 }

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', creditLimit: 1000 }])
})

/* Net 40, total 42.42. */
const body = (payment, id = '42') => ({ purchaseOrderByCustomer: `0000000${id}`, partnerId: 'C1', currency: 'USD', total: 42.42, lines: [{ sku: 'A1', qty: 4, price: 10, customerLineReference: '1' }], ...(payment === undefined ? {} : { payment }) })
const post = (payment, id) => invoke(orders, cols, { method: 'POST', body: body(payment, id) })
const eventTypes = async () => (await pending(cols, 100)).map((e) => e.type)

async function invoiced (payment, id) {
  const order = await createOrder(cols, body(payment, id))
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, order.number, status)
  return getOrder(cols, order.number)
}

test('an order keeps the payment reference it arrived with, and only the named fields of it', async () => {
  const made = await post({ ...CARD, reference: '  8FK21345TX901234A ', cardNumber: '4111111111111111', cvv: '123' })
  assert.equal(made.statusCode, 201)
  assert.deepEqual(made.body.payment, CARD)
  const stored = await cols.salesOrders.findOne({ _id: made.body.number })
  assert.deepEqual(Object.keys(stored.payment).sort(), [...contract.order.payment].sort())
  assert.equal(JSON.stringify(stored).includes('4111111111111111'), false, 'a card number is never kept')
  // Its document answers it too.
  const doc = (await invoke(orders, cols, { path: made.body.number })).body
  assert.deepEqual(doc.payment, CARD)
})

test('an order with no payment reference reads payment null, as one stored before version 18 does', async () => {
  const made = await post(undefined)
  assert.equal(made.body.payment, null)
  const { payment: _gone, ...old } = await cols.salesOrders.findOne({ _id: made.body.number })
  await cols.salesOrders.replaceOne({ _id: old._id }, old, { upsert: true })
  assert.equal((await getOrder(cols, made.body.number)).payment, null)
})

test('brand, method and last four are optional; a reference and an amount are not', async () => {
  const bare = await post({ reference: 'TX1', amount: 42.42 })
  assert.equal(bare.statusCode, 201)
  assert.deepEqual(bare.body.payment, { method: null, reference: 'TX1', cardBrand: null, cardLastFour: null, amount: 42.42 })
  for (const [payment, words] of [
    [{ amount: 42.42 }, /payment reference/],
    [{ reference: '   ', amount: 42.42 }, /payment reference/],
    [{ reference: 'TX1' }, /amount/],
    [{ reference: 'TX1', amount: 0 }, /amount/],
    [{ reference: 'TX1', amount: -1 }, /amount/],
    ['paid', /payment/]
  ]) {
    const res = await post(payment, '77')
    assert.equal(res.statusCode, 400, JSON.stringify(payment))
    assert.match(res.body.errorMessage, words)
  }
})

test('more of a card than its last four digits is refused, in words; so is a brand that is not a name', async () => {
  for (const cardLastFour of ['4111111111111111', '42424', '424', 'abcd', 4242]) {
    const res = await post({ ...CARD, cardLastFour }, '78')
    assert.equal(res.statusCode, 400, String(cardLastFour))
    assert.equal(res.body.errorMessage, 'payment.cardLastFour must be the last four digits of the card, as text; the ERP never keeps a card number.')
  }
  const brand = await post({ ...CARD, cardBrand: '4111111111111111' }, '79')
  assert.equal(brand.statusCode, 400)
  assert.equal(brand.body.errorMessage, 'payment.cardBrand must be the card brand\'s name, such as Visa.')
  assert.equal((await cols.salesOrders.find({}).toArray()).length, 0, 'nothing was created')
})

test('invoicing a paid order posts the payment with its reference: the invoice reads paid, nothing open', async () => {
  const order = await invoiced(CARD)
  const invoice = (await invoke(invoices, cols, { path: order.invoice.number })).body
  assert.deepEqual([invoice.openAmount, invoice.paidAmount, invoice.paymentStatus, invoice.payments], [0, 42.42, 'paid', ['7000000001']])
  assert.deepEqual(invoice.payment, CARD, 'the invoice names how it was paid')
  const payment = (await invoke(payments, cols, { path: '7000000001' })).body
  assert.deepEqual(Object.keys(payment).sort(), [...contract.payments.response].sort())
  assert.equal(payment.amount, 42.42)
  assert.equal(payment.reference, CARD.reference)
  assert.equal(payment.invoiceNumber, order.invoice.number)
  assert.deepEqual(payment.paidInWebShop, { method: CARD.method, cardBrand: 'Visa', cardLastFour: '4242' })
  // Nothing more can be paid on it.
  const again = await invoke(invoices, cols, { method: 'POST', path: `${order.invoice.number}/payments`, body: { amount: 1 } })
  assert.equal(again.statusCode, 400)
  assert.equal(again.body.errorMessage, `Invoice ${order.invoice.number} is paid; nothing is open on it.`)
})

test('the ERP raises the invoice event and NO payment event: the web shop already holds the money', async () => {
  await invoiced(CARD)
  const types = await eventTypes()
  assert.ok(types.includes('BillingDocument.Created'))
  assert.equal(types.includes('IncomingPayment.Posted'), false)
  // A payment posted in the ERP still raises its event, and reads as not paid in the web shop.
  const unpaid = await invoiced(undefined, '43')
  const res = await invoke(invoices, cols, { method: 'POST', path: `${unpaid.invoice.number}/payments`, body: { amount: 42.42, reference: 'Wire 1' } })
  assert.equal(res.body.paidInWebShop, null)
  assert.equal((await eventTypes()).filter((t) => t === 'IncomingPayment.Posted').length, 1)
})

test('an invoice the web shop made (external) is paid the same way', async () => {
  const order = await createOrder(cols, body(CARD))
  for (const status of ['confirmed', 'shipped']) await setStatus(cols, order.number, status)
  const res = await invoke(orders, cols, { method: 'POST', path: `${order.number}/external-invoice`, body: { externalReference: 'INV-9', origin: { system: 'Adobe Commerce', document: 'invoice 9' } } })
  assert.equal(res.statusCode, 201)
  const [payment] = await listPayments(cols)
  assert.equal(payment.amount, 42.42)
  assert.equal(payment.reference, CARD.reference)
  assert.equal((await eventTypes()).includes('IncomingPayment.Posted'), false)
})

test('the payment is what the web shop captured, never more: a shortfall stays open on the invoice', async () => {
  const order = await invoiced({ ...CARD, amount: 40 })
  const invoice = (await invoke(invoices, cols, { path: order.invoice.number })).body
  assert.deepEqual([invoice.openAmount, invoice.paidAmount, invoice.paymentStatus], [2.42, 40, 'partly paid'])
  // Captured more than this invoice bills (shipping no ERP part carries): the invoice total is paid.
  const over = await invoiced({ ...CARD, amount: 50 }, '44')
  const [latest] = await listPayments(cols)
  assert.equal(latest.orderNumber, over.number)
  assert.equal(latest.amount, 42.42)
})

test('a paid order uses none of the customer\'s credit: not while open, not once invoiced', async () => {
  const paid = await createOrder(cols, body(CARD))
  assert.equal(await exposureOf(cols, 'C1'), 0)
  await createOrder(cols, body(undefined, '45'))
  assert.equal(await exposureOf(cols, 'C1'), 40, 'the order on account still counts at its net')
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, paid.number, status)
  assert.equal(await exposureOf(cols, 'C1'), 40)
  const doc = await describePartner(cols, await getPartner(cols, 'C1'))
  assert.deepEqual([doc.credit.openOrders, doc.credit.openItems, doc.openItems.length], [40, 0, 0])
})

test('a paid order is not held for the credit limit; one on account for the same amount is', async () => {
  await importPartners(cols, [{ id: 'C2', name: 'Small', creditLimit: 10 }])
  const paid = await createOrder(cols, { ...body(CARD, '46'), partnerId: 'C2' })
  assert.equal(paid.creditStatus, 'approved')
  const onAccount = await createOrder(cols, { ...body(undefined, '47'), partnerId: 'C2' })
  assert.equal(onAccount.creditStatus, 'held')
})

test('a return on a card-paid invoice is credited as any other, and no payment moves', async () => {
  const order = await invoiced(CARD)
  const { returnOrder } = await createReturn(cols, { orderNumber: order.number, customerReturnReference: '7', lines: [{ customerLineReference: '1', qty: 1 }] })
  await receiveReturn(cols, returnOrder.number)
  const credited = await creditReturn(cols, returnOrder.number)
  assert.equal(credited.creditMemo.net, 10)
  const all = await listPayments(cols)
  assert.equal(all.length, 1, 'no payment was posted or reversed for the credit')
  assert.equal(all[0].amount, 42.42)
  const invoice = (await invoke(invoices, cols, { path: order.invoice.number })).body
  assert.deepEqual([invoice.openAmount, invoice.paymentStatus], [0, 'paid'])
  assert.equal(await exposureOf(cols, 'C1'), 0)
})

test('from version 18 the contract names the payment reference on the order and the payment', () => {
  assert.ok(contract.contractVersion >= 18)
  assert.ok(contract.order.request.includes('payment'))
  assert.ok(contract.order.response.includes('payment'))
  assert.deepEqual(contract.order.payment, ['method', 'reference', 'cardBrand', 'cardLastFour', 'amount'])
  assert.match(contract.order.paymentNote, /version 18/)
  assert.ok(contract.payments.response.includes('paidInWebShop'))
  assert.deepEqual(contract.payments.paidInWebShop, ['method', 'cardBrand', 'cardLastFour'])
  assert.match(contract.events.types['IncomingPayment.Posted'].note, /version 18/)
})

test('on screen, a payment taken in the web shop reads in plain words, with only the last four digits', async () => {
  const { paidAtCheckoutText, paymentReferenceText } = await import('../screen/src/components/paymentFormat.js')
  assert.equal(paidAtCheckoutText(CARD), 'Paid by card · Visa ending 4242 · reference 8FK21345TX901234A')
  assert.equal(paidAtCheckoutText({ ...CARD, cardBrand: null }), 'Paid by card · ending 4242 · reference 8FK21345TX901234A')
  assert.equal(paidAtCheckoutText({ ...CARD, cardLastFour: null }), 'Paid by card · Visa · reference 8FK21345TX901234A')
  assert.equal(paidAtCheckoutText({ method: 'paypal', reference: 'TX1', cardBrand: null, cardLastFour: null, amount: 5 }), 'Paid in the web shop · reference TX1')
  assert.equal(paidAtCheckoutText(null), null)
  // The payments list and the payment document: the reference, with the card when the web shop took it.
  assert.equal(paymentReferenceText({ reference: 'Wire 1', paidInWebShop: null }), 'Wire 1')
  assert.equal(paymentReferenceText({ reference: null }), '—')
  assert.equal(paymentReferenceText({ reference: 'TX1', paidInWebShop: { method: 'm', cardBrand: 'Visa', cardLastFour: '4242' } }), 'Web shop · Visa ending 4242 · TX1')
  assert.equal(paymentReferenceText({ reference: 'TX1', paidInWebShop: { method: 'paypal', cardBrand: null, cardLastFour: null } }), 'Web shop · TX1')
})

test('canceling an order paid at checkout moves no money in the ERP and says the card payment is refunded in the web shop; an order on account says nothing of the kind', async () => {
  const paid = await createOrder(cols, body(CARD))
  const canceled = await setStatus(cols, paid.number, 'canceled', undefined, { reason: 'Customer request' })
  assert.equal(canceled.status, 'canceled')
  assert.deepEqual(canceled.history.at(-1), { status: 'canceled', at: canceled.history.at(-1).at, reason: 'Customer request', note: 'Paid by card in the web shop: the card payment is refunded there, not by the ERP.' })
  assert.deepEqual(await listPayments(cols), [])
  assert.deepEqual(await eventTypes(), ['SalesOrder.Changed'])
  const onAccount = await createOrder(cols, body(undefined, '43'))
  const plain = await setStatus(cols, onAccount.number, 'canceled', undefined, { reason: 'Customer request' })
  assert.equal(plain.history.at(-1).note, undefined)
})

test('from version 19 the contract says how a canceled order paid at checkout is refunded', () => {
  assert.ok(contract.contractVersion >= 19)
  assert.match(contract.order.cardCancelNote, /refunded in the web shop/)
})
