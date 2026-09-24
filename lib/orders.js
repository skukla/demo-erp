/*
 * Sales orders. Created by the integration when Commerce places an order; moved from the
 * ERP's screen (lib/fulfilment: confirm, ship, invoice, cancel), each move an ERP event.
 *
 * What is STORED on an order is only what a person decided: the header word (created ·
 * confirmed · cancelled), the quantities each shipment moved, the shipments and the
 * invoice themselves. Shipping status, billing status and the outward `status` word
 * are DERIVED from those here, so they cannot drift into a state the quantities
 * contradict — which is how real ERPs behave, and why a derived status is worth the
 * few lines it costs.
 *
 * `status` still answers one of the five words the contract promises (created ·
 * confirmed · shipped · invoiced · cancelled); the events keep their names; the
 * integration keeps writing "Order {status} in the ERP" as a Commerce comment. Orders
 * written before shipments existed (one status word, no quantities) are upgraded on
 * read — see upgradeOrder — so a deployed ERP needs no migration.
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { next: nextCounter, formatDocumentNumber } = require('./counters')
const { resolvePartner } = require('./partners')

/* Every ERP numbers document lines in tens, so a line can be inserted between two
   without renumbering the rest. Ours are stored on the line at creation, because a
   shipment names the line it ships by item number. */
const LINE_STEP = 10

/** The five outward words, and the whole-order moves between them (the compatibility route). */
const STATUSES = ['created', 'confirmed', 'shipped', 'invoiced', 'cancelled']
const TRANSITIONS = {
  created: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['invoiced'],
  invoiced: [],
  cancelled: []
}

/** The statuses an order may move to from a status WORD, for a caller with only the word. */
function nextStatuses (status) {
  return TRANSITIONS[status] || []
}

/* The reasons an order may be rejected, the way an ERP keeps a fixed list rather than
   free text: the reason is reported on, so it has to be one of a known set. */
const CANCEL_REASONS = [
  'Customer request',
  'Credit rejected',
  'Out of stock',
  'Pricing error',
  'Duplicate order'
]

/** Money, to the cent: a sum of qty x price otherwise carries its own float dust. */
const cents = (value) => Math.round(value * 100) / 100

/** What a line still has to ship: ordered, less shipped, less given up on. */
function openQty (line) {
  return Math.max(0, (Number(line.qty) || 0) - (Number(line.shippedQty) || 0) - (Number(line.closedQty) || 0))
}

/** Ordered, shipped and open quantities across the order. */
function totals (order) {
  const lines = order.lines || []
  return {
    ordered: lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0),
    shipped: lines.reduce((sum, l) => sum + (Number(l.shippedQty) || 0), 0),
    open: lines.reduce((sum, l) => sum + openQty(l), 0)
  }
}

/** An order's net amount: its lines. Total is what Commerce charged, which carries tax. */
function netOf (order) {
  return cents((order.lines || []).reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.price) || 0), 0))
}

/** none · partial · full, from the quantities alone. */
function shippingStatus (order) {
  const { shipped, open } = totals(order)
  if (shipped === 0) return 'none'
  return open > 0 ? 'partial' : 'full'
}

/** none · invoiced · credited. */
function billingStatus (order) {
  if (!order.invoice) return 'none'
  return order.invoice.status === 'credited' ? 'credited' : 'invoiced'
}

/** The outward word (plan §4.2). */
function deriveStatus (order) {
  if (order.header === 'cancelled') return 'cancelled'
  if (order.invoice) return 'invoiced'
  if (totals(order).shipped > 0) return 'shipped'
  return order.header === 'confirmed' ? 'confirmed' : 'created'
}

/** Open · In process · Completed · Cancelled — the one word a header shows. */
function overallStatus (order) {
  if (order.header === 'cancelled') return 'Cancelled'
  if (order.invoice) return 'Completed'
  return order.header === 'confirmed' ? 'In process' : 'Open'
}

/**
 * The whole-order moves open to THIS order, from its quantities rather than its word:
 * the compatibility route and the document's `nextStatuses` both read this.
 */
