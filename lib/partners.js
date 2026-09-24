/*
 * Business partners: the ERP's accounts (SAP's sold-to). Mirrored from the
 * integration's import of Commerce companies, then owned here: credit limit and
 * blocked. A default partner exists so an instance without companies still prices
 * and orders (decision 15).
 *
 * There is no stored credit USED. It existed, was written as zero and never changed
 * again, so every customer showed no exposure beside a real limit. Exposure is DERIVED
 * — see describePartner — from the orders the customer has not yet been invoiced for.
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { emit } = require('./events')
const { BLOCKING, hasCredit } = require('./credit')

const DEFAULT_PARTNER_ID = 'P000000'

/**
 * A stored partner in today's shape. A record written before blocking levels existed held
 * one boolean, `blocked`; it reads as All (blocked) or Open, and the boolean is gone.
 */
function upgradePartner (stored) {
  if (!stored) return stored
  if (BLOCKING.includes(stored.blocking)) return stored
  const { blocked, ...rest } = stored
  return { ...rest, blocking: blocked ? 'all' : 'open' }
}

/** Commerce knows one boolean; the ERP's four levels fold to it and unfold from it. */
const blockingFromFlag = (blocked) => (blocked ? 'all' : 'open')
const isBlocked = (blocking) => blocking !== 'open'

/**
 * Bulk upsert from the integration's import. Commerce is the master the demo is
 * prepared in: every field the import carries (name, group, email domain, credit limit,
 * blocked) overwrites what the ERP holds; a field it does not carry (payment terms)
 * keeps its ERP value.
 *
 * @param {object[]} rows `{ id, name, commerceCompanyId?, customerGroupId?, emailDomain?, creditLimit?, salesOrg? }`
 */
async function importPartners (cols, rows) {
  let created = 0
  let updated = 0
  for (const row of rows) {
    if (!row || !row.id) continue
    const existing = upgradePartner(await cols.businessPartners.findOne({ _id: row.id }))
    const partner = {
      _id: row.id,
      id: row.id,
      name: row.name || existing?.name || row.id,
      salesOrg: row.salesOrg || existing?.salesOrg || '1000',
      commerceCompanyId: row.commerceCompanyId ?? existing?.commerceCompanyId ?? null,
      customerGroupId: row.customerGroupId !== undefined ? (row.customerGroupId === null ? null : String(row.customerGroupId)) : (existing?.customerGroupId ?? null),
      emailDomain: row.emailDomain ? String(row.emailDomain).toLowerCase() : (existing?.emailDomain ?? null),
      paymentTerms: existing?.paymentTerms || 'NET30',
      creditLimit: row.creditLimit !== undefined && row.creditLimit !== null ? Number(row.creditLimit) : (existing?.creditLimit ?? 50000),
      // Commerce's boolean is the master: blocked there is All here, and a level set on
      // the ERP's screen survives only until Commerce next says otherwise.
      blocking: typeof row.blocked === 'boolean' ? blockingFromFlag(row.blocked) : (existing?.blocking ?? 'open'),
      updatedAt: new Date().toISOString()
    }
    await cols.businessPartners.replaceOne({ _id: row.id }, partner, { upsert: true })
    if (existing) updated += 1
    else created += 1
  }
  return { created, updated }
}

/** Ensure the default partner exists; it is the fallback when a quote names none. */
async function ensureDefaultPartner (cols, projectName) {
  const existing = await cols.businessPartners.findOne({ _id: DEFAULT_PARTNER_ID })
  if (existing) return existing
  const partner = {
    _id: DEFAULT_PARTNER_ID,
    id: DEFAULT_PARTNER_ID,
    name: projectName ? `${projectName} (walk-in)` : 'Walk-in customers',
    salesOrg: '1000',
    commerceCompanyId: null,
    customerGroupId: null,
    paymentTerms: 'NET30',
    creditLimit: 0,
    blocking: 'open',
    isDefault: true,
    updatedAt: new Date().toISOString()
  }
  await cols.businessPartners.replaceOne({ _id: DEFAULT_PARTNER_ID }, partner, { upsert: true })
  return partner
}

async function listPartners (cols, options = {}) {
  const rows = await findAll(cols.businessPartners, {}, { limit: options.limit ?? 1000, sort: { _id: 1 } })
  return rows.map(upgradePartner)
}

async function getPartner (cols, id) {
  return upgradePartner(await cols.businessPartners.findOne({ _id: id }))
}

/**
 * The partner a cart or order belongs to: by partner id, by Commerce company id, by the
 * buyer's email domain, by customer group (a company's shared-catalog group, which several
 * companies can share, so it comes last), else the default partner.
 */
async function resolvePartner (cols, hints = {}) {
  return upgradePartner(await findPartner(cols, hints))
}

async function findPartner (cols, { partnerId, commerceCompanyId, email, customerGroupId } = {}) {
  if (partnerId) {
    const byId = await cols.businessPartners.findOne({ _id: partnerId })
    if (byId) return byId
  }
  if (commerceCompanyId !== undefined && commerceCompanyId !== null) {
    const byCompany = await cols.businessPartners.findOne({ commerceCompanyId: String(commerceCompanyId) })
    if (byCompany) return byCompany
  }
  if (typeof email === 'string' && email.includes('@')) {
    const byDomain = await cols.businessPartners.findOne({ emailDomain: email.split('@')[1].toLowerCase() })
    if (byDomain) return byDomain
  }
  if (customerGroupId !== undefined && customerGroupId !== null) {
    const byGroup = await cols.businessPartners.findOne({ customerGroupId: String(customerGroupId) })
    if (byGroup) return byGroup
  }
  return cols.businessPartners.findOne({ _id: DEFAULT_PARTNER_ID })
}

