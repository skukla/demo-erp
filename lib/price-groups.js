/*
 * Customer price groups: a code and a name, nothing else (Business Central's customer price
 * group; SAP's customer price group or price list type). A customer belongs to at most one
 * (`priceGroup` on the business partner, the ERP's own, never from Commerce), and a customer
 * price list may apply to a group instead of one customer (lib/contracts).
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')

const CODE = /^[A-Z0-9_-]{1,20}$/

/** A group code as stored: trimmed, upper case, refused when unusable. */
function codeOf (value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!CODE.test(code)) throw badRequest('a price group code is 1 to 20 letters, digits, - or _')
  return code
}

/** @returns {Promise<Array<{ code, name }>>} by code */
async function listPriceGroups (cols) {
  const rows = await findAll(cols.priceGroups, {}, { limit: 1000, sort: { _id: 1 } })
  return rows.map(({ code, name }) => ({ code, name }))
}

/** @returns {Promise<object|null>} the group, or null when unknown */
async function getPriceGroup (cols, code) {
  const found = await cols.priceGroups.findOne({ _id: String(code) })
  return found ? { code: found.code, name: found.name } : null
}

/** Create or rename a group. @returns {Promise<{ code, name }>} */
async function savePriceGroup (cols, input = {}) {
  const code = codeOf(input.code)
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : code
  await cols.priceGroups.replaceOne({ _id: code }, { _id: code, code, name }, { upsert: true })
  return { code, name }
}

/** Remove a group nothing uses. @returns {Promise<number>} groups removed */
async function deletePriceGroup (cols, code) {
  const key = String(code)
  if ((await findAll(cols.businessPartners, { priceGroup: key }, { limit: 1 })).length) throw badRequest(`price group ${key} still has customers; move them out first`)
  if ((await findAll(cols.contracts, { priceGroup: key }, { limit: 1 })).length) throw badRequest(`price group ${key} still has a price list`)
  const result = await cols.priceGroups.deleteMany({ _id: key })
  return (result && result.deletedCount) || 0
}

module.exports = { codeOf, listPriceGroups, getPriceGroup, savePriceGroup, deletePriceGroup }
