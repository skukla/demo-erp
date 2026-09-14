/*
 * Wipe and import: the ERP's half of a reset. Counters survive a wipe on purpose
 * (see counters.js). The integration orchestrates the rest (plan decision 11).
 */
const { COLLECTIONS } = require('./db')
const { stamp } = require('./settings')

const WIPED = COLLECTIONS.filter((name) => name !== 'counters' && name !== 'settings')

/** @returns {Promise<Record<string, number>>} documents removed per collection */
async function wipe (cols) {
  const removed = {}
  for (const name of WIPED) {
    const result = await cols[name].deleteMany({})
    removed[name] = (result && result.deletedCount) || 0
  }
  await stamp(cols, { lastWipeAt: new Date().toISOString(), lastImportAt: null })
  return removed
}

module.exports = { WIPED, wipe }
