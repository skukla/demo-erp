/*
 * The ERP's one settings record: its display name, how it is dressed, and the stamps the
 * screen shows.
 *
 * The appearance is normalized on the way in AND on the way out, so the screen is always
 * handed a combination it can draw — including for a record written before a palette was
 * renamed, and for the very first read, where there is no record at all yet.
 */
const { normalizeAppearance } = require('./appearance')

const SETTINGS_ID = 'erp'

/**
 * @param {object} cols collections
 * @param {string} [defaultName] the name from the deploy's ERP_DISPLAY_NAME input
 * @returns {Promise<object>} the settings, created on first read
 */
async function getSettings (cols, defaultName) {
  const found = await cols.settings.findOne({ _id: SETTINGS_ID })
  if (found) {
    const dressed = { ...found, appearance: normalizeAppearance(null, found.appearance) }
    // A redeploy with a new ERP_DISPLAY_NAME renames the ERP unless someone renamed it on screen.
    if (defaultName && !found.displayNameEdited && found.displayName !== defaultName) {
      const renamed = { ...dressed, displayName: defaultName }
      await cols.settings.replaceOne({ _id: SETTINGS_ID }, renamed, { upsert: true })
      return renamed
    }
    return dressed
  }
  const fresh = {
    _id: SETTINGS_ID,
    displayName: defaultName || 'Acme ERP',
    displayNameEdited: false,
    appearance: normalizeAppearance(null, null),
    lastImportAt: null,
    lastWipeAt: null
  }
  await cols.settings.replaceOne({ _id: SETTINGS_ID }, fresh, { upsert: true })
  return fresh
}

/**
 * Change the display name and how the ERP is dressed; other fields are the ERP's own.
 *
 * The two move independently: renaming does not reset the look, and re-dressing does not
 * touch the name. `patch.appearance` may carry any of `palette`, `logo`, `nav` — or a
 * `theme` id, which stands for all three (lib/appearance.js).
 *
 * @returns {Promise<object>} the settings after the change
 */
async function updateSettings (cols, patch, defaultName) {
  const current = await getSettings(cols, defaultName)
  const next = { ...current }
  if (typeof patch.displayName === 'string' && patch.displayName.trim() && patch.displayName.trim() !== current.displayName) {
    next.displayName = patch.displayName.trim()
    next.displayNameEdited = true
  }
  if (patch.appearance) {
    next.appearance = normalizeAppearance(patch.appearance, current.appearance)
  }
  await cols.settings.replaceOne({ _id: SETTINGS_ID }, next, { upsert: true })
  return next
}

/** Internal stamps (import, wipe). */
async function stamp (cols, fields) {
  const current = await getSettings(cols)
  const next = { ...current, ...fields }
  await cols.settings.replaceOne({ _id: SETTINGS_ID }, next, { upsert: true })
  return next
}

module.exports = { SETTINGS_ID, getSettings, updateSettings, stamp }