/**
 * Credit limit and block edits from the screen. Both raise ERP events; the integration
 * writes them onto the Commerce company and keeps its ledger so a reset can undo exactly
 * these (decision 8).
 */
async function patchPartner (cols, id, patch, params) {
  const current = upgradePartner(await cols.businessPartners.findOne({ _id: id }))
  if (!current) return null
  const next = { ...current, updatedAt: new Date().toISOString() }
  if (patch.creditLimit !== undefined) {
    const limit = Number(patch.creditLimit)
    if (!Number.isFinite(limit) || limit < 0) throw badRequest('creditLimit must be a non-negative number')
    if (limit !== current.creditLimit) {
      next.creditLimit = limit
      await emit(cols, 'partner.creditLimit', { partnerId: id, companyId: current.commerceCompanyId, creditLimit: limit }, params)
    }
  }
  if (patch.blocking !== undefined) {
    if (!BLOCKING.includes(patch.blocking)) throw badRequest(`blocking must be one of ${BLOCKING.join(', ')}`)
    if (patch.blocking !== current.blocking) {
      next.blocking = patch.blocking
      // Commerce hears a boolean, so only a change that flips it is an event: Shipping to
      // Invoicing is the ERP's business and stays here.
      if (isBlocked(patch.blocking) !== isBlocked(current.blocking)) {
        await emit(cols, 'partner.blocked', { partnerId: id, companyId: current.commerceCompanyId, blocked: isBlocked(patch.blocking) }, params)
      }
    }
  }
  if (typeof patch.paymentTerms === 'string' && patch.paymentTerms.trim()) next.paymentTerms = patch.paymentTerms.trim()
  await cols.businessPartners.replaceOne({ _id: id }, next, { upsert: true })
  return next
}

/** Money, to the cent. The same rounding lib/orders uses, which cannot be required from here: it requires this module. */
const cents = (value) => Math.round(value * 100) / 100

/** An order's net amount: its lines, not what Commerce charged (that carries tax). */
function netOf (order) {
  return cents((order.lines || []).reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.price) || 0), 0))
}

/* An order the customer still owes for. Both reference systems count credit exposure
   as open receivables plus open orders; here an order is open until it is invoiced,
   and a cancelled one never counts. */
const OPEN = new Set(['created', 'confirmed', 'shipped'])

/**
 * The customer's orders, newest first, each with its net amount and credit decision.
 * Read straight from the collection: lib/orders requires this module, so this module
 * cannot require it. `header`-less records (written before shipments existed) are read
 * by their stored status word, which is also what deriveStatus would answer for them.
 */
async function ordersOf (cols, partnerId) {
  const orders = await findAll(cols.salesOrders, { partnerId }, { limit: 500, sort: { _id: -1 } })
  return orders.map((o) => ({
    number: o.number,
    createdAt: o.createdAt,
    status: o.status,
    creditStatus: o.creditStatus ?? null,
    commerceOrderId: o.commerceOrderId,
    commerceIncrementId: o.commerceIncrementId,
    currency: o.currency,
    net: netOf(o)
  }))
}

/** Net of the customer's open orders — what the credit check measures against the limit. */
async function exposureOf (cols, partnerId) {
  const rows = await ordersOf(cols, partnerId)
  return cents(rows.filter((o) => OPEN.has(o.status) && o.creditStatus !== 'held').reduce((sum, o) => sum + o.net, 0))
}

/**
 * A customer as its own document shows it, which is more than the record holds: the
 * credit picture, the customer's own sales orders, and the pricing agreed with it.
 *
 * Credit is null for a customer with no Commerce company — the walk-in account — because
 * there is no credit relationship to describe; the screen leaves the card out rather
 * than showing a limit of zero. Exposure is never stored: it is worked out here, on
 * read, as the net amount of every order not yet invoiced and not cancelled, so raising
 * an order or invoicing one moves it without anything having to be kept in step.
 *
 * @param {object} cols collections
 * @param {object} partner the stored partner
 * @returns {Promise<object>} the partner, plus `credit` ({ limit, exposure, available } or null),
 *   `orders` (newest first, each with `net`) and `conditions` (this customer's only)
 */
async function describePartner (cols, partner) {
  const [rows, conditions] = await Promise.all([
    ordersOf(cols, partner.id),
    findAll(cols.pricingConditions, { partnerId: partner.id }, { limit: 1000 })
  ])
  // A held order is not yet the customer's to owe for: it counts once released. The
  // count of held orders is SAP's "blocked documents" work list, for this customer.
  const exposure = cents(rows.filter((o) => OPEN.has(o.status) && o.creditStatus !== 'held').reduce((sum, o) => sum + o.net, 0))
  const held = rows.filter((o) => o.creditStatus === 'held' && o.status !== 'cancelled').length
  const limit = Number(partner.creditLimit) || 0
  return {
    ...partner,
    credit: hasCredit(partner) ? { limit, exposure, available: cents(limit - exposure), held } : null,
    orders: rows,
    conditions
  }
}

module.exports = { DEFAULT_PARTNER_ID, BLOCKING, importPartners, ensureDefaultPartner, listPartners, getPartner, resolvePartner, patchPartner, describePartner, exposureOf, upgradePartner }
