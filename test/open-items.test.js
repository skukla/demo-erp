/*
 * Open items (contract version 14, AB-26s): an invoice is what the customer owes until it is
 * paid. Every place an invoice is described carries its open amount, what was paid, the
 * payment status and the payments against it, worked out from the payments and credit memos
 * on read. A credit memo lowers the open amount: a whole-invoice credit leaves nothing open
 * (credited), a return's credit memo lowers it by its total.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const contract = require('../contract/erp-contract.json')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder, setStatus, getOrder, describeOrder } = require('../lib/orders')
const { importProducts } = require('../lib/products')
const { importPartners } = require('../lib/partners')
const { createReturn, receiveReturn, creditReturn } = require('../lib/returns')
const invoices = require('../actions/invoices')
const orders = require('../actions/orders')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', creditLimit: 1000 }])
})

/* Net 30 (3 x 10); Commerce charged 32.40, so the invoice total is 32.40. */
async function invoiced (commerceOrderId = '42') {
  const order = await createOrder(cols, { commerceOrderId, partnerId: 'C1', total: 32.4, lines: [{ sku: 'A1', qty: 3, price: 10, commerceItemId: 1 }] })
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, order.number, status)
  return getOrder(cols, order.number)
}

const fieldsOf = (invoice) => Object.fromEntries(contract.payments.invoiceFields.map((k) => [k, invoice[k]]))

test('a new invoice is open for its total, everywhere it is described', async () => {
  const order = await invoiced()
  const open = { openAmount: 32.4, paidAmount: 0, paymentStatus: 'open', payments: [] }
  const doc = await invoke(invoices, cols, { path: order.invoice.number })
  assert.deepEqual(fieldsOf(doc.body), open)
  const list = await invoke(invoices, cols)
  assert.deepEqual(fieldsOf(list.body.items[0]), open)
  const described = await describeOrder(cols, await cols.salesOrders.findOne({ _id: order.number }))
  assert.deepEqual(fieldsOf(described.invoice), open)
})

test('an invoice credited in whole is credited, with nothing open', async () => {
  const order = await invoiced()
  await invoke(orders, cols, { method: 'POST', path: `${order.number}/credit-memo` })
  const doc = await invoke(invoices, cols, { path: order.invoice.number })
  assert.deepEqual(fieldsOf(doc.body), { openAmount: 0, paidAmount: 0, paymentStatus: 'credited', payments: [] })
})

test("a return's credit memo lowers the open amount by its total", async () => {
  const order = await invoiced()
  const { returnOrder } = await createReturn(cols, { commerceReturnId: 5, orderNumber: order.number, lines: [{ commerceItemId: 1, qty: 1 }] })
  await receiveReturn(cols, returnOrder.number)
  await creditReturn(cols, returnOrder.number)
  // One of three credited: net 10, tax 0.80 (the invoice's 2.40 in proportion), total 10.80.
  const doc = await invoke(invoices, cols, { path: order.invoice.number })
  assert.deepEqual(fieldsOf(doc.body), { openAmount: 21.6, paidAmount: 0, paymentStatus: 'open', payments: [] })
})

test('an invoice stored before version 14, with no payment data, reads as open for its total', async () => {
  const order = await invoiced()
  const stored = await cols.salesOrders.findOne({ _id: order.number })
  // What a version 13 ERP stored: no payment field anywhere on the invoice.
  assert.equal(Object.keys(stored.invoice).some((k) => /pa(id|yment)|open/i.test(k)), false)
  const doc = await invoke(invoices, cols, { path: order.invoice.number })
  assert.equal(doc.body.openAmount, 32.4)
  assert.equal(doc.body.paymentStatus, 'open')
})
