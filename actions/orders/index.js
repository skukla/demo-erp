/*
 * GET  orders                                   list, newest first, each row naming its customer
 * GET  orders/:number                           one order as its document shows it (lib/orders describeOrder)
 * POST orders                                   create from a Commerce order (idempotent on commerceOrderId;
 *                                               `origin: { event }` journals it the first time)
 * POST orders/:number/confirm                   confirm it
 * POST orders/:number/cancel                    { reason } cancel it; the reason is one of CANCEL_REASONS
 * POST orders/:number/shipments                 { lines:[{item, qty}], warehouse? } create an open shipment (201)
 * POST orders/:number/shipments/:shipment/post  post it: the goods leave, the shipment event goes out
 * POST orders/:number/lines/:item/close         { reason } give up on what is still open on a line
 * POST orders/:number/invoice                   invoice the whole order, once every line is shipped or closed (201)
 * POST orders/:number/credit/release            let a held order proceed
 * POST orders/:number/credit/reject             cancel a held order, reason "Credit rejected"
 * POST orders/:number/status                    { status, reason? } the whole-order move, for a caller that
 *                                               knows nothing of shipments; predates them and stays
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound, badRequest } = require('../../lib/errors')
const { createOrder, listOrders, getOrder, describeOrder } = require('../../lib/orders')
const { confirmOrder, cancelOrder, createShipment, postShipment, closeRemaining, createInvoice, setStatus, releaseCredit, rejectCredit } = require('../../lib/fulfilment')
const { listPartners } = require('../../lib/partners')
const { journalOrder } = require('../../lib/inbound')

/**
 * The list, with each order's customer NAMED. The customers are read once and matched
 * here rather than one lookup per row: a demo store has a handful of accounts and up to
 * 500 orders, so the other way round is 500 reads to answer one screen.
 */
async function listRows (cols) {
  const orders = await listOrders(cols)
  const names = new Map((await listPartners(cols)).map((p) => [p.id, p.name]))
  return orders.map((o) => ({ ...o, partnerName: names.get(o.partnerId) || null }))
}

/** The moves on one order, by the path segment after its number. Each answers the document. */
async function move (cols, number, segments, body, params) {
  const [, verb, id, action] = segments
  if (verb === 'confirm') return confirmOrder(cols, number, params)
  if (verb === 'cancel') return cancelOrder(cols, number, body.reason, params)
  if (verb === 'invoice') return createInvoice(cols, number, params)
  if (verb === 'shipments' && !id) return createShipment(cols, number, body, params)
  if (verb === 'shipments' && id && action === 'post') return postShipment(cols, number, id, params)
  if (verb === 'lines' && id && action === 'close') return closeRemaining(cols, number, id, body.reason, params)
  if (verb === 'credit' && id === 'release') return releaseCredit(cols, number, params)
  if (verb === 'credit' && id === 'reject') return rejectCredit(cols, number, params)
  if (verb === 'status') {
    if (!body.status) throw badRequest('status is required')
    const order = await setStatus(cols, number, body.status, params, { reason: body.reason })
    if (!order) throw notFound(`Sales order ${number}`)
    return order
  }
  return undefined
}

/** The moves that make a document answer 201. */
const CREATES = new Set(['shipments', 'invoice'])

async function handler ({ cols, method, segments, body, params }) {
  const number = segments[0] || null
  if (method === 'GET' && !number) return ok({ items: await listRows(cols) })
  if (method === 'GET') {
    const order = await getOrder(cols, number)
    if (!order) throw notFound(`Sales order ${number}`)
    return ok(await describeOrder(cols, order))
  }
  if (method === 'POST' && !number) {
    const existed = await cols.salesOrders.findOne({ commerceOrderId: String(body.commerceOrderId || '') })
    const order = await createOrder(cols, body)
    // Journaled the first time only: a redelivered event is the same order.
    if (!existed) await journalOrder(cols, body, order)
    return ok(order, existed ? 200 : 201)
  }
  if (method === 'POST' && segments[1]) {
    const order = await move(cols, number, segments, body || {}, params)
    if (order === undefined) return undefined
    const created = CREATES.has(segments[1]) && segments.length === 2
    return ok(await describeOrder(cols, order), created ? 201 : 200)
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
