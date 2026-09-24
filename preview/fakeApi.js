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
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../lib/appearance.js'
import { describeEvent } from '../lib/journal.js'

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
  { id: 'P000000', name: 'Walk-in customers', salesOrgs: ['*'], ...noLegal, commerceCompanyId: null, customerGroupId: null, paymentTerms: 'NET30', creditLimit: 0, blocking: 'open', isDefault: true },
  { id: 'C000101', name: 'Northwind Trading', salesOrgs: ['1000'], legalName: 'Northwind Trading LLC', vatTaxId: 'US 83-1234567', resellerId: 'R-1042', legalAddress: { street: ['1 Harbor Way', 'Suite 400'], city: 'Seattle', region: 'WA', postcode: '98101', countryId: 'US', telephone: '206-555-0100' }, website: { id: 1, code: 'base' }, commerceCompanyId: '4', customerGroupId: '2', paymentTerms: 'NET30', creditLimit: 50000, blocking: 'open' },
  { id: 'C000102', name: 'Contoso Supply', salesOrgs: ['1000', '2000'], legalName: 'Contoso Supply Inc.', vatTaxId: 'US 91-7654321', resellerId: null, legalAddress: { street: ['200 Market St'], city: 'San Francisco', region: 'CA', postcode: '94105', countryId: 'US', telephone: null }, website: { id: 1, code: 'base' }, commerceCompanyId: '7', customerGroupId: '2', paymentTerms: 'NET60', creditLimit: 120000, blocking: 'open' },
  { id: 'C000103', name: 'Fabrikam Retail', salesOrgs: ['2000'], legalName: 'Fabrikam Retail GmbH', vatTaxId: 'DE 812345678', resellerId: 'R-2210', legalAddress: { street: ['Hauptstraße 5'], city: 'Berlin', region: null, postcode: '10115', countryId: 'DE', telephone: '+49 30 555 0100' }, website: { id: 2, code: 'eu' }, commerceCompanyId: '9', customerGroupId: '3', paymentTerms: 'NET15', creditLimit: 25000, blocking: 'all' },
  { id: 'C000104', name: 'Adventure Works', salesOrgs: ['2000'], legalName: 'Adventure Works B.V.', vatTaxId: 'NL 001234567B01', resellerId: null, legalAddress: { street: ['Keizersgracht 100'], city: 'Amsterdam', region: null, postcode: '1015 AA', countryId: 'NL', telephone: null }, website: { id: 2, code: 'eu' }, commerceCompanyId: '12', customerGroupId: '2', paymentTerms: 'NET30', creditLimit: 80000, blocking: 'open' }
]

/* The stored shape (lib/orders.js): a header word, quantities per line, the shipments
   and the invoice. The outward `status` is DERIVED below, as the ERP derives it. */
