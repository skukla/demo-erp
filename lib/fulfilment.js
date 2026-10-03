/*
 * What happens to a sales order after it is created: it is confirmed, shipped — in
 * parts, each part a SHIPMENT with a number of its own that is created and then
 * posted — invoiced once, whole, and possibly canceled.
 *
 * Each of these is a move on the order, and each move refuses the impossible in words
 * a person can act on ("Item 20: 4 EA are not yet shipped. Ship them, or close the
 * remainder."). Nothing here stores a status the quantities could contradict: the
 * order's stored word is only the header (created · confirmed · canceled); shipping,
 * billing and the outward `status` are worked out from the quantities in lib/orders.
 *
 * The invoice covers the whole order, once, and only when every line is shipped or
 * closed. That is an owner decision (2026-09-23): the web shop can invoice in parts but has
 * no way to take further payment against an order left partly invoiced, so the ERP does
 * not pretend to. Its consequence is Close remaining: without a way to give up on an
 * unshipped quantity, a short-shipped order could never be invoiced.
 */
const { badRequest, notFound } = require('./errors')
const { next: nextCounter, formatDocumentNumber, STARTS } = require('./counters')
const { emit, receive } = require('./events')
const { originOf } = require('./inbound')
const { findAll } = require('./db')
const orders = require('./orders')
const { getProduct } = require('./products')
const { goodsMoves, refuseIfShort, issueGoods, shortfallNote } = require('./goods-issue')
const { getPartner } = require('./partners')
const { getSettings } = require('./settings')
const { blockingRefusal } = require('./credit')
const { daysOf, dueDate, termsFor } = require('./terms')
const { openItemFor, openItemReader } = require('./open-items')
const { companyOf, DEFAULT_COMPANY_CODE } = require('./setup')
const { salesOrganizationsOf, websitesOf } = require('./sales-organizations')
const { discountOf, lineNet } = require('./line-amounts')

const { STATUSES, CANCEL_REASONS, openQty, totals, nextMoves, deriveStatus, upgradeOrder, listOrders, eventItems, salesOrderData, billingData } = orders

/* Why an unshipped quantity is given up on. A fixed list, as an ERP keeps one: the
   reason is reported on, so it has to be one of a known set. */
const CLOSE_REASONS = ['Customer request', 'Out of stock', 'Product discontinued']

/** What a canceled order paid at checkout says about the money (owner 2026-10-02, flow 1). */
const CARD_REFUND = 'Paid by card in the web shop: the card payment is refunded there, not by the ERP.'

/** First shipment and invoice numbers: each document type has its own range (lib/counters STARTS). */
const FIRST = { shipment: STARTS.shipment, invoice: STARTS.invoice }

/** The stored order, upgraded, or null. */
async function load (cols, number) {
  const found = await cols.salesOrders.findOne({ _id: number })
  return found ? upgradeOrder(found) : null
}

/**
 * A change made IN ANOTHER SYSTEM (the customer's web shop) arrives with
 * `origin: { system, document? }` (the pattern the imports use; contract version 16). The ERP
 * journals it as received, naming that system as the source of the document.
 *
 * It raises its outbound event for it all the same (contract version 19, AB-26y step 5): a real
 * ERP raises its events for every change, whoever made it. Recognising that an event echoes a
 * change it sent is the subscriber's business; until version 19 the ERP held its event back,
 * which no real ERP does.
 *
 * @returns {{ system: string, document?: string, eventId?: string }|undefined} the origin, or
 *   undefined for a move made here
 */
function external (options) {
  return originOf(options)
}

/**
 * Journal what another system did, when the move names its origin.
 * @param {(origin: object) => string} summary the words, given who sent it
 */
async function journalExternal (cols, options, summary, value) {
  const origin = external(options)
  if (!origin) return undefined
  return receive(cols, origin, summary(origin), value)
}

/** An invoice by its number, or what an invoice from before numbering is called. */
const invoiceRef = (invoice) => invoice.number || 'before invoices were numbered'

/** Write the order back. The derived status is stored too, so a raw read still says it. */
async function save (cols, order) {
  const next = { ...order, status: deriveStatus(order) }
  await cols.salesOrders.replaceOne({ _id: order._id }, next, { upsert: true })
  return next
}

