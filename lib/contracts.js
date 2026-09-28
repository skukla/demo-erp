/*
 * Contracts: one customer's price agreement. Named after Business Central's sales price
 * lists (Microsoft Learn, "Record special sales prices and discounts", read 2026-09-28): a
 * list per customer with a starting and an optional ending date, a status (Draft, Active,
 * Inactive) and its lines, each an item, a price or a line discount, and a minimum quantity.
 *
 * Stored like every other ERP document: one record per contract, keyed by its number, drawn
 * from its own range (lib/counters STARTS.contract) that never rewinds. What a contract prices
 * is worked out in lib/contract-prices, which this module and the pricing read.
 *
 *   { number, partnerId, description, startingDate, endingDate|null, status,
 *     lines: [{ sku, kind: 'price'|'discount', price? | percent?, minQty }], createdAt, updatedAt }
 *
 * A contract's customer never changes after creation. Lines, dates and description change
 * while it is draft or active; an inactive contract is closed to edits until it is active again.
 *
 * Every change that moves a customer's prices in force (today) raises `contract.changed` with
 * that customer's WHOLE current set, `{ partnerId, lines }`, so a replay is harmless and an
 * empty `lines` means the customer has no contract price left. A change that moves nothing
 * (a draft's edit, a future-dated activation, a description) raises nothing. A contract that
 * starts or ends with the calendar raises nothing either: no one changed it. A subscriber that
 * must follow dates reads `GET contracts/in-force`.
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { next: nextCounter, formatDocumentNumber, STARTS } = require('./counters')
const { emit } = require('./events')
const { today } = require('./pricing')
const { partnerPricesInForce } = require('./contract-prices')

const STATUSES = ['draft', 'active', 'inactive']
const LINE_KINDS = ['price', 'discount']
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A calendar day as YYYY-MM-DD, null when absent and allowed to be, refused when unreadable. */
function dayOf (value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field} is required, written YYYY-MM-DD`)
    return null
  }
  if (typeof value !== 'string' || !DAY.test(value) || Number.isNaN(Date.parse(value))) {
    throw badRequest(`${field} must be a date written YYYY-MM-DD`)
  }
  return value
}

/** One line, checked and in its stored shape. */
function lineOf (input, knownSkus) {
  const sku = typeof input?.sku === 'string' ? input.sku.trim() : ''
  if (!sku || !knownSkus.has(sku)) throw badRequest(`line product ${sku || '(none)'} is not a product of this ERP`)
  if (!LINE_KINDS.includes(input.kind)) throw badRequest(`line kind must be one of ${LINE_KINDS.join(', ')}`)
  const minQty = input.minQty === undefined || input.minQty === null || input.minQty === '' ? 1 : Number(input.minQty)
  if (!Number.isInteger(minQty) || minQty < 1) throw badRequest('minQty must be a whole number of 1 or more')
  if (input.kind === 'price') {
    const price = Number(input.price)
    if (input.price === null || input.price === '' || !Number.isFinite(price) || price < 0) throw badRequest(`the price for ${sku} must be a number of 0 or more`)
    return { sku, kind: 'price', price, minQty }
  }
  const percent = Number(input.percent)
  if (input.percent === null || input.percent === '' || !Number.isFinite(percent) || percent <= 0 || percent > 100) throw badRequest(`the discount percent for ${sku} must be above 0 and at most 100`)
  return { sku, kind: 'discount', percent, minQty }
}

/** The lines, each product and minimum quantity at most once. */
async function linesOf (cols, input) {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw badRequest('lines must be a list')
  const knownSkus = new Set((await findAll(cols.products, {}, { limit: 5000 })).map((p) => p.sku || p._id))
  const lines = input.map((l) => lineOf(l, knownSkus))
  const seen = new Set()
  for (const line of lines) {
    const key = `${line.sku}@${line.minQty}`
    if (seen.has(key)) throw badRequest(`${line.sku} from quantity ${line.minQty} may appear once in a contract`)
    seen.add(key)
  }
  return lines
}

function checkTerm (startingDate, endingDate) {
  if (endingDate && endingDate < startingDate) throw badRequest('endingDate must not be before startingDate')
}

const describe = (value) => (typeof value === 'string' ? value.trim() : '')

/** @returns {Promise<object>} the new contract, a draft */
async function createContract (cols, input = {}) {
  const partnerId = typeof input.partnerId === 'string' ? input.partnerId.trim() : ''
  if (!partnerId || !(await cols.businessPartners.findOne({ _id: partnerId }))) throw badRequest(`customer ${partnerId || '(none)'} is not a customer of this ERP`)
  const startingDate = dayOf(input.startingDate, 'startingDate', { required: true })
  const endingDate = dayOf(input.endingDate, 'endingDate')
  checkTerm(startingDate, endingDate)
  const lines = await linesOf(cols, input.lines)
  const number = formatDocumentNumber(await nextCounter(cols, 'contract', STARTS.contract))
  const now = new Date().toISOString()
  const contract = { _id: number, number, partnerId, description: describe(input.description), startingDate, endingDate, status: 'draft', lines, createdAt: now, updatedAt: now }
  await cols.contracts.replaceOne({ _id: number }, contract, { upsert: true })
  return contract
}

/** @returns {Promise<object|null>} */
function getContract (cols, number) {
  return cols.contracts.findOne({ _id: String(number) })
}

/** @returns {Promise<object[]>} newest first; `partnerId` narrows to one customer */
function listContracts (cols, { partnerId } = {}) {
  return findAll(cols.contracts, partnerId ? { partnerId } : {}, { limit: 5000, sort: { _id: -1 } })
}

/** One customer's prices in force today, from the store. */
async function inForceFor (cols, partnerId) {
  return partnerPricesInForce(await listContracts(cols, { partnerId }), partnerId, today())
}

/** Store a changed contract; announce the customer's prices when they moved. */
async function save (cols, contract, params) {
  const before = await inForceFor(cols, contract.partnerId)
  const next = { ...contract, updatedAt: new Date().toISOString() }
  await cols.contracts.replaceOne({ _id: next._id }, next, { upsert: true })
  const after = await inForceFor(cols, contract.partnerId)
  if (JSON.stringify(before) !== JSON.stringify(after)) await emit(cols, 'contract.changed', { partnerId: contract.partnerId, lines: after }, params)
  return next
}

/**
 * Description, dates and lines, while draft or active. A field left out keeps its value;
 * `endingDate: null` opens the term. `params` (the action's) delivers the event at once.
 * @returns {Promise<object|null>} the contract after the edit, null when unknown
 */
async function updateContract (cols, number, patch = {}, params) {
  const contract = await getContract(cols, number)
  if (!contract) return null
  if (contract.status === 'inactive') throw badRequest(`contract ${contract.number} is inactive; activate it before changing it`)
  const startingDate = 'startingDate' in patch ? dayOf(patch.startingDate, 'startingDate', { required: true }) : contract.startingDate
  const endingDate = 'endingDate' in patch ? dayOf(patch.endingDate, 'endingDate') : contract.endingDate
  checkTerm(startingDate, endingDate)
  const lines = 'lines' in patch ? await linesOf(cols, patch.lines) : contract.lines
  const description = 'description' in patch ? describe(patch.description) : contract.description
  return save(cols, { ...contract, description, startingDate, endingDate, lines }, params)
}

async function move (cols, number, from, to, params) {
  const contract = await getContract(cols, number)
  if (!contract) return null
  if (!from.includes(contract.status)) throw badRequest(`contract ${contract.number} is ${contract.status}; it cannot be set ${to}`)
  return save(cols, { ...contract, status: to }, params)
}

/** Draft or inactive → active. @returns {Promise<object|null>} */
const activateContract = (cols, number, params) => move(cols, number, ['draft', 'inactive'], 'active', params)

/** Active → inactive. @returns {Promise<object|null>} */
const deactivateContract = (cols, number, params) => move(cols, number, ['active'], 'inactive', params)

module.exports = { STATUSES, LINE_KINDS, createContract, getContract, listContracts, updateContract, activateContract, deactivateContract }
