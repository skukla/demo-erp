/*
 * Settings → Sales & receivables (AB-59), as Business Central's Sales & Receivables Setup
 * holds it. Each setting changes a decision the ERP makes:
 *   - default payment terms: the terms a customer the ERP creates takes, and the terms a
 *     customer with none is billed on (its invoices' due dates);
 *   - credit warnings: what a new order's credit decision checks — the credit limit, an
 *     overdue balance (open items past their due date), both, or neither;
 *   - return reasons: the codes a return line is coded with.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importProducts } = require('../lib/products')
const { importPartners, ensureDefaultPartner, getPartner } = require('../lib/partners')
const { createOrder, setStatus, getOrder } = require('../lib/orders')
const { getInvoice } = require('../lib/fulfilment')
const { createReturn } = require('../lib/returns')
const settings = require('../actions/settings')
const partners = require('../actions/partners')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 500 }] }])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', creditLimit: 1000 }])
})

const patchSales = (sales) => invoke(settings, cols, { method: 'PATCH', path: '/setup', body: { sales } })

let orderId = 0
async function invoicedOrder (qty = 3) {
  orderId += 1
  const order = await createOrder(cols, { commerceOrderId: String(orderId), partnerId: 'C1', lines: [{ sku: 'A1', qty, price: 10, commerceItemId: 1 }] })
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, order.number, status)
  return getOrder(cols, order.number)
}

/** Its invoice billed long enough ago that NET30 has passed: an overdue open item of 30.00. */
async function overdueInvoice () {
  const order = await invoicedOrder()
  const stored = await cols.salesOrders.findOne({ _id: order.number })
  const billed = new Date(Date.now() - 60 * 86400000).toISOString()
  await cols.salesOrders.replaceOne({ _id: order.number }, { ...stored, invoice: { ...stored.invoice, createdAt: billed } }, { upsert: true })
  return order
}

const newOrder = (qty) => createOrder(cols, { commerceOrderId: `n${++orderId}`, partnerId: 'C1', lines: [{ sku: 'A1', qty, price: 10, commerceItemId: 1 }] })

test('the setup answers the sales defaults: NET30, the credit limit checked, the shipped return reasons', async () => {
  const res = await invoke(settings, cols, { path: '/setup' })
  assert.equal(res.body.sales.defaultPaymentTerms, 'NET30')
  assert.equal(res.body.sales.creditWarnings, 'creditLimit')
  assert.equal(res.body.sales.defaultReturnReason, 'RETURN')
  assert.deepEqual(res.body.sales.returnReasons[0], { code: 'RETURN', description: 'Customer return' })
})

test('default payment terms: a customer the ERP creates takes them; one it has keeps its own', async () => {
  const res = await patchSales({ defaultPaymentTerms: 'net 45' })
  assert.equal(res.body.sales.defaultPaymentTerms, 'NET45')
  await importPartners(cols, [{ id: 'C2', name: 'Newco' }, { id: 'C1', name: 'Acme' }])
  assert.equal((await getPartner(cols, 'C2')).paymentTerms, 'NET45')
  assert.equal((await getPartner(cols, 'C1')).paymentTerms, 'NET30')
  assert.equal((await ensureDefaultPartner(cols, 'Demo')).paymentTerms, 'NET45')
})

test('default payment terms: a customer with no terms of its own is billed on them', async () => {
  await patchSales({ defaultPaymentTerms: 'NET10' })
  const stored = await cols.businessPartners.findOne({ _id: 'C1' })
  await cols.businessPartners.replaceOne({ _id: 'C1' }, { ...stored, paymentTerms: null }, { upsert: true })
  const order = await invoicedOrder()
  const invoice = await getInvoice(cols, order.invoice.number)
  assert.equal(invoice.paymentDays, 10)
  const due = new Date(order.invoice.createdAt)
  due.setUTCDate(due.getUTCDate() + 10)
  assert.equal(invoice.dueDate, due.toISOString())
})

test('payment terms the ERP cannot make a due date from are refused in words', async () => {
  const res = await patchSales({ defaultPaymentTerms: 'Due on receipt' })
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.errorMessage, 'Payment terms are NET and a number of days, such as NET30.')
})

test('credit warnings on the credit limit (the default): over the limit holds, an overdue balance does not', async () => {
  await overdueInvoice()
  assert.equal((await newOrder(1)).creditStatus, 'approved', 'overdue, within the limit')
  const over = await newOrder(100)
  assert.equal(over.creditStatus, 'held')
  assert.match(over.creditReason, /^Credit limit USD 1,000\.00 exceeded by/)
})

test('credit warnings on the overdue balance: an overdue open item holds the next order; the limit is not checked', async () => {
  await patchSales({ creditWarnings: 'overdue' })
  assert.equal((await newOrder(200)).creditStatus, 'approved', 'over the limit, nothing overdue')
  await overdueInvoice()
  const held = await newOrder(1)
  assert.equal(held.creditStatus, 'held')
  assert.equal(held.creditReason, 'Overdue balance USD 30.00')
})

