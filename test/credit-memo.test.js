/*
 * The credit memo against an invoice (contract version 13): the whole invoice is credited,
 * once, by a document numbered from 9500000001; the invoice then reads credited, and the
 * creditmemo.created event carries exactly the credited lines so Commerce credits only those.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const contract = require('../contract/erp-contract.json')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder, setStatus, getOrder, describeOrder, billingStatus } = require('../lib/orders')
const { pending } = require('../lib/events')
const { STARTS, peek } = require('../lib/counters')
const { importProducts } = require('../lib/products')
const orders = require('../actions/orders')
const creditMemos = require('../actions/credit-memos')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [
    { sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] },
    { sku: 'B2', name: 'Shirt', listPrice: 5, warehouses: [{ code: 'default', name: 'Default Source', quantity: 9 }] }
  ])
})

/* Net 40 (3 x 10 + 2 x 5); Commerce charged 43.20, so the ERP reports 3.20 tax. */
const input = { purchaseOrderByCustomer: '000000042', total: 43.2, lines: [{ sku: 'A1', qty: 3, price: 10, customerLineReference: '1' }, { sku: 'B2', qty: 2, price: 5, customerLineReference: '2' }] }

async function invoiced () {
  const order = await createOrder(cols, input)
  await setStatus(cols, order.number, 'confirmed')
  await setStatus(cols, order.number, 'shipped')
  return setStatus(cols, order.number, 'invoiced')
}

const credit = (number) => invoke(orders, cols, { method: 'POST', path: `${number}/credit-memo` })

test('credit memos and return orders have number ranges of their own', async () => {
  assert.equal(STARTS.creditMemo, 9500000001)
  assert.equal(STARTS.returnOrder, 6000000001)
  const next = await peek(cols)
  assert.equal(next.creditMemo, '9500000001')
  assert.equal(next.returnOrder, '6000000001')
})

test('crediting an invoiced order answers 201 with the order, its invoice credited and the credit memo on it', async () => {
  const order = await invoiced()
  const res = await credit(order.number)
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.invoice.status, 'credited')
  assert.equal(res.body.invoice.creditMemo, '9500000001')
  assert.equal(res.body.billingStatus, 'credited')
  assert.equal(res.body.creditMemos.length, 1)
  const memo = res.body.creditMemos[0]
  assert.deepEqual(Object.keys(memo).sort(), [...contract.creditMemo.response].sort())
  assert.equal(memo.number, '9500000001')
  assert.equal(memo.orderNumber, order.number)
  assert.equal(memo.invoiceNumber, '9000000001')
  assert.equal(memo.returnNumber, null)
  assert.deepEqual([memo.net, memo.tax, memo.total], [40, 3.2, 43.2])
  assert.deepEqual(Object.keys(memo.lines[0]).sort(), [...contract.creditMemo.line].sort())
  assert.deepEqual(memo.lines, [
    { item: 10, sku: 'A1', qty: 3, price: 10, amount: 30, customerLineReference: '1' },
    { item: 20, sku: 'B2', qty: 2, price: 5, amount: 10, customerLineReference: '2' }
  ])
  // The stored invoice says so too, so billingStatus reads it from the record.
  assert.equal(billingStatus(await getOrder(cols, order.number)), 'credited')
})

const isCreditMemo = (e) => e.type === 'BillingDocument.Created' && e.data.BillingDocumentType === 'CreditMemo'

test('the credit memo raises BillingDocument.Created (credit memo) naming the credited lines, the invoice, no return, and the amounts', async () => {
  const order = await invoiced()
  await credit(order.number)
  const event = (await pending(cols)).find(isCreditMemo)
  assert.ok(event, 'the credit memo was raised')
  assert.deepEqual(event.data, {
    BillingDocument: '9500000001',
    BillingDocumentType: 'CreditMemo',
    SalesOrder: order.number,
    PurchaseOrderByCustomer: '000000042',
    SoldToParty: order.partnerId,
    ReferenceBillingDocument: '9000000001',
    CustomerReturn: null,
    CustomerReturnReference: null,
    TotalNetAmount: 40,
    TaxAmount: 3.2,
    TotalGrossAmount: 43.2,
    TransactionCurrency: 'USD',
    Items: [{ SalesOrderItem: 10, Material: 'A1', Quantity: 3, CustomerLineReference: '1' }, { SalesOrderItem: 20, Material: 'B2', Quantity: 2, CustomerLineReference: '2' }]
  })
})

test('an invoice is credited once: a second credit is refused, naming the credit memo', async () => {
  const order = await invoiced()
  await credit(order.number)
  const again = await credit(order.number)
  assert.equal(again.statusCode, 400)
  assert.equal(again.body.errorMessage, 'Invoice 9000000001 was credited by credit memo 9500000001.')
  // Nothing was numbered or raised the second time.
  assert.equal((await peek(cols)).creditMemo, '9500000002')
  assert.equal((await pending(cols)).filter(isCreditMemo).length, 1)
})

test('an order with no invoice has nothing to credit; an unknown order is a 404', async () => {
  const order = await createOrder(cols, input)
  const res = await credit(order.number)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.errorMessage, 'This order has no invoice to credit.')
  assert.equal((await credit('0000009999')).statusCode, 404)
})

test('credit-memos lists every credit memo newest first, and opens one by number', async () => {
  const first = await invoiced()
  await credit(first.number)
  const second = await createOrder(cols, { ...input, purchaseOrderByCustomer: '000000043' })
  await setStatus(cols, second.number, 'confirmed')
  await setStatus(cols, second.number, 'shipped')
  await setStatus(cols, second.number, 'invoiced')
  await credit(second.number)
  const list = await invoke(creditMemos, cols)
  assert.equal(list.statusCode, 200)
  assert.deepEqual(list.body.items.map((m) => [m.number, m.orderNumber, m.invoiceNumber, m.returnNumber, m.total]), [
    ['9500000002', second.number, '9000000002', null, 43.2],
    ['9500000001', first.number, '9000000001', null, 43.2]
  ])
  const one = await invoke(creditMemos, cols, { path: '9500000001' })
  assert.equal(one.statusCode, 200)
  assert.deepEqual(Object.keys(one.body).sort(), [...contract.creditMemo.response].sort())
  assert.equal(one.body.orderNumber, first.number)
  assert.equal((await invoke(creditMemos, cols, { path: '9500000099' })).statusCode, 404)
})

test('the order document carries its credit memos', async () => {
  const order = await invoiced()
  await credit(order.number)
  const doc = await describeOrder(cols, await getOrder(cols, order.number))
  assert.deepEqual(doc.creditMemos.map((m) => m.number), ['9500000001'])
})
