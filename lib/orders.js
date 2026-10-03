/*
 * Sales orders. Created by the integration when a customer orders in the web shop; moved from
 * the ERP's screen (lib/fulfilment: confirm, ship, invoice, cancel), each move an ERP event.
 *
 * What is STORED on an order is only what a person decided: the header word (created ·
 * confirmed · canceled), the quantities each shipment moved, the shipments and the
 * invoice themselves. Shipping status, billing status and the outward `status` word
 * are DERIVED from those here, so they cannot drift into a state the quantities
 * contradict — which is how real ERPs behave, and why a derived status is worth the
 * few lines it costs.
 *
 * `status` still answers one of the five words the contract promises (created ·
 * confirmed · shipped · invoiced · canceled), and a sales order event carries it as its
 * OverallStatus. The customer's own references ride on the order as a real ERP keeps them:
 * the buyer's order number (purchaseOrderByCustomer, SAP's PurchaseOrderByCustomer) and each
 * line's customer item reference (customerLineReference). Orders written before shipments
 * existed (one status word, no quantities), or before contract version 16 (the web shop's ids
 * under its own names, lib/legacy), are upgraded on read — see upgradeOrder — so a deployed
 * ERP needs no migration.
 */
const { findAll } = require('./db')
const { emit } = require('./events')
const { getSettings } = require('./settings')
const { badRequest } = require('./errors')
const { next: nextCounter, formatDocumentNumber, STARTS } = require('./counters')
const { resolvePartner, creditStanding, widenSalesOrgs } = require('./partners')
const { decide } = require('./credit')
const { withCurrent } = require('./spelling')
const { upgradeOrderRecord, findOrderByReference } = require('./legacy')
const { cents, discountOf, lineNet, netOfLines } = require('./line-amounts')
const { paymentSent } = require('./checkout-payment')

/* Every ERP numbers document lines in tens, so a line can be inserted between two
   without renumbering the rest. Ours are stored on the line at creation, because a
   shipment names the line it ships by item number. */
const LINE_STEP = 10

/** The five outward words, and the whole-order moves between them (the compatibility route). */
const STATUSES = ['created', 'confirmed', 'shipped', 'invoiced', 'canceled']
const TRANSITIONS = {
  created: ['confirmed', 'canceled'],
  confirmed: ['shipped', 'canceled'],
  shipped: ['invoiced'],
  invoiced: [],
  canceled: []
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
  'Duplicate order',
  // The one reason the ERP does not choose: the customer's web shop canceled the order and said so.
  'Canceled in the web shop'
]

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

/** An order's net amount: its lines, each less its discount (lib/line-amounts). Total is what the web shop charged, which carries tax. */
function netOf (order) {
  return netOfLines(order.lines)
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
  if (order.header === 'canceled') return 'canceled'
  if (order.invoice) return 'invoiced'
  if (totals(order).shipped > 0) return 'shipped'
  return order.header === 'confirmed' ? 'confirmed' : 'created'
}

/** Open · In process · Completed · Canceled: the one word a header shows. */
function overallStatus (order) {
  if (order.header === 'canceled') return 'Canceled'
  if (order.invoice) return 'Completed'
  return order.header === 'confirmed' ? 'In process' : 'Open'
}

/**
 * The whole-order moves open to THIS order, from its quantities rather than its word:
 * the compatibility route and the document's `nextStatuses` both read this.
 */
function nextMoves (order) {
  if (order.header === 'canceled' || order.invoice) return []
  if (order.header === 'created') return ['confirmed', 'canceled']
  const { shipped, open } = totals(order)
  if (shipped === 0) return open > 0 ? ['shipped', 'canceled'] : ['canceled']
  return open > 0 ? ['shipped'] : ['invoiced']
}

/** What the document may do, decided here rather than on the screen. */
function abilities (order) {
  const { shipped, open } = totals(order)
  const live = order.header === 'confirmed' && !order.invoice
  const held = order.creditStatus === 'held' && order.header !== 'canceled'
  return {
    // A credit hold stops the next document (SAP): Confirm waits for Release.
    confirm: order.header === 'created' && !held,
    ship: live && open > 0,
    close: live && open > 0,
    invoice: live && open === 0 && shipped > 0,
    cancel: order.header !== 'canceled' && !order.invoice && shipped === 0,
    release: held,
    reject: held
  }
}

