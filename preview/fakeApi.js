/*
 * Stand-in records for the local preview, in the shapes the real actions answer with
 * (lib/products.js `shape`, lib/partners.js, lib/orders.js, lib/fulfilment.js,
 * lib/events.js). They are here so a screen can be looked at — and screenshotted —
 * without a deployed action, a key, or a Commerce store.
 *
 * Keep the shapes honest. A screen built against an invented shape agrees with the
 * invention and nothing else. The order document and its moves are mirrored from
 * lib/orders and lib/fulfilment by hand: those modules are the action's CommonJS and
 * this runs in a browser. If a field grows there, it grows here.
 */
import { DEFAULT_APPEARANCE } from '../lib/appearance.js'
import { describeEvent } from '../lib/journal.js'
import { maintenanceOf } from '../lib/maintenance.js'
import { returnMoves, canPayInvoice } from '../lib/return-moves.js'
import { openItemOf } from '../lib/open-items.js'
import { describeSetup, updateSetup } from '../lib/setup.js'
import { addSalesOrganization, updateSalesOrganization } from '../lib/sales-organizations.js'
import { updateSettings } from '../lib/settings.js'

const NAMES = [
  ['Wide-leg trouser', 89], ['Cotton poplin shirt', 34.2], ['Canvas tote', 12],
  ['Merino crew knit', 119], ['Linen blazer', 245], ['Chino short', 49.5],
  ['Rain shell', 189], ['Leather belt', 55], ['Wool overcoat', 420],
  ['Oxford shirt', 64], ['Denim jacket', 138], ['Silk scarf', 78],
  ['Running short', 42], ['Quilted gilet', 165], ['Cashmere beanie', 58],
  ['Field jacket', 210], ['Pima tee', 28], ['Corduroy trouser', 95],
  ['Packable duffel', 130], ['Suede loafer', 175]
]

const products = NAMES.map(([name, price], i) => {
  const sku = `P${String(i + 1).padStart(6, '0')}`
  const quantity = [0, 4, 18, 120, 7, 64][i % 6]
  // Every fourth product is stocked in two warehouses, so Ship-from has a choice to show.
  // A parent holds no stock of its own (lib/products.js shape): its variants below do.
  const warehouses = i === 3
    ? []
    : i % 4 === 1
      ? [{ code: 'default', name: 'Default Source', quantity }, { code: 'east', name: 'East DC', quantity: 30 }]
      : [{ code: 'default', name: 'Default Source', quantity }]
  return {
    sku,
    name,
    type: i === 3 ? 'configurable' : 'simple',
    description: `${name} — mirrored from Commerce`,
    unit: i % 7 === 0 ? 'PC' : 'EA',
    // One product blocked for sales, so the refusal and its status have something to show.
    ...(i === 3 ? {} : { salesStatus: i === 9 ? 'blocked' : 'sellable' }),
    listPrice: price,
    warehouses,
    stock: i === 3 ? 120 : warehouses.reduce((sum, w) => sum + w.quantity, 0),
    ...(i === 3 ? { priceRange: { min: 119, max: 149 }, variantCount: 3 } : {})
  }
})
/* The parent's three variants (SAP's generic article and its articles): each names its
   parent and the value it varies on, and carries the parent's stock between them. */
for (const [size, price] of [['S', 119], ['M', 129], ['L', 149]]) {
  products.push({
    sku: `P000004-${size}`,
    name: `Merino crew knit ${size}`,
    type: 'simple',
    parentSku: 'P000004',
    variantAttributes: [{ label: 'Size', value: size }],
    unit: 'EA',
    salesStatus: 'sellable',
    listPrice: price,
    warehouses: [{ code: 'default', name: 'Default Source', quantity: 40 }],
    stock: 40
  })
}

/* The business structure the last mirror sent: two websites, each its own sales organisation
   (lib/structure.js). Stand-in Store Information stays null, as the real one does: it is
   not readable over REST. */
const structureMirror = { websites: [
  { code: 'base', name: 'Main Website', salesOrg: '1000', salesOrgName: 'Online US', storeInfo: { currency: 'USD', countryId: 'US', vatNumber: null, address: null } },
  { code: 'eu', name: 'Europe', salesOrg: '2000', salesOrgName: 'Online EU', storeInfo: { currency: 'EUR', countryId: 'DE', vatNumber: null, address: null } }
] }
const salesOrgNames = { 1000: 'Online US', 2000: 'Online EU' }
const noLegal = { legalName: null, vatTaxId: null, resellerId: null, legalAddress: null, website: null }

const partners = [
  { id: 'P000000', name: 'Walk-in customers', salesOrgs: ['*'], ...noLegal, paymentTerms: 'NET30', creditLimit: 0, blocking: 'open', isDefault: true },
  { id: 'C000101', name: 'Northwind Trading', salesOrgs: ['1000'], legalName: 'Northwind Trading LLC', vatTaxId: 'US 83-1234567', resellerId: 'R-1042', legalAddress: { street: ['1 Harbor Way', 'Suite 400'], city: 'Seattle', region: 'WA', postcode: '98101', countryId: 'US', telephone: '206-555-0100' }, paymentTerms: 'NET30', creditLimit: 50000, blocking: 'open' },
  { id: 'C000102', name: 'Contoso Supply', salesOrgs: ['1000', '2000'], legalName: 'Contoso Supply Inc.', vatTaxId: 'US 91-7654321', resellerId: null, legalAddress: { street: ['200 Market St'], city: 'San Francisco', region: 'CA', postcode: '94105', countryId: 'US', telephone: null }, paymentTerms: 'NET60', creditLimit: 120000, blocking: 'open', priceGroup: 'TRADE' },
  { id: 'C000103', name: 'Fabrikam Retail', salesOrgs: ['2000'], legalName: 'Fabrikam Retail GmbH', vatTaxId: 'DE 812345678', resellerId: 'R-2210', legalAddress: { street: ['Hauptstraße 5'], city: 'Berlin', region: null, postcode: '10115', countryId: 'DE', telephone: '+49 30 555 0100' }, paymentTerms: 'NET15', creditLimit: 25000, blocking: 'all' },
  { id: 'C000104', name: 'Adventure Works', salesOrgs: ['2000'], legalName: 'Adventure Works B.V.', vatTaxId: 'NL 001234567B01', resellerId: null, legalAddress: { street: ['Keizersgracht 100'], city: 'Amsterdam', region: null, postcode: '1015 AA', countryId: 'NL', telephone: null }, paymentTerms: 'NET30', creditLimit: 80000, blocking: 'open', priceGroup: 'TRADE' }
]

/* The stored shape (lib/orders.js): a header word, quantities per line, the shipments
   and the invoice. The outward `status` is DERIVED below, as the ERP derives it. */
const HEADERS = ['created', 'confirmed', 'confirmed', 'confirmed', 'canceled', 'created', 'confirmed', 'created', 'confirmed', 'confirmed']
const cents = (value) => Math.round(value * 100) / 100
/** A line's net amount, as lib/line-amounts has it: quantity × price − discount. */
const lineNet = (l) => cents(l.qty * l.price - (l.discount || 0))
const day = (d, h = 9) => new Date(Date.UTC(2026, 8, d, h, 12)).toISOString()
const orders = HEADERS.map((header, i) => {
  const number = String(1000 + i).padStart(10, '0')
  const lines = [
    { item: 10, sku: products[i % products.length].sku, qty: (i % 4) + 1, price: products[i % products.length].listPrice, customerLineReference: String(100 + i * 2), shippedQty: 0, closedQty: 0 },
    { item: 20, sku: products[(i + 5) % products.length].sku, qty: (i % 3) + 2, price: products[(i + 5) % products.length].listPrice, customerLineReference: String(101 + i * 2), shippedQty: 0, closedQty: 0 }
  ]
  const order = {
    number,
    purchaseOrderByCustomer: `00000${300 + i}`,
    partnerId: partners[(i % 4) + 1].id,
    lines,
    // The website the order came through, as the integration's setting names it.
    salesOrg: partners[(i % 4) + 1].salesOrgs[0],
    salesOrgName: salesOrgNames[partners[(i % 4) + 1].salesOrgs[0]] || null,
    currency: partners[(i % 4) + 1].salesOrgs[0] === '2000' ? 'EUR' : 'USD',
    // Every third order arrives with tax in its total, as a real Commerce order does,
    // so the document's Tax row is something that can be looked at.
    total: cents(lines.reduce((sum, l) => sum + l.qty * l.price, 0) * (i % 3 === 0 ? 1.0825 : 1)),
    header,
    shipments: [],
    invoice: null,
    creditMemos: [],
    history: [{ status: 'created', at: day(4 + i) }],
    createdAt: day(4 + i)
  }
  // Every order approved but the last, which arrived over the limit and waits on a decision.
  order.creditStatus = i === 7 ? 'held' : 'approved'
  order.creditReason = i === 7 ? 'Credit limit 80,000.00 exceeded by 1,240.00' : null
  order.creditDecidedAt = null
  if (header === 'confirmed') order.history.push({ status: 'confirmed', at: day(4 + i, 11) })
  if (header === 'canceled') {
    order.cancelReason = 'Customer request'
    order.history.push({ status: 'canceled', at: day(4 + i, 11), reason: 'Customer request' })
  }
  return order
})