const stamp = () => new Date().toISOString()

/** "23 Sep 2026", for a refusal that names when something happened. */
function dayOf (iso) {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}

/** When the order last entered a status, from its history. */
function whenStatus (order, status) {
  const entry = [...(order.history || [])].reverse().find((h) => h.status === status)
  return entry ? entry.at : order.createdAt
}

/** The base unit of a line's product, for a message about quantities. */
async function unitOf (cols, sku) {
  const product = await cols.products.findOne({ _id: sku })
  return product && product.unit ? product.unit : 'EA'
}

async function mustExist (cols, number) {
  const order = await load(cols, number)
  if (!order) throw notFound(`Sales order ${number}`)
  return order
}

function refuseIfCancelled (order) {
  if (order.header === 'canceled') throw badRequest(`This order was canceled on ${dayOf(whenStatus(order, 'canceled'))}.`)
}

/**
 * A product blocked for sales ships nothing (plan §6.3): the block is on the product, so
 * the other lines of the order still ship. Checked when a shipment is created and again
 * when it is posted, since the block may have been set in between.
 */
async function refuseIfBlockedForSales (cols, lines) {
  for (const sku of new Set(lines.map((l) => l.sku))) {
    const product = await cols.products.findOne({ _id: sku })
    if (product && product.salesStatus === 'blocked') throw badRequest(`Product ${sku} is blocked for sales.`)
  }
}

/** The customer's blocking level, if it stops this document. */
async function refuseIfBlocked (cols, order, document) {
  if (!order.partnerId) return
  const refusal = blockingRefusal(await getPartner(cols, order.partnerId), document)
  if (refusal) throw badRequest(refusal)
}

/** Confirm: from created only, and not while on credit hold — a hold stops the next document. */
async function confirmOrder (cols, number, params) {
  const order = await mustExist(cols, number)
  refuseIfCancelled(order)
  if (order.header === 'confirmed') throw badRequest(`This order was confirmed on ${dayOf(whenStatus(order, 'confirmed'))}.`)
  if (order.creditStatus === 'held') throw badRequest(`${order.creditReason}. Release the order first.`)
  const at = stamp()
  const next = await save(cols, { ...order, header: 'confirmed', history: [...order.history, { status: 'confirmed', at }] })
  await emit(cols, 'SalesOrder.Changed', salesOrderData(next, order), params)
  return next
}

/**
 * Cancel, with a reason from CANCEL_REASONS. Refused once anything has shipped:
 * the web shop cannot cancel a shipped order either, and the two must agree.
 */
async function cancelOrder (cols, number, reason, params, options = {}) {
  const order = await mustExist(cols, number)
  if (!CANCEL_REASONS.includes(reason)) throw badRequest(`a cancellation needs one of these reasons: ${CANCEL_REASONS.join(', ')}`)
  // The web shop says it canceled an order the ERP already shows canceled: nothing to do twice.
  if (external(options) && order.header === 'canceled') return order
  refuseIfCancelled(order)
  if (order.invoice) throw badRequest(`This order was invoiced (${invoiceRef(order.invoice)}) and cannot be canceled.`)
  const { shipped } = totals(order)
  if (shipped > 0) {
    const posted = order.shipments.filter((s) => s.status === 'posted').map((s) => s.number).join(', ')
    throw badRequest(`This order has shipped (shipment ${posted}); a shipped order cannot be canceled.`)
  }
  const at = stamp()
  // Paid at checkout (contract version 18): the money is the web shop's, and so is the refund.
  // Nothing was invoiced here, so the ERP posted no payment and has none to reverse.
  const note = order.payment ? { note: CARD_REFUND } : {}
  const next = await save(cols, {
    ...order,
    header: 'canceled',
    cancelReason: reason,
    history: [...order.history, { status: 'canceled', at, reason, ...note }]
  })
  // The reason rides with the event, so the customer's side can say WHY the ERP canceled —
  // the line an audience reads when the ERP is meant to be the system of record.
  await emit(cols, 'SalesOrder.Changed', salesOrderData(next, order, reason), params)
  await journalExternal(cols, options, (o) => `Sales order ${number} canceled in ${o.system}`, { number, reason })
  return next
}