/**
 * A stored order in today's shape, whatever shape it was written in. An order from
 * before shipments existed held one status word and no quantities: its header is the
 * word (or confirmed, for shipped and invoiced), a shipped or invoiced order has shipped
 * its whole quantity, and an invoiced one carries an invoice record with no number —
 * the ERP kept none then, and minting one on read would be a write. A word stored in British
 * English before contract version 10 (cancelled) reads as the American one (lib/spelling); the
 * web shop's ids and words stored before version 16 read as references (lib/legacy).
 */
function upgradeOrder (raw) {
  const stored = upgradeOrderRecord(withCurrent(raw, ['header', 'status', 'cancelReason']))
  const legacy = !stored.header
  const word = stored.status
  const wholeShipped = legacy && (word === 'shipped' || word === 'invoiced')
  const lines = (stored.lines || []).map((l, index) => ({
    ...l,
    item: l.item || (index + 1) * LINE_STEP,
    // A line stored before contract version 17 has no discount.
    discount: discountOf(l),
    shippedQty: wholeShipped ? Number(l.qty) || 0 : (Number(l.shippedQty) || 0),
    closedQty: Number(l.closedQty) || 0
  }))
  let header = stored.header
  if (legacy) header = ['created', 'confirmed', 'canceled'].includes(word) ? word : 'confirmed'
  let invoice = stored.invoice || null
  if (legacy && word === 'invoiced') {
    const at = [...(stored.history || [])].reverse().find((h) => h.status === 'invoiced')
    invoice = { number: null, legacy: true, createdAt: at ? at.at : stored.createdAt, status: 'open' }
  }
  const { status: _word, ...rest } = stored
  // An order written before credit existed was never held: it reads as approved when it
  // has a customer, and as having no credit at all when it has none.
  const creditStatus = stored.creditStatus !== undefined ? stored.creditStatus : (stored.partnerId ? 'approved' : null)
  return {
    ...rest,
    header,
    lines,
    shipments: stored.shipments || [],
    invoice,
    history: (stored.history || []).map((h) => withCurrent(h, ['status', 'reason'])),
    creditStatus,
    creditReason: stored.creditReason ?? null,
    creditDecidedAt: stored.creditDecidedAt ?? null,
    // An order stored before contract version 18 was not paid at checkout.
    payment: stored.payment ?? null,
    // An order stored before the structure existed sold through 1000.
    salesOrg: stored.salesOrg || '1000',
    salesOrgName: stored.salesOrgName ?? null
  }
}

/** The order as the API answers it: upgraded, with the derived word on it. */
function view (stored) {
  const order = upgradeOrder(stored)
  return { ...order, status: deriveStatus(order) }
}

/** A reference as the ERP keeps it: text, or null when none was given. */
const referenceText = (value) => (value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim())

/** The stored order a customer's order number names, under today's name or an older one. */
function findByReference (cols, reference) {
  return findOrderByReference(cols.salesOrders, reference)
}

/**
 * The discount a new line carries (contract version 17): the amount the web shop took off the
 * whole line, from 0 to the line's quantity × price; none sent is none. Anything else is
 * refused in words, since a discount the ERP cannot read would misstate what is owed.
 */
function discountSent (line, qty, price, index) {
  if (line.discount === undefined || line.discount === null) return 0
  const most = cents(qty * price)
  const discount = typeof line.discount === 'number' ? cents(line.discount) : NaN
  if (!(discount >= 0 && discount <= most)) throw badRequest(`Line ${index + 1}: the discount must be an amount from 0 to ${most}, the line's quantity × price.`)
  return discount
}

/**
 * Create a sales order. Idempotent on the customer's order number
 * (`purchaseOrderByCustomer`): the same order posted twice answers the same ERP number.
 *
 * @param {object} cols collections
 * @param {object} input `{ purchaseOrderByCustomer, partnerId?, lines:[{sku, qty, price, discount?, customerLineReference?}], currency?, total?, salesOrg?, salesOrgName?, payment? }`
 *   `payment` is the reference of an order paid at checkout (lib/checkout-payment).
 *   Without a partnerId the order is the default (walk-in) partner's.
 * @returns {Promise<object>} the order
 */
