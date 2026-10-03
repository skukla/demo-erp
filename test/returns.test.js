/*
 * Return orders (contract version 13): made from a customer's return for this ERP's lines of one
 * of its sales orders, idempotent on the customer's reference for the return (version 16); the
 * goods come back (stock up at the warehouse the order shipped from, CustomerReturn.Changed
 * raised), then the received lines are credited (a credit memo naming the return,
 * BillingDocument.Created raised). Open, received, credited.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const contract = require('../contract/erp-contract.json')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { createOrder, getOrder, describeOrder } = require('../lib/orders')
const { confirmOrder, createShipment, postShipment, createInvoice } = require('../lib/fulfilment')
const { importProducts, getProduct } = require('../lib/products')
const { importPartners } = require('../lib/partners')
const { pending, recent } = require('../lib/events')
const { peek } = require('../lib/counters')
const returns = require('../actions/returns')
const orders = require('../actions/orders')
const creditMemos = require('../actions/credit-memos')

let cols
let order
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [
    { sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }, { code: 'east', name: 'East DC', quantity: 20 }] },
    { sku: 'B2', name: 'Shirt', listPrice: 5, warehouses: [{ code: 'default', name: 'Default Source', quantity: 9 }] }
  ])
  await importPartners(cols, [{ id: 'C1', name: 'Acme' }])
  // Net 40; Commerce charged 43.20, so the invoice carries 3.20 tax. A1 ships from east.
  const created = await createOrder(cols, { purchaseOrderByCustomer: '000000042', partnerId: 'C1', total: 43.2, lines: [{ sku: 'A1', qty: 3, price: 10, customerLineReference: '1' }, { sku: 'B2', qty: 2, price: 5, customerLineReference: '2' }] })
  await confirmOrder(cols, created.number)
  await createShipment(cols, created.number, { lines: [{ item: 10, qty: 3 }], warehouse: 'east' })
  await postShipment(cols, created.number, '8000000001')
  await createShipment(cols, created.number, { lines: [{ item: 20, qty: 2 }], warehouse: 'default' })
  await postShipment(cols, created.number, '8000000002')
  order = await createInvoice(cols, created.number)
})

const request = (over = {}) => ({
  customerReturnReference: '7',
  orderNumber: order.number,
  lines: [{ customerLineReference: '1', qty: 2, reason: 'Damaged' }, { customerLineReference: '2', qty: 1 }],
  ...over
})
const post = (body) => invoke(returns, cols, { method: 'POST', body })
const move = (number, verb) => invoke(returns, cols, { method: 'POST', path: `${number}/${verb}` })
const refusal = async (body) => {
  const res = await post(body)
  assert.equal(res.statusCode, 400, JSON.stringify(res.body))
  return res.body.errorMessage
}

test('a return order is created from a customer\'s return: 201, numbered from 6000000001, open, in the contract shape', async () => {
  const res = await post(request())
  assert.equal(res.statusCode, 201)
  const r = res.body
  assert.deepEqual(Object.keys(r).sort(), [...contract.returns.response].sort())
  assert.deepEqual(Object.keys(r.lines[0]).sort(), [...contract.returns.responseLine].sort())
  assert.equal(r.number, '6000000001')
  assert.equal(r.customerReturnReference, '7')
  assert.equal(r.orderNumber, order.number)
  assert.equal(r.partnerId, 'C1')
  assert.equal(r.status, 'open')
  assert.equal(r.creditMemo, null)
  assert.equal(r.receivedAt, null)
  assert.deepEqual(r.history.map((h) => h.status), ['open'])
  // Each line names the sales order line it returns, its price there, and why.
  assert.deepEqual(r.lines, [
    { item: 10, sku: 'A1', qty: 2, price: 10, reason: 'Damaged', reasonCode: 'DAMAGED', customerLineReference: '1' },
    { item: 20, sku: 'B2', qty: 1, price: 5, reason: 'Customer return', reasonCode: 'RETURN', customerLineReference: '2' }
  ])
})

test('the same customer return sent twice answers the return order it made, 200, and numbers nothing', async () => {
  await post(request())
  const again = await post(request())
  assert.equal(again.statusCode, 200)
  assert.equal(again.body.number, '6000000001')
  assert.equal((await peek(cols)).returnOrder, '6000000002')
  assert.equal((await invoke(returns, cols)).body.items.length, 1)
})

test('a return that names its origin is journaled as received, the first time only', async () => {
  const origin = { system: 'Adobe Commerce', document: 'return 7', eventId: 'e-1' }
  await post(request({ origin }))
  await post(request({ origin }))
  const inbound = (await recent(cols)).filter((e) => e.direction === 'in')
  assert.equal(inbound.length, 1)
  assert.equal(inbound[0].summary, `Return 7 from Adobe Commerce received as return order 6000000001 for sales order ${order.number}`)
})

test('a return is refused in words when it does not fit the sales order', async () => {
  assert.equal(await refusal(request({ customerReturnReference: undefined })), "A return needs the customer's reference for it (customerReturnReference).")
  assert.equal(await refusal(request({ customerReturnReference: 'x'.repeat(101) })), 'customerReturnReference is at most 100 characters.')
  assert.equal(await refusal(request({ orderNumber: '0000009999' })), 'Sales order 0000009999 is not in this ERP.')
  assert.equal(await refusal(request({ lines: [] })), 'A return needs at least one line.')
  assert.equal(await refusal(request({ lines: [{ customerLineReference: '99', qty: 1 }] })), `Customer line reference 99 is not on sales order ${order.number}.`)
  assert.equal(await refusal(request({ lines: [{ customerLineReference: '1', qty: 0 }] })), 'Customer line reference 1: the quantity must be a whole number of 1 or more.')
  assert.equal(await refusal(request({ lines: [{ customerLineReference: '1', qty: 1.5 }] })), 'Customer line reference 1: the quantity must be a whole number of 1 or more.')
  assert.equal(await refusal(request({ lines: [{ customerLineReference: '1', qty: 4 }] })), 'Customer line reference 1: 3 EA can be returned of 3 invoiced.')
  assert.equal(await refusal(request({ lines: [{ customerLineReference: '1', qty: 1, reason: '  ' }] })), 'Customer line reference 1: the reason must be words.')
  // Nothing refused was numbered.
  assert.equal((await peek(cols)).returnOrder, '6000000001')
})

test('what earlier returns took cannot be returned again', async () => {
  await post(request())
  assert.equal(await refusal(request({ customerReturnReference: '8', lines: [{ customerLineReference: '1', qty: 2 }] })), 'Customer line reference 1: 1 EA can be returned of 3 invoiced.')
  assert.equal((await post(request({ customerReturnReference: '8', lines: [{ customerLineReference: '1', qty: 1 }] }))).statusCode, 201)
})

test('an order with no invoice, or an invoice credited in full, has nothing to return', async () => {
  const open = await createOrder(cols, { purchaseOrderByCustomer: '43', lines: [{ sku: 'A1', qty: 1, price: 10, customerLineReference: '5' }] })
  assert.equal(await refusal(request({ orderNumber: open.number, lines: [{ customerLineReference: '5', qty: 1 }] })), `Sales order ${open.number} has no invoice; nothing on it can be returned.`)
  await invoke(orders, cols, { method: 'POST', path: `${order.number}/credit-memo` })
  assert.equal(await refusal(request()), 'Invoice 9000000001 was credited by credit memo 9500000001.')
})

test('receiving a return puts the goods back where the order shipped them from and raises CustomerReturn.Changed', async () => {
  await post(request())
  const res = await move('6000000001', 'receive')
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.status, 'received')
  assert.ok(res.body.receivedAt)
  assert.deepEqual(res.body.history.map((h) => h.status), ['open', 'received'])
  // A1: 3 shipped from east (20 → 17), 2 come back (→ 19). B2: 2 shipped from default (9 → 7),
  // 1 comes back (→ 8). The stock event says so; the goods issues raised none (AB-63).
  const stockOf = async (sku) => Object.fromEntries((await getProduct(cols, sku)).warehouses.map((w) => [w.code, w.quantity]))
  assert.deepEqual(await stockOf('A1'), { default: 50, east: 19 })
  assert.deepEqual(await stockOf('B2'), { default: 8 })
  const events = await pending(cols)
  const stock = events.filter((e) => e.type === 'ProductStock.Changed').map((e) => e.data)
  assert.deepEqual(stock, [{ Product: 'A1', Plant: 'east', Quantity: 19, PrevQuantity: 17 }, { Product: 'B2', Plant: 'default', Quantity: 8, PrevQuantity: 7 }])
  const received = events.find((e) => e.type === 'CustomerReturn.Changed')
  assert.deepEqual(received.data, {
    CustomerReturn: '6000000001',
    CustomerReturnReference: '7',
    SalesOrder: order.number,
    PurchaseOrderByCustomer: '000000042',
    SoldToParty: 'C1',
    Status: 'received',
    PrevStatus: 'open',
    Items: [{ SalesOrderItem: 10, Material: 'A1', Quantity: 2, CustomerLineReference: '1' }, { SalesOrderItem: 20, Material: 'B2', Quantity: 1, CustomerLineReference: '2' }]
  })
  const again = await move('6000000001', 'receive')
  assert.equal(again.statusCode, 400)
  assert.match(again.body.errorMessage, /^Return order 6000000001 was received on /)
})

test('a received return is credited by a credit memo of its lines, which names the return and raises BillingDocument.Created', async () => {
  await post(request())
  const early = await move('6000000001', 'credit-memo')
  assert.equal(early.statusCode, 400)
  assert.equal(early.body.errorMessage, 'Receive return order 6000000001 before crediting it.')
  await move('6000000001', 'receive')
  const res = await move('6000000001', 'credit-memo')
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.status, 'credited')
  const memo = res.body.creditMemo
  assert.deepEqual(Object.keys(memo).sort(), [...contract.creditMemo.response].sort())
  assert.equal(memo.number, '9500000001')
  assert.equal(memo.returnNumber, '6000000001')
  assert.equal(memo.invoiceNumber, '9000000001')
  assert.deepEqual(memo.lines, [
    { item: 10, sku: 'A1', qty: 2, price: 10, amount: 20, customerLineReference: '1' },
    { item: 20, sku: 'B2', qty: 1, price: 5, amount: 5, customerLineReference: '2' }
  ])
  // Net 25 of the invoice's 40, so 25/40 of its 3.20 tax.
  assert.deepEqual([memo.net, memo.tax, memo.total], [25, 2, 27])
  const event = (await pending(cols)).find((e) => e.type === 'BillingDocument.Created' && e.data.BillingDocumentType === 'CreditMemo')
  assert.deepEqual(event.data, {
    BillingDocument: '9500000001',
    BillingDocumentType: 'CreditMemo',
    SalesOrder: order.number,
    PurchaseOrderByCustomer: '000000042',
    SoldToParty: 'C1',
    ReferenceBillingDocument: '9000000001',
    CustomerReturn: '6000000001',
    CustomerReturnReference: '7',
    TotalNetAmount: 25,
    TaxAmount: 2,
    TotalGrossAmount: 27,
    TransactionCurrency: 'USD',
    Items: [{ SalesOrderItem: 10, Material: 'A1', Quantity: 2, CustomerLineReference: '1' }, { SalesOrderItem: 20, Material: 'B2', Quantity: 1, CustomerLineReference: '2' }]
  })
  const again = await move('6000000001', 'credit-memo')
  assert.equal(again.body.errorMessage, 'Return order 6000000001 was credited by credit memo 9500000001.')
})

test("a return's credit memo is listed with the others, shown on its order, and stops a whole-invoice credit", async () => {
  await post(request())
  await move('6000000001', 'receive')
  await move('6000000001', 'credit-memo')
  const list = (await invoke(creditMemos, cols)).body.items
  assert.deepEqual(list.map((m) => [m.number, m.returnNumber, m.partnerName]), [['9500000001', '6000000001', 'Acme']])
  assert.equal((await invoke(creditMemos, cols, { path: '9500000001' })).body.returnNumber, '6000000001')
  const doc = await describeOrder(cols, await getOrder(cols, order.number))
  assert.deepEqual(doc.creditMemos.map((m) => m.number), ['9500000001'])
  // The invoice is still open in part: it reads invoiced, and the rest is credited by return.
  assert.equal(doc.invoice.status, 'open')
  const whole = await invoke(orders, cols, { method: 'POST', path: `${order.number}/credit-memo` })
  assert.equal(whole.body.errorMessage, 'Return order 6000000001 credited part of this invoice (credit memo 9500000001); credit the rest by return.')
})

test('an open return stops a whole-invoice credit, which would leave it never creditable', async () => {
  await post(request())
  const whole = await invoke(orders, cols, { method: 'POST', path: `${order.number}/credit-memo` })
  assert.equal(whole.statusCode, 400)
  assert.equal(whole.body.errorMessage, 'Return order 6000000001 is still open on this invoice; receive and credit it, or credit by return.')
})

test('returns are listed newest first and opened by number; an unknown one is a 404', async () => {
  await post(request())
  await post(request({ customerReturnReference: '8', lines: [{ customerLineReference: '2', qty: 1 }] }))
  const list = await invoke(returns, cols)
  assert.deepEqual(list.body.items.map((r) => r.number), ['6000000002', '6000000001'])
  const one = await invoke(returns, cols, { path: '6000000002' })
  assert.equal(one.body.customerReturnReference, '8')
  assert.equal((await invoke(returns, cols, { path: '6000000099' })).statusCode, 404)
  assert.equal((await move('6000000099', 'receive')).statusCode, 404)
})

/* What the screen reads (AB-16e screen slice): the order's return orders, a list row's
   sold-to, Home's two return cues, and the shell search. */
