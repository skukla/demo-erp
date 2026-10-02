/*
 * A return order's status in words and its light, read the same on the list, the
 * document and the sales order's related documents. Open waits for the goods; received
 * waits for its credit memo; credited is done.
 */
const WORDS = { open: 'Open', received: 'Received', credited: 'Credited' }
const LIGHTS = { open: 'notice', received: 'info', credited: 'positive' }

export const returnStatusText = (r) => WORDS[r.status] || r.status
export const returnStatusLight = (r) => LIGHTS[r.status] || 'neutral'
