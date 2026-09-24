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
  const warehouses = i % 4 === 1
    ? [{ code: 'default', name: 'Default Source', quantity }, { code: 'east', name: 'East DC', quantity: 30 }]
    : [{ code: 'default', name: 'Default Source', quantity }]
  return {
    sku,
    name,
    type: i === 3 ? 'configurable' : 'simple',
    description: `${name} — mirrored from Commerce`,
    unit: i % 7 === 0 ? 'PC' : 'EA',
    listPrice: price,
    warehouses,
    stock: warehouses.reduce((sum, w) => sum + w.quantity, 0),
    ...(i === 3 ? { priceRange: { min: 119, max: 149 }, variantCount: 3 } : {})
  }
})

const partners = [
  { id: 'P000000', name: 'Walk-in customers', salesOrg: '1000', commerceCompanyId: null, customerGroupId: null, paymentTerms: 'NET30', creditLimit: 0, blocked: false, isDefault: true },
  { id: 'C000101', name: 'Northwind Trading', salesOrg: '1000', commerceCompanyId: '4', customerGroupId: '2', paymentTerms: 'NET30', creditLimit: 50000, blocked: false },
  { id: 'C000102', name: 'Contoso Supply', salesOrg: '1000', commerceCompanyId: '7', customerGroupId: '2', paymentTerms: 'NET60', creditLimit: 120000, blocked: false },
  { id: 'C000103', name: 'Fabrikam Retail', salesOrg: '2000', commerceCompanyId: '9', customerGroupId: '3', paymentTerms: 'NET15', creditLimit: 25000, blocked: true },
  { id: 'C000104', name: 'Adventure Works', salesOrg: '2000', commerceCompanyId: '12', customerGroupId: '2', paymentTerms: 'NET30', creditLimit: 80000, blocked: false }
]

/* The stored shape (lib/orders.js): a header word, quantities per line, the shipments
   and the invoice. The outward `status` is DERIVED below, as the ERP derives it. */
const HEADERS = ['created', 'confirmed', 'confirmed', 'confirmed', 'cancelled', 'created', 'confirmed', 'confirmed']
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
    currency: 'USD',
    // Every third order arrives with tax in its total, as a real Commerce order does,
    // so the document's Tax row is something that can be looked at.
    total: cents(lines.reduce((sum, l) => sum + l.qty * l.price, 0) * (i % 3 === 0 ? 1.0825 : 1)),
    header,
    shipments: [],
    invoice: null,
    history: [{ status: 'created', at: day(4 + i) }],
    createdAt: day(4 + i)
  }
  if (header === 'confirmed') order.history.push({ status: 'confirmed', at: day(4 + i, 11) })
  if (header === 'cancelled') {
    order.cancelReason = 'Customer request'
    order.history.push({ status: 'cancelled', at: day(4 + i, 11), reason: 'Customer request' })
  }
  return order
})

/* Order 1002: fully shipped in two shipments and invoiced. 1003: one shipment posted,
   one still open. 1007: partly shipped, the rest closed. */
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
seedShipment(orders[7], '8000000005', [{ item: 10, qty: orders[7].lines[0].qty }, { item: 20, qty: 1 }], 'default', true)
orders[7].lines[1].closedQty = orders[7].lines[1].qty - 1
orders[7].lines[1].closeReason = 'Out of stock'
let nextShipment = 8000000006
let nextInvoice = 9000000002

