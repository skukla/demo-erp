/* GET settings; PATCH/POST settings { displayName? }. */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { updateSettings } = require('../../lib/settings')

async function handler ({ cols, params, method, body, settings }) {
  if (method === 'GET') return ok(settings)
  if (method === 'PATCH' || method === 'POST' || method === 'PUT') {
    return ok(await updateSettings(cols, body, params.ERP_DISPLAY_NAME))
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
