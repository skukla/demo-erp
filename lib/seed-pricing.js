/*
 * The one-time setup seed of the ERP's pricing from the web shop's custom shared catalogs (AB-44):
 * a price group per catalog, each customer's group from its catalog membership, and the
 * catalog's tier prices as the group's active price list. Demo Builder's fill sends it AFTER
 * products and partners exist, because the price lists reference products and the group
 * assignments reference partners.
 *
 * Order matters: groups first, then each customer's group (needs the groups and the partners),
 * then the price lists (need the groups and the products). Silent throughout — the prices are
 * the shop's already, so this seeds the ERP without echoing anything back (AB-26z stays the one
 * ERP → shop writer). A real integration would not copy the shop's prices ongoing; this is setup.
 */
const { importPriceGroups } = require('./price-groups')
const { seedPartnerPriceGroups } = require('./partners')
const { seedContracts } = require('./contracts')

/**
 * @param {object} seed `{ priceGroups?: [{code,name}], partnerGroups?: [{id,priceGroup}],
 *   contracts?: [{priceGroup, description?, startingDate, lines}] }`
 * @returns {Promise<{ priceGroups: number, partnerGroups: number, contracts: number }>}
 */
async function seedPricing (cols, seed = {}) {
  const priceGroups = await importPriceGroups(cols, seed.priceGroups || [])
  const partnerGroups = await seedPartnerPriceGroups(cols, seed.partnerGroups || [])
  const contracts = await seedContracts(cols, seed.contracts || [])
  return { priceGroups: priceGroups.length, partnerGroups, contracts: contracts.length }
}

module.exports = { seedPricing }
