/*
 * The one shape every action has: connect, route by method and path, turn
 * thrown errors into HTTP statuses. Tests hand in an in-memory `collections`.
 *
 * While the ERP is in maintenance (lib/maintenance.js) every route answers 503
 * naming when the window ends, except the actions that say they stay open:
 * health, so a caller can tell why, and settings, which starts and ends the
 * window. This replaces the "offline" switch removed on 2026-09-17; the owner
 * asked for it back on 2026-09-28 as what a real ERP has, a maintenance window
 * that ends by itself (AB-16j).
 */
const { Core } = require('@adobe/aio-sdk')
const db = require('./db')
const http = require('./http')
const { getSettings } = require('./settings')
const { maintenanceOf } = require('./maintenance')

/**
 * @param {object} params the action params
 * @param {(ctx: object) => Promise<object>} handler receives `{ cols, params, method, segments, body, settings }`
 * @param {object} [options] `openInMaintenance` (default false), `collections` (test injection)
 * @returns {Promise<object>} a web-action response
 */
async function run (params, handler, options = {}) {
  const logger = Core.Logger('demo-erp', { level: params.LOG_LEVEL || 'info' })
  const connect = options.collections || db.collections
  try {
    const cols = await connect(params)
    const settings = await getSettings(cols, params.ERP_DISPLAY_NAME, params.ERP_ID)
    const maintenance = maintenanceOf(settings)
    if (maintenance && !options.openInMaintenance) {
      return http.fail(503, 'ERP_MAINTENANCE', maintenance.message, { maintenanceUntil: maintenance.until })
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
