/* GET health: is the ERP up, what is it called, is it offline, how big is it. */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { COLLECTIONS } = require('../../lib/db')

async function handler ({ cols, settings }) {
  const counts = {}
  for (const name of COLLECTIONS) {
    if (name === 'settings' || name === 'counters') continue
    counts[name] = await cols[name].countDocuments({})
  }
  return ok({ ok: true, displayName: settings.displayName, offline: settings.offline, lastImportAt: settings.lastImportAt, lastWipeAt: settings.lastWipeAt, sync: settings.sync || null, counts })
}

exports.handler = handler
exports.main = (params) => run(params, handler, { allowOffline: true })
exports.allowOffline = true
