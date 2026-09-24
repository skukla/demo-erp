/*
 * What happens to a sales order after it is created: it is confirmed, shipped — in
 * parts, each part a SHIPMENT with a number of its own that is created and then
 * posted — invoiced once, whole, and possibly cancelled.
 *
 * Each of these is a move on the order, and each move refuses the impossible in words
 * a person can act on ("Item 20: 4 EA are not yet shipped. Ship them, or close the
 * remainder."). Nothing here stores a status the quantities could contradict: the
 * order's stored word is only the header (created · confirmed · cancelled); shipping,
 * billing and the outward `status` are worked out from the quantities in lib/orders.
 *
 * The invoice covers the whole order, once, and only when every line is shipped or
 * closed. That is an owner decision (2026-09-23): Commerce can invoice in parts but has
 * no way to take further payment against an order left partly invoiced, so the ERP does
 * not pretend to. Its consequence is Close remaining: without a way to give up on an
 * unshipped quantity, a short-shipped order could never be invoiced.
 */
const { badRequest, notFound } = require('./errors')
const { next: nextCounter, formatDocumentNumber } = require('./counters')
const { emit } = require('./events')
const { findAll } = require('./db')
const orders = require('./orders')
const { getPartner } = require('./partners')
const { blockingRefusal } = require('./credit')

const { STATUSES, CANCEL_REASONS, openQty, totals, nextMoves, deriveStatus, upgradeOrder, orderEventPayload, listOrders } = orders

/* Why an unshipped quantity is given up on. A fixed list, as an ERP keeps one: the
   reason is reported on, so it has to be one of a known set. */
const CLOSE_REASONS = ['Customer request', 'Out of stock', 'Product discontinued']

/** First shipment and invoice numbers: each document type has its own range (plan §4.1). */
const FIRST = { shipment: 8000000001, invoice: 9000000001 }

/** The stored order, upgraded, or null. */
async function load (cols, number) {
  const found = await cols.salesOrders.findOne({ _id: number })
  return found ? upgradeOrder(found) : null
}

/** Write the order back. The derived status is stored too, so a raw read still says it. */
async function save (cols, order) {
  const next = { ...order, status: deriveStatus(order) }
  await cols.salesOrders.replaceOne({ _id: order._id }, next, { upsert: true })
  return next
}

const stamp = () => new Date().toISOString()

/** "23 Sep 2026", for a refusal that names when something happened. */
function dayOf (iso) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
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
  if (order.header === 'cancelled') throw badRequest(`This order was cancelled on ${dayOf(whenStatus(order, 'cancelled'))}.`)
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
  await emit(cols, 'order.confirmed', orderEventPayload(next), params)
  return next
}

/**
 * Cancel, with a reason from CANCEL_REASONS. Refused once anything has shipped:
 * Commerce cannot cancel a shipped order either, and the two must agree.
 */
async function cancelOrder (cols, number, reason, params) {
  const order = await mustExist(cols, number)
  if (!CANCEL_REASONS.includes(reason)) throw badRequest(`a cancellation needs one of these reasons: ${CANCEL_REASONS.join(', ')}`)
  refuseIfCancelled(order)
  if (order.invoice) throw badRequest(`This order was invoiced (${order.invoice.number || 'in Commerce'}) and cannot be cancelled.`)
  const { shipped } = totals(order)
  if (shipped > 0) {
    const posted = order.shipments.filter((s) => s.status === 'posted').map((s) => s.number).join(', ')
    throw badRequest(`This order has shipped (shipment ${posted}); Commerce cannot cancel a shipped order.`)
  }
  const at = stamp()
  const next = await save(cols, {
    ...order,
    header: 'cancelled',
    cancelReason: reason,
    history: [...order.history, { status: 'cancelled', at, reason }]
  })
  // The reason rides with the event, so Commerce's order history can say WHY the ERP
  // cancelled — the line an audience reads when the ERP is meant to be the system of record.
  await emit(cols, 'order.cancelled', { ...orderEventPayload(next), reason }, params)
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
    lines.push({ item, sku: line.sku, qty, commerceItemId: line.commerceItemId ?? null })
  }
  return lines
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
  if (order.invoice) throw badRequest(`This order was invoiced (${order.invoice.number || 'in Commerce'}); nothing more ships against it.`)
  await refuseIfBlocked(cols, order, 'shipment')
  const lines = await shipmentLines(cols, order, input && input.lines)
  const warehouse = input && typeof input.warehouse === 'string' && input.warehouse.trim() ? input.warehouse.trim() : null
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
 * Post a shipment: the goods leave. The shipped quantities move, and the shipment event
 * carries THIS shipment's items — not the whole order — plus the warehouse it named, so
 * Commerce deducts from the matching source.
 */
async function postShipment (cols, number, shipmentNumber, params) {
  const order = await mustExist(cols, number)
  const shipment = order.shipments.find((s) => s.number === shipmentNumber)
  if (!shipment) throw notFound(`Shipment ${shipmentNumber} on sales order ${number}`)
  if (shipment.status === 'posted') throw badRequest(`Shipment ${shipmentNumber} was posted on ${dayOf(shipment.postedAt)}.`)
  refuseIfCancelled(order)
  // Another shipment may have been posted since this one was created.
  const lines = order.lines.map((line) => ({ ...line }))
  for (const l of shipment.lines) {
    const line = lines.find((x) => x.item === l.item)
    const open = openQty(line)
    if (l.qty > open) throw badRequest(`Item ${l.item}: ${open} ${await unitOf(cols, line.sku)} remain of ${line.qty}.`)
    line.shippedQty += l.qty
  }
  const at = stamp()
  const posted = { ...shipment, status: 'posted', postedAt: at }
  const next = await save(cols, {
    ...order,
    lines,
    shipments: order.shipments.map((s) => (s.number === shipmentNumber ? posted : s)),
    history: [...order.history, { status: 'shipped', at, shipment: shipmentNumber }]
  })
  await emit(cols, 'order.shipped', {
    ...orderEventPayload(next),
    items: posted.lines.filter((l) => l.commerceItemId).map((l) => ({ orderItemId: Number(l.commerceItemId), qty: l.qty, sku: l.sku })),
    stockSourceCode: posted.warehouse
  }, params)
  return next
}

