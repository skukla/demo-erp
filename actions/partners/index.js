/* GET partners; GET partners/:id; PATCH partners/:id { creditLimit?, blocked?, paymentTerms? } */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listPartners, getPartner, patchPartner } = require('../../lib/partners')

async function handler ({ cols, method, segments, body }) {
  const id = segments[0] || null
  if (method === 'GET' && !id) return ok({ items: await listPartners(cols) })
  if (method === 'GET') {
    const partner = await getPartner(cols, id)
    if (!partner) throw notFound(`Business partner ${id}`)
    return ok(partner)
  }
  if ((method === 'PATCH' || method === 'POST') && id) {
    const partner = await patchPartner(cols, id, body)
    if (!partner) throw notFound(`Business partner ${id}`)
    return ok(partner)
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