/** The requested shipment lines, checked against what remains open on the order. */
async function shipmentLines (cols, order, requested) {
  const asked = (Array.isArray(requested) ? requested : []).filter((l) => Number(l.qty) > 0)
  if (asked.length === 0) throw badRequest('A shipment needs at least one line with a quantity.')
  const lines = []
  for (const ask of asked) {
    const item = Number(ask.item)
    const line = order.lines.find((l) => l.item === item)
    if (!line) throw badRequest(`Item ${ask.item} is not on this order.`)
    const qty = Number(ask.qty)
    if (!Number.isInteger(qty)) throw badRequest(`Item ${item}: the quantity must be a whole number.`)
    const open = openQty(line)
    if (qty > open) throw badRequest(`Item ${item}: ${open} ${await unitOf(cols, line.sku)} remain of ${line.qty}.`)
    lines.push({ item, sku: line.sku, qty, customerLineReference: line.customerLineReference ?? null })
  }
  return lines
}

/**
 * The warehouse a shipment ships from when none was named (AB-49): the one that holds EVERY
 * shipped line, when exactly one does; else the one with the most stock across the shipped
 * lines; null only when no warehouse holds any of them. Deterministic, so an API- or
 * agent-created shipment names a plant the web shop can ship from instead of giving up when a
 * product sits in two warehouses (which left it null, sent as "default", and 400'd).
 *
 * @param {Map<string, object|null>} products by SKU, as getProduct answers them
 * @param {{ sku: string }[]} lines the shipment's lines
 * @returns {string|null} a warehouse code, or null
 */
function defaultWarehouse (products, lines) {
  const skus = [...new Set(lines.map((l) => l.sku))]
  const holds = new Map()   // code -> { skus: Set, stock: number }
  for (const sku of skus) {
    for (const w of products.get(sku)?.warehouses || []) {
      if (!(Number(w.quantity) > 0)) continue
      const h = holds.get(w.code) || { skus: new Set(), stock: 0 }
      h.skus.add(sku)
      h.stock += Number(w.quantity)
      holds.set(w.code, h)
    }
  }
  if (holds.size === 0) return null
  const all = [...holds].filter(([, h]) => h.skus.size === skus.length).map(([code]) => code)
  if (all.length === 1) return all[0]
  return [...holds].sort((a, b) => b[1].stock - a[1].stock || (a[0] < b[0] ? -1 : 1))[0][0]
}

/**
 * Create a shipment: an open document naming the quantities it will carry and, when the
 * store has more than one warehouse, which one it ships from. Nothing moves until it is
 * posted.
 *
 * @param {object} input `{ lines: [{ item, qty }], warehouse? }`
 */
async function createShipment (cols, number, input, params) {
  const order = await mustExist(cols, number)
  refuseIfCancelled(order)
  if (order.header !== 'confirmed') throw badRequest('Confirm the order before shipping it.')
  if (order.invoice) throw badRequest(`This order was invoiced (${invoiceRef(order.invoice)}); nothing more ships against it.`)
  await refuseIfBlocked(cols, order, 'shipment')
  const lines = await shipmentLines(cols, order, input && input.lines)
  await refuseIfBlockedForSales(cols, lines)
  let warehouse = input && typeof input.warehouse === 'string' && input.warehouse.trim() ? input.warehouse.trim() : null
  if (!warehouse) {
    // No warehouse named: an ERP ships from where the goods are, so the shipment names its
    // plant and the customer's side ships from it (a null plant became "default", where the
    // goods are not, and 400'd). Each product read once.
    const products = new Map()
    for (const sku of new Set(lines.map((l) => l.sku))) products.set(sku, await getProduct(cols, sku))
    warehouse = defaultWarehouse(products, lines)
  }
  const shipment = {
    number: formatDocumentNumber(await nextCounter(cols, 'shipment', FIRST.shipment)),
    createdAt: stamp(),
    postedAt: null,
    status: 'open',
    warehouse,
    lines
  }
  return save(cols, { ...order, shipments: [...order.shipments, shipment] })
}

/**
 * The data of an OutboundDelivery.GoodsIssueStatusChanged event: the shipment (SAP's outbound
 * delivery) whose goods issue was just posted, THIS shipment's items — not the whole order —
 * and the plant it named, so the customer's side deducts from the matching stock. The ERP
 * keeps no carrier or tracking number, so both are null.
 */
