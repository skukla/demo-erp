/*
 * GET  returns                        every return order, newest first, each naming its sold-to (`partnerName`)
 * GET  returns/:number                one return order
 * POST returns                        { customerReturnReference, orderNumber,
 *                                     lines:[{ customerLineReference, qty, reason? }], origin? } make a return
 *                                     order from a customer's return (idempotent on customerReturnReference:
 *                                     201 the first time, 200 with the same return after)
 * POST returns/:number/receive        the goods are back: stock up, CustomerReturn.Changed raised
 * POST returns/:number/credit-memo    credit the received lines (201): BillingDocument.Created raised
 *
 * The rules live in lib/returns; a refusal answers 400 in words.
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { createReturn, listReturns, getReturn, receiveReturn, creditReturn } = require('../../lib/returns')
const { listPartners } = require('../../lib/partners')

/** The list rows, each naming its sold-to, as the credit memo list does. */
async function listRows (cols) {
  const [rows, partners] = await Promise.all([listReturns(cols), listPartners(cols)])
  const names = new Map(partners.map((p) => [p.id, p.name]))
  return rows.map((r) => ({ ...r, partnerName: names.get(r.partnerId) || null }))
}

async function handler ({ cols, method, segments, body, params }) {
  const [number, verb] = segments
  if (method === 'GET' && !number) return ok({ items: await listRows(cols) })
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
