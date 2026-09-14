/* GET outbox: pending entries oldest first; POST outbox/ack { ids } */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { badRequest } = require('../../lib/errors')
const { pending, ack } = require('../../lib/outbox')

async function handler ({ cols, method, segments, body }) {
  if (method === 'GET') return ok({ items: await pending(cols) })
  if (method === 'POST' && segments[0] === 'ack') {
    if (!Array.isArray(body.ids)) throw badRequest('ack needs an ids array')
    return ok({ acked: await ack(cols, body.ids) })
  }
}

exports.handler = handler
exports.main = (params) => run(params, handler)
