/*
 * An invoice's payment status in words and its light (contract version 14, lib/open-items),
 * read the same on the invoice list, the invoice, the customer's open items and the sales
 * order's related documents. Open and partly paid are still owed; paid and credited are done.
 * An invoice from before the ERP kept payment data reads by its old status word.
 */
const WORDS = { open: 'Open', 'partly paid': 'Partly paid', paid: 'Paid', credited: 'Credited' }
const LIGHTS = { open: 'notice', 'partly paid': 'info', paid: 'positive', credited: 'neutral' }

const statusOf = (invoice) => invoice.paymentStatus || (invoice.status === 'credited' ? 'credited' : 'open')

export const paymentStatusText = (invoice) => WORDS[statusOf(invoice)] || statusOf(invoice)
export const paymentStatusLight = (invoice) => LIGHTS[statusOf(invoice)] || 'neutral'
