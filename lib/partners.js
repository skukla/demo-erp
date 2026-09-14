/*
 * Business partners: the ERP's accounts (SAP's sold-to). Mirrored from the
 * integration's import of Commerce companies, then owned here: credit limit,
 * credit used, blocked. A default partner exists so an instance without companies
 * still prices and orders (decision 15).
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { emit } = require('./events')

const DEFAULT_PARTNER_ID = 'P000000'

/**
 * Bulk upsert from the integration's import. Commerce is the master the demo is
 * prepared in: every field the import carries (name, group, email domain, credit limit,
 * blocked) overwrites what the ERP holds; fields it does not carry (payment terms,
 * credit used) keep their ERP value.
 *
 * @param {object[]} rows `{ id, name, commerceCompanyId?, customerGroupId?, emailDomain?, creditLimit?, salesOrg? }`
 */
async function importPartners (cols, rows) {
  let created = 0
  let updated = 0
  for (const row of rows) {
    if (!row || !row.id) continue
    const existing = await cols.businessPartners.findOne({ _id: row.id })
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
      creditUsed: existing?.creditUsed ?? 0,
      blocked: typeof row.blocked === 'boolean' ? row.blocked : (existing?.blocked ?? false),
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
    creditUsed: 0,
    blocked: false,
    isDefault: true,
    updatedAt: new Date().toISOString()
  }
  await cols.businessPartners.replaceOne({ _id: DEFAULT_PARTNER_ID }, partner, { upsert: true })
  return partner
}

function listPartners (cols, options = {}) {
  return findAll(cols.businessPartners, {}, { limit: options.limit ?? 1000, sort: { _id: 1 } })
}

function getPartner (cols, id) {
  return cols.businessPartners.findOne({ _id: id })
}

/**
 * The partner a cart or order belongs to: by partner id, by Commerce company id, by the
 * buyer's email domain, by customer group (a company's shared-catalog group, which several
 * companies can share, so it comes last), else the default partner.
 */
async function resolvePartner (cols, { partnerId, commerceCompanyId, email, customerGroupId } = {}) {
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
  const current = await cols.businessPartners.findOne({ _id: id })
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
  if (patch.blocked !== undefined) {
    const blocked = Boolean(patch.blocked)
    if (blocked !== current.blocked) {
      next.blocked = blocked
      await emit(cols, 'partner.blocked', { partnerId: id, companyId: current.commerceCompanyId, blocked }, params)
    }
  }
  if (typeof patch.paymentTerms === 'string' && patch.paymentTerms.trim()) next.paymentTerms = patch.paymentTerms.trim()
  await cols.businessPartners.replaceOne({ _id: id }, next, { upsert: true })
  return next
}

module.exports = { DEFAULT_PARTNER_ID, importPartners, ensureDefaultPartner, listPartners, getPartner, resolvePartner, patchPartner }