async function createOrder (cols, input, params) {
  const reference = referenceText(input && input.purchaseOrderByCustomer)
  if (!reference) throw badRequest("purchaseOrderByCustomer (the customer's order number) is required")
  const existing = await findByReference(cols, reference)
  if (existing) return view(existing)
  const partner = await resolvePartner(cols, input)
  const lines = (input.lines || []).map((l, index) => ({
    item: (index + 1) * LINE_STEP,
    sku: l.sku,
    qty: Number(l.qty) || 1,
    price: Number(l.price) || 0,
    discount: discountSent(l, Number(l.qty) || 1, Number(l.price) || 0, index),
    customerLineReference: referenceText(l.customerLineReference),
    shippedQty: 0,
    closedQty: 0
  }))
  // The credit check, before the number is drawn: exposure is the net of the customer's
  // open orders so far, and this order is created whatever the answer — held, not refused
  // (plan §6.1: the customer has already ordered, and a refusal would drop the order).
  const net = netOfLines(lines)
  // Paid at checkout (contract version 18): the web shop holds the money, so this order asks
  // for none of the customer's credit and adds nothing to the limit check.
  const payment = paymentSent(input.payment)
  // What is checked besides the block is Settings' credit warnings: the limit, an overdue
  // balance, both or neither.
  const credit = decide({ partner, ...await creditStanding(cols, partner), net: payment ? 0 : net, currency: input.currency || 'USD' })
  const number = formatDocumentNumber(await nextCounter(cols, 'salesOrder', STARTS.salesOrder))
  const at = new Date().toISOString()
  const order = {
    _id: number,
    number,
    purchaseOrderByCustomer: reference,
    partnerId: partner ? partner.id : null,
    lines,
    currency: input.currency || 'USD',
    // The selling unit (business structure): the website's sales organisation, from the
    // integration's setting; a caller that names none sells through 1000.
    salesOrg: typeof input.salesOrg === 'string' && input.salesOrg.trim() ? input.salesOrg.trim() : '1000',
    salesOrgName: typeof input.salesOrgName === 'string' && input.salesOrgName.trim() ? input.salesOrgName.trim() : null,
    total: Number(input.total ?? net),
    header: 'created',
    status: 'created',
    shipments: [],
    invoice: null,
    creditStatus: credit.status,
    creditReason: credit.reason,
    creditDecidedAt: null,
    payment,
    history: [{ status: 'created', at }, ...(credit.status === 'held' ? [{ status: 'held', at, reason: credit.reason }] : [])],
    createdAt: at
  }
  await cols.salesOrders.replaceOne({ _id: number }, order, { upsert: true })
  // The customer has now bought through this sales organisation.
  if (partner) await widenSalesOrgs(cols, partner.id, order.salesOrg)
  // The hold is announced at once, so the customer's side can show the order held while the
  // ERP's is — SAP's blocked sales document, seen from the shop's side.
  if (credit.status === 'held') await emit(cols, 'SalesOrder.Changed', salesOrderData(order, null, credit.reason), params)
  return view(order)
}

