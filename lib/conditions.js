/*
 * Pricing conditions: stored rows the pricing module reads.
 *
 * A record carries a validity (validFrom / validTo, dates, either open) and a minimum
 * quantity, the two fields a B2B pricing person looks for first on a conditions table
 * (plan §3.10). Both are optional: absent means always and any quantity, which is what
 * every record written before 2026-09-24 means too.
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { randomUUID } = require('crypto')

const KINDS = ['contractPrice', 'contractDiscount', 'maxDiscount']

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A calendar day as YYYY-MM-DD, null when absent, refused when unreadable. */
function dayOf (value, field) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !DAY.test(value) || Number.isNaN(Date.parse(value))) {
    throw badRequest(`${field} must be a date written YYYY-MM-DD`)
  }
  return value
}

function listConditions (cols) {
  return findAll(cols.pricingConditions, {}, { limit: 5000 })
}

/** Create or replace a condition; `_id` optional on create. */
async function upsertCondition (cols, input) {
  if (!KINDS.includes(input.kind)) throw badRequest(`kind must be one of ${KINDS.join(', ')}`)
  if (input.kind === 'contractPrice' && (!input.partnerId || !input.sku)) throw badRequest('a contract price needs partnerId and sku')
  if (input.kind !== 'contractPrice' && !Number.isFinite(Number(input.percent))) throw badRequest('percent must be a number')
  const validFrom = dayOf(input.validFrom, 'validFrom')
  const validTo = dayOf(input.validTo, 'validTo')
  if (validFrom && validTo && validTo < validFrom) throw badRequest('validTo must not be before validFrom')
  let minQty = null
  if (input.minQty !== undefined && input.minQty !== null && input.minQty !== '') {
    minQty = Number(input.minQty)
    if (!Number.isInteger(minQty) || minQty < 1) throw badRequest('minQty must be a whole number of 1 or more')
  }
  const condition = {
    _id: input._id || randomUUID(),
    kind: input.kind,
    partnerId: input.partnerId || null,
    sku: input.sku || null,
    // Optional scope to one sales organisation (business structure); null = every one.
    salesOrg: typeof input.salesOrg === 'string' && input.salesOrg.trim() ? input.salesOrg.trim() : null,
    ...(input.kind === 'contractPrice' ? { price: Number(input.price) } : { percent: Number(input.percent) }),
    validFrom,
    validTo,
    minQty,
    updatedAt: new Date().toISOString()
  }
  await cols.pricingConditions.replaceOne({ _id: condition._id }, condition, { upsert: true })
  return condition
}

async function deleteCondition (cols, id) {
  const result = await cols.pricingConditions.deleteMany({ _id: id })
  return (result && result.deletedCount) || 0
}

module.exports = { KINDS, listConditions, upsertCondition, deleteCondition }
