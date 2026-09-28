/*
 * Customer price lists and customer price groups. The route keeps the name `contracts`, which
 * the integration calls; people read "price list" (lib/contracts).
 *
 * GET    contracts                        every price list, newest first; ?partnerId= or ?priceGroup= narrows it
 * GET    contracts/in-force               prices in force today, per customer, groups resolved (lib/contract-prices):
 *                                         { items: [{ partnerId, lines: [{ sku, kind, price? | percent?, minQty,
 *                                         contractNumber, appliesTo }] }] }; customers with no line are left out;
 *                                         with ?partnerId= the answer is always that one customer, lines possibly empty
 * GET    contracts/:number                one price list
 * POST   contracts                        { appliesTo?, partnerId | priceGroup, description?, startingDate, endingDate?,
 *                                         lines? } a new draft (201); appliesTo is customer (default) or priceGroup
 * PATCH  contracts/:number                { description?, startingDate?, endingDate?, lines? } while draft or active
 * POST   contracts/:number/activate       draft or inactive → active
 * POST   contracts/:number/deactivate     active → inactive
 * GET    contracts/price-groups           the customer price groups, { items: [{ code, name }] }
 * POST   contracts/price-groups           { code, name } create or rename one (201)
 * DELETE contracts/price-groups/:code     remove one no customer and no price list uses
 *
 * A change that moves a customer's prices in force raises contract.changed (lib/contracts).
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { findAll } = require('../../lib/db')
const { createContract, getContract, listContracts, updateContract, activateContract, deactivateContract, resolvedFor } = require('../../lib/contracts')
const { listPriceGroups, savePriceGroup, deletePriceGroup } = require('../../lib/price-groups')
const { pricesInForce } = require('../../lib/contract-prices')
const { today } = require('../../lib/pricing')

const MOVES = { activate: activateContract, deactivate: deactivateContract }

/** A text filter from the query, or null. */
function queryOf (params, key) {
  return typeof params?.[key] === 'string' && params[key].trim() ? params[key].trim() : null
}

async function inForce (cols, partnerId) {
  if (partnerId) return { items: [{ partnerId, lines: await resolvedFor(cols, partnerId) }] }
  const [lists, customers] = await Promise.all([listContracts(cols), findAll(cols.businessPartners, {}, { limit: 5000 })])
  return { items: pricesInForce(lists, customers.map((p) => ({ id: p._id, priceGroup: p.priceGroup || null })), today()) }
}

async function priceGroups ({ cols, method, segments, body }) {
  const code = segments[1]
  if (method === 'GET' && !code) return ok({ items: await listPriceGroups(cols) })
  if (method === 'POST' && !code) return ok(await savePriceGroup(cols, body), 201)
  if (method === 'DELETE' && code) return ok({ deleted: await deletePriceGroup(cols, code) })
}

const found = (contract, number) => {
  if (!contract) throw notFound(`Price list ${number}`)
  return ok(contract)
}

async function handler (ctx) {
  const { cols, method, segments, body, params } = ctx
  const [number, move] = segments
  if (number === 'price-groups') return priceGroups(ctx)
  if (method === 'GET' && !number) return ok({ items: await listContracts(cols, { partnerId: queryOf(params, 'partnerId'), priceGroup: queryOf(params, 'priceGroup') }) })
  if (method === 'GET' && number === 'in-force') return ok(await inForce(cols, queryOf(params, 'partnerId')))
  if (method === 'GET' && !move) return found(await getContract(cols, number), number)
  if (method === 'POST' && !number) return ok(await createContract(cols, body), 201)
  if (method === 'PATCH' && number && !move) return found(await updateContract(cols, number, body, params), number)
  if (method === 'POST' && MOVES[move]) return found(await MOVES[move](cols, number, params), number)
}

exports.handler = handler
exports.main = (params) => run(params, handler)
