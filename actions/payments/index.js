/*
 * GET payments           every incoming payment, newest number first, each naming its sold-to (`partnerName`)
 * GET payments/:number   one payment as its document shows it (contract payments.response)
 *
 * Read-only, as actions/credit-memos is: a payment is posted on its invoice
 * (POST invoices/:number/payments).
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listPayments, getPayment } = require('../../lib/payments')
const { listPartners } = require('../../lib/partners')

/** The list rows, each naming its sold-to. */
async function listRows (cols) {
  const [rows, partners] = await Promise.all([listPayments(cols), listPartners(cols)])
  const names = new Map(partners.map((p) => [p.id, p.name]))
  return rows.map((p) => ({ ...p, partnerName: names.get(p.partnerId) || null }))
}

async function handler ({ cols, method, segments }) {
  const number = segments[0] || null
  if (method === 'GET' && !number) return ok({ items: await listRows(cols) })
  if (method === 'GET' && segments.length === 1) {
    const payment = await getPayment(cols, number)
    if (!payment) throw notFound(`Payment ${number}`)
    return ok(payment)
  }
  return undefined
}

exports.handler = handler
exports.main = (params) => run(params, handler)
