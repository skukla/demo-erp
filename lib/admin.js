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
  // `lastImportAt` stays: the ERP WAS filled, and blanking it made the screen say
  // "never" beside the wipe time. The two stamps together tell the truth — filled,
  // then wiped.
  await stamp(cols, { lastWipeAt: new Date().toISOString() })
  return removed
}

module.exports = { WIPED, wipe }
