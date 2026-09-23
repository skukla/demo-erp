/*
 * GET  orders                       list, newest first, each row naming its customer
 * GET  orders/:number               one order as its document shows it (lib/orders describeOrder)
 * POST orders                       create from a Commerce order (idempotent on commerceOrderId;
 *                                   `origin: { event }` journals it the first time)
 * POST orders/:number/status        { status, reason? } move it; cancelling needs a reason
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound, badRequest } = require('../../lib/errors')
const { createOrder, listOrders, getOrder, describeOrder, setStatus } = require('../../lib/orders')
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
  if (method === 'POST' && segments[1] === 'status') {
    if (!body.status) throw badRequest('status is required')
    const order = await setStatus(cols, number, body.status, params, { reason: body.reason })
    if (!order) throw notFound(`Sales order ${number}`)
    return ok(await describeOrder(cols, order))
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
