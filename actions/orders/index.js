/*
 * GET  orders                                   list, newest first, each row naming its customer
 * GET  orders?reference=<customer reference>    only the orders carrying that reference (the buyer's
 *                                               order number); SAP filters PurchaseOrderByCustomer, Business
 *                                               Central externalDocumentNumber
 * GET  orders/:number                           one order as its document shows it (lib/orders describeOrder)
 * POST orders                                   create from a customer's order (idempotent on purchaseOrderByCustomer;
 *                                               `origin: { system, document? }` journals it the first time)
 * POST orders/:number/confirm                   confirm it
 * POST orders/:number/cancel                    { reason } cancel it; the reason is one of CANCEL_REASONS
 * POST orders/:number/shipments                 { lines:[{item, qty}], warehouse? } create an open shipment (201)
 * POST orders/:number/shipments/:shipment/post  post it: the goods leave, the shipment event goes out
 * POST orders/:number/lines/:item/close         { reason } give up on what is still open on a line
 * POST orders/:number/invoice                   invoice the whole order, once every line is shipped or closed (201)
 * POST orders/:number/credit-memo               credit the whole invoice, once (201; lib/credit-memos)
 * POST orders/:number/credit/release            let a held order proceed
 * POST orders/:number/credit/reject             cancel a held order, reason "Credit rejected"
 * POST orders/:number/credit/hold               { reason?, origin }  an order put On Hold in the web shop is held here too
 *
 * A move made in another system (the web shop) carries `origin: { system, document?, eventId? }`:
 * the ERP records it, journals it as received, and raises no outbound event for it (that
 * system already has it):
 * POST orders/:number/external-shipment         { externalReference, lines:[{ customerLineReference, qty }], warehouse?, origin }
 * POST orders/:number/external-invoice          { externalReference?, origin }
 * POST orders/:number/cancel                    { reason: "Canceled in the web shop", origin }
 * POST orders/:number/credit/release            { origin }
 * POST orders/:number/status                    { status, reason? } the whole-order move, for a caller that
 *                                               knows nothing of shipments; predates them and stays
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound, badRequest } = require('../../lib/errors')
const { createOrder, findByReference, listOrders, getOrder, describeOrder, shippingStatus, billingStatus, overallStatus } = require('../../lib/orders')
const { confirmOrder, cancelOrder, createShipment, postShipment, closeRemaining, createInvoice, setStatus, releaseCredit, rejectCredit, receiveExternalShipment, holdExternal } = require('../../lib/fulfilment')
const { creditInvoice } = require('../../lib/credit-memos')
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
  // The two derived states and the overall word, so a row says where the order stands
  // without being opened (UI audit §Sales Orders).
  return orders.map((o) => ({ ...o, partnerName: names.get(o.partnerId) || null, shippingStatus: shippingStatus(o), billingStatus: billingStatus(o), overall: overallStatus(o) }))
}

/** The customer's reference an order carries: the buyer's own order number. */
function referenceOf (order) {
  return String(order.purchaseOrderByCustomer || '')
}

/** The moves on one order, by the path segment after its number. Each answers the document. */
async function move (cols, number, segments, body, params) {
  const [, verb, id, action] = segments
  const origin = body.origin ? { origin: body.origin } : {}
  if (verb === 'confirm') return confirmOrder(cols, number, params)
  if (verb === 'cancel') return cancelOrder(cols, number, body.reason, params, origin)
  if (verb === 'invoice') return createInvoice(cols, number, params)
  if (verb === 'credit-memo') return creditInvoice(cols, number, params)
  if (verb === 'external-shipment') return receiveExternalShipment(cols, number, body, params)
  if (verb === 'external-invoice') return createInvoice(cols, number, params, { ...origin, externalReference: body.externalReference })
  if (verb === 'shipments' && !id) return createShipment(cols, number, body, params)
  if (verb === 'shipments' && id && action === 'post') return postShipment(cols, number, id, params)
  if (verb === 'lines' && id && action === 'close') return closeRemaining(cols, number, id, body.reason, params)
  if (verb === 'credit' && id === 'release') return releaseCredit(cols, number, params, origin)
  if (verb === 'credit' && id === 'reject') return rejectCredit(cols, number, params)
  if (verb === 'credit' && id === 'hold') return holdExternal(cols, number, params, { ...origin, reason: body.reason })
  if (verb === 'status') {
    if (!body.status) throw badRequest('status is required')
    const order = await setStatus(cols, number, body.status, params, { reason: body.reason })
    if (!order) throw notFound(`Sales order ${number}`)
    return order
  }
  return undefined
}

/** The moves that make a document answer 201. */
const CREATES = new Set(['shipments', 'invoice', 'external-shipment', 'external-invoice', 'credit-memo'])

async function handler ({ cols, method, segments, body, params }) {
  const number = segments[0] || null
  if (method === 'GET' && !number) {
    const rows = await listRows(cols)
    const ref = typeof params?.reference === 'string' ? params.reference.trim() : ''
    return ok({ items: ref ? rows.filter((o) => referenceOf(o) === ref) : rows })
  }
  if (method === 'GET') {
    const order = await getOrder(cols, number)
    if (!order) throw notFound(`Sales order ${number}`)
    return ok(await describeOrder(cols, order))
  }
  if (method === 'POST' && !number) {
    const reference = body && body.purchaseOrderByCustomer !== undefined && body.purchaseOrderByCustomer !== null ? String(body.purchaseOrderByCustomer).trim() : ''
    const existed = reference ? await findByReference(cols, reference) : null
    const order = await createOrder(cols, body, params)
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
