/* The journal in words: every kind of entry names the document it belongs to. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { describeEvent, typeName } = require('../lib/journal')
const { EVENT_TYPES } = require('../lib/events')

/* An entry journaled before contract version 16: a kind and the payload it was sent with. */
const out = (kind, value) => ({ direction: 'out', kind, value })
/* An entry of version 16: a type and its data, in the ERP's words. */
const v16 = (type, data) => ({ direction: 'out', type, data })

test('every event type the ERP publishes has a plain name of its own', () => {
  for (const type of EVENT_TYPES) assert.notEqual(typeName(type, { ChangedFields: [] }), type, type)
})

test('version 16: the journal names each event in the ERP\'s words (AB-26y)', () => {
  const order = { SalesOrder: '0000001001', PurchaseOrderByCustomer: '000000301' }
  assert.deepEqual(describeEvent(v16('SalesOrder.Changed', { ...order, OverallStatus: 'confirmed', PrevOverallStatus: 'created', CreditBlock: false, PrevCreditBlock: false })), {
    name: 'Sales order changed', text: 'Sales order 0000001001 confirmed (customer reference 000000301)', links: [{ kind: 'order', number: '0000001001' }]
  })
  assert.equal(describeEvent(v16('SalesOrder.Changed', { ...order, OverallStatus: 'created', PrevOverallStatus: null, CreditBlock: true, PrevCreditBlock: false, Reason: 'Customer blocked for all business' })).text, 'Sales order 0000001001 put on credit hold: Customer blocked for all business')
  assert.equal(describeEvent(v16('SalesOrder.Changed', { ...order, OverallStatus: 'created', PrevOverallStatus: 'created', CreditBlock: false, PrevCreditBlock: true })).text, 'Sales order 0000001001 released from credit hold')
  const shipped = describeEvent(v16('OutboundDelivery.GoodsIssueStatusChanged', { ...order, OutboundDelivery: '8000000001', Plant: 'east', Items: [{ Quantity: 5 }, { Quantity: 2 }] }))
  assert.equal(shipped.name, 'Goods issue posted')
  assert.equal(shipped.text, 'Shipment 8000000001 of 7 for sales order 0000001001 from east')
  assert.equal(describeEvent(v16('BillingDocument.Created', { ...order, BillingDocument: '9000000001', BillingDocumentType: 'Invoice' })).name, 'Billing document created (invoice)')
  const memo = describeEvent(v16('BillingDocument.Created', { ...order, BillingDocument: '9500000001', BillingDocumentType: 'CreditMemo', CustomerReturn: '6000000001' }))
  assert.equal(memo.name, 'Billing document created (credit memo)')
  assert.equal(memo.text, 'Credit memo 9500000001 for sales order 0000001001 (return order 6000000001)')
  assert.equal(describeEvent(v16('CustomerReturn.Changed', { ...order, CustomerReturn: '6000000001', Status: 'received', Items: [{ Quantity: 2 }, { Quantity: 1 }] })).text, 'Return order 6000000001 received: 3 back for sales order 0000001001')
  assert.equal(describeEvent(v16('IncomingPayment.Posted', { ...order, Payment: '7000000001', BillingDocument: '9000000001', Amount: 50, Currency: 'USD' })).text, 'Payment 7000000001 of USD 50.00 against invoice 9000000001 for sales order 0000001001')
  // AB-60: a name change is not a price change.
  const product = describeEvent(v16('Product.Changed', { Product: 'A1', ProductName: 'Trouser (ERP)', ListPrice: 12, ChangedFields: ['ProductName', 'ListPrice'] }))
  assert.deepEqual(product, { name: 'Product changed: name, list price', text: 'Product A1: name "Trouser (ERP)", list price 12', links: [{ kind: 'product', number: 'A1' }] })
  assert.equal(describeEvent(v16('Product.Changed', { Product: 'A1', ProductName: 'Trouser', ChangedFields: ['ProductName'] })).name, 'Product changed: name')
  assert.equal(describeEvent(v16('ProductStock.Changed', { Product: 'A1', Plant: 'east', Quantity: 7, PrevQuantity: 20 })).text, 'Stock of A1 in east: 20 to 7')
  const customer = describeEvent(v16('Customer.Changed', { Customer: 'C7', CreditLimit: 250, BlockingLevel: 'all', ChangedFields: ['CreditLimit', 'BlockingLevel'] }))
  assert.deepEqual(customer, { name: 'Customer changed: credit limit, blocking level', text: 'Customer C7: credit limit 250, blocking level all', links: [{ kind: 'customer', number: 'C7' }] })
  assert.deepEqual(describeEvent(v16('PriceList.Changed', { Customer: 'C7', Lines: [{ sku: 'A1' }] })), { name: 'Price list changed', text: 'Price list prices of customer C7: 1 in force', links: [{ kind: 'customer', number: 'C7' }] })
})