function deliveryData (order, shipment, before) {
  return {
    OutboundDelivery: shipment.number,
    SalesOrder: order.number,
    PurchaseOrderByCustomer: order.purchaseOrderByCustomer ?? null,
    SoldToParty: order.partnerId ?? null,
    GoodsMovementStatus: shipment.status,
    PrevGoodsMovementStatus: before.status,
    Plant: shipment.warehouse ?? null,
    Carrier: null,
    TrackingNumber: null,
    Items: eventItems(shipment.lines)
  }
}

/**
 * Post a shipment: the goods leave, and the quantities move — the order's shipped quantities,
 * and the warehouse's on hand (lib/goods-issue; refused when the warehouse is short).
 */
async function postShipment (cols, number, shipmentNumber, params) {
  const order = await mustExist(cols, number)
  const shipment = order.shipments.find((s) => s.number === shipmentNumber)
  if (!shipment) throw notFound(`Shipment ${shipmentNumber} on sales order ${number}`)
  if (shipment.status === 'posted') throw badRequest(`Shipment ${shipmentNumber} was posted on ${dayOf(shipment.postedAt)}.`)
  refuseIfCancelled(order)
  await refuseIfBlockedForSales(cols, shipment.lines)
  // Another shipment may have been posted since this one was created.
  const lines = order.lines.map((line) => ({ ...line }))
  for (const l of shipment.lines) {
    const line = lines.find((x) => x.item === l.item)
    const open = openQty(line)
    if (l.qty > open) throw badRequest(`Item ${l.item}: ${open} ${await unitOf(cols, line.sku)} remain of ${line.qty}.`)
    line.shippedQty += l.qty
  }
  const moves = await goodsMoves(cols, shipment)
  refuseIfShort(moves)
  const at = stamp()
  const posted = { ...shipment, status: 'posted', postedAt: at }
  const next = await save(cols, {
    ...order,
    lines,
    shipments: order.shipments.map((s) => (s.number === shipmentNumber ? posted : s)),
    history: [...order.history, { status: 'shipped', at, shipment: shipmentNumber }]
  })
  await issueGoods(cols, moves)
  await emit(cols, 'OutboundDelivery.GoodsIssueStatusChanged', deliveryData(next, posted, shipment), params)
  return next
}

/**
 * A shipment posted IN ANOTHER SYSTEM (the web shop's admin, or a warehouse system behind
 * it): the ERP records it as a posted shipment of its own so its record matches, and does not
 * ship it again. Lines come by the customer's line reference; the plant it shipped from
 * becomes the warehouse. Idempotent on that system's reference for the shipment
 * (`externalReference`): a redelivered message finds it recorded.
 *
 * Its goods come off the ERP's shelf too, once (lib/goods-issue): a redelivery returns before
 * anything moves, and the ERP's own shipment coming back was taken when the ERP posted it. The
 * goods have already left, so a shortfall is not refused: on hand stops at zero and the
 * journal entry says how many were missing.
 *
 * @param {object} input `{ externalReference, lines: [{ customerLineReference, qty }], warehouse?, origin }`
 */