/** Every order, newest first. Each row carries `can`, so a list can filter to the work a cue counted (lib/work). */
async function listOrders (cols, options = {}) {
  const rows = await findAll(cols.salesOrders, {}, { limit: options.limit ?? 500, sort: { _id: -1 } })
  return rows.map(view).map((order) => ({ ...order, can: abilities(order) }))
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
 * the derived statuses, and what the order became — its shipments, its invoice and its
 * credit memos.
 *
 * Net is the sum of the lines, each less its discount. Total is what the web shop charged, which includes tax. The
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
      amount: lineNet(line)
    })
  }
  const named = (l) => ({ ...l, name: lines.find((x) => x.item === l.item)?.name || l.sku, unit: lines.find((x) => x.item === l.item)?.unit || 'EA' })
  /* The warehouses this order's products are stocked in: the Ship-from choices, under
     the ERP's own names for its plants (settings). */
  const settings = await getSettings(cols)
  const ownNames = settings.warehouses || {}
  const warehouses = new Map()
  for (const product of products.values()) {
    for (const w of product.warehouses || []) {
      const own = ownNames[w.code] && ownNames[w.code].name
      warehouses.set(w.code, { code: w.code, name: own || w.name || w.code })
    }
  }
  const can = abilities(order)
  const net = cents(lines.reduce((sum, l) => sum + l.amount, 0))
  const total = cents(Number(order.total ?? net))
  return {
    ...order,
    lines,
    nextStatuses: nextMoves(order),
    partner: partner
      ? { id: partner.id, name: partner.name, paymentTerms: partner.paymentTerms }
      : null,
    shippingStatus: shippingStatus(order),
    billingStatus: billingStatus(order),
    overall: overallStatus(order),
    // The credit decision, or null for a customer with no credit — the screen leaves the
    // field out rather than printing "Approved" for the walk-in account.
    credit: order.creditStatus ? { status: order.creditStatus, reason: order.creditReason, decidedAt: order.creditDecidedAt } : null,
    can,
    shipments: order.shipments.map((s) => ({ ...s, lines: s.lines.map(named) })),
    // Contract version 14: what is still owed on the invoice, from its payments and credits.
    invoice: order.invoice ? { ...order.invoice, lines: (order.invoice.lines || []).map(named), ...await require('./open-items').openItemFor(cols, order) } : null,
    // Contract version 13: every credit memo against this order, from its invoice and its
    // returns (lib/credit-memos), oldest first. A credited invoice also names its memo.
    creditMemos: await require('./credit-memos').creditMemosOf(cols, order),
    // Its return orders (lib/returns), oldest first, so the document flow can show them.
    returnOrders: await require('./credit-memos').returnOrdersOf(cols, order.number),
    // Contract version 14: the incoming payments against its invoice (lib/payments), oldest first.
    payments: await require('./payments').paymentsOf(cols, order.number),
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

/**
 * The lines an event names, in the ERP's words: each sales order item, its material and
 * quantity, and the customer's own reference for the line (null when the customer gave none).
 *
 * @param {{ item, sku, qty, customerLineReference? }[]} lines
 */
function eventItems (lines) {
  return (lines || []).map((l) => ({ SalesOrderItem: l.item, Material: l.sku, Quantity: l.qty, CustomerLineReference: l.customerLineReference ?? null }))
}

/**
 * The data of a SalesOrder.Changed event: the order as it is now, with what it was before the
 * change (its overall status and credit block), so a subscriber can tell which move this was.
 *
 * @param {object} order the order after the change
 * @param {object|null} before the order before it, or null for a new order
 * @param {string|null} [reason] why: the cancellation or credit reason, or null
 */
function salesOrderData (order, before, reason = null) {
  return {
    SalesOrder: order.number,
    PurchaseOrderByCustomer: order.purchaseOrderByCustomer ?? null,
    SoldToParty: order.partnerId ?? null,
    SalesOrganization: order.salesOrg ?? null,
    TransactionCurrency: order.currency ?? null,
    OverallStatus: deriveStatus(order),
    PrevOverallStatus: before ? deriveStatus(before) : null,
    CreditBlock: order.creditStatus === 'held',
    PrevCreditBlock: before ? before.creditStatus === 'held' : false,
    Reason: reason,
    Items: eventItems(order.lines)
  }
}

/** A document's lines with the customer's reference for each, read from the order's lines when the document kept none. */
function withReferences (order, lines) {
  return (lines || []).map((l) => ({ ...l, customerLineReference: l.customerLineReference ?? (order.lines || []).find((x) => x.item === l.item)?.customerLineReference ?? null }))
}

/**
 * The data of a BillingDocument.Created event: an invoice, or a credit memo (contract
 * version 16). A credit memo names the invoice it credits (ReferenceBillingDocument) and,
 * when it credits a return, the return order and the customer's reference for it.
 *
 * @param {object} order the sales order
 * @param {object} doc the invoice or credit memo (`number, lines, net, tax, total`)
 * @param {'Invoice'|'CreditMemo'} type
 * @param {{ referenceBillingDocument?: string, customerReturn?: string, customerReturnReference?: string }} [refs]
 */
function billingData (order, doc, type, refs = {}) {
  return {
    BillingDocument: doc.number,
    BillingDocumentType: type,
    SalesOrder: order.number,
    PurchaseOrderByCustomer: order.purchaseOrderByCustomer ?? null,
    SoldToParty: order.partnerId ?? null,
    ReferenceBillingDocument: refs.referenceBillingDocument ?? null,
    CustomerReturn: refs.customerReturn ?? null,
    CustomerReturnReference: refs.customerReturnReference ?? null,
    TotalNetAmount: doc.net ?? null,
    TaxAmount: doc.tax ?? null,
    TotalGrossAmount: doc.total ?? null,
    TransactionCurrency: order.currency ?? null,
    Items: eventItems(withReferences(order, doc.lines))
  }
}

module.exports = {
  STATUSES, TRANSITIONS, CANCEL_REASONS, LINE_STEP,
  cents, netOf, openQty, totals, shippingStatus, billingStatus, deriveStatus, overallStatus, nextMoves, abilities,
  upgradeOrder, view, nextStatuses, createOrder, findByReference, listOrders, getOrder, describeOrder, setStatus,
  eventItems, salesOrderData, billingData, withReferences
}