/* Order 1002: fully shipped in two shipments and invoiced. 1003: one shipment posted,
   one still open. 1006: partly shipped, the rest closed. 1007: on credit hold. */
function seedShipment (order, number, lines, warehouse, posted) {
  const lineOf = (item) => order.lines.find((x) => x.item === item)
  order.shipments.push({
    number,
    createdAt: day(12),
    postedAt: posted ? day(12, 15) : null,
    status: posted ? 'posted' : 'open',
    warehouse,
    lines: lines.map((l) => ({ ...l, sku: lineOf(l.item).sku, customerLineReference: lineOf(l.item).customerLineReference }))
  })
  if (posted) for (const l of lines) lineOf(l.item).shippedQty += l.qty
}
seedShipment(orders[2], '8000000001', [{ item: 10, qty: orders[2].lines[0].qty }], 'default', true)
seedShipment(orders[2], '8000000002', [{ item: 20, qty: orders[2].lines[1].qty }], 'default', true)
{
  const net = cents(orders[2].lines.reduce((s, l) => s + lineNet(l), 0))
  orders[2].invoice = {
    number: '9000000001',
    createdAt: day(13),
    status: 'open',
    lines: orders[2].lines.map((l) => ({ item: l.item, sku: l.sku, qty: l.qty, price: l.price, discount: l.discount || 0, amount: lineNet(l) })),
    net,
    tax: cents(orders[2].total - net),
    total: orders[2].total,
    shipments: ['8000000001', '8000000002']
  }
}
seedShipment(orders[3], '8000000003', [{ item: 10, qty: orders[3].lines[0].qty }], 'default', true)
seedShipment(orders[3], '8000000004', [{ item: 20, qty: 1 }], 'default', false)
seedShipment(orders[6], '8000000005', [{ item: 10, qty: orders[6].lines[0].qty }, { item: 20, qty: 1 }], 'default', true)
orders[6].lines[1].closedQty = orders[6].lines[1].qty - 1
orders[6].lines[1].closeReason = 'Out of stock'
/* Invoice the way createInvoice does, and the whole-invoice credit memo the way
   lib/credit-memos makeCreditMemo does: tax in proportion to the net credited. */
function seedInvoice (order, number, at) {
  const net = cents(order.lines.reduce((s, l) => s + lineNet(l), 0))
  order.invoice = {
    number,
    createdAt: at,
    status: 'open',
    lines: order.lines.map((l) => ({ item: l.item, sku: l.sku, qty: l.qty, price: l.price, discount: l.discount || 0, amount: lineNet(l) })),
    net,
    tax: cents(order.total - net),
    total: order.total,
    shipments: order.shipments.filter((s) => s.status === 'posted').map((s) => s.number)
  }
}
function makeCreditMemo (order, lines, returnNumber, number, at) {
  const credited = lines.map((l) => ({ item: l.item, sku: l.sku, qty: l.qty, price: l.price, discount: l.discount || 0, amount: lineNet(l), customerLineReference: l.customerLineReference ?? null }))
  const net = cents(credited.reduce((sum, l) => sum + l.amount, 0))
  const tax = order.invoice.net ? cents((order.invoice.tax * net) / order.invoice.net) : 0
  return { number, createdAt: at, orderNumber: order.number, invoiceNumber: order.invoice.number, returnNumber: returnNumber ?? null, lines: credited, net, tax, total: cents(net + tax) }
}

/* Order 1008: shipped, invoiced, and its invoice credited in full by credit memo 9500000002.
   Its first line carries a discount the web shop gave (contract version 17), so the Discount
   column and total can be looked at on a credit memo. */
orders[8].lines[0].discount = 25
orders[8].total = cents(orders[8].total - 25)
seedShipment(orders[8], '8000000006', orders[8].lines.map((l) => ({ item: l.item, qty: l.qty })), 'default', true)
seedInvoice(orders[8], '9000000002', day(14))
{
  const memo = makeCreditMemo(orders[8], orders[8].lines, null, '9500000002', day(15))
  orders[8].invoice.status = 'credited'
  orders[8].invoice.creditMemo = memo.number
  orders[8].creditMemos.push(memo)
  orders[8].history.push({ status: 'invoiced', at: day(14) }, { status: 'credited', at: day(15), creditMemo: memo.number })
}

/* Order 1009: paid by card at checkout (contract version 18), shipped, invoiced as 9000000003
   and paid in full by payment 7000000002, which the ERP posted with the invoice. Its
   lines are two sellable products (the index would have picked P000010, which is blocked
   for sales and could not have shipped). */
orders[9].lines = [
  // A promotion in the web shop took 17.80 off the first line (contract version 17).
  { ...orders[9].lines[0], sku: 'P000001', price: 89, discount: 17.8 },
  { ...orders[9].lines[1], sku: 'P000003', price: 12 }
]
orders[9].total = cents(orders[9].lines.reduce((sum, l) => sum + lineNet(l), 0) * 1.0825)
seedShipment(orders[9], '8000000007', orders[9].lines.map((l) => ({ item: l.item, qty: l.qty })), 'default', true)
orders[9].payment = { method: 'Credit card', reference: '8FK21345TX901234A', cardBrand: 'Visa', cardLastFour: '4242', amount: orders[9].total }
seedInvoice(orders[9], '9000000003', day(16))
orders[9].history.push({ status: 'invoiced', at: day(16) })

/* Incoming payments (lib/payments): 7000000001 pays part of invoice 9000000001, so it reads
   partly paid; 7000000002 is the card payment of order 1009, posted with invoice 9000000003. */
const payments = [
  { number: '7000000001', createdAt: day(17), partnerId: orders[2].partnerId, orderNumber: orders[2].number, invoiceNumber: '9000000001', amount: 100, currency: orders[2].currency, reference: 'Wire 2026-0917', paidInWebShop: null },
  { number: '7000000002', createdAt: day(18), partnerId: orders[9].partnerId, orderNumber: orders[9].number, invoiceNumber: '9000000003', amount: orders[9].invoice.total, currency: orders[9].currency, reference: orders[9].payment.reference, paidInWebShop: { method: 'Credit card', cardBrand: 'Visa', cardLastFour: '4242' } }
]

/* Return orders (lib/returns), all on sales order 1002: 6000000001 received and credited by
   credit memo 9500000001, 6000000002 received and waiting for its credit memo, 6000000003
   open — one of each state, so each document's move can be looked at. */
function seedReturn (order, number, customerReturnReference, lines, moments) {
  const lineOf = (item) => order.lines.find((x) => x.item === item)
  const r = {
    number,
    customerReturnReference: String(customerReturnReference),
    orderNumber: order.number,
    partnerId: order.partnerId,
    status: 'open',
    lines: lines.map((l) => ({ item: l.item, sku: lineOf(l.item).sku, qty: l.qty, price: lineOf(l.item).price, reason: l.reason, reasonCode: l.reasonCode, customerLineReference: lineOf(l.item).customerLineReference })),
    creditMemo: null,
    history: [{ status: 'open', at: moments.open }],
    createdAt: moments.open,
    receivedAt: null
  }
  if (moments.received) {
    r.status = 'received'
    r.receivedAt = moments.received
    r.history.push({ status: 'received', at: moments.received })
  }
  if (moments.credited) {
    r.creditMemo = makeCreditMemo(order, r.lines, r.number, moments.memo, moments.credited)
    r.status = 'credited'
    r.history.push({ status: 'credited', at: moments.credited, creditMemo: moments.memo })
  }
  return r
}
const returnOrders = [
  seedReturn(orders[2], '6000000001', '7', [{ item: 10, qty: 1, reason: 'Wrong size', reasonCode: 'WRONGSIZE' }], { open: day(14), received: day(15), credited: day(16), memo: '9500000001' }),
  seedReturn(orders[2], '6000000002', '8', [{ item: 20, qty: 1, reason: 'Customer return', reasonCode: 'RETURN' }], { open: day(17), received: day(18) }),
  seedReturn(orders[2], '6000000003', '9', [{ item: 10, qty: 1, reason: 'Damaged', reasonCode: 'DAMAGED' }], { open: day(19) })
]

