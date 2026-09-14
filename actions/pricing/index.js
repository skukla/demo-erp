/*
 * GET  pricing                 the pricing conditions
 * POST pricing                 create or replace a condition
 * DELETE pricing/:id           remove one
 * POST pricing/quote           { partnerId?, commerceCompanyId?, customerGroupId?, lines:[{sku, qty}] }
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { badRequest } = require('../../lib/errors')
const { listConditions, upsertCondition, deleteCondition } = require('../../lib/conditions')
const { listMaterials } = require('../../lib/materials')
const { resolvePartner } = require('../../lib/partners')
const { quote } = require('../../lib/pricing')

async function handler ({ cols, method, segments, body }) {
  if (method === 'GET' && segments.length === 0) return ok({ items: await listConditions(cols) })
  if (method === 'POST' && segments[0] === 'quote') {
    if (!Array.isArray(body.lines) || body.lines.length === 0) throw badRequest('quote needs a non-empty lines array')
    const [materials, partner, conditions] = await Promise.all([
      listMaterials(cols), resolvePartner(cols, body), listConditions(cols)
    ])
    return ok(quote({ materials, partner, conditions, lines: body.lines }))
  }
  if (method === 'POST' && segments.length === 0) return ok(await upsertCondition(cols, body), 201)
  if (method === 'DELETE' && segments[0]) return ok({ deleted: await deleteCondition(cols, segments[0]) })
}

exports.handler = handler
exports.main = (params) => run(params, handler)
