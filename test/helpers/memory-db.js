/*
 * An in-memory stand-in for the App Builder Database client, behaving as the real one
 * does where the ERP can tell the difference (verified against @adobe/aio-lib-db 1.0.3
 * on a deployed workspace, 2026-09-14):
 *   - findOne with no match THROWS "... failed: Document not found" (the ERP's wrapper turns that into null)
 *   - find(filter) returns a cursor with sort/skip/limit/toArray
 *   - countDocuments, replaceOne (upsert), deleteMany answer Mongo-shaped results
 * Filters are equality on top-level fields, which is all the ERP asks for.
 */
const { COLLECTIONS, wrapCollection } = require('../../lib/db')

function matches (doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v)
}

function compareBy (field) {
  return (a, b) => {
    if (a[field] < b[field]) return -1
    if (a[field] > b[field]) return 1
    return 0
  }
}

function cursor (all) {
  let rows = all
  return {
    sort (spec) {
      const [[field, dir]] = Object.entries(spec)
      rows = [...rows].sort((a, b) => compareBy(field)(a, b) * dir)
      return this
    },
    skip (n) { rows = rows.slice(n); return this },
    limit (n) { rows = rows.slice(0, n); return this },
    async toArray () { return rows }
  }
}

function rawCollection (name) {
  const docs = new Map()
  return {
    async findOne (filter) {
      const found = [...docs.values()].find((d) => matches(d, filter))
      if (!found) {
        const error = new Error(`Request test to v1/collection/${name}/findOne failed: Document not found`)
        error.name = 'DbError'
        throw error
      }
      return found
    },
    find (filter) {
      return cursor([...docs.values()].filter((d) => matches(d, filter)))
    },
    async countDocuments (filter) {
      return [...docs.values()].filter((d) => matches(d, filter)).length
    },
    async replaceOne (filter, doc) {
      const existing = [...docs.values()].find((d) => matches(d, filter))
      if (existing) docs.delete(existing._id)
      docs.set(doc._id, { ...doc })
      return { matchedCount: existing ? 1 : 0 }
    },
    async deleteMany (filter) {
      let deletedCount = 0
      for (const [id, d] of docs) {
        if (matches(d, filter)) { docs.delete(id); deletedCount += 1 }
      }
      return { deletedCount }
    }
  }
}

/** @returns {Record<string, object>} fresh collections, wrapped exactly as the deployed code wraps the client's */
function memoryCollections () {
  return Object.fromEntries(COLLECTIONS.map((name) => [name, wrapCollection(rawCollection(name))]))
}

/** Run an action handler against in-memory collections as Runtime would. */
function invoke (action, cols, { method = 'GET', path = '', body, params = {} } = {}) {
  const { run } = require('../../lib/action')
  const p = { ...params, __ow_method: method.toLowerCase(), __ow_path: path }
  if (body !== undefined) p.__ow_body = JSON.stringify(body)
  return run(p, action.handler, { allowOffline: action.allowOffline, collections: async () => cols })
}

module.exports = { memoryCollections, invoke }