async function receiveExternalShipment (cols, number, input, params) {
  const order = await mustExist(cols, number)
  const externalReference = input && input.externalReference !== undefined && input.externalReference !== null ? String(input.externalReference).trim() : ''
  if (!externalReference) throw badRequest('A shipment posted elsewhere needs its externalReference.')
  if (!external(input)) throw badRequest('A shipment posted elsewhere names the system it came from (origin.system).')
  if (order.shipments.some((s) => s.externalReference === externalReference)) return order
  refuseIfCancelled(order)
  const requested = (Array.isArray(input.lines) ? input.lines : []).map((i) => {
    const line = order.lines.find((l) => l.customerLineReference !== null && l.customerLineReference !== undefined && String(l.customerLineReference) === String(i.customerLineReference))
    if (!line) throw badRequest(`Customer line reference ${i.customerLineReference} is not on this order.`)
    return { item: line.item, qty: Number(i.qty) }
  })
  // The ERP's own shipment comes back this way too: the integration ships it in the web
  // shop, and the shop's shipment then arrives here. A posted ERP shipment with the same
  // lines and no external reference yet IS that shipment: it takes the reference, and
  // nothing is shipped twice. (Whichever order the two arrive in.)
  const sameLines = (s) => s.lines.length === requested.length && requested.every((r) => s.lines.some((l) => l.item === r.item && l.qty === r.qty))
  const own = order.shipments.find((s) => s.status === 'posted' && !s.externalReference && sameLines(s))
  if (own) {
    const next = await save(cols, { ...order, shipments: order.shipments.map((s) => (s === own ? { ...s, externalReference } : s)) })
    await journalExternal(cols, input, (o) => `Shipment ${externalReference} in ${o.system} is ERP shipment ${own.number} on sales order ${number}; nothing shipped twice`, { number, shipment: own.number, externalReference })
    return next
  }
  const lines = await shipmentLines(cols, order, requested)
  const at = stamp()
  const shipment = {
    number: formatDocumentNumber(await nextCounter(cols, 'shipment', FIRST.shipment)),
    createdAt: at,
    postedAt: at,
    status: 'posted',
    warehouse: typeof input.warehouse === 'string' && input.warehouse.trim() ? input.warehouse.trim() : null,
    externalReference,
    lines
  }
  const shipped = order.lines.map((l) => {
    const part = lines.find((x) => x.item === l.item)
    return part ? { ...l, shippedQty: (Number(l.shippedQty) || 0) + part.qty } : l
  })
  // A shipment posted elsewhere is the goods leaving whether or not the ERP had confirmed the order.
  const header = order.header === 'created' ? 'confirmed' : order.header
  const next = await save(cols, {
    ...order,
    header,
    lines: shipped,
    shipments: [...order.shipments, shipment],
    history: [...order.history, ...(header !== order.header ? [{ status: 'confirmed', at }] : []), { status: 'shipped', at, shipment: shipment.number }]
  })
  const moves = await goodsMoves(cols, shipment, { lenient: true })
  await issueGoods(cols, moves)
  const shippedQty = shipment.lines.reduce((sum, l) => sum + l.qty, 0)
  const from = shipment.warehouse ? ` from ${shipment.warehouse}` : ''
  await journalExternal(cols, input, (o) => `Goods issue posted from ${o.system}: shipment ${shipment.number} for sales order ${number} (${shippedQty} shipped${from})${shortfallNote(moves)}`, { number, shipment: shipment.number, externalReference })
  // A goods issue is raised as one, whoever posted it (contract version 19).
  await emit(cols, 'OutboundDelivery.GoodsIssueStatusChanged', deliveryData(next, shipment, { status: 'open' }), params)
  return next
}

/**
 * Give up on what remains unshipped of one line, with a reason, so a short-shipped order
 * can still be invoiced. No event is raised: the customer's side will invoice the order as
 * placed, which is what the ERP's invoice mirrors (see createInvoice).
 */
async function closeRemaining (cols, number, item, reason, params) {
  const order = await mustExist(cols, number)
  if (!CLOSE_REASONS.includes(reason)) throw badRequest(`closing a line needs one of these reasons: ${CLOSE_REASONS.join(', ')}`)
  refuseIfCancelled(order)
  if (order.header !== 'confirmed') throw badRequest('Confirm the order first.')
  if (order.invoice) throw badRequest(`This order was invoiced (${invoiceRef(order.invoice)}).`)
  const line = order.lines.find((l) => l.item === Number(item))
  if (!line) throw badRequest(`Item ${item} is not on this order.`)
  const open = openQty(line)
  if (open === 0) throw badRequest(`Item ${item} has nothing open.`)
  const lines = order.lines.map((l) => (l.item === line.item ? { ...l, closedQty: l.closedQty + open, closeReason: reason, closedAt: stamp() } : l))
  return save(cols, { ...order, lines })
}

/**
 * Create the invoice: one, for the whole order, once every line is shipped or closed.
 * Its lines are the order's as placed — that is what the web shop invoices (the whole
 * order, captured), and an ERP invoice that disagreed with the shop's would be the wrong
 * kind of realism. A closed line therefore still bills; the order says why it was closed.
 * An invoice made in another system arrives with its origin and that system's reference
 * for it (`externalReference`). The invoice of an order paid at checkout is paid as it is
 * posted (lib/payments payCheckoutInvoice).
 */
