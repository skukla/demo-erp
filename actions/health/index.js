/* GET health: is the ERP up, what is it called, how big is it. */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { COLLECTIONS } = require('../../lib/db')

async function handler ({ cols, settings }) {
  const counts = {}
  for (const name of COLLECTIONS) {
    if (name === 'settings' || name === 'counters') continue
    counts[name] = await cols[name].countDocuments({})
  }
  return ok({ ok: true, displayName: settings.displayName, lastImportAt: settings.lastImportAt, lastWipeAt: settings.lastWipeAt, sync: settings.sync || null, counts })
}

exports.handler = handler
exports.main = (params) => run(params, handler)