test('credit warnings on both: either one holds', async () => {
  await patchSales({ creditWarnings: 'both' })
  assert.equal((await newOrder(101)).creditStatus, 'held', 'over the limit')
  await cols.salesOrders.deleteMany({})
  await overdueInvoice()
  assert.equal((await newOrder(1)).creditReason, 'Overdue balance USD 30.00')
})

test('no credit warnings: neither holds, and the credit block still does', async () => {
  await patchSales({ creditWarnings: 'none' })
  await overdueInvoice()
  assert.equal((await newOrder(200)).creditStatus, 'approved')
  await invoke(partners, cols, { method: 'PATCH', path: '/C1', body: { blocking: 'all' } })
  assert.equal((await newOrder(1)).creditStatus, 'held')
})

test('the live credit check answers by the same setting', async () => {
  await overdueInvoice()
  const ask = () => invoke(partners, cols, { method: 'POST', path: '/C1/credit-check', body: { net: 5 } })
  assert.equal((await ask()).body.status, 'approved')
  await patchSales({ creditWarnings: 'overdue' })
  const res = await ask()
  assert.equal(res.body.status, 'held')
  assert.equal(res.body.reason, 'Overdue balance USD 30.00')
})

test('credit warnings outside the four are refused', async () => {
  const res = await patchSales({ creditWarnings: 'sometimes' })
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.errorMessage, 'Credit warnings are one of both, creditLimit, overdue, none.')
})

test('return reasons: a reason matching a description takes its code; none takes the default; any other keeps its words under the default', async () => {
  const order = await invoicedOrder(5)
  const make = (id, reason) => createReturn(cols, { commerceReturnId: id, orderNumber: order.number, lines: [{ commerceItemId: 1, qty: 1, ...(reason === undefined ? {} : { reason }) }] })
  const [line] = (await make(1, 'wrong size')).returnOrder.lines
  assert.deepEqual([line.reasonCode, line.reason], ['WRONGSIZE', 'wrong size'])
  const [none] = (await make(2)).returnOrder.lines
  assert.deepEqual([none.reasonCode, none.reason], ['RETURN', 'Customer return'])
  const [other] = (await make(3, 'Arrived late')).returnOrder.lines
  assert.deepEqual([other.reasonCode, other.reason], ['RETURN', 'Arrived late'])
})

test('return reasons: the list and the default are the ERP\'s own, and a change codes the next return by it', async () => {
  const res = await patchSales({ returnReasons: [{ code: 'late', description: 'Arrived late' }, { code: 'DAMAGED', description: 'Damaged' }], defaultReturnReason: 'damaged' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.sales.returnReasons, [{ code: 'LATE', description: 'Arrived late' }, { code: 'DAMAGED', description: 'Damaged' }])
  const order = await invoicedOrder(5)
  const make = (id, reason) => createReturn(cols, { commerceReturnId: id, orderNumber: order.number, lines: [{ commerceItemId: 1, qty: 1, ...(reason === undefined ? {} : { reason }) }] })
  assert.equal((await make(1, 'arrived LATE')).returnOrder.lines[0].reasonCode, 'LATE')
  const [none] = (await make(2)).returnOrder.lines
  assert.deepEqual([none.reasonCode, none.reason], ['DAMAGED', 'Damaged'])
})

test('return reasons the ERP cannot keep are refused in words, and the list stays', async () => {
  const refusals = [
    [{ returnReasons: [] }, 'The ERP needs at least one return reason.'],
    [{ returnReasons: [{ code: 'A', description: 'One' }, { code: 'a', description: 'Two' }], defaultReturnReason: 'A' }, 'Return reason A is listed twice.'],
    [{ returnReasons: [{ code: 'A', description: 'Same' }, { code: 'B', description: 'same' }], defaultReturnReason: 'A' }, 'Two return reasons are described as Same.'],
    [{ returnReasons: [{ code: 'NOT OK', description: 'Spaces' }] }, 'A return reason code is 1 to 10 letters or digits, such as DAMAGED.'],
    [{ returnReasons: [{ code: 'A', description: 'One' }] }, 'The default return reason RETURN is not one of the return reasons.'],
    [{ defaultReturnReason: 'NOPE' }, 'The default return reason NOPE is not one of the return reasons.']
  ]
  for (const [sales, message] of refusals) {
    const res = await patchSales(sales)
    assert.equal(res.statusCode, 400, JSON.stringify(sales))
    assert.equal(res.body.errorMessage, message)
  }
  const after = await invoke(settings, cols, { path: '/setup' })
  assert.equal(after.body.sales.returnReasons.length, 6)
})