let nextShipment = 8000000008
let nextInvoice = 9000000004
let nextCreditMemo = 9500000003
let nextPayment = 7000000003

/* What is still open on an order's invoice, by the ERP's own rule (lib/open-items): its
   payments, and the credit memos of its returns. Empty for an order with no invoice. */
const paymentsOf = (order) => payments.filter((p) => p.orderNumber === order.number).sort((a, b) => (a.number < b.number ? -1 : 1))
function openItem (order) {
  if (!order.invoice || !order.invoice.number) return {}
  const credits = returnOrders.filter((r) => r.orderNumber === order.number && r.creditMemo).map((r) => r.creditMemo)
  return openItemOf(order, paymentsOf(order), credits)
}

const events = [
  { _id: 'e1', at: new Date(Date.UTC(2026, 8, 22, 14, 2)).toISOString(), direction: 'out', type: 'SalesOrder.Changed', data: { SalesOrder: '0000001001', PurchaseOrderByCustomer: '00000301', OverallStatus: 'confirmed', PrevOverallStatus: 'created', CreditBlock: false, PrevCreditBlock: false, Reason: null, Items: [] }, delivered: true, attempts: 1 },
  { _id: 'e2', at: new Date(Date.UTC(2026, 8, 22, 13, 55)).toISOString(), direction: 'in', origin: { system: 'Adobe Commerce', document: 'stock item P000003' }, summary: 'Stock for P000003 set to 18', value: { sku: 'P000003', stock: 18 } },
  { _id: 'e3', at: new Date(Date.UTC(2026, 8, 22, 13, 40)).toISOString(), direction: 'out', type: 'Product.Changed', data: { Product: 'P000007', ProductName: 'Product 7', ListPrice: 189, ChangedFields: ['ListPrice'] }, delivered: false, failed: true, attempts: 10, lastError: 'ingestion webhook answered 503' },
  { _id: 'e4', at: new Date(Date.UTC(2026, 8, 22, 13, 20)).toISOString(), direction: 'out', type: 'Customer.Changed', data: { Customer: 'C000102', CreditLimit: 120000, BlockingLevel: 'open', PrevBlockingLevel: 'open', ChangedFields: ['CreditLimit'] }, delivered: false, attempts: 2 },
  { _id: 'e5', at: new Date(Date.UTC(2026, 8, 22, 12, 5)).toISOString(), direction: 'in', origin: { system: 'Adobe Commerce', document: 'company 9' }, summary: 'Customer C000103 blocked', value: { blocked: true } },
  { _id: 'e6', at: new Date(Date.UTC(2026, 8, 22, 11, 45)).toISOString(), direction: 'out', type: 'OutboundDelivery.GoodsIssueStatusChanged', data: { OutboundDelivery: '8000000002', SalesOrder: '0000001002', Plant: 'default', Items: [{ Quantity: 3 }, { Quantity: 2 }] }, delivered: true, attempts: 1 },
  { _id: 'e7', at: new Date(Date.UTC(2026, 8, 22, 11, 30)).toISOString(), direction: 'out', type: 'CustomerReturn.Changed', data: { CustomerReturn: '6000000002', SalesOrder: '0000001002', Status: 'received', PrevStatus: 'open', Items: [{ Quantity: 1 }] }, delivered: true, attempts: 1 },
  { _id: 'e9', at: new Date(Date.UTC(2026, 8, 22, 11, 20)).toISOString(), direction: 'out', type: 'IncomingPayment.Posted', data: { Payment: '7000000001', BillingDocument: '9000000001', SalesOrder: orders[2].number, Amount: 100, Currency: orders[2].currency, Customer: orders[2].partnerId, PaymentReference: 'Wire 2026-0917' }, delivered: true, attempts: 1 },
  { _id: 'e8', at: new Date(Date.UTC(2026, 8, 22, 11, 15)).toISOString(), direction: 'out', type: 'BillingDocument.Created', data: { BillingDocument: '9500000001', BillingDocumentType: 'CreditMemo', SalesOrder: '0000001002', CustomerReturn: '6000000001' }, delivered: true, attempts: 1 }
]

const conditions = [
  { _id: 'c1', id: 'c1', kind: 'contractPrice', partnerId: 'C000101', sku: 'P000001', price: 79, validFrom: '2026-09-01', validTo: '2026-12-31', minQty: 10 },
  { _id: 'c2', id: 'c2', kind: 'contractDiscount', partnerId: 'C000102', sku: null, percent: 12, validFrom: null, validTo: null, minQty: null },
  { _id: 'c3', id: 'c3', kind: 'maxDiscount', partnerId: null, sku: null, percent: 25, validFrom: null, validTo: null, minQty: null },
  { _id: 'c4', id: 'c4', kind: 'contractPrice', partnerId: 'C000104', sku: 'P000008', price: 49, validFrom: '2026-11-01', validTo: null, minQty: null },
  { _id: 'c5', id: 'c5', kind: 'contractDiscount', partnerId: 'C000103', sku: null, percent: 8, validFrom: '2026-01-01', validTo: '2026-06-30', minQty: null },
  { _id: 'c6', id: 'c6', kind: 'contractDiscount', partnerId: 'C000102', sku: null, percent: 15, validFrom: null, validTo: null, minQty: null, salesOrg: '2000' }
]
for (const c of conditions) if (c.salesOrg === undefined) c.salesOrg = null
for (const p of partners) if (p.priceGroup === undefined) p.priceGroup = null

/* Customer price lists (lib/contracts; the record keeps the integration's name) and the
   customer price groups they may apply to (lib/price-groups). No list here ENDS: a status
   that turns with the calendar would change a screen's look on a date, not by a change. */