const { workList } = require('../lib/work')
const { search } = require('../lib/search')

test('the order document lists its return orders, oldest first, each with its status and credit memo', async () => {
  await post(request())
  await post(request({ customerReturnReference: '8', lines: [{ customerLineReference: '2', qty: 1 }] }))
  await move('6000000001', 'receive')
  await move('6000000001', 'credit-memo')
  const doc = await describeOrder(cols, await getOrder(cols, order.number))
  assert.deepEqual(doc.returnOrders.map((r) => [r.number, r.status, r.creditMemo && r.creditMemo.number]), [
    ['6000000001', 'credited', '9500000001'],
    ['6000000002', 'open', null]
  ])
  assert.equal(doc.returnOrders[0]._id, undefined, 'no storage key on the document')
})

test('a return order row in the list names its sold-to', async () => {
  await post(request())
  const [row] = (await invoke(returns, cols)).body.items
  assert.equal(row.partnerId, 'C1')
  assert.equal(row.partnerName, 'Acme')
  assert.equal(row.lines.length, 2)
})

test('Home counts open return orders to receive and received ones to credit, and no credited one', async () => {
  const before = (await workList(cols)).counts
  assert.deepEqual([before.returnsToReceive, before.returnsToCredit], [0, 0])
  await post(request({ lines: [{ customerLineReference: '1', qty: 1 }] }))
  await post(request({ customerReturnReference: '8', lines: [{ customerLineReference: '1', qty: 1 }] }))
  await post(request({ customerReturnReference: '9', lines: [{ customerLineReference: '2', qty: 1 }] }))
  await move('6000000002', 'receive')
  await move('6000000003', 'receive')
  await move('6000000003', 'credit-memo')
  const { counts } = await workList(cols)
  assert.deepEqual([counts.returnsToReceive, counts.returnsToCredit], [1, 1])
})

test('the shell search finds a return order and a credit memo by number', async () => {
  await post(request())
  await move('6000000001', 'receive')
  await move('6000000001', 'credit-memo')
  const [byReturn] = await search(cols, '6000000001')
  assert.deepEqual(byReturn, { kind: 'return', number: '6000000001', title: 'Return Order 6000000001', subtitle: `for sales order ${order.number}` })
  const [byMemo] = await search(cols, '9500000001')
  assert.deepEqual(byMemo, { kind: 'creditMemo', number: '9500000001', title: 'Credit Memo 9500000001', subtitle: `for sales order ${order.number}` })
  // The customer's reference for a return finds the return order too.
  await post(request({ customerReturnReference: '1234', lines: [{ customerLineReference: '2', qty: 1 }] }))
  assert.equal((await search(cols, '1234'))[0].number, '6000000002')
})
