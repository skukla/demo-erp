/*
 * GET invoices           every invoice, newest number first, each naming its sales order
 * GET invoices/:number   one invoice as its document shows it
 *
 * Read-only, as actions/shipments is: an invoice is created on its order.
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listInvoices, getInvoice } = require('../../lib/fulfilment')

async function handler ({ cols, method, segments }) {
  const number = segments[0] || null
  if (method === 'GET' && !number) return ok({ items: await listInvoices(cols) })
  if (method === 'GET') {
    const invoice = await getInvoice(cols, number)
    if (!invoice) throw notFound(`Invoice ${number}`)
    return ok(invoice)
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
