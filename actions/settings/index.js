/*
 * GET settings; PATCH/POST settings { appearance?, timeZone?, warehouses? };
 * POST settings/maintenance { minutes? } starts a maintenance window (30 minutes by default),
 * DELETE settings/maintenance ends it. Answers in maintenance too: it is how the window ends.
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { updateSettings } = require('../../lib/settings')
const { startMaintenance, endMaintenance } = require('../../lib/maintenance')

async function handler ({ cols, params, method, segments, body, settings }) {
  if (segments[0] === 'maintenance') {
    if (method === 'POST') return ok({ maintenance: await startMaintenance(cols, body.minutes, params.ERP_DISPLAY_NAME) })
    if (method === 'DELETE') return ok({ maintenance: await endMaintenance(cols, params.ERP_DISPLAY_NAME) })
    return
  }
  if (method === 'GET') return ok(settings)
  if (method === 'PATCH' || method === 'POST' || method === 'PUT') {
    return ok(await updateSettings(cols, body, params.ERP_DISPLAY_NAME))
  }
}

exports.handler = handler
exports.openInMaintenance = true
exports.main = (params) => run(params, handler, { openInMaintenance: true })
