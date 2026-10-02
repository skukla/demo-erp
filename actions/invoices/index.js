/*
 * GET invoices           every invoice, newest number first, each naming its sales order and its sold-to (`partnerName`)
 * GET invoices/:number   one invoice as its document shows it, with what is still open on it
 * POST invoices/:number/payments { amount, reference? }   post an incoming payment against it (201,
 *                        contract version 14): more than 0 and at most the open amount; IncomingPayment.Posted raised
 *
 * An invoice is created on its order; a refusal answers 400 in words (lib/payments).
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listInvoices, getInvoice } = require('../../lib/fulfilment')
const { listPartners } = require('../../lib/partners')
const { postPayment } = require('../../lib/payments')

/** The list rows, each naming its sold-to. */
async function listRows (cols) {
  const [rows, partners] = await Promise.all([listInvoices(cols), listPartners(cols)])
  const names = new Map(partners.map((p) => [p.id, p.name]))
  return rows.map((i) => ({ ...i, partnerName: names.get(i.partnerId) || null }))
}

async function handler ({ cols, method, segments, body, params }) {
  const [number, verb] = segments
  if (method === 'GET' && !number) return ok({ items: await listRows(cols) })
  if (method === 'GET' && !verb) {
    const invoice = await getInvoice(cols, number)
    if (!invoice) throw notFound(`Invoice ${number}`)
    return ok(invoice)
  }
  if (method === 'POST' && verb === 'payments' && segments.length === 2) return ok(await postPayment(cols, number, body || {}, params), 201)
  return undefined
}

exports.handler = handler
exports.main = (params) => run(params, handler)
