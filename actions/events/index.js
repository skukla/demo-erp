/* GET events: the newest journal entries, each with its sentence (lib/journal); POST events/retry: redeliver what is pending; POST events/requeue: give failed events another ten attempts. */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { recent, pending, failed, retryPending, requeueFailed, webhookUrl } = require('../../lib/events')
const { describeEvent } = require('../../lib/journal')

async function handler ({ cols, method, segments, params }) {
  if (method === 'GET') {
    return ok({ webhookUrl: webhookUrl(params), pending: (await pending(cols)).length, failed: (await failed(cols)).length, items: (await recent(cols)).map((e) => ({ ...e, describe: describeEvent(e) })) })
  }
  if (method === 'POST' && segments[0] === 'retry') return ok(await retryPending(cols, params))
  if (method === 'POST' && segments[0] === 'requeue') return ok(await requeueFailed(cols))
}

exports.handler = handler
exports.main = (params) => run(params, handler)
