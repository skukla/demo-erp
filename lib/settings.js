/*
 * The ERP's one settings record: its display name, how it is dressed, the stamps the
 * screen shows, and its setup (lib/setup.js): the company, sales and receivables, and the
 * sales organizations.
 *
 * The appearance is normalized on the way in AND on the way out, so the screen is always
 * handed a combination it can draw — including for a record written before a palette was
 * renamed, and for the very first read, where there is no record at all yet.
 */
const { normalizeAppearance, themeForErpId } = require('./appearance')
const { badRequest } = require('./errors')

const SETTINGS_ID = 'erp'

/*
 * The ERP's return reason codes as it ships (Business Central's Return Reasons): each a code
 * and a description. A return line from a web shop whose reason matches a description takes its
 * code; any other reason keeps its words under the default code (lib/returns.js).
 */
const RETURN_REASONS = Object.freeze([
  { code: 'RETURN', description: 'Customer return' },
  { code: 'DAMAGED', description: 'Damaged' },
  { code: 'DEFECTIVE', description: 'Defective' },
  { code: 'WRONGITEM', description: 'Wrong item' },
  { code: 'WRONGSIZE', description: 'Wrong size' },
  { code: 'WRONGCOLOR', description: 'Wrong color' }
])

/**
 * Sales & Receivables Setup as a fresh ERP has it. Credit warnings `creditLimit` is how the
 * ERP checked credit before the setting existed, so a stored ERP reads the same.
 */
const SALES_DEFAULTS = Object.freeze({
  defaultPaymentTerms: 'NET30',
  creditWarnings: 'creditLimit',
  returnReasons: RETURN_REASONS,
  defaultReturnReason: 'RETURN'
})

/** Company information nobody has set: every field falls back (lib/setup.js companyOf). */
const COMPANY_UNSET = Object.freeze({ code: null, name: null, address: null, taxId: null, currency: null })

/** The setup fields, each with its default where the record has none yet. */
function dressSetup (kept) {
  return {
    company: { ...COMPANY_UNSET, ...(kept.company || {}) },
    sales: { ...SALES_DEFAULTS, ...(kept.sales || {}) },
    // The ERP's own sales organizations (lib/sales-organizations.js); empty until the first
    // fill seeds them or someone adds one.
    salesOrganizations: Array.isArray(kept.salesOrganizations) ? kept.salesOrganizations : []
  }
}

/**
 * @param {object} cols collections
 * @param {string} [defaultName] the name from the deploy's ERP_DISPLAY_NAME input
 * @param {string} [erpId] the ERP's id in the integration's list (ERP_ID): a fresh ERP's
 *   starting look (themeForErpId); an ERP whose look is stored keeps it
 * @returns {Promise<object>} the settings, created on first read
 */
async function getSettings (cols, defaultName, erpId) {
  const found = await cols.settings.findOne({ _id: SETTINGS_ID })
  if (found) {
    const { displayNameEdited, ...kept } = found
    const dressed = { ...kept, timeZone: kept.timeZone || 'UTC', appearance: normalizeAppearance(null, found.appearance), ...dressSetup(kept) }
    // The name is the one the ERP was added with (ERP_DISPLAY_NAME), fixed at creation
    // (owner, 2026-09-25): there is no on-screen rename to protect any more, and a record
    // still carrying the old `displayNameEdited` flag loses it here.
    if ((defaultName && found.displayName !== defaultName) || displayNameEdited !== undefined) {
      const renamed = { ...dressed, displayName: defaultName || dressed.displayName }
      await cols.settings.replaceOne({ _id: SETTINGS_ID }, renamed, { upsert: true })
      return renamed
    }
    return dressed
  }
  const fresh = {
    _id: SETTINGS_ID,
    displayName: defaultName || 'Acme ERP',
    // The company's local time: which day a price line is in force (lib/pricing today()).
    timeZone: 'UTC',
    appearance: normalizeAppearance({ theme: themeForErpId(erpId) }, null),
    lastImportAt: null,
    lastWipeAt: null,
    // When a maintenance window ends; null or a time passed means none (lib/maintenance.js).
    maintenanceUntil: null,
    // The ERP's own names for its plants (business structure); a code seen in an import
    // with no entry gets the name the import gave it. Settings survive a wipe.
    warehouses: {},
    // The web shop's websites and their sales organisations, as the last full mirror sent them.
    structureMirror: null,
    ...dressSetup({})
  }
  await cols.settings.replaceOne({ _id: SETTINGS_ID }, fresh, { upsert: true })
  return fresh
}

/** A time zone Intl knows, by its IANA name, or a refusal saying so. */
function timeZoneOf (value) {
  const name = typeof value === 'string' ? value.trim() : ''
  try {
    return new Intl.DateTimeFormat('en', { timeZone: name }).resolvedOptions().timeZone
  } catch {
    throw badRequest(`${name || 'That'} is not a time zone. Use a name such as America/New_York.`)
  }
}

/**
 * Change how the ERP is dressed and what it calls its warehouses; other fields are the ERP's
 * own. The name is not among them: it is fixed when the ERP is added (owner, 2026-09-25), so a
 * different name means removing the ERP and adding it again. `patch.appearance` may carry any
 * of `palette`, `logo`, `nav` — or a `theme` id, which stands for all three (lib/appearance.js).
 *
 * @returns {Promise<object>} the settings after the change
 */
async function updateSettings (cols, patch, defaultName) {
  const current = await getSettings(cols, defaultName)
  const next = { ...current }
  if (patch.displayName !== undefined) {
    throw badRequest('The ERP\'s name is set when it is added and cannot be changed here.')
  }
  if (patch.appearance) {
    next.appearance = normalizeAppearance(patch.appearance, current.appearance)
  }
  if (patch.timeZone !== undefined) {
    next.timeZone = timeZoneOf(patch.timeZone)
  }
  if (patch.warehouses && typeof patch.warehouses === 'object') {
    next.warehouses = { ...(current.warehouses || {}) }
    for (const [code, value] of Object.entries(patch.warehouses)) {
      const name = value && typeof value.name === 'string' ? value.name.trim() : ''
      if (!code.trim() || !name) throw badRequest('a warehouse rename needs a code and a non-empty name')
      next.warehouses[code] = { ...(next.warehouses[code] || {}), name }
    }
  }
  await cols.settings.replaceOne({ _id: SETTINGS_ID }, next, { upsert: true })
  return next
}

/**
 * Register the warehouses an import mentions: a code with no ERP name yet takes the
 * name the import gave it, once; a name set on screen is never overwritten by an import.
 * @param {Array<{ code: string, name?: string }>} list
 */
async function registerWarehouses (cols, list) {
  const current = await getSettings(cols)
  const known = { ...(current.warehouses || {}) }
  let changed = false
  for (const w of list || []) {
    const code = w && typeof w.code === 'string' ? w.code.trim() : ''
    if (!code || known[code]) continue
    known[code] = { name: (w.name && String(w.name).trim()) || code }
    changed = true
  }
  if (changed) await stamp(cols, { warehouses: known })
  return known
}

/** Internal stamps (import, wipe). */
async function stamp (cols, fields) {
  const current = await getSettings(cols)
  const next = { ...current, ...fields }
  await cols.settings.replaceOne({ _id: SETTINGS_ID }, next, { upsert: true })
  return next
}

module.exports = { SETTINGS_ID, RETURN_REASONS, SALES_DEFAULTS, getSettings, updateSettings, stamp, registerWarehouses }
