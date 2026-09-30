/*
 * Customer price lists: Business Central's sales price lists (Microsoft Learn, "Record special
 * sales prices and discounts", read 2026-09-28). A list applies to ONE customer or to ONE
 * customer price group (its "Applies-to Type", lib/price-groups), has a starting and an
 * optional ending date, a status (Draft, Active, Inactive) and its lines: a product, an
 * agreed price or a line discount, a minimum quantity ("from quantity") and dates of its own.
 *
 * The record and its route keep the name `contracts`, which the integration calls; people
 * read "price list". Stored like every other ERP document: one record per list, keyed by its
 * number, from its own range (lib/counters STARTS.contract) that never rewinds. What a list
 * prices is worked out in lib/contract-prices, which this module and the pricing read.
 *
 *   { number, appliesTo: 'customer'|'priceGroup', partnerId|null, priceGroup|null, description,
 *     startingDate, endingDate|null, status,
 *     lines: [{ sku, kind: 'price'|'discount', price? | percent?, minQty, startingDate|null, endingDate|null }],
 *     createdAt, updatedAt }
 *
 * Who a list applies to never changes after creation. Lines, dates and description change
 * while it is draft or active; an inactive list is closed to edits until it is active again.
 *
 * A customer's prices in force are what the ERP would charge it (lib/net-prices): its lists,
 * then its loose pricing conditions, bounded by the maximum discount. Every change that moves
 * them (today) raises `contract.changed` for that customer with its WHOLE current set,
 * `{ partnerId, lines }`: a group list's change for every member whose prices moved, a move
 * into or out of a group for that customer, a loose condition's change (lib/conditions) and a
 * list price change (lib/products) for each customer whose prices moved. A replay is
 * harmless, and an empty `lines` means the customer pays list price for everything. A change
 * that moves nothing raises nothing. A list, line or condition starting or ending with the
 * calendar raises nothing either: no one changed it. A subscriber that follows dates reads
 * `GET contracts/in-force`.
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { next: nextCounter, formatDocumentNumber, STARTS } = require('./counters')
const { emit } = require('./events')
const { today } = require('./pricing')
const { getSettings } = require('./settings')
const { netPricesFor, netPricesInForce } = require('./net-prices')
const { getPriceGroup } = require('./price-groups')

const STATUSES = ['draft', 'active', 'inactive']
const APPLIES_TO = ['customer', 'priceGroup']
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
  const startingDate = dayOf(input.startingDate, `the line for ${sku}: startingDate`)
  const endingDate = dayOf(input.endingDate, `the line for ${sku}: endingDate`)
  if (startingDate && endingDate && endingDate < startingDate) throw badRequest(`the line for ${sku}: endingDate must not be before startingDate`)
  return { sku, ...amountOf(input, sku), minQty, startingDate, endingDate }
}

/** The price or the percent a line carries, checked. */
function amountOf (input, sku) {
  if (input.kind === 'price') {
    const price = Number(input.price)
    if (input.price === null || input.price === '' || !Number.isFinite(price) || price < 0) throw badRequest(`the price for ${sku} must be a number of 0 or more`)
    return { kind: 'price', price }
  }
  const percent = Number(input.percent)
  if (input.percent === null || input.percent === '' || !Number.isFinite(percent) || percent <= 0 || percent > 100) throw badRequest(`the discount percent for ${sku} must be above 0 and at most 100`)
  return { kind: 'discount', percent }
}

/** The lines, each product, minimum quantity and starting date at most once. */
async function linesOf (cols, input) {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw badRequest('lines must be a list')
  const knownSkus = new Set((await findAll(cols.products, {}, { limit: 5000 })).map((p) => p.sku || p._id))
  const lines = input.map((l) => lineOf(l, knownSkus))
  const seen = new Set()
  for (const line of lines) {
    const key = `${line.sku}@${line.minQty}@${line.startingDate || ''}`
    if (seen.has(key)) throw badRequest(`${line.sku} from quantity ${line.minQty}${line.startingDate ? ` starting ${line.startingDate}` : ''} may appear once in a price list`)
    seen.add(key)
  }
  return lines
}

function checkTerm (startingDate, endingDate) {
  if (endingDate && endingDate < startingDate) throw badRequest('endingDate must not be before startingDate')
}