const priceGroups = [{ code: 'RETAIL', name: 'Retail shops' }, { code: 'TRADE', name: 'Trade accounts' }]
const listLine = (sku, amount, extra = {}) => ({ sku, ...amount, minQty: 1, startingDate: null, endingDate: null, ...extra })
const contracts = [
  { number: '4000000003', appliesTo: 'customer', partnerId: 'C000103', priceGroup: null, description: 'Fabrikam 2027 proposal', startingDate: '2027-01-01', endingDate: null, status: 'draft', lines: [listLine('P000002', { kind: 'price', price: 30 })] },
  { number: '4000000002', appliesTo: 'priceGroup', partnerId: null, priceGroup: 'TRADE', description: 'Trade price list', startingDate: '2026-01-01', endingDate: null, status: 'active', lines: [listLine('P000001', { kind: 'discount', percent: 10 }), listLine('P000001', { kind: 'discount', percent: 15 }, { minQty: 25 }), listLine('P000004', { kind: 'price', price: 99 }), listLine('P000004', { kind: 'price', price: 105 }, { startingDate: '2027-01-01' })] },
  { number: '4000000001', appliesTo: 'customer', partnerId: 'C000101', priceGroup: null, description: 'Northwind terms', startingDate: '2026-01-01', endingDate: null, status: 'active', lines: [listLine('P000001', { kind: 'price', price: 79 }), listLine('P000003', { kind: 'price', price: 10 }, { minQty: 10 })] }
].map((c) => ({ ...c, _id: c.number, createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-01T09:00:00.000Z' }))

const settings = {
  displayName: 'Northwind ERP',
  appearance: { ...DEFAULT_APPEARANCE },
  warehouses: { default: { name: 'Plant 1000 · Seattle DC' }, east: { name: 'East DC' } },
  structureMirror,
  lastImportAt: new Date(Date.UTC(2026, 8, 22, 13, 58)).toISOString(),
  lastWipeAt: null,
  // The ERP's setup (lib/setup.js): what Settings shows and edits.
  company: { code: '1000', name: 'Northwind Trading Co.', address: { street: ['1 Harbor Way'], city: 'Seattle', region: 'WA', postcode: '98101', countryId: 'US' }, taxId: 'US 91-1234567', currency: 'USD' },
  sales: {
    defaultPaymentTerms: 'NET30',
    creditWarnings: 'creditLimit',
    returnReasons: [
      { code: 'RETURN', description: 'Customer return' }, { code: 'DAMAGED', description: 'Damaged' },
      { code: 'DEFECTIVE', description: 'Defective' }, { code: 'WRONGITEM', description: 'Wrong item' },
      { code: 'WRONGSIZE', description: 'Wrong size' }, { code: 'WRONGCOLOR', description: 'Wrong color' }
    ],
    defaultReturnReason: 'RETURN'
  },
  salesOrganizations: [
    { code: '1000', name: 'Online US', currency: 'USD', websiteCode: 'base' },
    { code: '2000', name: 'Online EU', currency: 'EUR', websiteCode: 'eu' }
  ]
}

/* The selling structure, derived as lib/structure.js derives it. */
function describeStructure () {
  const home = structureMirror.websites.find((w) => w.salesOrg === '1000') || structureMirror.websites[0]
  const orgs = new Map()
  const org = (code) => {
    if (!orgs.has(code)) orgs.set(code, { code, name: null, currency: null, websiteCode: null, customers: 0, orders: 0 })
    return orgs.get(code)
  }
  for (const own of settings.salesOrganizations) Object.assign(org(own.code), { name: own.name, currency: own.currency, websiteCode: own.websiteCode })
  for (const p of partners) for (const code of p.salesOrgs) if (code !== '*') org(code).customers += 1
  for (const o of orders) org(o.salesOrg || '1000').orders += 1
  const houses = new Map()
  for (const p of products) {
    for (const w of p.warehouses) {
      if (!houses.has(w.code)) houses.set(w.code, { code: w.code, imported: w.name, products: 0 })
      houses.get(w.code).products += 1
    }
  }
  for (const [code, value] of Object.entries(settings.warehouses)) {
    if (!houses.has(code)) houses.set(code, { code, imported: code, products: 0 })
    houses.get(code).name = value.name
  }
  return {
    companyCode: { code: settings.company.code, name: settings.company.name, currency: settings.company.currency, countryId: settings.company.address.countryId || home.storeInfo.countryId, vatNumber: settings.company.taxId, address: settings.company.address },
    salesOrgs: [...orgs.values()].sort((a, b) => a.code.localeCompare(b.code)),
    warehouses: [...houses.values()].map(({ imported, ...h }) => ({ ...h, name: h.name || imported })).sort((a, b) => a.code.localeCompare(b.code)),
    unmapped: []
  }
}

/* Home's work list, as lib/work counts it: from the same abilities the documents read. */
function workList () {
  const counts = { toConfirm: 0, onHold: 0, toShip: 0, toInvoice: 0, invoicesToCollect: 0, toPost: 0, returnsToReceive: 0, returnsToCredit: 0, blockedCustomers: 0, eventsFailed: 0, eventsPending: 0 }
  let amount = 0
  const recent = []
  for (const o of orders) {
    const can = abilities(o)
    if (can.confirm) counts.toConfirm += 1
    if (can.release) counts.onHold += 1
    if (can.ship) counts.toShip += 1
    if (can.invoice) counts.toInvoice += 1
    if (o.invoice && canPayInvoice({ ...o.invoice, ...openItem(o) })) counts.invoicesToCollect += 1
    counts.toPost += o.shipments.filter((s) => s.status !== 'posted').length
    if (o.header !== 'canceled' && !o.invoice) amount += o.lines.reduce((sum, l) => sum + lineNet(l), 0)
    const last = o.history.reduce((at, h) => (h.at > at ? h.at : at), o.createdAt)
    recent.push({ kind: 'order', number: o.number, at: last, title: `Sales Order ${o.number}` })
    for (const sh of o.shipments) recent.push({ kind: 'shipment', number: sh.number, at: sh.postedAt || sh.createdAt, title: `Shipment ${sh.number}` })
    if (o.invoice) recent.push({ kind: 'invoice', number: o.invoice.number, at: o.invoice.createdAt, title: `Invoice ${o.invoice.number}` })
  }
  for (const r of returnOrders) {
    const can = returnMoves(r)
    if (can.receive) counts.returnsToReceive += 1
    if (can.credit) counts.returnsToCredit += 1
  }
  counts.blockedCustomers = partners.filter((p) => p.blocking !== 'open').length
  counts.eventsFailed = events.filter((e) => e.direction === 'out' && e.failed).length
  counts.eventsPending = events.filter((e) => e.direction === 'out' && !e.delivered && !e.failed).length
  return {
    counts,
    openValue: { amount: cents(amount), currency: 'USD' },
    recent: recent.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5)
  }
}

/* `?maintenance` in the preview's address opens it inside a 30-minute window, so the banner
   can be looked at: a window is started from Demo Builder's ERP card, not from this screen. */
const PREVIEW_WINDOW_MS = 30 * 60 * 1000
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('maintenance')) {
  settings.maintenanceUntil = new Date(Date.now() + PREVIEW_WINDOW_MS).toISOString()
}

/* `?refuse-appearance` makes saving the appearance fail, so the panel's refusal can be looked
   at: the real ERP stores any look it is sent, and only an ERP that is not answering refuses. */
const refuseAppearance = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('refuse-appearance')
const APPEARANCE_REFUSAL = 'The ERP did not keep the appearance. Try again in a moment.'

const health = {
  displayName: settings.displayName,
  maintenance: maintenanceOf(settings),
  counts: { products: products.length, businessPartners: partners.length, salesOrders: orders.length, pricingConditions: conditions.length, contracts: contracts.length, priceGroups: priceGroups.length },
  // The next document numbers, nothing reserved (lib/counters peek), and the company code's currency.
  numbering: { salesOrder: '0000001010', shipment: '8000000008', invoice: '9000000004', contract: '4000000004', creditMemo: '9500000003', returnOrder: '6000000004', payment: '7000000003' },
  currency: 'USD',
  eventsPending: events.filter((e) => e.direction === 'out' && !e.delivered && !e.failed).length,
  lastImportAt: settings.lastImportAt
}

/* The two collections the ERP's setup reads and writes, over the records above: the settings
   record is `settings`, and each counter's value is one below health's next number. */
const counterValues = Object.fromEntries(Object.entries(health.numbering).map(([type, next]) => [type, Number(next) - 1]))
const setupCols = {
  settings: {
    findOne: async () => ({ _id: 'erp', ...settings }),
    replaceOne: async (_filter, { _id: _key, ...doc }) => { Object.assign(settings, doc); return { matchedCount: 1 } }
  },
  counters: {
    findOne: async ({ _id }) => (counterValues[_id] === undefined ? null : { _id, value: counterValues[_id] }),
    replaceOne: async ({ _id }, doc) => {
      counterValues[_id] = doc.value
      health.numbering[_id] = String(doc.value + 1).padStart(10, '0')
      return { matchedCount: 1 }
    }
  }
}

/* Real actions answer over the network. Without a delay here the preview would never
   show a loading state, so the one place it is checked would be the one place it does
   not happen. */
const LATENCY_MS = 350
const wait = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS))

/* Pricing, mirroring lib/pricing.js so the preview answers what the ERP would. */
const DEFAULT_MAX_DISCOUNT = 100
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const specificity = (c) => (c.salesOrg ? 4 : 0) + (c.partnerId ? 2 : 0) + (c.sku ? 1 : 0)
const matchesCondition = (c, partnerId, sku, salesOrg) =>
  (!c.partnerId || c.partnerId === partnerId) && (!c.sku || c.sku === sku) && (!c.salesOrg || !salesOrg || c.salesOrg === salesOrg)
const otherSalesOrg = (c, salesOrg) => (c.salesOrg && salesOrg && c.salesOrg !== salesOrg ? `for sales organization ${c.salesOrg}; this is ${salesOrg}` : null)
const dayText = (d) => new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))
function ruledOut (c, { date, qty }) {
  if (c.validFrom && date < c.validFrom) return `not valid until ${dayText(c.validFrom)}`
  if (c.validTo && date > c.validTo) return `expired on ${dayText(c.validTo)}`
  if (c.minQty && qty < c.minQty) return `minimum quantity ${c.minQty}, this line is ${qty}`
  return null
}

function mostSpecific (kind, partnerId, sku, context) {
  return conditions
    .filter((c) => c.kind === kind && matchesCondition(c, partnerId, sku, context.salesOrg) && !ruledOut(c, context))
    .sort((a, b) => specificity(b) - specificity(a))[0]
}