async function createInvoice (cols, number, params, options = {}) {
  const order = await mustExist(cols, number)
  // The web shop says it invoiced an order the ERP already shows invoiced: nothing to do twice.
  if (external(options) && order.invoice) return order
  if (order.invoice) throw badRequest(`This order is already invoiced (${invoiceRef(order.invoice)}).`)
  refuseIfCancelled(order)
  if (order.header !== 'confirmed') throw badRequest('Confirm the order before invoicing it.')
  await refuseIfBlocked(cols, order, 'invoice')
  const short = order.lines.find((l) => openQty(l) > 0)
  if (short) throw badRequest(`Item ${short.item}: ${openQty(short)} ${await unitOf(cols, short.sku)} are not yet shipped. Ship them, or close the remainder.`)
  if (totals(order).shipped === 0) throw badRequest('Nothing on this order has shipped.')
  const at = stamp()
  const net = orders.netOf(order)
  const total = orders.cents(Number(order.total ?? net))
  const invoice = {
    number: formatDocumentNumber(await nextCounter(cols, 'invoice', FIRST.invoice)),
    createdAt: at,
    status: 'open',
    lines: order.lines.map((l) => ({ item: l.item, sku: l.sku, qty: l.qty, price: l.price, discount: discountOf(l), amount: lineNet(l) })),
    net,
    tax: orders.cents(total - net),
    total,
    shipments: order.shipments.filter((s) => s.status === 'posted').map((s) => s.number)
  }
  const externalReference = options.externalReference !== undefined && options.externalReference !== null && String(options.externalReference).trim() ? String(options.externalReference).trim() : undefined
  const next = await save(cols, { ...order, invoice: externalReference ? { ...invoice, externalReference } : invoice, history: [...order.history, { status: 'invoiced', at, invoice: invoice.number }] })
  // An order paid at checkout (contract version 18): its payment is posted with the invoice,
  // so nothing is left open. Required here at call time: lib/payments requires this module.
  await require('./payments').payCheckoutInvoice(cols, next)
  await emit(cols, 'BillingDocument.Created', billingData(next, invoice, 'Invoice'), params)
  await journalExternal(cols, options, (o) => `Invoice ${invoice.number} for sales order ${number} posted from ${o.system}`, { number, invoice: invoice.number, externalReference })
  return next
}

/**
 * Release a credit hold: the order may proceed. SAP's own verb; the decision is recorded
 * with its time, and raising the limit never does this by itself.
 */
async function releaseCredit (cols, number, params, options = {}) {
  const order = await mustExist(cols, number)
  // The web shop took an order off hold that the ERP does not hold: nothing to do.
  if (external(options) && order.creditStatus !== 'held') return order
  refuseIfCancelled(order)
  if (order.creditStatus !== 'held') throw badRequest('This order is not on credit hold.')
  const at = stamp()
  const next = await save(cols, {
    ...order,
    creditStatus: 'released',
    creditDecidedAt: at,
    history: [...order.history, { status: 'released', at }]
  })
  // The same event that announced the hold announces the release: the credit block lifts.
  await emit(cols, 'SalesOrder.Changed', salesOrderData(next, order, null), params)
  await journalExternal(cols, options, (o) => `Sales order ${number} taken off hold in ${o.system}`, { number })
  return next
}

/**
 * An order put On Hold IN ANOTHER SYSTEM (the web shop): the ERP holds it too, with that
 * system's word as the reason, so Confirm and Create shipment refuse here as well until it is
 * released. Only an order that is still open can be held; one already held stays as it is.
 */
async function holdExternal (cols, number, params, options = {}) {
  const order = await mustExist(cols, number)
  const origin = external(options)
  if (!origin) throw badRequest('A hold from another system names the system it came from (origin.system).')
  if (order.creditStatus === 'held') return order
  refuseIfCancelled(order)
  if (order.invoice) throw badRequest(`This order was invoiced (${invoiceRef(order.invoice)}) and cannot be held.`)
  const at = stamp()
  const reason = typeof options.reason === 'string' && options.reason.trim() ? options.reason.trim() : `Put on hold in ${origin.system}`
  const next = await save(cols, {
    ...order,
    creditStatus: 'held',
    creditReason: reason,
    creditDecidedAt: null,
    history: [...order.history, { status: 'held', at, reason }]
  })
  await journalExternal(cols, options, (o) => `Sales order ${number} put on hold in ${o.system}`, { number, reason })
  // The credit block is raised as the ERP's own hold is (contract version 19).
  await emit(cols, 'SalesOrder.Changed', salesOrderData(next, order, reason), params)
  return next
}