const HEADERS = ['created', 'confirmed', 'confirmed', 'confirmed', 'cancelled', 'created', 'confirmed', 'created']
const cents = (value) => Math.round(value * 100) / 100
const day = (d, h = 9) => new Date(Date.UTC(2026, 8, d, h, 12)).toISOString()
const orders = HEADERS.map((header, i) => {
  const number = String(1000 + i).padStart(10, '0')
  const lines = [
    { item: 10, sku: products[i % products.length].sku, qty: (i % 4) + 1, price: products[i % products.length].listPrice, commerceItemId: 100 + i * 2, shippedQty: 0, closedQty: 0 },
    { item: 20, sku: products[(i + 5) % products.length].sku, qty: (i % 3) + 2, price: products[(i + 5) % products.length].listPrice, commerceItemId: 101 + i * 2, shippedQty: 0, closedQty: 0 }
  ]
  const order = {
    number,
    commerceOrderId: String(700 + i),
    commerceIncrementId: `00000${300 + i}`,
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
    history: [{ status: 'created', at: day(4 + i) }],
    createdAt: day(4 + i)
  }
  // Every order approved but the last, which arrived over the limit and waits on a decision.
  order.creditStatus = i === 7 ? 'held' : 'approved'
  order.creditReason = i === 7 ? 'Credit limit 80,000.00 exceeded by 1,240.00' : null
  order.creditDecidedAt = null
  if (header === 'confirmed') order.history.push({ status: 'confirmed', at: day(4 + i, 11) })
  if (header === 'cancelled') {
    order.cancelReason = 'Customer request'
    order.history.push({ status: 'cancelled', at: day(4 + i, 11), reason: 'Customer request' })
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
    lines: lines.map((l) => ({ ...l, sku: lineOf(l.item).sku, commerceItemId: lineOf(l.item).commerceItemId }))
  })
  if (posted) for (const l of lines) lineOf(l.item).shippedQty += l.qty
}
seedShipment(orders[2], '8000000001', [{ item: 10, qty: orders[2].lines[0].qty }], 'default', true)
seedShipment(orders[2], '8000000002', [{ item: 20, qty: orders[2].lines[1].qty }], 'default', true)
{
  const net = cents(orders[2].lines.reduce((s, l) => s + l.qty * l.price, 0))
  orders[2].invoice = {
    number: '9000000001',
    createdAt: day(13),
    status: 'open',
    lines: orders[2].lines.map((l) => ({ item: l.item, sku: l.sku, qty: l.qty, price: l.price, amount: cents(l.qty * l.price) })),
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
let nextShipment = 8000000006
let nextInvoice = 9000000002

const events = [
  { _id: 'e1', at: new Date(Date.UTC(2026, 8, 22, 14, 2)).toISOString(), direction: 'out', kind: 'order.confirmed', event: 'be-observer.sales_order_status_update', value: { erpNumber: '0000001001', incrementId: '00000301' }, delivered: true, attempts: 1 },
  { _id: 'e2', at: new Date(Date.UTC(2026, 8, 22, 13, 55)).toISOString(), direction: 'in', event: 'catalog_stock_update', summary: 'Stock for P000003 set to 18', value: { sku: 'P000003', stock: 18 } },
  { _id: 'e3', at: new Date(Date.UTC(2026, 8, 22, 13, 40)).toISOString(), direction: 'out', kind: 'product.price', event: 'be-observer.catalog_product_update', value: { sku: 'P000007', price: 189 }, delivered: false, failed: true, attempts: 10, lastError: 'ingestion webhook answered 503' },
  { _id: 'e4', at: new Date(Date.UTC(2026, 8, 22, 13, 20)).toISOString(), direction: 'out', kind: 'partner.creditLimit', event: 'be-observer.company_credit_update', value: { partnerId: 'C000102', companyId: '7', creditLimit: 120000 }, delivered: false, attempts: 2 },
  { _id: 'e5', at: new Date(Date.UTC(2026, 8, 22, 12, 5)).toISOString(), direction: 'in', event: 'observer.company_save_commit_after', summary: 'Customer C000103 blocked', value: { companyId: '9', blocked: true } },
  { _id: 'e6', at: new Date(Date.UTC(2026, 8, 22, 11, 45)).toISOString(), direction: 'out', kind: 'order.shipped', event: 'be-observer.sales_order_shipment_create', value: { erpNumber: '0000001002', items: [{ qty: 3 }, { qty: 2 }], stockSourceCode: 'default' }, delivered: true, attempts: 1 }
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

const settings = {
  displayName: 'Northwind ERP',
  appearance: { ...DEFAULT_APPEARANCE },
  warehouses: { default: { name: 'Plant 1000 · Seattle DC' }, east: { name: 'East DC' } },
  structureMirror,
  lastImportAt: new Date(Date.UTC(2026, 8, 22, 13, 58)).toISOString(),
  lastWipeAt: null,
  sync: null
}

/* The selling structure, derived as lib/structure.js derives it. */
function describeStructure () {
  const home = structureMirror.websites.find((w) => w.salesOrg === '1000') || structureMirror.websites[0]
  const orgs = new Map()
  const org = (code) => {
    if (!orgs.has(code)) orgs.set(code, { code, name: null, websiteCode: null, customers: 0, orders: 0 })
    return orgs.get(code)
  }
  for (const site of structureMirror.websites) {
    const entry = org(site.salesOrg)
    entry.name = entry.name || site.salesOrgName || site.name
    entry.websiteCode = entry.websiteCode || site.code
  }
  for (const p of partners) for (const code of p.salesOrgs) if (code !== '*') org(code).customers += 1
  for (const o of orders) org(o.salesOrg || '1000').orders += 1
  const houses = new Map()
  for (const p of products) {
    for (const w of p.warehouses) {
      if (!houses.has(w.code)) houses.set(w.code, { code: w.code, commerceName: w.name, products: 0 })
      houses.get(w.code).products += 1
    }
  }
  for (const [code, value] of Object.entries(settings.warehouses)) {
    if (!houses.has(code)) houses.set(code, { code, commerceName: code, products: 0 })
    houses.get(code).name = value.name
  }
  return {
    companyCode: { code: '1000', name: settings.displayName, currency: home.storeInfo.currency, countryId: home.storeInfo.countryId, vatNumber: null, address: null },
    salesOrgs: [...orgs.values()].sort((a, b) => a.code.localeCompare(b.code)),
    warehouses: [...houses.values()].map((h) => ({ ...h, name: h.name || h.commerceName })).sort((a, b) => a.code.localeCompare(b.code)),
    unmapped: []
  }
}

/* Home's work list, as lib/work counts it: from the same abilities the documents read. */
function workList () {
  const counts = { toConfirm: 0, onHold: 0, toShip: 0, toInvoice: 0, toPost: 0, blockedCustomers: 0, eventsFailed: 0, eventsPending: 0 }
  let amount = 0
  const recent = []
  for (const o of orders) {
    const can = abilities(o)
    if (can.confirm) counts.toConfirm += 1
    if (can.release) counts.onHold += 1
    if (can.ship) counts.toShip += 1
    if (can.invoice) counts.toInvoice += 1
    counts.toPost += o.shipments.filter((s) => s.status !== 'posted').length
    if (o.header !== 'cancelled' && !o.invoice) amount += o.lines.reduce((sum, l) => sum + l.qty * l.price, 0)
    const last = o.history.reduce((at, h) => (h.at > at ? h.at : at), o.createdAt)
    recent.push({ kind: 'order', number: o.number, at: last, title: `Sales Order ${o.number}` })
    for (const sh of o.shipments) recent.push({ kind: 'shipment', number: sh.number, at: sh.postedAt || sh.createdAt, title: `Shipment ${sh.number}` })
    if (o.invoice) recent.push({ kind: 'invoice', number: o.invoice.number, at: o.invoice.createdAt, title: `Invoice ${o.invoice.number}` })
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

const health = {
  displayName: settings.displayName,
  appearance: settings.appearance,
  counts: { products: products.length, businessPartners: partners.length, salesOrders: orders.length, pricingConditions: conditions.length },
  // The next document numbers, nothing reserved (lib/counters peek), and the company code's currency.
  numbering: { salesOrder: '0000001008', shipment: '8000000005', invoice: '9000000002' },
  currency: 'USD',
  eventsPending: events.filter((e) => e.direction === 'out' && !e.delivered && !e.failed).length,
  lastImportAt: settings.lastImportAt,
  sync: null
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
const otherSalesOrg = (c, salesOrg) => (c.salesOrg && salesOrg && c.salesOrg !== salesOrg ? `for sales organisation ${c.salesOrg}; this is ${salesOrg}` : null)
const dayText = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))
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
  if (o.header === 'cancelled') return 'cancelled'
  if (o.invoice) return 'invoiced'
  if (totalsOf(o).shipped > 0) return 'shipped'
  return o.header === 'confirmed' ? 'confirmed' : 'created'
}
function nextMoves (o) {
  if (o.header === 'cancelled' || o.invoice) return []
  if (o.header === 'created') return ['confirmed', 'cancelled']
  const { shipped, open } = totalsOf(o)
  if (shipped === 0) return open > 0 ? ['shipped', 'cancelled'] : ['cancelled']
  return open > 0 ? ['shipped'] : ['invoiced']
}
function abilities (o) {
  const { shipped, open } = totalsOf(o)
  const live = o.header === 'confirmed' && !o.invoice
  const held = o.creditStatus === 'held' && o.header !== 'cancelled'
  return {
    confirm: o.header === 'created' && !held,
    ship: live && open > 0,
    close: live && open > 0,
    invoice: live && open === 0 && shipped > 0,
    cancel: o.header !== 'cancelled' && !o.invoice && shipped === 0,
    release: held,
    reject: held
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
  const lines = order.lines.map((line) => ({ ...named(line), openQty: openQty(line), amount: cents(line.qty * line.price) }))
  const net = cents(lines.reduce((sum, l) => sum + l.amount, 0))
  const total = cents(Number(order.total ?? net))
  const can = abilities(order)
  const { shipped, open } = totalsOf(order)
  const warehouses = new Map()
  for (const l of order.lines) {
    for (const w of (productOf(l.sku) || { warehouses: [] }).warehouses) warehouses.set(w.code, { code: w.code, name: (settings.warehouses[w.code] || {}).name || w.name, commerceName: w.name })
  }
  return {
    ...order,
    status: deriveStatus(order),
    lines,
    nextStatuses: nextMoves(order),
    partner: partner ? { id: partner.id, name: partner.name, paymentTerms: partner.paymentTerms } : null,
    shippingStatus: shipped === 0 ? 'none' : (open > 0 ? 'partial' : 'full'),
    billingStatus: order.invoice ? (order.invoice.status === 'credited' ? 'credited' : 'invoiced') : 'none',
    overall: order.header === 'cancelled' ? 'Cancelled' : (order.invoice ? 'Completed' : (order.header === 'confirmed' ? 'In process' : 'Open')),
    credit: order.creditStatus ? { status: order.creditStatus, reason: order.creditReason, decidedAt: order.creditDecidedAt } : null,
    can,
    shipments: order.shipments.map((s) => ({ ...s, lines: s.lines.map(named) })),
    invoice: order.invoice ? { ...order.invoice, lines: order.invoice.lines.map(named) } : null,
    warehouses: [...warehouses.values()],
    net,
    tax: cents(total - net),
    total,
    cancelReasons: can.cancel ? CANCEL_REASONS : [],
    closeReasons: can.close ? CLOSE_REASONS : []
  }
}

const fail = (message) => { throw new Error(message) }
const orderOf = (number) => orders.find((o) => o.number === number) || fail(`Sales order ${number} was not found.`)

function describeShipment (order, s) {
  const p = partnerOf(order.partnerId)
  const stocked = productOf(s.lines[0].sku)
  const commerceName = s.warehouse ? ((stocked && stocked.warehouses.find((w) => w.code === s.warehouse)) || { name: s.warehouse }).name : null
  const warehouse = s.warehouse
    ? { code: s.warehouse, name: (settings.warehouses[s.warehouse] || {}).name || commerceName, commerceName }
    : null
  return {
    ...s,
    orderNumber: order.number,
    commerceIncrementId: order.commerceIncrementId,
    partner: p ? { id: p.id, name: p.name } : null,
    warehouse,
    lines: s.lines.map(named)
  }
}

function describeInvoice (order, inv) {
  const p = partnerOf(order.partnerId)
  return {
    ...inv,
    orderNumber: order.number,
    commerceIncrementId: order.commerceIncrementId,
    currency: order.currency,
    partner: p ? { id: p.id, name: p.name, paymentTerms: p.paymentTerms } : null,
    seller: (() => {
      const through = structureMirror.websites.find((w) => w.salesOrg === order.salesOrg) || structureMirror.websites[0]
      return { companyCode: '1000', name: settings.displayName, salesOrg: order.salesOrg, salesOrgName: order.salesOrgName, currency: through.storeInfo.currency, countryId: through.storeInfo.countryId, vatNumber: null, address: null }
    })(),
    lines: inv.lines.map(named)
  }
}

/* The customer document, shaped the way lib/partners.js `describePartner` shapes it. */
const OPEN = new Set(['created', 'confirmed', 'shipped'])
function describePartner (partner) {
  const own = orders
    .filter((o) => o.partnerId === partner.id)
    .sort((a, b) => (a.number < b.number ? 1 : -1))
    .map((o) => ({
      number: o.number,
      createdAt: o.createdAt,
      status: deriveStatus(o),
      creditStatus: o.creditStatus ?? null,
      commerceOrderId: o.commerceOrderId,
      commerceIncrementId: o.commerceIncrementId,
      currency: o.currency,
      net: cents((o.lines || []).reduce((sum, l) => sum + l.qty * l.price, 0))
    }))
  const exposure = cents(own.filter((o) => OPEN.has(o.status) && o.creditStatus !== 'held').reduce((sum, o) => sum + o.net, 0))
  const held = own.filter((o) => o.creditStatus === 'held' && o.status !== 'cancelled').length
  const limit = Number(partner.creditLimit) || 0
  return {
    ...partner,
    salesOrgNames,
    credit: partner.commerceCompanyId ? { limit, exposure, available: cents(limit - exposure), held } : null,
    orders: own,
    conditions: conditions.filter((c) => c.partnerId === partner.id)
  }
}

const refuse = () => Promise.reject(new Error('The preview holds stand-in records; nothing here writes.'))

/* Committed and available, mirrored from lib/availability.js: the open quantity on orders
   that are neither cancelled nor invoiced, and on hand less that. A configurable parent
   has no lines of its own here (its stand-in variants are not orders' SKUs). */
const commitsStock = (o) => o.header !== 'cancelled' && !o.invoice
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
  health: async () => { await wait(); return copy({ ...health, work: workList(), structure: describeStructure() }) },
  settings: async () => { await wait(); return copy(settings) },
  /* The one settings write the preview allows, because it is the one thing the preview
     exists to show. An appearance is not a record — it is how the screen looks, and a
     harness for looking at the screen that could not change its look would be missing
     the point. */
  saveSettings: async (patch) => {
    await wait()
    if (patch && patch.warehouses) {
      for (const [code, value] of Object.entries(patch.warehouses)) settings.warehouses[code] = { name: value.name }
      return copy(settings)
    }
    if (!patch || !patch.appearance) return refuse()
    settings.appearance = normalizeAppearance(patch.appearance, settings.appearance)
    health.appearance = settings.appearance
    return copy(settings)
  },
  wipe: refuse,
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
  partners: async () => { await wait(); return copy(partners) },
  partner: async (id) => { await wait(); return copy(describePartner(partnerOf(id))) },
  patchPartner: async (id, patch) => {
    await wait()
    const partner = partnerOf(id)
    if (patch.creditLimit !== undefined) partner.creditLimit = Number(patch.creditLimit)
    if (patch.blocking !== undefined) partner.blocking = String(patch.blocking)
    return copy(partner)
  },
  conditions: async () => { await wait(); return copy(conditions) },
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
    o.header = 'cancelled'; o.cancelReason = 'Credit rejected'; o.creditDecidedAt = new Date().toISOString()
    o.history.push({ status: 'cancelled', at: o.creditDecidedAt, reason: 'Credit rejected' })
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
    o.header = 'cancelled'
    o.cancelReason = reason
    o.history.push({ status: 'cancelled', at: new Date().toISOString(), reason })
    return copy(describe(o))
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
      lines: asked.map((a) => { const line = lineOf(a.item); return { item: line.item, sku: line.sku, qty: a.qty, commerceItemId: line.commerceItemId } })
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
    const net = cents(o.lines.reduce((s, l) => s + l.qty * l.price, 0))
    o.invoice = {
      number: String(nextInvoice++),
      createdAt: new Date().toISOString(),
      status: 'open',
      lines: o.lines.map((l) => ({ item: l.item, sku: l.sku, qty: l.qty, price: l.price, amount: cents(l.qty * l.price) })),
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
      createdAt: o.invoice.createdAt,
      status: o.invoice.status,
      currency: o.currency,
      total: o.invoice.total
    })).sort((a, b) => (a.number < b.number ? 1 : -1)))
  },
  invoice: async (number) => {
    await wait()
    const o = orders.find((x) => x.invoice && x.invoice.number === number) || fail(`Invoice ${number} was not found.`)
    return copy(describeInvoice(o, o.invoice))
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
    for (const o of orders) hits.push({ rank: score([o.number, o.commerceIncrementId, (partnerOf(o.partnerId) || {}).name]), kind: 'order', number: o.number, title: `Sales Order ${o.number}`, subtitle: (partnerOf(o.partnerId) || {}).name })
    for (const o of orders) for (const sh of o.shipments) hits.push({ rank: score([sh.number, o.number]), kind: 'shipment', number: sh.number, title: `Shipment ${sh.number}`, subtitle: `for sales order ${o.number}` })
    for (const o of orders) if (o.invoice) hits.push({ rank: score([o.invoice.number, o.number]), kind: 'invoice', number: o.invoice.number, title: `Invoice ${o.invoice.number}`, subtitle: `for sales order ${o.number}` })
    for (const p of products) hits.push({ rank: score([p.sku, p.name]), kind: 'product', number: p.sku, title: p.name, subtitle: p.sku })
    for (const p of partners) hits.push({ rank: score([p.id, p.name]), kind: 'customer', number: p.id, title: p.name, subtitle: p.id })
    return { items: hits.filter((h) => h.rank > 0).sort((a, b) => b.rank - a.rank || a.title.localeCompare(b.title)).slice(0, 12).map(({ rank, ...h }) => h) }
  },
  retryEvents: refuse,
  requeueEvents: refuse,
  sync: refuse
}
