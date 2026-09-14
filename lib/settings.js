/*
 * The ERP's one settings record: its display name, whether it is "offline" for the
 * test of the store carrying on without it, and the stamps the screen shows.
 */
const SETTINGS_ID = 'erp'

/**
 * @param {object} cols collections
 * @param {string} [defaultName] the name from the deploy's ERP_DISPLAY_NAME input
 * @returns {Promise<object>} the settings, created on first read
 */
async function getSettings (cols, defaultName) {
  const found = await cols.settings.findOne({ _id: SETTINGS_ID })
  if (found) {
    // A redeploy with a new ERP_DISPLAY_NAME renames the ERP unless someone renamed it on screen.
    if (defaultName && !found.displayNameEdited && found.displayName !== defaultName) {
      const renamed = { ...found, displayName: defaultName }
      await cols.settings.replaceOne({ _id: SETTINGS_ID }, renamed, { upsert: true })
      return renamed
    }
    return found
  }
  const fresh = {
    _id: SETTINGS_ID,
    displayName: defaultName || 'Acme ERP',
    displayNameEdited: false,
    offline: false,
    lastImportAt: null,
    lastWipeAt: null
  }
  await cols.settings.replaceOne({ _id: SETTINGS_ID }, fresh, { upsert: true })
  return fresh
}

/**
 * Change display name and/or offline; other fields are the ERP's own.
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
  if (typeof patch.offline === 'boolean') next.offline = patch.offline
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