/**
 * Give up on what remains unshipped of one line, with a reason, so a short-shipped order
 * can still be invoiced. Commerce hears nothing: it will invoice the order as placed,
 * which is what the ERP's invoice mirrors (see createInvoice).
 */
async function closeRemaining (cols, number, item, reason, params) {
  const order = await mustExist(cols, number)
  if (!CLOSE_REASONS.includes(reason)) throw badRequest(`closing a line needs one of these reasons: ${CLOSE_REASONS.join(', ')}`)
  refuseIfCancelled(order)
  if (order.header !== 'confirmed') throw badRequest('Confirm the order first.')
  if (order.invoice) throw badRequest(`This order was invoiced (${order.invoice.number || 'in Commerce'}).`)
  const line = order.lines.find((l) => l.item === Number(item))
  if (!line) throw badRequest(`Item ${item} is not on this order.`)
  const open = openQty(line)
  if (open === 0) throw badRequest(`Item ${item} has nothing open.`)
  const lines = order.lines.map((l) => (l.item === line.item ? { ...l, closedQty: l.closedQty + open, closeReason: reason, closedAt: stamp() } : l))
  return save(cols, { ...order, lines })
}

/**
 * Create the invoice: one, for the whole order, once every line is shipped or closed.
 * Its lines are the order's as placed — that is what Commerce invoices (`capture: true`,
 * no items), and an ERP invoice that disagreed with Commerce's would be the wrong kind
 * of realism. A closed line therefore still bills; the order says why it was closed.
 */
async function createInvoice (cols, number, params) {
  const order = await mustExist(cols, number)
  if (order.invoice) throw badRequest(`This order is already invoiced (${order.invoice.number || 'in Commerce'}).`)
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
    lines: order.lines.map((l) => ({ item: l.item, sku: l.sku, qty: l.qty, price: l.price, amount: orders.cents(l.qty * l.price) })),
    net,
    tax: orders.cents(total - net),
    total,
    shipments: order.shipments.filter((s) => s.status === 'posted').map((s) => s.number)
  }
  const next = await save(cols, { ...order, invoice, history: [...order.history, { status: 'invoiced', at, invoice: invoice.number }] })
  await emit(cols, 'order.invoiced', orderEventPayload(next), params)
  return next
}

/**
 * Release a credit hold: the order may proceed. SAP's own verb; the decision is recorded
 * with its time, and raising the limit never does this by itself.
 */
async function releaseCredit (cols, number, params) {
  const order = await mustExist(cols, number)
  refuseIfCancelled(order)
  if (order.creditStatus !== 'held') throw badRequest('This order is not on credit hold.')
  const at = stamp()
  const next = await save(cols, {
    ...order,
    creditStatus: 'released',
    creditDecidedAt: at,
    history: [...order.history, { status: 'released', at }]
  })
  // The same event that put the Commerce order On Hold takes it off.
  await emit(cols, 'order.hold', { ...orderEventPayload(next), held: false, reason: null }, params)
  return next
}

/** Reject a credit hold: the order is cancelled, with the reason Commerce hears. */
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
  if (status === 'cancelled') return cancelOrder(cols, number, options.reason, params)
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

/** The warehouse a shipment named, with its name from whichever product knows it. */
function warehouseOf (code, products) {
  if (!code) return null
  for (const product of products.values()) {
    const match = (product.warehouses || []).find((w) => w.code === code)
    if (match) return { code, name: match.name }
  }
  return { code, name: code }
}

/** A shipment as its document shows it: the order named, each line with its product. */
async function describeShipment (cols, order, shipment) {
  const products = await productsFor(cols, shipment.lines.map((l) => l.sku))
  const partner = order.partnerId ? await cols.businessPartners.findOne({ _id: order.partnerId }) : null
  return {
    ...shipment,
    orderNumber: order.number,
    commerceIncrementId: order.commerceIncrementId,
    partner: partner ? { id: partner.id, name: partner.name } : null,
    warehouse: warehouseOf(shipment.warehouse, products),
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
  const products = await productsFor(cols, (invoice.lines || []).map((l) => l.sku))
  const partner = order.partnerId ? await cols.businessPartners.findOne({ _id: order.partnerId }) : null
  return {
    ...invoice,
    orderNumber: order.number,
    commerceIncrementId: order.commerceIncrementId,
    currency: order.currency,
    partner: partner ? { id: partner.id, name: partner.name, paymentTerms: partner.paymentTerms } : null,
    lines: (invoice.lines || []).map((l) => {
      const product = products.get(l.sku)
      return { ...l, name: product ? product.name : l.sku, unit: product && product.unit ? product.unit : 'EA' }
    })
  }
}

/** Every invoice, newest number first. A legacy invoice (no number) is listed as such. */
async function listInvoices (cols) {
  const rows = []
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
      total: order.invoice.total ?? order.total
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
  CLOSE_REASONS, FIRST,
  confirmOrder, cancelOrder, createShipment, postShipment, closeRemaining, createInvoice, setStatus,
  releaseCredit, rejectCredit,
  describeShipment, listShipments, getShipment, describeInvoice, listInvoices, getInvoice
}