function nextMoves (order) {
  if (order.header === 'cancelled' || order.invoice) return []
  if (order.header === 'created') return ['confirmed', 'cancelled']
  const { shipped, open } = totals(order)
  if (shipped === 0) return open > 0 ? ['shipped', 'cancelled'] : ['cancelled']
  return open > 0 ? ['shipped'] : ['invoiced']
}

/** What the document may do, decided here rather than on the screen. */
function abilities (order) {
  const { shipped, open } = totals(order)
  const live = order.header === 'confirmed' && !order.invoice
  return {
    confirm: order.header === 'created',
    ship: live && open > 0,
    close: live && open > 0,
    invoice: live && open === 0 && shipped > 0,
    cancel: order.header !== 'cancelled' && !order.invoice && shipped === 0
  }
}

/**
 * A stored order in today's shape, whatever shape it was written in. An order from
 * before shipments existed held one status word and no quantities: its header is the
 * word (or confirmed, for shipped and invoiced), a shipped or invoiced order has shipped
 * its whole quantity, and an invoiced one carries an invoice record with no number —
 * the ERP kept none then, and minting one on read would be a write.
 */
function upgradeOrder (stored) {
  const legacy = !stored.header
  const word = stored.status
  const wholeShipped = legacy && (word === 'shipped' || word === 'invoiced')
  const lines = (stored.lines || []).map((l, index) => ({
    ...l,
    item: l.item || (index + 1) * LINE_STEP,
    shippedQty: wholeShipped ? Number(l.qty) || 0 : (Number(l.shippedQty) || 0),
    closedQty: Number(l.closedQty) || 0
  }))
  let header = stored.header
  if (legacy) header = ['created', 'confirmed', 'cancelled'].includes(word) ? word : 'confirmed'
  let invoice = stored.invoice || null
  if (legacy && word === 'invoiced') {
    const at = [...(stored.history || [])].reverse().find((h) => h.status === 'invoiced')
    invoice = { number: null, legacy: true, createdAt: at ? at.at : stored.createdAt, status: 'open' }
  }
  const { status: _word, ...rest } = stored
  return { ...rest, header, lines, shipments: stored.shipments || [], invoice, history: stored.history || [] }
}

/** The order as the API answers it: upgraded, with the derived word on it. */
function view (stored) {
  const order = upgradeOrder(stored)
  return { ...order, status: deriveStatus(order) }
}

/**
 * Create a sales order. Idempotent on `commerceOrderId`: the same Commerce order
 * posted twice answers the same ERP number.
 *
 * @param {object} cols collections
 * @param {object} input `{ commerceOrderId, commerceIncrementId?, partnerId?, commerceCompanyId?, email?, customerGroupId?, lines:[{sku, qty, price}], currency?, total? }`
 *   Without a partnerId the partner is resolved from the other hints, else the default partner.
 * @returns {Promise<object>} the order
 */
async function createOrder (cols, input) {
  if (!input || !input.commerceOrderId) throw badRequest('commerceOrderId is required')
  const existing = await cols.salesOrders.findOne({ commerceOrderId: String(input.commerceOrderId) })
  if (existing) return view(existing)
  const partner = await resolvePartner(cols, input)
  const number = formatDocumentNumber(await nextCounter(cols, 'salesOrder', 1000))
  const lines = (input.lines || []).map((l, index) => ({
    item: (index + 1) * LINE_STEP,
    sku: l.sku,
    qty: Number(l.qty) || 1,
    price: Number(l.price) || 0,
    commerceItemId: l.commerceItemId ?? null,
    shippedQty: 0,
    closedQty: 0
  }))
  const at = new Date().toISOString()
  const order = {
    _id: number,
    number,
    commerceOrderId: String(input.commerceOrderId),
    commerceIncrementId: input.commerceIncrementId ? String(input.commerceIncrementId) : null,
    partnerId: partner ? partner.id : null,
    lines,
    currency: input.currency || 'USD',
    total: Number(input.total ?? lines.reduce((s, l) => s + l.qty * l.price, 0)),
    header: 'created',
    status: 'created',
    shipments: [],
    invoice: null,
    history: [{ status: 'created', at }],
    createdAt: at
  }
  await cols.salesOrders.replaceOne({ _id: number }, order, { upsert: true })
  return view(order)
}

