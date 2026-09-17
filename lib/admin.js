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
  // `lastImportAt` stays: the SC DID sync, and blanking it made the screen say
  // "Last sync: never" directly under a panel describing that sync. The two
  // stamps together tell the truth — synced, then wiped.
  //
  // The sync RECORD goes, though: it describes records that no longer exist, and
  // the screen was still showing "Synced 182 products" with two full bars after a
  // wipe had emptied the ERP (2026-09-17).
  await stamp(cols, { lastWipeAt: new Date().toISOString(), sync: null })
  return removed
}

module.exports = { WIPED, wipe }
