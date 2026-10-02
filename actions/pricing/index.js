/*
 * GET  pricing                 the pricing conditions
 * POST pricing                 create or replace a condition
 * DELETE pricing/:id           remove one
 *                              a create, change or delete raises PriceList.Changed for each customer whose
 *                              prices in force it moved (lib/conditions)
 * POST pricing/quote           { partnerId?, lines:[{sku, qty}], date?, salesOrg? }
 *                              date (YYYY-MM-DD) is the day priced on — today when absent; salesOrg scopes
 *                              the conditions to one sales organisation (a condition with none applies to all);
 *                              the customer's price lists in force come first, then its price group's (lib/pricing)
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { badRequest } = require('../../lib/errors')
const { listConditions, upsertCondition, deleteCondition } = require('../../lib/conditions')
const { listProducts } = require('../../lib/products')
const { resolvePartner } = require('../../lib/partners')
const { quote, today } = require('../../lib/pricing')
const { listContracts } = require('../../lib/contracts')

async function handler ({ cols, method, segments, body, settings, params }) {
  if (method === 'GET' && segments.length === 0) return ok({ items: await listConditions(cols) })
  if (method === 'POST' && segments[0] === 'quote') {
    if (!Array.isArray(body.lines) || body.lines.length === 0) throw badRequest('quote needs a non-empty lines array')
    const [products, partner, conditions] = await Promise.all([
      listProducts(cols), resolvePartner(cols, body), listConditions(cols)
    ])
    // The customer's own price lists and its price group's; lib/pricing decides between them.
    const contracts = partner
      ? [...await listContracts(cols, { partnerId: partner.id }), ...(partner.priceGroup ? await listContracts(cols, { priceGroup: partner.priceGroup }) : [])]
      : []
    const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : undefined
    const salesOrg = typeof body.salesOrg === 'string' && body.salesOrg.trim() ? body.salesOrg.trim() : undefined
    return ok(quote({ products, partner, conditions, contracts, lines: body.lines, date: date ?? today(settings?.timeZone), salesOrg }))
  }
  if (method === 'POST' && segments.length === 0) return ok(await upsertCondition(cols, body, params), 201)
  if (method === 'DELETE' && segments[0]) return ok({ deleted: await deleteCondition(cols, segments[0], params) })
}

exports.handler = handler
exports.main = (params) => run(params, handler)