/** Reject a credit hold: the order is canceled, with the reason the event carries. */
async function rejectCredit (cols, number, params) {
  const order = await mustExist(cols, number)
  refuseIfCancelled(order)
  if (order.creditStatus !== 'held') throw badRequest('This order is not on credit hold.')
  const cancelled = await cancelOrder(cols, number, 'Credit rejected', params)
  return save(cols, { ...cancelled, creditDecidedAt: stamp() })
}

/**
 * The whole-order move a caller that knows nothing of shipments asks for
 * (`POST orders/:number/status`): shipped ships everything still open in one posted
 * shipment; invoiced creates the invoice. The route predates shipments and stays.
 */
async function setStatus (cols, number, status, params, options = {}) {
  const order = await load(cols, number)
  if (!order) return null
  if (!STATUSES.includes(status)) throw badRequest(`status must be one of ${STATUSES.join(', ')}`)
  if (!nextMoves(order).includes(status)) {
    throw badRequest(`an order in status "${deriveStatus(order)}" cannot move to "${status}"`)
  }
  if (status === 'confirmed') return confirmOrder(cols, number, params)
  if (status === 'canceled') return cancelOrder(cols, number, options.reason, params)
  if (status === 'invoiced') return createInvoice(cols, number, params)
  const lines = order.lines.filter((l) => openQty(l) > 0).map((l) => ({ item: l.item, qty: openQty(l) }))
  const withShipment = await createShipment(cols, number, { lines }, params)
  return postShipment(cols, number, withShipment.shipments.at(-1).number, params)
}

/** Product names and units for a set of lines, read once. */
async function productsFor (cols, skus) {
  const found = new Map()
  for (const sku of new Set(skus)) {
    const product = await cols.products.findOne({ _id: sku })
    if (product) found.set(sku, product)
  }
  return found
}

/**
 * The warehouse a shipment named: the ERP's own name for the plant (settings, business
 * structure), else the name it was imported with, else its code.
 */
function warehouseOf (code, products, settingsWarehouses = {}) {
  if (!code) return null
  let imported = code
  for (const product of products.values()) {
    const match = (product.warehouses || []).find((w) => w.code === code)
    if (match) { imported = match.name || code; break }
  }
  const own = settingsWarehouses[code] && settingsWarehouses[code].name
  return { code, name: own || imported }
}

/** A shipment as its document shows it: the order named, each line with its product. */
async function describeShipment (cols, order, shipment) {
  const [products, partner, settings] = await Promise.all([
    productsFor(cols, shipment.lines.map((l) => l.sku)),
    order.partnerId ? cols.businessPartners.findOne({ _id: order.partnerId }) : null,
    getSettings(cols)
  ])
  return {
    ...shipment,
    orderNumber: order.number,
    purchaseOrderByCustomer: order.purchaseOrderByCustomer,
    partner: partner ? { id: partner.id, name: partner.name } : null,
    warehouse: warehouseOf(shipment.warehouse, products, settings.warehouses || {}),
    lines: shipment.lines.map((l) => {
      const product = products.get(l.sku)
      return { ...l, name: product ? product.name : l.sku, unit: product && product.unit ? product.unit : 'EA' }
    })
  }
}

/** Every shipment across every order, newest number first, each naming its order. */
async function listShipments (cols) {
  const rows = []
  for (const order of await listOrders(cols)) {
    for (const s of order.shipments) {
      rows.push({
        number: s.number,
        orderNumber: order.number,
        partnerId: order.partnerId,
        createdAt: s.createdAt,
        postedAt: s.postedAt,
        status: s.status,
        warehouse: s.warehouse,
        lines: s.lines.length,
        qty: s.lines.reduce((sum, l) => sum + l.qty, 0)
      })
    }
  }
  return rows.sort((a, b) => (a.number < b.number ? 1 : -1))
}

