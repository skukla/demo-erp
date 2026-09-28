/*
 * Business partners: the ERP's accounts (SAP's sold-to), filled by Demo Builder's import
 * and then owned here: credit limit and blocked. The ERP holds no Commerce id: which
 * Commerce company is which customer is the integration's key map (contract version 3).
 * A default partner exists so an instance without companies still prices and orders
 * (decision 15).
 *
 * There is no stored credit USED. It existed, was written as zero and never changed
 * again, so every customer showed no exposure beside a real limit. Exposure is DERIVED
 * — see describePartner — from the orders the customer has not yet been invoiced for.
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { emit } = require('./events')
const { BLOCKING, hasCredit } = require('./credit')
const { getSettings } = require('./settings')
const { announcing } = require('./contracts')
const { getPriceGroup } = require('./price-groups')

const DEFAULT_PARTNER_ID = 'P000000'

/** Commerce's ids a customer stored before contract version 3 still carries. */
const COMMERCE_FIELDS = ['commerceCompanyId', 'customerGroupId', 'emailDomain', 'website']

/**
 * A stored partner in today's shape. A record written before blocking levels existed held
 * one boolean, `blocked`; it reads as All (blocked) or Open, and the boolean is gone. A
 * record written before version 3 drops the Commerce ids it held.
 */
function upgradePartner (stored) {
  if (!stored) return stored
  let partner = Object.fromEntries(Object.entries(stored).filter(([key]) => !COMMERCE_FIELDS.includes(key)))
  if (!BLOCKING.includes(partner.blocking)) {
    const { blocked, ...rest } = partner
    partner = { ...rest, blocking: blocked ? 'all' : 'open' }
  }
  // A record written before the website account existed (contract version 5) is active.
  if (!WEBSITE_ACCOUNT.includes(partner.websiteAccount)) {
    partner = { ...partner, websiteAccount: 'active' }
  }
  // A record written with one fixed `salesOrg` reads as its sales organisations: the
  // walk-in partner belongs to every one; a company set to something other than the
  // default keeps it; the default alone meant nothing was known. The next import replaces it.
  if (!Array.isArray(partner.salesOrgs)) {
    const { salesOrg, ...rest } = partner
    let salesOrgs = []
    if (partner.isDefault) salesOrgs = ['*']
    else if (salesOrg && salesOrg !== '1000') salesOrgs = [salesOrg]
    partner = { ...rest, salesOrgs, legalName: null, vatTaxId: null, resellerId: null, legalAddress: null }
  }
  return partner
}

/** A list of sales organisation codes, cleaned: strings, trimmed, unique, in order. */
function salesOrgList (value) {
  if (!Array.isArray(value)) return null
  return [...new Set(value.map((v) => String(v ?? '').trim()).filter(Boolean))]
}

/** A legal address as the import sends it, or null when nothing is known. */
function legalAddressOf (value) {
  if (!value || typeof value !== 'object') return null
  const street = Array.isArray(value.street) ? value.street.map((l) => String(l).trim()).filter(Boolean) : []
  const address = {
    street,
    city: value.city ? String(value.city) : null,
    region: value.region ? String(value.region) : null,
    postcode: value.postcode ? String(value.postcode) : null,
    countryId: value.countryId ? String(value.countryId) : null,
    telephone: value.telephone ? String(value.telephone) : null
  }
  return street.length || address.city || address.region || address.postcode || address.countryId || address.telephone ? address : null
}

/** Commerce's value when the row carries the field, else what the ERP had, else null. */
const carried = (row, existing, key, clean = (v) => (v === undefined || v === null || v === '' ? null : String(v))) =>
  (row[key] !== undefined ? clean(row[key]) : (existing ? existing[key] ?? null : null))

const isBlocked = (blocking) => blocking !== 'open'

/** The two values of the website account: Commerce's company Active/Blocked switch. */
const WEBSITE_ACCOUNT = ['active', 'closed']

/**
 * The website account an import carries: `websiteAccountClosed` (contract version 5), or the
 * `blocked` boolean an integration built before version 5 still sends for the same switch.
 * Undefined when the row carries neither, so the stored value stays.
 */
function websiteAccountOf (row) {
  const closed = typeof row.websiteAccountClosed === 'boolean' ? row.websiteAccountClosed : row.blocked
  return typeof closed === 'boolean' ? (closed ? 'closed' : 'active') : undefined
}

/**
 * Bulk upsert from the integration's import. Commerce is the master the demo is
 * prepared in: every field the import carries (name, credit limit, website account)
 * overwrites what the ERP holds; a field it does not carry (payment terms) keeps its ERP
 * value. Commerce's ids are not among the fields (contract version 3).
 *
 * The ERP's own credit block is never among them (owner, 2026-09-28): it is this ERP's
 * finance team's decision, and nothing from Commerce changes it. Commerce's company
 * Active/Blocked switch arrives as the separate website account.
 *
 * @param {object[]} rows `{ id, name, creditLimit?, websiteAccountClosed?, salesOrgs?, legalName?, vatTaxId?,
 *   resellerId?, legalAddress? }`
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
      // The sales organisations the company buys through (its admin's website, and every
      // website an order has since arrived from). Commerce's list replaces the ERP's.
      salesOrgs: salesOrgList(row.salesOrgs) ?? existing?.salesOrgs ?? [],
      legalName: carried(row, existing, 'legalName'),
      vatTaxId: carried(row, existing, 'vatTaxId'),
      resellerId: carried(row, existing, 'resellerId'),
      legalAddress: row.legalAddress !== undefined ? legalAddressOf(row.legalAddress) : (existing?.legalAddress ?? null),
      paymentTerms: existing?.paymentTerms || 'NET30',
      creditLimit: row.creditLimit !== undefined && row.creditLimit !== null ? Number(row.creditLimit) : (existing?.creditLimit ?? 50000),
      // The ERP's own credit block: never from Commerce.
      blocking: existing?.blocking ?? 'open',
      websiteAccount: websiteAccountOf(row) ?? existing?.websiteAccount ?? 'active',
      // The customer price group: the ERP's own, never from Commerce.
      priceGroup: existing?.priceGroup ?? null,
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
    // The walk-in account exists so any website's order has a sold-to: every sales organisation.
    salesOrgs: ['*'],
    legalName: null,
    vatTaxId: null,
    resellerId: null,
    legalAddress: null,
    paymentTerms: 'NET30',
    creditLimit: 0,
    blocking: 'open',
    websiteAccount: 'active',
    priceGroup: null,
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
 * The partner a cart or order belongs to: the one it names by number, else the default
 * (walk-in) partner. The integration finds the number in its key map; the ERP matches
 * nothing of Commerce's.
 */
