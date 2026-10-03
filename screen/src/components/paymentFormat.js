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

/** "Visa ending 4242" · "ending 4242" · "Visa" · null: what the ERP holds of a card, never its number. */
function cardText (card) {
  const ending = card.cardLastFour ? `ending ${card.cardLastFour}` : ''
  return [card.cardBrand, ending].filter(Boolean).join(' ') || null
}

/**
 * How an order paid at checkout reads on the order and its invoice (contract version 18,
 * lib/checkout-payment): "Paid by card · Visa ending 4242 · reference …", or "Paid in the
 * web shop · reference …" when the web shop named no card. Null for an order not paid there.
 */
export function paidAtCheckoutText (payment) {
  if (!payment) return null
  const card = cardText(payment)
  return [card ? 'Paid by card' : 'Paid in the web shop', card, `reference ${payment.reference}`].filter(Boolean).join(' · ')
}

/** A payment's reference on the payments list and its document; one taken in the web shop says so, with its card. */
export function paymentReferenceText (payment) {
  if (!payment.paidInWebShop) return payment.reference || '—'
  return ['Web shop', cardText(payment.paidInWebShop), payment.reference].filter(Boolean).join(' · ')
}
