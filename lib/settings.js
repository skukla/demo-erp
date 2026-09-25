/*
 * The ERP's one settings record: its display name, how it is dressed, and the stamps the
 * screen shows.
 *
 * The appearance is normalized on the way in AND on the way out, so the screen is always
 * handed a combination it can draw — including for a record written before a palette was
 * renamed, and for the very first read, where there is no record at all yet.
 */
const { normalizeAppearance } = require('./appearance')
const { badRequest } = require('./errors')

const SETTINGS_ID = 'erp'

/**
 * @param {object} cols collections
 * @param {string} [defaultName] the name from the deploy's ERP_DISPLAY_NAME input
 * @returns {Promise<object>} the settings, created on first read
 */
async function getSettings (cols, defaultName) {
  const found = await cols.settings.findOne({ _id: SETTINGS_ID })
  if (found) {
    const { displayNameEdited, ...kept } = found
    const dressed = { ...kept, appearance: normalizeAppearance(null, found.appearance) }
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
    appearance: normalizeAppearance(null, null),
    lastImportAt: null,
    lastWipeAt: null,
    // The ERP's own names for Commerce's inventory sources (business structure); a code
    // seen in an import with no entry gets the Commerce name. Settings survive a wipe.
    warehouses: {},
    // Commerce's websites and their sales organisations, as the last full mirror sent them.
    structureMirror: null
  }
  await cols.settings.replaceOne({ _id: SETTINGS_ID }, fresh, { upsert: true })
  return fresh
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
 * Commerce source name, once; a name set on screen is never overwritten by an import.
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

module.exports = { SETTINGS_ID, getSettings, updateSettings, stamp, registerWarehouses }
