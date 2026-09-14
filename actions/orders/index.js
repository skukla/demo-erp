/*
 * GET  orders                       list, newest first
 * GET  orders/:number               one order
 * POST orders                       create from a Commerce order (idempotent on commerceOrderId)
 * POST orders/:number/status        { status } move it
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound, badRequest } = require('../../lib/errors')
const { createOrder, listOrders, getOrder, setStatus, nextStatuses } = require('../../lib/orders')

async function handler ({ cols, method, segments, body, params }) {
  const number = segments[0] || null
  if (method === 'GET' && !number) return ok({ items: await listOrders(cols) })
  if (method === 'GET') {
    const order = await getOrder(cols, number)
    if (!order) throw notFound(`Sales order ${number}`)
    return ok({ ...order, nextStatuses: nextStatuses(order.status) })
  }
  if (method === 'POST' && !number) {
    const existed = await cols.salesOrders.findOne({ commerceOrderId: String(body.commerceOrderId || '') })
    const order = await createOrder(cols, body)
    return ok(order, existed ? 200 : 201)
  }
  if (method === 'POST' && segments[1] === 'status') {
    if (!body.status) throw badRequest('status is required')
    const order = await setStatus(cols, number, body.status, params)
    if (!order) throw notFound(`Sales order ${number}`)
    return ok({ ...order, nextStatuses: nextStatuses(order.status) })
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