const describe = (value) => (typeof value === 'string' ? value.trim() : '')

/** Who a new list applies to: one known customer, or one known price group. */
async function appliesToOf (cols, input) {
  const appliesTo = input.appliesTo ?? (input.priceGroup ? 'priceGroup' : 'customer')
  if (!APPLIES_TO.includes(appliesTo)) throw badRequest(`appliesTo must be one of ${APPLIES_TO.join(', ')}`)
  if (appliesTo === 'priceGroup') {
    const code = typeof input.priceGroup === 'string' ? input.priceGroup.trim().toUpperCase() : ''
    if (!code || !(await getPriceGroup(cols, code))) throw badRequest(`price group ${code || '(none)'} is not a price group of this ERP`)
    return { appliesTo, partnerId: null, priceGroup: code }
  }
  const partnerId = typeof input.partnerId === 'string' ? input.partnerId.trim() : ''
  if (!partnerId || !(await cols.businessPartners.findOne({ _id: partnerId }))) throw badRequest(`customer ${partnerId || '(none)'} is not a customer of this ERP`)
  return { appliesTo, partnerId, priceGroup: null }
}

/** @returns {Promise<object>} the new price list, a draft */
async function createContract (cols, input = {}) {
  const who = await appliesToOf(cols, input)
  const startingDate = dayOf(input.startingDate, 'startingDate', { required: true })
  const endingDate = dayOf(input.endingDate, 'endingDate')
  checkTerm(startingDate, endingDate)
  const lines = await linesOf(cols, input.lines)
  const number = formatDocumentNumber(await nextCounter(cols, 'contract', STARTS.contract))
  const now = new Date().toISOString()
  const contract = { _id: number, number, ...who, description: describe(input.description), startingDate, endingDate, status: 'draft', lines, createdAt: now, updatedAt: now }
  await cols.contracts.replaceOne({ _id: number }, contract, { upsert: true })
  return contract
}

/**
 * Bulk-create ACTIVE price lists silently — Demo Builder's one-time setup seed of each price
 * group's prices from Commerce's shared catalogs (AB-44). No `contract.changed` is raised: the
 * prices are Commerce's already, so announcing them would echo them straight back (AB-26z).
 * Each row applies to a price group (which must already exist). @returns {Promise<object[]>}
 */
async function seedContracts (cols, rows = []) {
  const out = []
  for (const input of rows) {
    const who = await appliesToOf(cols, { ...input, appliesTo: 'priceGroup' })
    const startingDate = dayOf(input.startingDate, 'startingDate', { required: true })
    const endingDate = dayOf(input.endingDate, 'endingDate')
    checkTerm(startingDate, endingDate)
    const lines = await linesOf(cols, input.lines)
    const number = formatDocumentNumber(await nextCounter(cols, 'contract', STARTS.contract))
    const now = new Date().toISOString()
    const contract = { _id: number, number, ...who, description: describe(input.description), startingDate, endingDate, status: 'active', lines, createdAt: now, updatedAt: now }
    await cols.contracts.replaceOne({ _id: number }, contract, { upsert: true })
    out.push(contract)
  }
  return out
}

/** @returns {Promise<object|null>} */
function getContract (cols, number) {
  return cols.contracts.findOne({ _id: String(number) })
}

/** @returns {Promise<object[]>} newest first; `partnerId` or `priceGroup` narrows to the lists applying to it */
function listContracts (cols, { partnerId, priceGroup } = {}) {
  let filter = {}
  if (partnerId) filter = { partnerId }
  else if (priceGroup) filter = { priceGroup }
  return findAll(cols.contracts, filter, { limit: 5000, sort: { _id: -1 } })
}

/**
 * Everything a customer's prices are made from, read once: products, conditions, lists,
 * customers, and the sales organizations the store sells through (the business structure the
 * integration mirrors into settings), which a sales-organization-scoped condition is
 * published per (lib/net-prices, contract version 12).
 */
