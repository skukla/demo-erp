/*
 * The one shape every action has: connect, refuse when the ERP is "offline"
 * (unless the route is allowed through), route by method and path, turn thrown
 * errors into HTTP statuses. Tests hand in an in-memory `collections`.
 */
const { Core } = require('@adobe/aio-sdk')
const db = require('./db')
const http = require('./http')
const { getSettings } = require('./settings')

/**
 * @param {object} params the action params
 * @param {(ctx: object) => Promise<object>} handler receives `{ cols, params, method, segments, body, settings }`
 * @param {object} [options] `allowOffline` (default false), `collections` (test injection)
 * @returns {Promise<object>} a web-action response
 */
async function run (params, handler, options = {}) {
  const logger = Core.Logger('demo-erp', { level: params.LOG_LEVEL || 'info' })
  const connect = options.collections || db.collections
  try {
    const cols = await connect(params)
    const settings = await getSettings(cols, params.ERP_DISPLAY_NAME)
    if (settings.offline && !options.allowOffline) {
      return http.fail(503, 'ERP_OFFLINE', `${settings.displayName} is offline.`)
    }
    const ctx = {
      cols,
      params,
      settings,
      method: http.method(params),
      segments: http.segments(params),
      body: http.body(params)
    }
    const result = await handler(ctx)
    if (result === undefined) return http.fail(404, 'NO_ROUTE', `No route for ${ctx.method} /${ctx.segments.join('/')}.`)
    return result
  } catch (error) {
    if (error && error.statusCode) {
      return http.fail(error.statusCode, error.code || 'ERROR', error.message)
    }
    logger.error(error)
    return http.fail(500, 'INTERNAL', 'The ERP could not complete the request.')
  }
}

module.exports = { run }