function priceLine (product, partnerId, qty, date, salesOrg) {
  const listPrice = Number(product.listPrice) || 0
  const context = { date, qty, salesOrg }
  const price = mostSpecific('contractPrice', partnerId, product.sku, context)
  const discount = mostSpecific('contractDiscount', partnerId, product.sku, context)
  const ceiling = mostSpecific('maxDiscount', partnerId, product.sku, context)
  const maxDiscountPercent = ceiling ? Number(ceiling.percent) : DEFAULT_MAX_DISCOUNT
  let contractPrice = listPrice
  let source = 'list'
  if (price && price.partnerId === partnerId) {
    contractPrice = Number(price.price)
    source = 'contractPrice'
  } else if (discount && discount.partnerId === partnerId) {
    contractPrice = round2(listPrice * (1 - Number(discount.percent) / 100))
    source = 'contractDiscount'
  }
  const floor = round2(listPrice * (1 - maxDiscountPercent / 100))
  if (contractPrice < floor) {
    contractPrice = floor
    source = 'ceiling'
  }
  const discountPercent = listPrice > 0 ? round2(((listPrice - contractPrice) / listPrice) * 100) : 0
  const applied = new Set([ceiling, price || discount].filter(Boolean))
  const outranked = (c) => {
    if (c.kind === 'contractDiscount' && price) return 'a contract price takes precedence'
    if (c.kind === 'contractPrice' && price) return 'a more specific contract price applies'
    if (c.kind === 'contractDiscount' && discount) return 'a more specific discount applies'
    if (c.kind === 'maxDiscount' && ceiling) return 'a more specific discount limit applies'
    return null
  }
  const notApplied = conditions
    .filter((c) => matchesCondition(c, partnerId, product.sku) && !applied.has(c) && (c.partnerId === partnerId || c.kind === 'maxDiscount' || !c.partnerId))
    .map((c) => ({ id: c._id, kind: c.kind, reason: ruledOut(c, context) || otherSalesOrg(c, salesOrg) || outranked(c) }))
    .filter((c) => c.reason)
  return {
    sku: product.sku,
    qty,
    listPrice,
    contractPrice: round2(contractPrice),
    discountPercent,
    maxDiscountPercent,
    source,
    lineTotal: round2(contractPrice * qty),
    notApplied
  }
}

let nextConditionId = 100
const copy = (value) => JSON.parse(JSON.stringify(value))

/* The order document (lib/orders describeOrder) and its moves (lib/fulfilment). */
const CANCEL_REASONS = ['Customer request', 'Credit rejected', 'Out of stock', 'Pricing error', 'Duplicate order']
const CLOSE_REASONS = ['Customer request', 'Out of stock', 'Product discontinued']
const openQty = (l) => Math.max(0, l.qty - l.shippedQty - l.closedQty)
const totalsOf = (o) => ({
  shipped: o.lines.reduce((s, l) => s + l.shippedQty, 0),
  open: o.lines.reduce((s, l) => s + openQty(l), 0)
})
function deriveStatus (o) {
  if (o.header === 'canceled') return 'canceled'
  if (o.invoice) return 'invoiced'
  if (totalsOf(o).shipped > 0) return 'shipped'
  return o.header === 'confirmed' ? 'confirmed' : 'created'
}
function nextMoves (o) {
  if (o.header === 'canceled' || o.invoice) return []
  if (o.header === 'created') return ['confirmed', 'canceled']
  const { shipped, open } = totalsOf(o)
  if (shipped === 0) return open > 0 ? ['shipped', 'canceled'] : ['canceled']
  return open > 0 ? ['shipped'] : ['invoiced']
}
function abilities (o) {
  const { shipped, open } = totalsOf(o)
  const live = o.header === 'confirmed' && !o.invoice
  const held = o.creditStatus === 'held' && o.header !== 'canceled'
  return {
    confirm: o.header === 'created' && !held,
    ship: live && open > 0,
    close: live && open > 0,
    invoice: live && open === 0 && shipped > 0,
    cancel: o.header !== 'canceled' && !o.invoice && shipped === 0,
    release: held,
    reject: held,
    repeat: o.header === 'canceled' && !o.repeatedAs
  }
}
const productOf = (sku) => products.find((p) => p.sku === sku)
const named = (l) => {
  const p = productOf(l.sku)
  return { ...l, name: p ? p.name : l.sku, unit: p && p.unit ? p.unit : 'EA' }
}
const partnerOf = (id) => partners.find((p) => p.id === id) || null

function describe (order) {
  const partner = partnerOf(order.partnerId)
  const lines = order.lines.map((line) => ({ ...named(line), openQty: openQty(line), amount: lineNet(line) }))
  const net = cents(lines.reduce((sum, l) => sum + l.amount, 0))
  const total = cents(Number(order.total ?? net))
  const can = abilities(order)
  const { shipped, open } = totalsOf(order)
  const warehouses = new Map()
  for (const l of order.lines) {
    for (const w of (productOf(l.sku) || { warehouses: [] }).warehouses) warehouses.set(w.code, { code: w.code, name: (settings.warehouses[w.code] || {}).name || w.name })
  }
  return {
    ...order,
    status: deriveStatus(order),
    lines,
    nextStatuses: nextMoves(order),
    partner: partner ? { id: partner.id, name: partner.name, paymentTerms: partner.paymentTerms } : null,
    shippingStatus: shipped === 0 ? 'none' : (open > 0 ? 'partial' : 'full'),
    billingStatus: order.invoice ? (order.invoice.status === 'credited' ? 'credited' : 'invoiced') : 'none',
    overall: order.header === 'canceled' ? 'Canceled' : (order.invoice ? 'Completed' : (order.header === 'confirmed' ? 'In process' : 'Open')),
    credit: order.creditStatus ? { status: order.creditStatus, reason: order.creditReason, decidedAt: order.creditDecidedAt } : null,
    can,
    shipments: order.shipments.map((s) => ({ ...s, lines: s.lines.map(named) })),
    invoice: order.invoice ? { ...order.invoice, lines: order.invoice.lines.map(named), ...openItem(order) } : null,
    creditMemos: creditMemosOf(order),
    returnOrders: returnOrders.filter((r) => r.orderNumber === order.number),
    payments: paymentsOf(order),
    warehouses: [...warehouses.values()],
    net,
    tax: cents(total - net),
    total,
    cancelReasons: can.cancel ? CANCEL_REASONS : [],
    closeReasons: can.close ? CLOSE_REASONS : []
  }
}

/* Every credit memo of an order, from its invoice and its returns, by number (lib/credit-memos creditMemosOf). */
function creditMemosOf (order) {
  const byReturn = returnOrders.filter((r) => r.orderNumber === order.number && r.creditMemo).map((r) => r.creditMemo)
  return [...(order.creditMemos || []), ...byReturn].sort((a, b) => (a.number < b.number ? -1 : 1))
}
const allCreditMemos = () => orders.flatMap(creditMemosOf)

const fail = (message) => { throw new Error(message) }
const orderOf = (number) => orders.find((o) => o.number === number) || fail(`Sales order ${number} was not found.`)

function describeShipment (order, s) {
  const p = partnerOf(order.partnerId)
  const stocked = productOf(s.lines[0].sku)
  const imported = s.warehouse ? ((stocked && stocked.warehouses.find((w) => w.code === s.warehouse)) || { name: s.warehouse }).name : null
  const warehouse = s.warehouse
    ? { code: s.warehouse, name: (settings.warehouses[s.warehouse] || {}).name || imported }
    : null
  return {
    ...s,
    orderNumber: order.number,
    purchaseOrderByCustomer: order.purchaseOrderByCustomer,
    partner: p ? { id: p.id, name: p.name } : null,
    warehouse,
    lines: s.lines.map(named)
  }
}

function describeInvoice (order, inv) {
  const p = partnerOf(order.partnerId)
  return {
    ...inv,
    ...openItem(order),
    payment: order.payment ?? null,
    orderNumber: order.number,
    purchaseOrderByCustomer: order.purchaseOrderByCustomer,
    currency: order.currency,
    partner: p ? { id: p.id, name: p.name, paymentTerms: p.paymentTerms } : null,
    ...(() => {
      // lib/terms: the billing date plus the terms' days; terms naming no days leave it null.
      const m = p && /^NET\s*(\d{1,3})$/i.exec(p.paymentTerms || '')
      if (!m) return { paymentDays: null, dueDate: null }
      const due = new Date(inv.createdAt); due.setUTCDate(due.getUTCDate() + Number(m[1]))
      return { paymentDays: Number(m[1]), dueDate: due.toISOString() }
    })(),
    seller: (() => {
      const through = structureMirror.websites.find((w) => w.salesOrg === order.salesOrg) || structureMirror.websites[0]
      const org = settings.salesOrganizations.find((o) => o.code === order.salesOrg)
      const c = settings.company
      return { companyCode: c.code, name: c.name, salesOrg: order.salesOrg, salesOrgName: (org && org.name) || order.salesOrgName, currency: (org && org.currency) || c.currency, countryId: c.address.countryId || through.storeInfo.countryId, vatNumber: c.taxId, address: c.address }
    })(),
    lines: inv.lines.map(named)
  }
}

/* The customer document, shaped the way lib/partners.js `describePartner` shapes it. */
const OPEN = new Set(['created', 'confirmed', 'shipped'])