const events = [
  { _id: 'e1', at: new Date(Date.UTC(2026, 8, 22, 14, 2)).toISOString(), direction: 'out', event: 'be-observer.sales_order_status_update', value: { erpNumber: '0000001001' }, delivered: true, attempts: 1 },
  { _id: 'e2', at: new Date(Date.UTC(2026, 8, 22, 13, 55)).toISOString(), direction: 'in', event: 'catalog_stock_update', summary: 'Stock for P000003 set to 18', value: { sku: 'P000003', stock: 18 } },
  { _id: 'e3', at: new Date(Date.UTC(2026, 8, 22, 13, 40)).toISOString(), direction: 'out', event: 'be-observer.catalog_product_update', value: { sku: 'P000007', price: 189 }, delivered: false, failed: true, attempts: 10, lastError: 'ingestion webhook answered 503' },
  { _id: 'e4', at: new Date(Date.UTC(2026, 8, 22, 13, 20)).toISOString(), direction: 'out', event: 'be-observer.company_credit_update', value: { companyId: '7', creditLimit: 120000 }, delivered: false, attempts: 2 },
  { _id: 'e5', at: new Date(Date.UTC(2026, 8, 22, 12, 5)).toISOString(), direction: 'in', event: 'company_updated', summary: 'Company 9 blocked', value: { companyId: '9', blocked: true } },
  { _id: 'e6', at: new Date(Date.UTC(2026, 8, 22, 11, 45)).toISOString(), direction: 'out', event: 'be-observer.sales_order_shipment_create', value: { erpNumber: '0000001002' }, delivered: true, attempts: 1 }
]

const conditions = [
  { _id: 'c1', id: 'c1', kind: 'contractPrice', partnerId: 'C000101', sku: 'P000001', price: 79 },
  { _id: 'c2', id: 'c2', kind: 'contractDiscount', partnerId: 'C000102', sku: null, percent: 12 },
  { _id: 'c3', id: 'c3', kind: 'maxDiscount', partnerId: null, sku: null, percent: 25 }
]

const settings = {
  displayName: 'Northwind ERP',
  appearance: { ...DEFAULT_APPEARANCE },
  lastImportAt: new Date(Date.UTC(2026, 8, 22, 13, 58)).toISOString(),
  lastWipeAt: null,
  sync: null
}

const health = {
  displayName: settings.displayName,
  appearance: settings.appearance,
  counts: { products: products.length, businessPartners: partners.length, salesOrders: orders.length, pricingConditions: conditions.length },
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
const specificity = (c) => (c.partnerId ? 2 : 0) + (c.sku ? 1 : 0)
const matchesCondition = (c, partnerId, sku) =>
  (!c.partnerId || c.partnerId === partnerId) && (!c.sku || c.sku === sku)

function mostSpecific (kind, partnerId, sku) {
  return conditions
    .filter((c) => c.kind === kind && matchesCondition(c, partnerId, sku))
    .sort((a, b) => specificity(b) - specificity(a))[0]
}

function priceLine (product, partnerId, qty) {
  const listPrice = Number(product.listPrice) || 0
  const price = mostSpecific('contractPrice', partnerId, product.sku)
  const discount = mostSpecific('contractDiscount', partnerId, product.sku)
  const ceiling = mostSpecific('maxDiscount', partnerId, product.sku)
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
  return {
    sku: product.sku,
    qty,
    listPrice,
    contractPrice: round2(contractPrice),
    discountPercent,
    maxDiscountPercent,
    source,
    lineTotal: round2(contractPrice * qty)
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
  return {
    confirm: o.header === 'created',
    ship: live && open > 0,
    close: live && open > 0,
    invoice: live && open === 0 && shipped > 0,
    cancel: o.header !== 'cancelled' && !o.invoice && shipped === 0
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
    for (const w of (productOf(l.sku) || { warehouses: [] }).warehouses) warehouses.set(w.code, { code: w.code, name: w.name })
  }
  return {
    ...order,
    status: deriveStatus(order),
    lines,
    nextStatuses: nextMoves(order),
    partner: partner ? { id: partner.id, name: partner.name, paymentTerms: partner.paymentTerms, salesOrg: partner.salesOrg } : null,
    shippingStatus: shipped === 0 ? 'none' : (open > 0 ? 'partial' : 'full'),
    billingStatus: order.invoice ? (order.invoice.status === 'credited' ? 'credited' : 'invoiced') : 'none',
    overall: order.header === 'cancelled' ? 'Cancelled' : (order.invoice ? 'Completed' : (order.header === 'confirmed' ? 'In process' : 'Open')),
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
  const warehouse = s.warehouse
    ? { code: s.warehouse, name: ((stocked && stocked.warehouses.find((w) => w.code === s.warehouse)) || { name: s.warehouse }).name }
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
      commerceOrderId: o.commerceOrderId,
      commerceIncrementId: o.commerceIncrementId,
      currency: o.currency,
      net: cents((o.lines || []).reduce((sum, l) => sum + l.qty * l.price, 0))
    }))
  const exposure = cents(own.filter((o) => OPEN.has(o.status)).reduce((sum, o) => sum + o.net, 0))
  const limit = Number(partner.creditLimit) || 0
  return {
    ...partner,
    credit: partner.commerceCompanyId ? { limit, exposure, available: cents(limit - exposure) } : null,
    orders: own,
    conditions: conditions.filter((c) => c.partnerId === partner.id)
  }
}

