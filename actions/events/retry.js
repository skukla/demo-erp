/* Alarm-driven: redeliver pending ERP events. */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { retryPending } = require('../../lib/events')

async function handler ({ cols, params }) {
  return ok(await retryPending(cols, params))
}

exports.handler = handler
exports.allowOffline = true
exports.main = (params) => run(params, handler, { allowOffline: true })