/* A customer row for the list (lib/partners withCredit): exposure and what is left, by the
   document's rule; null for the walk-in account, which has no credit relationship. */
function withCredit (partner) {
  if (partner.isDefault) return { ...partner, exposure: null, available: null }
  const { credit } = describePartner(partner)
  return { ...partner, exposure: credit.exposure, available: credit.available }
}

/* The two derived states a sales order row shows (lib/orders shippingStatus, overallStatus). */
function shippingStatus (o) {
  const shipped = o.lines.reduce((sum, l) => sum + (l.shippedQty || 0), 0)
  const open = o.lines.reduce((sum, l) => sum + Math.max(0, l.qty - (l.shippedQty || 0) - (l.closedQty || 0)), 0)
  if (shipped === 0) return 'none'
  return open > 0 ? 'partial' : 'full'
}
function overallStatus (o) {
  if (o.header === 'canceled') return 'Canceled'
  if (o.invoice) return 'Completed'
  return o.header === 'confirmed' ? 'In process' : 'Open'
}
function describePartner (partner) {
  const own = orders
    .filter((o) => o.partnerId === partner.id)
    .sort((a, b) => (a.number < b.number ? 1 : -1))
    .map((o) => ({
      number: o.number,
      createdAt: o.createdAt,
      status: deriveStatus(o),
      creditStatus: o.creditStatus ?? null,
      purchaseOrderByCustomer: o.purchaseOrderByCustomer,
      currency: o.currency,
      net: cents((o.lines || []).reduce((sum, l) => sum + lineNet(l), 0))
    }))
  // Open orders plus open items (lib/partners exposures, openItemsOf).
  const openOrders = cents(own.filter((o) => OPEN.has(o.status) && o.creditStatus !== 'held').reduce((sum, o) => sum + o.net, 0))
  const openItems = orders
    .filter((o) => o.partnerId === partner.id && o.invoice && o.invoice.number)
    .map((o) => ({ o, item: openItem(o) }))
    .filter(({ item }) => item.openAmount > 0)
    .map(({ o, item }) => ({ invoiceNumber: o.invoice.number, orderNumber: o.number, createdAt: o.invoice.createdAt, dueDate: describeInvoice(o, o.invoice).dueDate, total: o.invoice.total, openAmount: item.openAmount, paymentStatus: item.paymentStatus, currency: o.currency }))
    .sort((a, b) => (a.invoiceNumber < b.invoiceNumber ? -1 : 1))
  const openItemsAmount = cents(openItems.reduce((sum, i) => sum + i.openAmount, 0))
  const exposure = cents(openOrders + openItemsAmount)
  const held = own.filter((o) => o.creditStatus === 'held' && o.status !== 'canceled').length
  const limit = Number(partner.creditLimit) || 0
  return {
    ...partner,
    salesOrgNames: Object.fromEntries(settings.salesOrganizations.map((o) => [o.code, o.name])),
    credit: !partner.isDefault ? { limit, exposure, openOrders, openItems: openItemsAmount, available: cents(limit - exposure), held } : null,
    openItems,
    orders: own,
    conditions: conditions.filter((c) => c.partnerId === partner.id),
    // Its own price lists, then its price group's (lib/partners describePartner).
    contracts: [...contracts.filter((c) => c.partnerId === partner.id), ...contracts.filter((c) => partner.priceGroup && c.priceGroup === partner.priceGroup)]
  }
}

const refuse = () => Promise.reject(new Error('The preview holds stand-in records; nothing here writes.'))

/* Committed and available, mirrored from lib/availability.js: the open quantity on orders
   that are neither canceled nor invoiced, and on hand less that. A configurable parent
   has no lines of its own here (its stand-in variants are not orders' SKUs). */
const commitsStock = (o) => o.header !== 'canceled' && !o.invoice
const openQtyOf = (l) => Math.max(0, l.qty - (l.shippedQty || 0) - (l.closedQty || 0))
function committedOf (sku) {
  return orders.filter(commitsStock).reduce((sum, o) => sum + o.lines.filter((l) => l.sku === sku).reduce((s, l) => s + openQtyOf(l), 0), 0)
}
const variantsOf = (p) => products.filter((v) => v.parentSku === p.sku)
function withAvailability (p) {
  const committed = p.type === 'configurable' ? variantsOf(p).reduce((sum, v) => sum + committedOf(v.sku), 0) : committedOf(p.sku)
  return { ...p, committed, available: p.stock - committed }
}
function openOrdersOf (p) {
  return orders
    .filter(commitsStock)
    .map((o) => ({ number: o.number, partnerId: o.partnerId, qty: o.lines.filter((l) => l.sku === p.sku).reduce((s, l) => s + openQtyOf(l), 0), status: deriveStatus(o), createdAt: o.createdAt, customer: (partnerOf(o.partnerId) || {}).name || null }))
    .filter((row) => row.qty > 0)
    .sort((a, b) => (a.number < b.number ? 1 : -1))
}

