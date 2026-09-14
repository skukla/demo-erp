/*
 * App Builder Database access.
 *
 * The database provisions on `aio app deploy` (never on `aio app run`); the region
 * is pinned in app.config.yaml. Deployed actions get their IMS token from the
 * `include-ims-credentials: true` annotation, the documented way:
 * https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/database
 *
 * Every store function takes the collections it needs as an argument, so the
 * logic is tested against an in-memory fake (test/helpers/memory-db.js) and the
 * real client is touched in exactly one place: here.
 */
const { Core } = require('@adobe/aio-sdk')
const libDb = require('@adobe/aio-lib-db')

/** The ERP's collections. Names are the module boundary; SAP words live in the records. */
const COLLECTIONS = ['materials', 'businessPartners', 'pricingConditions', 'salesOrders', 'outbox', 'settings', 'counters']

let clientPromise

/**
 * The service answers a findOne with no match as a FAILED request ("... failed: Document
 * not found") and the client throws it (verified against @adobe/aio-lib-db 1.0.3 on
 * 2026-09-14). The ERP wants null there, so every handle it uses is wrapped.
 *
 * @param {Error} error
 * @returns {boolean}
 */
function isNotFound (error) {
  return Boolean(error && /Document not found$/.test(String(error.message)))
}

/**
 * The collection surface the ERP's modules program against.
 *
 * @param {object} raw a collection handle from the client (or the in-memory stand-in)
 * @returns {object} `findOne` (null when absent), `find(filter, {limit, sort})` → `toArray()`,
 *   `countDocuments`, `replaceOne`, `deleteMany`
 */
function wrapCollection (raw) {
  return {
    async findOne (filter) {
      try {
        return await raw.findOne(filter)
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },
    find (filter, options = {}) {
      let cursor = raw.find(filter)
      if (options.sort) cursor = cursor.sort(options.sort)
      if (options.skip) cursor = cursor.skip(options.skip)
      if (options.limit) cursor = cursor.limit(options.limit)
      return cursor
    },
    countDocuments: (filter) => raw.countDocuments(filter),
    replaceOne: (filter, doc, options) => raw.replaceOne(filter, doc, options),
    deleteMany: (filter) => raw.deleteMany(filter)
  }
}

/**
 * Connect once per container and hand back the named collections.
 *
 * @param {object} params the action params (carry the IMS credentials)
 * @returns {Promise<Record<string, object>>} collection handles by name
 */
async function collections (params) {
  if (!clientPromise) {
    clientPromise = (async () => {
      const token = await Core.AuthClient.generateAccessToken(params)
      const db = await libDb.init({ token: token.access_token })
      return db.connect()
    })().catch((error) => {
      clientPromise = undefined
      throw error
    })
  }
  const client = await clientPromise
  return Object.fromEntries(COLLECTIONS.map((name) => [name, wrapCollection(client.collection(name))]))
}

/**
 * A whole result set. The cursor walks the service's batches itself.
 *
 * @param {object} collection a wrapped collection handle
 * @param {object} [filter] the query
 * @param {object} [options] `limit` (default 1000), `sort` (a Mongo-style spec, e.g. `{ _id: 1 }`)
 * @returns {Promise<object[]>} the documents
 */
async function findAll (collection, filter = {}, options = {}) {
  const limit = options.limit ?? 1000
  return collection.find(filter, { limit, sort: options.sort }).toArray()
}

module.exports = { COLLECTIONS, collections, findAll, wrapCollection, isNotFound }
