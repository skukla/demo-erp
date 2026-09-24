/* GET health: is the ERP up, what is it called, how big is it. */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { COLLECTIONS } = require('../../lib/db')
const { pending } = require('../../lib/events')
const { workList } = require('../../lib/work')
const { describeStructure } = require('../../lib/structure')

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
  // The appearance rides along here rather than behind its own request: the screen
  // already waits on health before it draws, so the shell bar paints in the SC's own
  // palette instead of flashing the default first.
  return ok({ ok: true, displayName: settings.displayName, appearance: settings.appearance, eventsPending, lastImportAt: settings.lastImportAt, lastWipeAt: settings.lastWipeAt, sync: settings.sync || null, counts, work, structure })
}

exports.handler = handler
exports.main = (params) => run(params, handler)