/** Everything screen/src/api.js offers, answered from the records above. */
export const fakeApi = {
  // The work list is counted on each read, as the ERP counts it, so a move made in the preview shows on Home.
  // The appearance is read on each call too: the user menu changes it (saveAppearance).
  health: async () => { await wait(); return copy({ ...health, appearance: settings.appearance, currency: settings.company.currency, work: workList(), structure: describeStructure() }) },
  // The setup, answered by the ERP's own lib/setup.js over stand-in collections (setupCols).
  setup: async () => { await wait(); return copy(await describeSetup(setupCols)) },
  saveSetup: async (patch) => { await wait(); return copy(await updateSetup(setupCols, patch)) },
  addSalesOrganization: async (org) => {
    await wait()
    await addSalesOrganization(setupCols, org)
    return copy(await describeSetup(setupCols))
  },
  updateSalesOrganization: async (code, patch) => {
    await wait()
    await updateSalesOrganization(setupCols, code, patch)
    return copy(await describeSetup(setupCols))
  },
  // Stored by the ERP's own lib/settings.js, so the look health brings back is the one it keeps.
  saveAppearance: async (appearance) => {
    await wait()
    if (refuseAppearance) throw new Error(APPEARANCE_REFUSAL)
    return copy(await updateSettings(setupCols, { appearance }))
  },
  renameWarehouse: async (code, name) => {
    await wait()
    settings.warehouses[code] = { name }
    return copy(settings)
  },
  products: async () => { await wait(); return copy(products.map(withAvailability)) },
  product: async (sku) => {
    const product = products.find((p) => p.sku === sku)
    if (!product) return undefined
    const parent = product.parentSku ? products.find((p) => p.sku === product.parentSku) : null
    return copy({
      ...withAvailability(product),
      ...(product.type === 'configurable' ? { variants: variantsOf(product).map(withAvailability) } : {}),
      ...(parent ? { parent: { sku: parent.sku, name: parent.name } } : {}),
      openOrders: openOrdersOf(product)
    })
  },
  patchProduct: refuse,
  partners: async () => { await wait(); return copy(partners.map(withCredit)) },
  partner: async (id) => { await wait(); return copy(describePartner(partnerOf(id))) },
  patchPartner: async (id, patch) => {
    await wait()
    const partner = partnerOf(id)
    if (patch.creditLimit !== undefined) partner.creditLimit = Number(patch.creditLimit)
    if (patch.blocking !== undefined) partner.blocking = String(patch.blocking)
    if (patch.priceGroup !== undefined) partner.priceGroup = patch.priceGroup || null
    return copy(partner)
  },
  conditions: async () => { await wait(); return copy(conditions) },
  contracts: async () => { await wait(); return copy(contracts) },
  contract: async (number) => { await wait(); return copy(contracts.find((c) => c.number === number) || fail(`Price list ${number} was not found.`)) },
  createContract: refuse,
  updateContract: refuse,
  activateContract: refuse,
  deactivateContract: refuse,
  priceGroups: async () => { await wait(); return copy(priceGroups) },
  savePriceGroup: refuse,
  deletePriceGroup: refuse,
  saveCondition: async (condition) => {
    await wait()
    const saved = { validFrom: null, validTo: null, minQty: null, ...condition, id: `c${nextConditionId++}`, _id: `c${nextConditionId}` }
    conditions.push(saved)
    return copy(saved)
  },
  deleteCondition: async (id) => {
    await wait()
    const at = conditions.findIndex((c) => c._id === id || c.id === id)
    if (at >= 0) conditions.splice(at, 1)
    return { deleted: at >= 0 }
  },
  quote: async ({ partnerId, lines, date, salesOrg }) => {
    await wait()
    const on = date || new Date().toISOString().slice(0, 10)
    const priced = (lines || []).map((line) => {
      const product = productOf(line.sku)
      if (!product) return { sku: line.sku, qty: line.qty ?? 1, unknown: true }
      return priceLine(product, partnerId, line.qty ?? 1, on, salesOrg)
    })
    return {
      partnerId: partnerId || partners[0].id,
      date: on,
      lines: priced,
      total: round2(priced.reduce((sum, l) => sum + (l.lineTotal || 0), 0))
    }
  },
  orders: async () => {
    await wait()
    return copy(orders.map((o) => ({
      ...o,
      status: deriveStatus(o),
      shippingStatus: shippingStatus(o),
      billingStatus: o.invoice ? (o.invoice.status === 'credited' ? 'credited' : 'invoiced') : 'none',
      overall: overallStatus(o),
      can: abilities(o),
      partnerName: (partnerOf(o.partnerId) || {}).name || null
    })))
  },
  order: async (number) => { await wait(); return copy(describe(orderOf(number))) },
  /* The moves the preview allows: they are what the documents are FOR, and a document
     whose buttons do nothing cannot be looked at properly. Each refuses as the ERP does. */
  releaseCredit: async (number) => {
    await wait()
    const o = orderOf(number)
    if (o.creditStatus !== 'held') fail('This order is not on credit hold.')
    o.creditStatus = 'released'; o.creditDecidedAt = new Date().toISOString()
    o.history.push({ status: 'released', at: o.creditDecidedAt })
    return copy(describe(o))
  },
  rejectCredit: async (number) => {
    await wait()
    const o = orderOf(number)
    if (o.creditStatus !== 'held') fail('This order is not on credit hold.')
    o.header = 'canceled'; o.cancelReason = 'Credit rejected'; o.creditDecidedAt = new Date().toISOString()
    o.history.push({ status: 'canceled', at: o.creditDecidedAt, reason: 'Credit rejected' })
    return copy(describe(o))
  },
  confirmOrder: async (number) => {
    await wait()
    const o = orderOf(number)
    if (o.creditStatus === 'held') fail(`${o.creditReason}. Release the order first.`)
    if (o.header !== 'created') fail(`This order was ${o.header} already.`)
    o.header = 'confirmed'
    o.history.push({ status: 'confirmed', at: new Date().toISOString() })
    return copy(describe(o))
  },
  cancelOrder: async (number, reason) => {
    await wait()
    const o = orderOf(number)
    if (!CANCEL_REASONS.includes(reason)) fail(`a cancellation needs one of these reasons: ${CANCEL_REASONS.join(', ')}`)
    if (totalsOf(o).shipped > 0) fail('This order has shipped; Commerce cannot cancel a shipped order.')
    o.header = 'canceled'
    o.cancelReason = reason
    o.history.push({ status: 'canceled', at: new Date().toISOString(), reason })
    return copy(describe(o))
  },
  // lib/repeat-order: a new order with the canceled one's lines, no customer reference.
  repeatOrder: async (number) => {
    await wait()
    const o = orderOf(number)
    if (o.header !== 'canceled' || o.repeatedAs) fail(`Sales order ${number} cannot be repeated.`)
    const at = new Date().toISOString()
    const made = { ...o, number: String(1000 + orders.length).padStart(10, '0'), purchaseOrderByCustomer: null, header: 'created', cancelReason: undefined, repeatOf: number, repeatedAs: null, shipments: [], invoice: null, creditMemos: [], lines: o.lines.map((l) => ({ ...l, customerLineReference: null, shippedQty: 0, closedQty: 0 })), history: [{ status: 'created', at, repeatOf: number }], createdAt: at }
    orders.push(made)
    o.repeatedAs = made.number
    o.history.push({ status: 'repeated', at, order: made.number })
    return copy(describe(made))
  },
  createShipment: async (number, { lines, warehouse }) => {
    await wait()
    const o = orderOf(number)
    if (o.header !== 'confirmed') fail('Confirm the order before shipping it.')
    const asked = (lines || []).filter((l) => l.qty > 0)
    if (asked.length === 0) fail('A shipment needs at least one line with a quantity.')
    const lineOf = (item) => o.lines.find((l) => l.item === Number(item)) || fail(`Item ${item} is not on this order.`)
    for (const a of asked) {
      const line = lineOf(a.item)
      if (a.qty > openQty(line)) fail(`Item ${line.item}: ${openQty(line)} EA remain of ${line.qty}.`)
    }
    o.shipments.push({
      number: String(nextShipment++),
      createdAt: new Date().toISOString(),
      postedAt: null,
      status: 'open',
      warehouse: warehouse || null,
      lines: asked.map((a) => { const line = lineOf(a.item); return { item: line.item, sku: line.sku, qty: a.qty, customerLineReference: line.customerLineReference } })
    })
    return copy(describe(o))
  },
  postShipment: async (number, shipmentNumber) => {
    await wait()
    const o = orderOf(number)
    const s = o.shipments.find((x) => x.number === shipmentNumber) || fail(`Shipment ${shipmentNumber} was not found.`)
    if (s.status === 'posted') fail(`Shipment ${shipmentNumber} was posted on ${new Date(s.postedAt).toLocaleDateString()}.`)
    for (const l of s.lines) o.lines.find((x) => x.item === l.item).shippedQty += l.qty
    s.status = 'posted'
    s.postedAt = new Date().toISOString()
    o.history.push({ status: 'shipped', at: s.postedAt, shipment: s.number })
    return copy(describe(o))
  },
  closeLine: async (number, item, reason) => {
    await wait()
    const o = orderOf(number)
    if (!CLOSE_REASONS.includes(reason)) fail(`closing a line needs one of these reasons: ${CLOSE_REASONS.join(', ')}`)
    const line = o.lines.find((l) => l.item === Number(item)) || fail(`Item ${item} is not on this order.`)
    if (openQty(line) === 0) fail(`Item ${item} has nothing open.`)
    line.closedQty += openQty(line)
    line.closeReason = reason
    return copy(describe(o))
  },
  createInvoice: async (number) => {
    await wait()
    const o = orderOf(number)
    if (o.invoice) fail(`This order is already invoiced (${o.invoice.number}).`)
    const short = o.lines.find((l) => openQty(l) > 0)
    if (short) fail(`Item ${short.item}: ${openQty(short)} EA are not yet shipped. Ship them, or close the remainder.`)
    if (totalsOf(o).shipped === 0) fail('Nothing on this order has shipped.')
    const net = cents(o.lines.reduce((s, l) => s + lineNet(l), 0))
    o.invoice = {
      number: String(nextInvoice++),
      createdAt: new Date().toISOString(),
      status: 'open',
      lines: o.lines.map((l) => ({ item: l.item, sku: l.sku, qty: l.qty, price: l.price, discount: l.discount || 0, amount: lineNet(l) })),
      net,
      tax: cents(o.total - net),
      total: o.total,
      shipments: o.shipments.filter((s) => s.status === 'posted').map((s) => s.number)
    }
    o.history.push({ status: 'invoiced', at: o.invoice.createdAt, invoice: o.invoice.number })
    return copy(describe(o))
  },
  shipments: async () => {
    await wait()
    return copy(orders.flatMap((o) => o.shipments.map((s) => ({
      number: s.number,
      orderNumber: o.number,
      partnerId: o.partnerId,
      createdAt: s.createdAt,
      postedAt: s.postedAt,
      status: s.status,
      warehouse: s.warehouse,
      warehouseName: s.warehouse ? ((settings.warehouses[s.warehouse] || {}).name || s.warehouse) : null,
      partnerName: (partnerOf(o.partnerId) || {}).name || null,
      lines: s.lines.length,
      qty: s.lines.reduce((sum, l) => sum + l.qty, 0)
    }))).sort((a, b) => (a.number < b.number ? 1 : -1)))
  },
  shipment: async (number) => {
    await wait()
    for (const o of orders) {
      const s = o.shipments.find((x) => x.number === number)
      if (s) return copy(describeShipment(o, s))
    }
    return fail(`Shipment ${number} was not found.`)
  },
  invoices: async () => {
    await wait()
    return copy(orders.filter((o) => o.invoice).map((o) => ({
      number: o.invoice.number,
      legacy: false,
      orderNumber: o.number,
      partnerId: o.partnerId,
      partnerName: (partnerOf(o.partnerId) || {}).name || null,
      createdAt: o.invoice.createdAt,
      status: o.invoice.status,
      currency: o.currency,
      total: o.invoice.total,
      ...openItem(o)
    })).sort((a, b) => (a.number < b.number ? 1 : -1)))
  },
  invoice: async (number) => {
    await wait()
    const o = orders.find((x) => x.invoice && x.invoice.number === number) || fail(`Invoice ${number} was not found.`)
    return copy(describeInvoice(o, o.invoice))
  },
  /* Crediting, mirrored from lib/credit-memos creditInvoice, refusals word for word. */
  creditInvoice: async (number) => {
    await wait()
    const o = orderOf(number)
    if (!o.invoice) fail('This order has no invoice to credit.')
    if (o.invoice.status === 'credited') fail(`Invoice ${o.invoice.number} was credited by credit memo ${o.invoice.creditMemo}.`)
    const own = returnOrders.filter((r) => r.orderNumber === number)
    const byReturn = own.find((r) => r.creditMemo)
    if (byReturn) fail(`Return order ${byReturn.number} credited part of this invoice (credit memo ${byReturn.creditMemo.number}); credit the rest by return.`)
    const open = own.find((r) => !r.creditMemo)
    if (open) fail(`Return order ${open.number} is still open on this invoice; receive and credit it, or credit by return.`)
    const memo = makeCreditMemo(o, o.lines, null, String(nextCreditMemo++), new Date().toISOString())
    o.invoice.status = 'credited'
    o.invoice.creditMemo = memo.number
    o.creditMemos.push(memo)
    o.history.push({ status: 'credited', at: memo.createdAt, creditMemo: memo.number })
    return copy(describe(o))
  },
  returns: async () => {
    await wait()
    return copy([...returnOrders].sort((a, b) => (a.number < b.number ? 1 : -1)).map((r) => ({ ...r, partnerName: (partnerOf(r.partnerId) || {}).name || null })))
  },
  returnOrder: async (number) => {
    await wait()
    return copy(returnOrders.find((r) => r.number === number) || fail(`Return order ${number} was not found.`))
  },
  /* lib/returns receiveReturn: the goods go back where a posted shipment of the line came from. */
  receiveReturn: async (number) => {
    await wait()
    const r = returnOrders.find((x) => x.number === number) || fail(`Return order ${number} was not found.`)
    if (r.status !== 'open') fail(`Return order ${number} was received on ${r.receivedAt.slice(0, 10)}.`)
    const o = orderOf(r.orderNumber)
    for (const l of r.lines) {
      const product = productOf(l.sku)
      const shipment = o.shipments.find((s) => s.status === 'posted' && s.lines.some((x) => x.item === l.item))
      const house = product && (product.warehouses.find((w) => shipment && w.code === shipment.warehouse) || product.warehouses[0])
      if (house) { house.quantity += l.qty; product.stock += l.qty }
    }
    r.status = 'received'
    r.receivedAt = new Date().toISOString()
    r.history.push({ status: 'received', at: r.receivedAt })
    return copy(r)
  },
  creditReturn: async (number) => {
    await wait()
    const r = returnOrders.find((x) => x.number === number) || fail(`Return order ${number} was not found.`)
    if (r.creditMemo) fail(`Return order ${number} was credited by credit memo ${r.creditMemo.number}.`)
    if (r.status !== 'received') fail(`Receive return order ${number} before crediting it.`)
    const o = orderOf(r.orderNumber)
    if (o.invoice.status === 'credited') fail(`Invoice ${o.invoice.number} was credited by credit memo ${o.invoice.creditMemo}.`)
    r.creditMemo = makeCreditMemo(o, r.lines, r.number, String(nextCreditMemo++), new Date().toISOString())
    r.status = 'credited'
    r.history.push({ status: 'credited', at: r.creditMemo.createdAt, creditMemo: r.creditMemo.number })
    return copy(r)
  },
  /* An incoming payment, mirrored from lib/payments postPayment, refusals word for word. */
  postPayment: async (invoiceNumber, body = {}) => {
    await wait()
    const o = orders.find((x) => x.invoice && x.invoice.number === invoiceNumber) || fail(`Invoice ${invoiceNumber} was not found.`)
    const amount = typeof body.amount === 'number' || typeof body.amount === 'string' ? cents(Number(body.amount)) : NaN
    if (!(amount > 0)) fail('A payment needs an amount: a number more than 0.')
    const item = openItem(o)
    if (item.openAmount === 0) fail(`Invoice ${invoiceNumber} ${item.paymentStatus === 'credited' ? 'was credited' : 'is paid'}; nothing is open on it.`)
    const figure = (v) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
    if (amount > item.openAmount) fail(`Invoice ${invoiceNumber} has ${figure(item.openAmount)} open; a payment of ${figure(amount)} is more than that.`)
    const reference = body.reference === undefined || body.reference === null ? null : (String(body.reference).trim() || null)
    const payment = { number: String(nextPayment++), createdAt: new Date().toISOString(), partnerId: o.partnerId, orderNumber: o.number, invoiceNumber, amount, currency: o.currency || 'USD', reference, paidInWebShop: null }
    payments.push(payment)
    return copy(payment)
  },
  payments: async () => {
    await wait()
    return copy([...payments].sort((a, b) => (a.number < b.number ? 1 : -1)).map((p) => ({ ...p, partnerName: (partnerOf(p.partnerId) || {}).name || null })))
  },
  payment: async (number) => {
    await wait()
    return copy(payments.find((p) => p.number === number) || fail(`Payment ${number} was not found.`))
  },
  creditMemos: async () => {
    await wait()
    return copy(allCreditMemos().map(({ lines, ...head }) => {
      const o = orderOf(head.orderNumber)
      return { ...head, lines: lines.length, partnerId: o.partnerId, currency: o.currency, partnerName: (partnerOf(o.partnerId) || {}).name || null }
    }).sort((a, b) => (a.number < b.number ? 1 : -1)))
  },
  creditMemo: async (number) => {
    await wait()
    return copy(allCreditMemos().find((m) => m.number === number) || fail(`Credit memo ${number} was not found.`))
  },
  events: async () => {
    await wait()
    return { items: copy(events.map((e) => ({ ...e, describe: describeEvent(e) }))), webhookUrl: 'https://preview.example/ingestion/webhook', pending: 1, failed: 1 }
  },
  /* One search across every record, as lib/search ranks it: exact first, then contains. */
  search: async (q) => {
    await wait()
    const needle = String(q || '').toLowerCase().trim()
    if (needle.length < 2) return { items: [] }
    const score = (fields) => fields.reduce((best, f) => {
      const v = String(f || '').toLowerCase()
      return v === needle ? 2 : (v.includes(needle) ? Math.max(best, 1) : best)
    }, 0)
    const hits = []
    for (const o of orders) hits.push({ rank: score([o.number, o.purchaseOrderByCustomer, (partnerOf(o.partnerId) || {}).name]), kind: 'order', number: o.number, title: `Sales Order ${o.number}`, subtitle: (partnerOf(o.partnerId) || {}).name })
    for (const o of orders) for (const sh of o.shipments) hits.push({ rank: score([sh.number, o.number]), kind: 'shipment', number: sh.number, title: `Shipment ${sh.number}`, subtitle: `for sales order ${o.number}` })
    for (const o of orders) if (o.invoice) hits.push({ rank: score([o.invoice.number, o.number]), kind: 'invoice', number: o.invoice.number, title: `Invoice ${o.invoice.number}`, subtitle: `for sales order ${o.number}` })
    // A document found by another's number never outranks that document (lib/search ownFirst).
    const ownFirst = (own, related) => Math.max(score(own), Math.min(1, score(related)))
    for (const r of returnOrders) hits.push({ rank: ownFirst([r.number, r.customerReturnReference], [r.orderNumber]), kind: 'return', number: r.number, title: `Return Order ${r.number}`, subtitle: `for sales order ${r.orderNumber}` })
    for (const m of allCreditMemos()) hits.push({ rank: ownFirst([m.number], [m.orderNumber, m.invoiceNumber, m.returnNumber]), kind: 'creditMemo', number: m.number, title: `Credit Memo ${m.number}`, subtitle: `for sales order ${m.orderNumber}` })
    for (const p of payments) hits.push({ rank: ownFirst([p.number, p.reference], [p.invoiceNumber, p.orderNumber]), kind: 'payment', number: p.number, title: `Payment ${p.number}`, subtitle: `for invoice ${p.invoiceNumber}` })
    for (const p of products) hits.push({ rank: score([p.sku, p.name]), kind: 'product', number: p.sku, title: p.name, subtitle: p.sku })
    for (const p of partners) hits.push({ rank: score([p.id, p.name]), kind: 'customer', number: p.id, title: p.name, subtitle: p.id })
    return { items: hits.filter((h) => h.rank > 0).sort((a, b) => b.rank - a.rank || a.title.localeCompare(b.title)).slice(0, 12).map(({ rank, ...h }) => h) }
  },
  retryEvents: refuse,
  requeueEvents: refuse
}
