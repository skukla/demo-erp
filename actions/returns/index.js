/*
 * GET  returns                        every return order, newest first
 * GET  returns/:number                one return order
 * POST returns                        { commerceReturnId, commerceReturnIncrementId?, orderNumber,
 *                                     lines:[{ commerceItemId, qty, reason? }], origin? } make a return
 *                                     order from a Commerce return (idempotent on commerceReturnId:
 *                                     201 the first time, 200 with the same return after)
 * POST returns/:number/receive        the goods are back: stock up, return.received raised
 * POST returns/:number/credit-memo    credit the received lines (201): creditmemo.created raised
 *
 * The rules live in lib/returns; a refusal answers 400 in words.
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { createReturn, listReturns, getReturn, receiveReturn, creditReturn } = require('../../lib/returns')

async function handler ({ cols, method, segments, body, params }) {
  const [number, verb] = segments
  if (method === 'GET' && !number) return ok({ items: await listReturns(cols) })
  if (method === 'GET' && !verb) {
    const found = await getReturn(cols, number)
    if (!found) throw notFound(`Return order ${number}`)
    return ok(found)
  }
  if (method === 'POST' && !number) {
    const { returnOrder, created } = await createReturn(cols, body || {})
    return ok(returnOrder, created ? 201 : 200)
  }
  if (method === 'POST' && verb === 'receive' && segments.length === 2) return ok(await receiveReturn(cols, number, params))
  if (method === 'POST' && verb === 'credit-memo' && segments.length === 2) return ok(await creditReturn(cols, number, params), 201)
  return undefined
}

exports.handler = handler
exports.main = (params) => run(params, handler)