async function resolvePartner (cols, hints = {}) {
  return upgradePartner(await findPartner(cols, hints))
}

async function findPartner (cols, { partnerId } = {}) {
  if (partnerId) {
    const byId = await cols.businessPartners.findOne({ _id: partnerId })
    if (byId) return byId
  }
  return cols.businessPartners.findOne({ _id: DEFAULT_PARTNER_ID })
}

/**
 * Credit limit, block and price group edits from the screen. The first two raise ERP events;
 * the integration writes them onto the Commerce company and keeps its ledger so a reset can
 * undo exactly these (decision 8). A price group change raises contract.changed when it
 * moves the customer's prices in force.
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
      await emit(cols, 'partner.creditLimit', { partnerId: id, creditLimit: limit }, params)
    }
  }
  if (patch.blocking !== undefined) {
    if (!BLOCKING.includes(patch.blocking)) throw badRequest(`blocking must be one of ${BLOCKING.join(', ')}`)
    if (patch.blocking !== current.blocking) {
      next.blocking = patch.blocking
      // Commerce hears a boolean, so only a change that flips it is an event: Shipping to
      // Invoicing is the ERP's business and stays here.
      if (isBlocked(patch.blocking) !== isBlocked(current.blocking)) {
        await emit(cols, 'partner.blocked', { partnerId: id, blocked: isBlocked(patch.blocking) }, params)
      }
    }
  }
  if (typeof patch.paymentTerms === 'string' && patch.paymentTerms.trim()) next.paymentTerms = patch.paymentTerms.trim()
  if (patch.priceGroup !== undefined) next.priceGroup = await priceGroupOf(cols, patch.priceGroup)
  // A move into or out of a price group can move the customer's list prices (lib/contracts).
  return announcing(cols, [id], async () => {
    await cols.businessPartners.replaceOne({ _id: id }, next, { upsert: true })
    return next
  }, params)
}

/** A price group a customer may join (null leaves every group). */
async function priceGroupOf (cols, value) {
  if (value === null || value === '') return null
  const code = String(value).trim().toUpperCase()
  if (!(await getPriceGroup(cols, code))) throw badRequest(`price group ${code} is not a price group of this ERP`)
  return code
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

/**
 * Every customer's exposure in ONE pass over the orders, for the Customers list: the same
 * rule as exposureOf (open orders, held ones not yet owed for), without a read per row.
 * A customer with no credit relationship (the walk-in account) answers null for both.
 * @returns {Promise<object[]>} the partners, each with `exposure` and `available`
 */
async function withCredit (cols, partners) {
  const orders = await findAll(cols.salesOrders, {}, { limit: 5000 })
  const exposure = new Map()
  for (const o of orders) {
    if (!o.partnerId || !OPEN.has(o.status) || o.creditStatus === 'held') continue
    exposure.set(o.partnerId, cents((exposure.get(o.partnerId) || 0) + netOf(o)))
  }
  return partners.map((p) => {
    if (!hasCredit(p)) return { ...p, exposure: null, available: null }
    const used = exposure.get(p.id) || 0
    return { ...p, exposure: used, available: cents((Number(p.creditLimit) || 0) - used) }
  })
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
    // What each sales organisation is called (the structure the mirror sent), for the document.
    salesOrgNames: await salesOrgNames(cols),
    credit: hasCredit(partner) ? { limit, exposure, available: cents(limit - exposure), held } : null,
    orders: rows,
    conditions
  }
}

/**
 * Add a sales organisation to a partner when an order arrives through it (SAP's extension
 * of the customer to a sales area, made automatic). The walk-in partner already has all.
 */
async function widenSalesOrgs (cols, partnerId, salesOrg) {
  if (!partnerId || !salesOrg) return
  const stored = upgradePartner(await cols.businessPartners.findOne({ _id: partnerId }))
  if (!stored || stored.salesOrgs.includes('*') || stored.salesOrgs.includes(salesOrg)) return
  await cols.businessPartners.replaceOne({ _id: partnerId }, { ...stored, salesOrgs: [...stored.salesOrgs, salesOrg] }, { upsert: true })
}

/** code → name for the sales organisations the structure mirror knows. */
async function salesOrgNames (cols) {
  const settings = await getSettings(cols)
  const names = {}
  for (const site of (settings.structureMirror && settings.structureMirror.websites) || []) {
    if (site.salesOrg && !names[site.salesOrg]) names[site.salesOrg] = site.salesOrgName || site.name || site.salesOrg
  }
  return names
}

module.exports = { DEFAULT_PARTNER_ID, BLOCKING, widenSalesOrgs, salesOrgNames, importPartners, ensureDefaultPartner, listPartners, getPartner, resolvePartner, patchPartner, describePartner, exposureOf, withCredit, upgradePartner }