test('an incoming entry of version 16 is named by the document its origin names', () => {
  const d = describeEvent({ direction: 'in', origin: { system: 'Adobe Commerce', document: 'shipment 900' }, summary: 'Goods issue posted from Adobe Commerce', value: { number: '0000001001' } })
  assert.equal(d.name, 'Shipment received')
  assert.deepEqual(d.links, [{ kind: 'order', number: '0000001001' }])
})

test('a shipment names its quantity, its order and where it shipped from, and links the order', () => {
  const d = describeEvent(out('order.shipped', { erpNumber: '0000001003', incrementId: '000000042', items: [{ qty: 5 }, { qty: 2 }], stockSourceCode: 'east' }))
  assert.equal(d.name, 'Shipment posted')
  assert.equal(d.text, 'Shipment of 7 for sales order 0000001003 from east')
  assert.deepEqual(d.links, [{ kind: 'order', number: '0000001003' }])
})

test('order events read as sentences with the Commerce order beside them', () => {
  assert.equal(describeEvent(out('order.confirmed', { erpNumber: '0000001001', incrementId: '000000301' })).text, 'Sales order 0000001001 confirmed (customer reference 000000301)')
  assert.equal(describeEvent(out('order.canceled', { erpNumber: '0000001001', reason: 'Out of stock' })).text, 'Sales order 0000001001 canceled: Out of stock')
  assert.equal(describeEvent(out('order.invoiced', { erpNumber: '0000001001' })).text, 'Invoice for sales order 0000001001')
  assert.equal(describeEvent(out('order.hold', { erpNumber: '0000001007', held: true, reason: 'Credit limit USD 80,000.00 exceeded by USD 1,240.00' })).text, 'Sales order 0000001007 put on credit hold: Credit limit USD 80,000.00 exceeded by USD 1,240.00')
  assert.equal(describeEvent(out('order.hold', { erpNumber: '0000001007', held: false, reason: null })).text, 'Sales order 0000001007 released from credit hold')
})

test('master-data events name the record and link it', () => {
  assert.deepEqual(describeEvent(out('product.price', { sku: 'P000007', price: 189 })), { name: 'Price changed', text: 'Price of P000007 set to 189', links: [{ kind: 'product', number: 'P000007' }] })
  assert.equal(describeEvent(out('product.stock', [{ sku: 'A1' }, { sku: 'B2' }])).text, 'Stock of 2 products changed')
  assert.equal(describeEvent(out('partner.blocked', { partnerId: 'C000103', blocked: true })).text, 'Customer C000103 blocked')
  assert.deepEqual(describeEvent(out('partner.creditLimit', { partnerId: 'C000102', creditLimit: 120000 })).links, [{ kind: 'customer', number: 'C000102' }])
})

