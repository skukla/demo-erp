/*
 * GET   contracts                        every contract, newest first; ?partnerId= narrows to one customer
 * GET   contracts/in-force               prices in force today, per customer (lib/contract-prices):
 *                                        { items: [{ partnerId, lines: [{ sku, kind, price? | percent?, minQty, contractNumber }] }] }
 *                                        customers with no line are left out; with ?partnerId= the answer is
 *                                        always that one customer, its lines possibly empty
 * GET   contracts/:number                one contract
 * POST  contracts                        { partnerId, description?, startingDate, endingDate?, lines? } a new draft (201)
 * PATCH contracts/:number                { description?, startingDate?, endingDate?, lines? } while draft or active
 * POST  contracts/:number/activate       draft or inactive → active
 * POST  contracts/:number/deactivate     active → inactive
 *
 * A change that moves a customer's prices in force raises contract.changed (lib/contracts).
 */
const { run } = require('../../lib/action')
const { ok } = require('../../lib/http')
const { notFound } = require('../../lib/errors')
const { createContract, getContract, listContracts, updateContract, activateContract, deactivateContract } = require('../../lib/contracts')
const { pricesInForce, partnerPricesInForce } = require('../../lib/contract-prices')
const { today } = require('../../lib/pricing')

const MOVES = { activate: activateContract, deactivate: deactivateContract }

/** The customer filter, from the query. */
function partnerOf (params) {
  return typeof params?.partnerId === 'string' && params.partnerId.trim() ? params.partnerId.trim() : null
}

async function inForce (cols, partnerId) {
  const contracts = await listContracts(cols, partnerId ? { partnerId } : {})
  if (partnerId) return { items: [{ partnerId, lines: partnerPricesInForce(contracts, partnerId, today()) }] }
  return { items: pricesInForce(contracts, today()) }
}

const found = (contract, number) => {
  if (!contract) throw notFound(`Contract ${number}`)
  return ok(contract)
}

async function handler ({ cols, method, segments, body, params }) {
  const [number, move] = segments
  if (method === 'GET' && !number) return ok({ items: await listContracts(cols, { partnerId: partnerOf(params) }) })
  if (method === 'GET' && number === 'in-force') return ok(await inForce(cols, partnerOf(params)))
  if (method === 'GET' && !move) return found(await getContract(cols, number), number)
  if (method === 'POST' && !number) return ok(await createContract(cols, body), 201)
  if (method === 'PATCH' && number && !move) return found(await updateContract(cols, number, body, params), number)
  if (method === 'POST' && MOVES[move]) return found(await MOVES[move](cols, number, params), number)
}

exports.handler = handler
exports.main = (params) => run(params, handler)
