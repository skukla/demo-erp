/*
 * Sales orders. Created by the integration when Commerce places an order; moved
 * through their statuses from the ERP's screen, each move an ERP event.
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { next: nextCounter, formatOrderNumber } = require('./counters')
const { emit } = require('./events')
const { resolvePartner } = require('./partners')

/* Every ERP numbers document lines in tens, so a line can be inserted between two
   without renumbering the rest. Ours are derived rather than stored: nothing here
   inserts a line, and a stored number that drifts from the order is worse than none. */
const LINE_STEP = 10

const STATUSES = ['created', 'confirmed', 'shipped', 'invoiced', 'cancelled']
const TRANSITIONS = {
  created: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['invoiced'],
  invoiced: [],
  cancelled: []
}

/** The statuses an order may move to from where it is. */
function nextStatuses (status) {
  return TRANSITIONS[status] || []
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
  if (existing) return existing
  const partner = await resolvePartner(cols, input)
  const number = formatOrderNumber(await nextCounter(cols, 'salesOrder', 1000))
  const lines = (input.lines || []).map((l) => ({ sku: l.sku, qty: Number(l.qty) || 1, price: Number(l.price) || 0, commerceItemId: l.commerceItemId ?? null }))
  const order = {
    _id: number,
    number,
    commerceOrderId: String(input.commerceOrderId),
    commerceIncrementId: input.commerceIncrementId ? String(input.commerceIncrementId) : null,
    partnerId: partner ? partner.id : null,
    lines,
    currency: input.currency || 'USD',
    total: Number(input.total ?? lines.reduce((s, l) => s + l.qty * l.price, 0)),
    status: 'created',
    history: [{ status: 'created', at: new Date().toISOString() }],
    createdAt: new Date().toISOString()
  }
  await cols.salesOrders.replaceOne({ _id: number }, order, { upsert: true })
  return order
}

function listOrders (cols, options = {}) {
  return findAll(cols.salesOrders, {}, { limit: options.limit ?? 500, sort: { _id: -1 } })
}

function getOrder (cols, number) {
  return cols.salesOrders.findOne({ _id: number })
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

/**
 * Move an order to a new status. Refuses a move the machine does not allow; raises the
 * ERP event for that status (status update, shipment, invoice, cancel).
 *
 * @param {object} cols collections
 * @param {string} number the ERP order number
 * @param {string} status where it is going
 * @param {object} [params] the action params, for the event
 * @param {object} [options] `reason` — required to cancel, and one of CANCEL_REASONS
 * @returns {Promise<object>} the order after the move
 */
async function setStatus (cols, number, status, params, options = {}) {
  const order = await cols.salesOrders.findOne({ _id: number })
  if (!order) return null
  if (!STATUSES.includes(status)) throw badRequest(`status must be one of ${STATUSES.join(', ')}`)
  if (!nextStatuses(order.status).includes(status)) {
    throw badRequest(`an order in status "${order.status}" cannot move to "${status}"`)
  }
  // Cancelling is the one move that cannot be undone here, and the one an audience asks
  // about, so it is the one that has to say why.
  const reason = status === 'cancelled' ? options.reason : undefined
  if (status === 'cancelled' && !CANCEL_REASONS.includes(reason)) {
    throw badRequest(`a cancellation needs one of these reasons: ${CANCEL_REASONS.join(', ')}`)
  }
  const at = new Date().toISOString()
  const next = {
    ...order,
    status,
    ...(reason ? { cancelReason: reason } : {}),
    history: [...(order.history || []), { status, at, ...(reason ? { reason } : {}) }]
  }
  await cols.salesOrders.replaceOne({ _id: number }, next, { upsert: true })
  await emit(cols, `order.${status}`, orderEventPayload(next), params)
  return next
}

/** Money, to the cent: a sum of qty x price otherwise carries its own float dust. */
const cents = (value) => Math.round(value * 100) / 100

/**
 * An order as its own document shows it, which is more than the record holds: the
 * customer named rather than referenced, each line numbered and carrying the product's
 * description and base unit, and the three money figures a sales order header carries.
 *
 * Net is the sum of the lines. Total is what Commerce charged, which includes tax. The
 * ERP does not calculate tax — it reports the difference between the two and says so on
 * screen. Inventing a tax rate here would be a number nobody could check.
 *
 * @param {object} cols collections
 * @param {object} order the stored order
 * @returns {Promise<object>} the order, plus `partner`, `nextStatuses`, `net`, `tax` and
 *   `cancelReasons`
 */
async function describeOrder (cols, order) {
  const partner = order.partnerId
    ? await cols.businessPartners.findOne({ _id: order.partnerId })
    : null
  const lines = []
  for (const [index, line] of (order.lines || []).entries()) {
    // biome-ignore lint/performance/noAwaitInLoops: one product per line, in line order
    const product = await cols.products.findOne({ _id: line.sku })
    lines.push({
      ...line,
      item: (index + 1) * LINE_STEP,
      name: product ? product.name : line.sku,
      unit: product && product.unit ? product.unit : 'EA',
      amount: cents(line.qty * line.price)
    })
  }
  const canCancel = nextStatuses(order.status).includes('cancelled')
  const net = cents(lines.reduce((sum, l) => sum + l.amount, 0))
  const total = cents(Number(order.total ?? net))
  return {
    ...order,
    lines,
    nextStatuses: nextStatuses(order.status),
    partner: partner
      ? { id: partner.id, name: partner.name, paymentTerms: partner.paymentTerms, salesOrg: partner.salesOrg }
      : null,
    net,
    tax: cents(total - net),
    total,
    // The reasons the screen offers, from the ERP's own list rather than a second copy
    // of it written on the screen. Empty when this order can no longer be cancelled.
    cancelReasons: canCancel ? CANCEL_REASONS : []
  }
}

/** The payload every order event carries: the Commerce order, its lines, the ERP number. */
function orderEventPayload (order) {
  return {
    id: Number(order.commerceOrderId),
    orderId: Number(order.commerceOrderId),
    incrementId: order.commerceIncrementId,
    erpNumber: order.number,
    status: order.status,
    items: (order.lines || []).filter((l) => l.commerceItemId).map((l) => ({ orderItemId: Number(l.commerceItemId), qty: l.qty, sku: l.sku })),
    notifyCustomer: false
  }
}

module.exports = { STATUSES, TRANSITIONS, CANCEL_REASONS, nextStatuses, createOrder, listOrders, getOrder, describeOrder, setStatus, orderEventPayload }