test('an entry journaled before kinds were recorded is named from its wire event', () => {
  const d = describeEvent({ direction: 'out', event: 'be-observer.sales_order_status_update', value: { erpNumber: '0000001001' } })
  assert.equal(d.name, 'Order confirmed')
  assert.equal(d.text, 'Sales order 0000001001 confirmed')
})

test('an incoming entry keeps the summary the ERP wrote and links the order it created', () => {
  const d = describeEvent({ direction: 'in', event: 'observer.sales_order_save_commit_after', summary: 'Commerce order 000000042 received as sales order 0000001042', value: { number: '0000001042' } })
  assert.equal(d.text, 'Commerce order 000000042 received as sales order 0000001042')
  assert.deepEqual(d.links, [{ kind: 'order', number: '0000001042' }])
})

test('what arrives is named by what it is, not by the system that sent it, with the wire name kept for the detail page', () => {
  const { inboundName } = require('../lib/journal')
  assert.equal(inboundName('observer.catalog_product_save_commit_after'), 'Product update received')
  assert.equal(inboundName('catalog_stock_update'), 'Stock update received')
  assert.equal(inboundName('observer.sales_order_save_commit_after'), 'Order received')
  assert.equal(inboundName('observer.sales_order_shipment_save_after'), 'Shipment received')
  assert.equal(inboundName('observer.sales_order_invoice_save_after'), 'Invoice received')
  assert.equal(inboundName('observer.company_save_commit_after'), 'Customer update received')
  assert.equal(inboundName('Sync from Commerce'), 'Sync from Commerce')
  assert.equal(inboundName('something.else'), 'Message received')
})

test('a price list change names the customer and how many list prices are now in force, and links the customer', () => {
  const two = describeEvent(out('contract.changed', { partnerId: 'C000102', lines: [{ sku: 'A1' }, { sku: 'B2' }] }))
  assert.deepEqual(two, { name: 'Customer prices changed', text: 'Price list prices of customer C000102: 2 in force', links: [{ kind: 'customer', number: 'C000102' }] })
  assert.equal(describeEvent(out('contract.changed', { partnerId: 'C000102', lines: [{ sku: 'A1' }] })).text, 'Price list prices of customer C000102: 1 in force')
  assert.equal(describeEvent(out('contract.changed', { partnerId: 'C000102', lines: [] })).text, 'Price list prices of customer C000102: none in force')
  assert.equal(describeEvent({ direction: 'out', event: 'be-observer.company_contract_update', value: { partnerId: 'C1', lines: [] } }).name, 'Customer prices changed')
})

test('a credit memo and a received return name their documents and link the order (contract version 13)', () => {
  assert.deepEqual(describeEvent(out('creditmemo.created', { erpNumber: '0000001003', creditMemoNumber: '9500000001', returnNumber: null })), {
    name: 'Credit memo created', text: 'Credit memo 9500000001 for sales order 0000001003', links: [{ kind: 'order', number: '0000001003' }]
  })
  assert.equal(describeEvent(out('creditmemo.created', { erpNumber: '0000001003', creditMemoNumber: '9500000002', returnNumber: '6000000001' })).text, 'Credit memo 9500000002 for sales order 0000001003 (return order 6000000001)')
  assert.deepEqual(describeEvent(out('return.received', { erpNumber: '0000001003', returnNumber: '6000000001', items: [{ qty: 2 }, { qty: 1 }] })), {
    name: 'Return received', text: 'Return order 6000000001 received: 3 back for sales order 0000001003', links: [{ kind: 'order', number: '0000001003' }]
  })
  // The wire names alone, for an entry journaled without its kind.
  assert.equal(describeEvent({ direction: 'out', event: 'be-observer.rma_status_update', value: {} }).name, 'Return received')
})

test('a return from Commerce reads as one in the journal', () => {
  const d = describeEvent({ direction: 'in', event: 'observer.rma_save_commit_after', summary: 'Commerce return 000000007 received as return order 6000000001', value: { number: '0000001003' } })
  assert.equal(d.name, 'Return request received')
})
