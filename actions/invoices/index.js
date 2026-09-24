/*
 * GET invoices           every invoice, newest number first, each naming its sales order and its sold-to (`partnerName`)
 * GET invoices/:number   one invoice as its document shows it
 *
 * Read-only, as actions/shipments is: an invoice is created on its order.
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listInvoices, getInvoice } = require('../../lib/fulfilment')
const { listPartners } = require('../../lib/partners')

/** The list rows, each naming its sold-to. */
async function listRows (cols) {
  const [rows, partners] = await Promise.all([listInvoices(cols), listPartners(cols)])
  const names = new Map(partners.map((p) => [p.id, p.name]))
  return rows.map((i) => ({ ...i, partnerName: names.get(i.partnerId) || null }))
}

async function handler ({ cols, method, segments }) {
  const number = segments[0] || null
  if (method === 'GET' && !number) return ok({ items: await listRows(cols) })
  if (method === 'GET') {
    const invoice = await getInvoice(cols, number)
    if (!invoice) throw notFound(`Invoice ${number}`)
    return ok(invoice)
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