async function listOrders (cols, options = {}) {
  const rows = await findAll(cols.salesOrders, {}, { limit: options.limit ?? 500, sort: { _id: -1 } })
  return rows.map(view)
}

async function getOrder (cols, number) {
  const found = await cols.salesOrders.findOne({ _id: number })
  return found ? view(found) : null
}

/**
 * Move an order by status word. Lives in lib/fulfilment with the other moves; required
 * here at call time because that module requires this one.
 */
function setStatus (cols, number, status, params, options) {
  return require('./fulfilment').setStatus(cols, number, status, params, options)
}

/**
 * An order as its own document shows it, which is more than the record holds: the
 * customer named rather than referenced, each line carrying the product's description,
 * base unit and open quantity, the three money figures a sales order header carries,
 * the derived statuses, and what the order became — its shipments and its invoice.
 *
 * Net is the sum of the lines. Total is what Commerce charged, which includes tax. The
 * ERP does not calculate tax — it reports the difference between the two and says so on
 * screen. Inventing a tax rate here would be a number nobody could check.
 */
async function describeOrder (cols, stored) {
  const order = view(stored)
  const partner = order.partnerId
    ? await cols.businessPartners.findOne({ _id: order.partnerId })
    : null
  const products = new Map()
  const lines = []
  for (const line of order.lines) {
    // biome-ignore lint/performance/noAwaitInLoops: one product per line, in line order
    const product = products.get(line.sku) || await cols.products.findOne({ _id: line.sku })
    if (product) products.set(line.sku, product)
    lines.push({
      ...line,
      openQty: openQty(line),
      name: product ? product.name : line.sku,
      unit: product && product.unit ? product.unit : 'EA',
      amount: cents(line.qty * line.price)
    })
  }
  const named = (l) => ({ ...l, name: lines.find((x) => x.item === l.item)?.name || l.sku, unit: lines.find((x) => x.item === l.item)?.unit || 'EA' })
  /* The warehouses this order's products are stocked in: the Ship-from choices. */
  const warehouses = new Map()
  for (const product of products.values()) {
    for (const w of product.warehouses || []) warehouses.set(w.code, { code: w.code, name: w.name })
  }
  const can = abilities(order)
  const net = cents(lines.reduce((sum, l) => sum + l.amount, 0))
  const total = cents(Number(order.total ?? net))
  return {
    ...order,
    lines,
    nextStatuses: nextMoves(order),
    partner: partner
      ? { id: partner.id, name: partner.name, paymentTerms: partner.paymentTerms, salesOrg: partner.salesOrg }
      : null,
    shippingStatus: shippingStatus(order),
    billingStatus: billingStatus(order),
    overall: overallStatus(order),
    can,
    shipments: order.shipments.map((s) => ({ ...s, lines: s.lines.map(named) })),
    invoice: order.invoice ? { ...order.invoice, lines: (order.invoice.lines || []).map(named) } : null,
    warehouses: [...warehouses.values()],
    net,
    tax: cents(total - net),
    total,
    // The reasons the screen offers, from the ERP's own lists rather than second copies
    // written on the screen. Empty when the move is not open.
    cancelReasons: can.cancel ? CANCEL_REASONS : [],
    closeReasons: can.close ? require('./fulfilment').CLOSE_REASONS : []
  }
}

/** The payload every order event carries: the Commerce order, its lines, the ERP number. */
function orderEventPayload (order) {
  return {
    id: Number(order.commerceOrderId),
    orderId: Number(order.commerceOrderId),
    incrementId: order.commerceIncrementId,
    erpNumber: order.number,
    status: deriveStatus(order),
    items: (order.lines || []).filter((l) => l.commerceItemId).map((l) => ({ orderItemId: Number(l.commerceItemId), qty: l.qty, sku: l.sku })),
    notifyCustomer: false
  }
}

module.exports = {
  STATUSES, TRANSITIONS, CANCEL_REASONS, LINE_STEP,
  cents, netOf, openQty, totals, shippingStatus, billingStatus, deriveStatus, overallStatus, nextMoves, abilities,
  upgradeOrder, view, nextStatuses, createOrder, listOrders, getOrder, describeOrder, setStatus, orderEventPayload
}
