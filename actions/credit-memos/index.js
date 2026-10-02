/*
 * GET credit-memos           every credit memo, newest number first, each naming its sales order,
 *                            its invoice, the return order it credits (or null) and its sold-to (`partnerName`)
 * GET credit-memos/:number   one credit memo as its document shows it
 *
 * Read-only, as actions/invoices is: a credit memo is created on its order
 * (POST orders/:number/credit-memo) or on its return order (POST returns/:number/credit-memo).
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { listCreditMemos, getCreditMemo } = require('../../lib/credit-memos')
const { listPartners } = require('../../lib/partners')

/** The list rows, each naming its sold-to. */
async function listRows (cols) {
  const [rows, partners] = await Promise.all([listCreditMemos(cols), listPartners(cols)])
  const names = new Map(partners.map((p) => [p.id, p.name]))
  return rows.map((m) => ({ ...m, partnerName: names.get(m.partnerId) || null }))
}

async function handler ({ cols, method, segments }) {
  const number = segments[0] || null
  if (method === 'GET' && !number) return ok({ items: await listRows(cols) })
  if (method === 'GET') {
    const memo = await getCreditMemo(cols, number)
    if (!memo) throw notFound(`Credit memo ${number}`)
    return ok(memo)
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
