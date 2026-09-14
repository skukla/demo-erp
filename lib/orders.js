/*
 * Sales orders. Created by the integration when Commerce places an order; moved
 * through their statuses from the ERP's screen, each move an ERP event.
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { next: nextCounter, formatOrderNumber } = require('./counters')
const { emit } = require('./events')
const { resolvePartner } = require('./partners')

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

/**
 * Move an order to a new status. Refuses a move the machine does not allow; raises the
 * ERP event for that status (status update, shipment, invoice, cancel).
 *
 * @returns {Promise<object>} the order after the move
 */
async function setStatus (cols, number, status, params) {
  const order = await cols.salesOrders.findOne({ _id: number })
  if (!order) return null
  if (!STATUSES.includes(status)) throw badRequest(`status must be one of ${STATUSES.join(', ')}`)
  if (!nextStatuses(order.status).includes(status)) {
    throw badRequest(`an order in status "${order.status}" cannot move to "${status}"`)
  }
  const at = new Date().toISOString()
  const next = { ...order, status, history: [...(order.history || []), { status, at }] }
  await cols.salesOrders.replaceOne({ _id: number }, next, { upsert: true })
  await emit(cols, `order.${status}`, orderEventPayload(next), params)
  return next
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

module.exports = { STATUSES, TRANSITIONS, nextStatuses, createOrder, listOrders, getOrder, setStatus, orderEventPayload }
