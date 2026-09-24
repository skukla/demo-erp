/* The journal in words: every kind of entry names the document it belongs to. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { describeEvent, KIND_NAMES } = require('../lib/journal')
const { EVENT_NAMES } = require('../lib/events')

const out = (kind, value) => ({ direction: 'out', kind, event: EVENT_NAMES[kind], value })

test('every event kind the ERP publishes has a plain name', () => {
  assert.deepEqual(Object.keys(KIND_NAMES).sort(), Object.keys(EVENT_NAMES).sort())
})

test('a shipment names its quantity, its order and where it shipped from, and links the order', () => {
  const d = describeEvent(out('order.shipped', { erpNumber: '0000001003', incrementId: '000000042', items: [{ qty: 5 }, { qty: 2 }], stockSourceCode: 'east' }))
  assert.equal(d.name, 'Shipment posted')
  assert.equal(d.text, 'Shipment of 7 for sales order 0000001003 from east')
  assert.deepEqual(d.links, [{ kind: 'order', number: '0000001003' }])
})

test('order events read as sentences with the Commerce order beside them', () => {
  assert.equal(describeEvent(out('order.confirmed', { erpNumber: '0000001001', incrementId: '000000301' })).text, 'Sales order 0000001001 confirmed (Commerce order 000000301)')
  assert.equal(describeEvent(out('order.cancelled', { erpNumber: '0000001001', reason: 'Out of stock' })).text, 'Sales order 0000001001 cancelled: Out of stock')
  assert.equal(describeEvent(out('order.invoiced', { erpNumber: '0000001001' })).text, 'Invoice for sales order 0000001001')
  assert.equal(describeEvent(out('order.hold', { erpNumber: '0000001007', held: true, reason: 'Credit limit 80,000.00 exceeded by 1,240.00' })).text, 'Sales order 0000001007 put on credit hold: Credit limit 80,000.00 exceeded by 1,240.00')
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

test('what arrives from Commerce is named by what it is, with the wire name kept for the detail page', () => {
  const { inboundName } = require('../lib/journal')
  assert.equal(inboundName('observer.catalog_product_save_commit_after'), 'Product from Commerce')
  assert.equal(inboundName('catalog_stock_update'), 'Stock from Commerce')
  assert.equal(inboundName('observer.sales_order_save_commit_after'), 'Order from Commerce')
  assert.equal(inboundName('observer.company_save_commit_after'), 'Company from Commerce')
  assert.equal(inboundName('Sync from Commerce'), 'Sync from Commerce')
  assert.equal(inboundName('something.else'), 'From Commerce')
})
