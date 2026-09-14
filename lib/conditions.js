/* Pricing conditions: stored rows the pricing module reads. */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { randomUUID } = require('crypto')

const KINDS = ['contractPrice', 'contractDiscount', 'maxDiscount']

function listConditions (cols) {
  return findAll(cols.pricingConditions, {}, { limit: 5000 })
}

/** Create or replace a condition; `_id` optional on create. */
async function upsertCondition (cols, input) {
  if (!KINDS.includes(input.kind)) throw badRequest(`kind must be one of ${KINDS.join(', ')}`)
  if (input.kind === 'contractPrice' && (!input.partnerId || !input.sku)) throw badRequest('a contract price needs partnerId and sku')
  if (input.kind !== 'contractPrice' && !Number.isFinite(Number(input.percent))) throw badRequest('percent must be a number')
  const condition = {
    _id: input._id || randomUUID(),
    kind: input.kind,
    partnerId: input.partnerId || null,
    sku: input.sku || null,
    ...(input.kind === 'contractPrice' ? { price: Number(input.price) } : { percent: Number(input.percent) }),
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
