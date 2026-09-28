/* GET health: is the ERP up, what is it called, is it in maintenance, how big is it. Answers in maintenance too. */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { COLLECTIONS } = require('../../lib/db')
const { pending } = require('../../lib/events')
const { workList } = require('../../lib/work')
const { describeStructure } = require('../../lib/structure')
const { peek } = require('../../lib/counters')
const { maintenanceOf } = require('../../lib/maintenance')

async function handler ({ cols, settings }) {
  const counts = {}
  for (const name of COLLECTIONS) {
    if (name === 'settings' || name === 'counters') continue
    counts[name] = await cols[name].countDocuments({})
  }
  // The journal holds delivered and incoming entries too, so its size is not a queue.
  const eventsPending = (await pending(cols)).length
  // Home's cues and the rail counts: what is waiting, counted from the documents (lib/work).
  const work = await workList(cols)
  // The selling structure (company code, sales organisations, warehouses), derived on read.
  const structure = await describeStructure(cols)
  // The next document numbers (nothing reserved) and the currency money with no currency
  // of its own is shown in: the company code's, from the website mapped to it.
  const numbering = await peek(cols)
  const currency = structure.companyCode.currency || null
  // The appearance rides along here rather than behind its own request: the screen
  // already waits on health before it draws, so the shell bar paints in the SC's own
  // palette instead of flashing the default first.
  // `maintenance` is null, or when the window ends and the sentence to show for it: the
  // integration and the screen say "in maintenance until …" from here (lib/maintenance.js).
  return ok({ ok: true, displayName: settings.displayName, maintenance: maintenanceOf(settings), appearance: settings.appearance, eventsPending, lastImportAt: settings.lastImportAt, lastWipeAt: settings.lastWipeAt, counts, work, structure, numbering, currency })
}

exports.handler = handler
exports.openInMaintenance = true
exports.main = (params) => run(params, handler, { openInMaintenance: true })
