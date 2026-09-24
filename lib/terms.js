/*
 * Payment terms, as the ERP reads them. The terms are a code on the business partner
 * (NET30 is Commerce's default here, and the one SAP and Business Central users both
 * recognise); the number of days in it is what a due date is made of. Terms that name no
 * number of days — a real ERP has many (payment in advance, letter of credit) — leave the
 * days unknown rather than guessed.
 */

const NET_DAYS = /^NET\s*(\d{1,3})$/i

/**
 * @param {string|null|undefined} terms e.g. 'NET30', 'NET 15'
 * @returns {number|null} the days to pay, or null when the terms name none
 */
function daysOf (terms) {
  const match = typeof terms === 'string' ? terms.trim().match(NET_DAYS) : null
  return match ? Number(match[1]) : null
}

/**
 * @param {string} from an ISO time (the billing date)
 * @param {string|null|undefined} terms
 * @returns {string|null} the due date as an ISO time, or null when the terms name no days
 */
function dueDate (from, terms) {
  const days = daysOf(terms)
  if (days === null || !from) return null
  const due = new Date(from)
  if (Number.isNaN(due.getTime())) return null
  due.setUTCDate(due.getUTCDate() + days)
  return due.toISOString()
}

module.exports = { daysOf, dueDate }