async function pricingRecords (cols) {
  const [products, conditions, lists, partners, settings] = await Promise.all([
    findAll(cols.products, {}, { limit: 5000 }),
    findAll(cols.pricingConditions, {}, { limit: 5000 }),
    listContracts(cols),
    findAll(cols.businessPartners, {}, { limit: 5000 }),
    getSettings(cols)
  ])
  const customers = partners.map((p) => ({ id: p._id, priceGroup: p.priceGroup || null }))
  const websites = (settings.structureMirror && settings.structureMirror.websites) || []
  const salesOrgs = [...new Set(websites.map((w) => w.salesOrg).filter(Boolean))]
  return { products, conditions, lists, customers, salesOrgs }
}

/** Each of these customers' prices in force on a day, as the ERP would charge them (lib/net-prices). */
async function resolvedMany (cols, partnerIds, date) {
  const { products, conditions, lists, customers, salesOrgs } = await pricingRecords(cols)
  const known = new Map(customers.map((c) => [c.id, c]))
  const linesOf = (id) => netPricesFor({ products, conditions, lists, customer: known.get(id) || { id, priceGroup: null }, date, salesOrgs })
  return new Map(partnerIds.map((id) => [id, linesOf(id)]))
}

/**
 * One customer's prices in force on a day (today by default), as the ERP would charge them:
 * its own lists, then its group's, then its loose conditions, bounded by the ceiling.
 */
async function resolvedFor (cols, partnerId, date = today()) {
  return (await resolvedMany(cols, [partnerId], date)).get(partnerId)
}

/** Every customer's prices in force on a day: those with at least one line, by id. */
async function resolvedForAll (cols, date = today()) {
  return netPricesInForce({ ...await pricingRecords(cols), date })
}

/** Every customer's id: a change every customer's prices read (a store-wide rule, a list price) can move any of them. */
async function everyCustomer (cols) {
  return (await findAll(cols.businessPartners, {}, { limit: 5000, sort: { _id: 1 } })).map((p) => p._id)
}

/** The customers a list's change can move: its customer, or its group's members. */
async function customersOf (cols, list) {
  if (list.appliesTo === 'priceGroup') return (await findAll(cols.businessPartners, { priceGroup: list.priceGroup }, { limit: 5000, sort: { _id: 1 } })).map((p) => p._id)
  return [list.partnerId]
}

/**
 * Run a change, then raise contract.changed for each of these customers whose prices in
 * force it moved, each with its whole current set.
 */
async function announcing (cols, partnerIds, change, params) {
  const day = today((await getSettings(cols)).timeZone)
  const before = await resolvedMany(cols, partnerIds, day)
  const result = await change()
  const after = await resolvedMany(cols, partnerIds, day)
  for (const id of partnerIds) {
    const lines = after.get(id)
    if (JSON.stringify(lines) !== JSON.stringify(before.get(id))) await emit(cols, 'contract.changed', { partnerId: id, lines }, params)
  }
  return result
}

/** Store a changed list; announce each customer's prices it moved. */
async function save (cols, contract, params) {
  const next = { ...contract, updatedAt: new Date().toISOString() }
  return announcing(cols, await customersOf(cols, contract), async () => {
    await cols.contracts.replaceOne({ _id: next._id }, next, { upsert: true })
    return next
  }, params)
}

/**
 * Description, dates and lines, while draft or active. A field left out keeps its value;
 * `endingDate: null` opens the term. `params` (the action's) delivers the event at once.
 * @returns {Promise<object|null>} the list after the edit, null when unknown
 */
async function updateContract (cols, number, patch = {}, params) {
  const contract = await getContract(cols, number)
  if (!contract) return null
  if (contract.status === 'inactive') throw badRequest(`price list ${contract.number} is inactive; activate it before changing it`)
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
  if (!from.includes(contract.status)) throw badRequest(`price list ${contract.number} is ${contract.status}; it cannot be set ${to}`)
  return save(cols, { ...contract, status: to }, params)
}

/** Draft or inactive → active. @returns {Promise<object|null>} */
const activateContract = (cols, number, params) => move(cols, number, ['draft', 'inactive'], 'active', params)

/** Active → inactive. @returns {Promise<object|null>} */
const deactivateContract = (cols, number, params) => move(cols, number, ['active'], 'inactive', params)

module.exports = { STATUSES, APPLIES_TO, LINE_KINDS, createContract, seedContracts, getContract, listContracts, updateContract, activateContract, deactivateContract, resolvedFor, resolvedForAll, everyCustomer, announcing }
