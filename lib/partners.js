/*
 * Business partners: the ERP's accounts (SAP's sold-to). Mirrored from the
 * integration's import of Commerce companies, then owned here: credit limit,
 * credit used, blocked. A default partner exists so an instance without companies
 * still prices and orders (decision 15).
 */
const { findAll } = require('./db')
const { badRequest } = require('./errors')
const { emit } = require('./outbox')

const DEFAULT_PARTNER_ID = 'P000000'

/**
 * Bulk upsert from the integration's import. ERP-owned fields (credit limit, credit
 * used, blocked, payment terms) survive a re-import.
 *
 * @param {object[]} rows `{ id, name, commerceCompanyId?, customerGroupId?, salesOrg? }`
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
      name: row.name || row.id,
      salesOrg: row.salesOrg || existing?.salesOrg || '1000',
      commerceCompanyId: row.commerceCompanyId ?? existing?.commerceCompanyId ?? null,
      customerGroupId: row.customerGroupId ?? existing?.customerGroupId ?? null,
      paymentTerms: existing?.paymentTerms || 'NET30',
      creditLimit: existing?.creditLimit ?? Number(row.creditLimit ?? 50000),
      creditUsed: existing?.creditUsed ?? 0,
      blocked: existing?.blocked ?? false,
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

/** The partner a Commerce company id maps to, else the default. */
async function resolvePartner (cols, { partnerId, commerceCompanyId, customerGroupId } = {}) {
  if (partnerId) {
    const byId = await cols.businessPartners.findOne({ _id: partnerId })
    if (byId) return byId
  }
  if (commerceCompanyId !== undefined && commerceCompanyId !== null) {
    const byCompany = await cols.businessPartners.findOne({ commerceCompanyId: String(commerceCompanyId) })
    if (byCompany) return byCompany
  }
  if (customerGroupId !== undefined && customerGroupId !== null) {
    const byGroup = await cols.businessPartners.findOne({ customerGroupId: String(customerGroupId) })
    if (byGroup) return byGroup
  }
  return cols.businessPartners.findOne({ _id: DEFAULT_PARTNER_ID })
}

/**
 * Credit limit and block edits from the screen. Both go to the outbox: the
 * integration writes them onto the Commerce company and keeps its ledger so a reset
 * can undo exactly these (decision 8).
 */
async function patchPartner (cols, id, patch) {
  const current = await cols.businessPartners.findOne({ _id: id })
  if (!current) return null
  const next = { ...current, updatedAt: new Date().toISOString() }
  if (patch.creditLimit !== undefined) {
    const limit = Number(patch.creditLimit)
    if (!Number.isFinite(limit) || limit < 0) throw badRequest('creditLimit must be a non-negative number')
    if (limit !== current.creditLimit) {
      next.creditLimit = limit
      await emit(cols, { kind: 'partner.creditLimit', partnerId: id, commerceCompanyId: current.commerceCompanyId, creditLimit: limit })
    }
  }
  if (patch.blocked !== undefined) {
    const blocked = Boolean(patch.blocked)
    if (blocked !== current.blocked) {
      next.blocked = blocked
      await emit(cols, { kind: 'partner.blocked', partnerId: id, commerceCompanyId: current.commerceCompanyId, blocked })
    }
  }
  if (typeof patch.paymentTerms === 'string' && patch.paymentTerms.trim()) next.paymentTerms = patch.paymentTerms.trim()
  await cols.businessPartners.replaceOne({ _id: id }, next, { upsert: true })
  return next
}

module.exports = { DEFAULT_PARTNER_ID, importPartners, ensureDefaultPartner, listPartners, getPartner, resolvePartner, patchPartner }
