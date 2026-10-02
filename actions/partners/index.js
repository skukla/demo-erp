/*
 * GET   partners                 the list, each with `exposure` and `available` (null for a customer with no credit)
 * GET   partners/:id             one customer as its document shows it (lib/partners describePartner)
 * POST  partners/:id/credit-check { net, currency? }   the live credit check at placement (AB-19/AB-20):
 *                                whether the customer can carry this amount NOW, without creating anything
 * PATCH partners/:id             { creditLimit?, blocking?, paymentTerms?, priceGroup? } — blocking is open · shipping · invoicing · all;
 *                                priceGroup is a customer price group's code, or null for none
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listPartners, getPartner, patchPartner, describePartner, withCredit, creditStanding } = require('../../lib/partners')
const { assessCredit } = require('../../lib/credit')

async function handler ({ cols, method, segments, body, params }) {
  const id = segments[0] || null
  if (method === 'GET' && !id) return ok({ items: await withCredit(cols, await listPartners(cols)) })
  if (method === 'GET') {
    const partner = await getPartner(cols, id)
    if (!partner) throw notFound(`Customer ${id}`)
    return ok(await describePartner(cols, partner))
  }
  // Live credit check (AB-20): the ERP owns the limit, so checkout asks it as the order is
  // placed. Read-only — it reads the partner's current exposure and answers, creating nothing,
  // so the web shop can refuse before committing (createOrder instead creates and holds, §6.1).
  if (method === 'POST' && id && segments[1] === 'credit-check') {
    const partner = await getPartner(cols, id)
    if (!partner) throw notFound(`Customer ${id}`)
    return ok(assessCredit({ partner, ...await creditStanding(cols, partner), net: body && body.net, currency: (body && body.currency) || 'USD' }))
  }
  if ((method === 'PATCH' || method === 'POST') && id) {
    const partner = await patchPartner(cols, id, body, params)
    if (!partner) throw notFound(`Customer ${id}`)
    return ok(partner)
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