const refuse = () => Promise.reject(new Error('The preview holds stand-in records; nothing here writes.'))

/** Everything screen/src/api.js offers, answered from the records above. */
export const fakeApi = {
  health: async () => { await wait(); return copy(health) },
  settings: async () => { await wait(); return copy(settings) },
  /* The one settings write the preview allows, because it is the one thing the preview
     exists to show. An appearance is not a record — it is how the screen looks, and a
     harness for looking at the screen that could not change its look would be missing
     the point. */
  saveSettings: async (patch) => {
    await wait()
    if (!patch || !patch.appearance) return refuse()
    settings.appearance = normalizeAppearance(patch.appearance, settings.appearance)
    health.appearance = settings.appearance
    return copy(settings)
  },
  wipe: refuse,
  products: async () => { await wait(); return copy(products) },
  product: async (sku) => copy(products.find((p) => p.sku === sku)),
  patchProduct: refuse,
  partners: async () => { await wait(); return copy(partners) },
  partner: async (id) => { await wait(); return copy(describePartner(partnerOf(id))) },
  patchPartner: async (id, patch) => {
    await wait()
    const partner = partnerOf(id)
    if (patch.creditLimit !== undefined) partner.creditLimit = Number(patch.creditLimit)
    if (patch.blocked !== undefined) partner.blocked = Boolean(patch.blocked)
    return copy(partner)
  },
  conditions: async () => { await wait(); return copy(conditions) },
  saveCondition: async (condition) => {
    await wait()
    const saved = { ...condition, id: `c${nextConditionId++}`, _id: `c${nextConditionId}` }
    conditions.push(saved)
    return copy(saved)
  },
  deleteCondition: async (id) => {
    await wait()
    const at = conditions.findIndex((c) => c._id === id || c.id === id)
    if (at >= 0) conditions.splice(at, 1)
    return { deleted: at >= 0 }
  },
  quote: async ({ partnerId, lines }) => {
    await wait()
    const priced = (lines || []).map((line) => {
      const product = productOf(line.sku)
      if (!product) return { sku: line.sku, qty: line.qty ?? 1, unknown: true }
      return priceLine(product, partnerId, line.qty ?? 1)
    })
    return {
      partnerId: partnerId || partners[0].id,
      lines: priced,
      total: round2(priced.reduce((sum, l) => sum + (l.lineTotal || 0), 0))
    }
  },
  orders: async () => {
    await wait()
    return copy(orders.map((o) => ({
      ...o,
      status: deriveStatus(o),
      partnerName: (partnerOf(o.partnerId) || {}).name || null
    })))
  },
  order: async (number) => { await wait(); return copy(describe(orderOf(number))) },
  /* The moves the preview allows: they are what the documents are FOR, and a document
     whose buttons do nothing cannot be looked at properly. Each refuses as the ERP does. */
  confirmOrder: async (number) => {
    await wait()
    const o = orderOf(number)
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
    return { items: copy(events), webhookUrl: 'https://preview.example/ingestion/webhook', pending: 1, failed: 1 }
  },
  retryEvents: refuse,
  requeueEvents: refuse,
  sync: refuse
}