/** One shipment, found through its order (a demo store holds at most a few hundred). */
async function getShipment (cols, number) {
  for (const order of await listOrders(cols)) {
    const shipment = order.shipments.find((s) => s.number === number)
    if (shipment) return describeShipment(cols, order, shipment)
  }
  return null
}

/** An invoice as its document shows it. */
async function describeInvoice (cols, order, invoice) {
  const [products, partner, settings] = await Promise.all([
    productsFor(cols, (invoice.lines || []).map((l) => l.sku)),
    order.partnerId ? cols.businessPartners.findOne({ _id: order.partnerId }) : null,
    getSettings(cols)
  ])
  // The sold-to's own terms, else the ERP's default payment terms.
  const terms = termsFor(partner, settings.sales.defaultPaymentTerms)
  return {
    ...invoice,
    // What is still owed on it (contract version 14), derived from its payments and credits.
    ...await openItemFor(cols, order),
    // How the order was paid at checkout (contract version 18), or null.
    payment: order.payment ?? null,
    orderNumber: order.number,
    purchaseOrderByCustomer: order.purchaseOrderByCustomer,
    currency: order.currency,
    partner: partner ? { id: partner.id, name: partner.name, paymentTerms: terms } : null,
    // When it is due: the billing date plus the payment terms (lib/terms); null when the
    // terms name no number of days.
    paymentDays: daysOf(terms),
    dueDate: dueDate(invoice.createdAt, terms),
    // Who is invoicing (P3): the company code, and the sales organisation the order came through.
    seller: sellerOf(settings, order),
    lines: (invoice.lines || []).map((l) => {
      const product = products.get(l.sku)
      return { ...l, name: product ? product.name : l.sku, unit: product && product.unit ? product.unit : 'EA' }
    })
  }
}

/**
 * The seller block an invoice carries: the company as Settings holds it (lib/setup), the
 * order's sales organization under the ERP's name for it, and the sales organization's
 * currency. A company field nobody set falls back to the Store Information of the website
 * the order came through.
 */
function sellerOf (settings, order) {
  const websites = websitesOf(settings)
  const salesOrg = order.salesOrg || DEFAULT_COMPANY_CODE
  const through = websites.find((w) => w.salesOrg === salesOrg) || websites.find((w) => w.salesOrg === DEFAULT_COMPANY_CODE) || websites[0] || null
  const company = companyOf(settings, through)
  const org = salesOrganizationsOf(settings).find((o) => o.code === salesOrg)
  return {
    companyCode: company.code,
    name: company.name,
    salesOrg,
    salesOrgName: (org && org.name) || order.salesOrgName || (through && through.salesOrgName) || null,
    currency: (org && org.currency) || company.currency || order.currency || null,
    countryId: (company.address && company.address.countryId) || (through && through.storeInfo && through.storeInfo.countryId) || null,
    vatNumber: company.taxId,
    address: company.address
  }
}

/** Every invoice, newest number first. A legacy invoice (no number) is listed as such. */
async function listInvoices (cols) {
  const rows = []
  const openItem = await openItemReader(cols)
  for (const order of await listOrders(cols)) {
    if (!order.invoice) continue
    rows.push({
      number: order.invoice.number,
      legacy: Boolean(order.invoice.legacy),
      orderNumber: order.number,
      partnerId: order.partnerId,
      createdAt: order.invoice.createdAt,
      status: order.invoice.status,
      currency: order.currency,
      total: order.invoice.total ?? order.total,
      ...openItem(order)
    })
  }
  return rows.sort((a, b) => (String(a.number) < String(b.number) ? 1 : -1))
}

async function getInvoice (cols, number) {
  for (const order of await listOrders(cols)) {
    if (order.invoice && order.invoice.number === number) return describeInvoice(cols, order, order.invoice)
  }
  return null
}

module.exports = {
  receiveExternalShipment, holdExternal, mustExist, save, stamp, dayOf, unitOf,
  CLOSE_REASONS, FIRST,
  confirmOrder, cancelOrder, createShipment, postShipment, closeRemaining, createInvoice, setStatus,
  releaseCredit, rejectCredit,
  describeShipment, listShipments, getShipment, describeInvoice, listInvoices, getInvoice, warehouseOf,
  defaultWarehouse
}
