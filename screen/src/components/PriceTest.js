/*
 * What one customer pays for one product, and which conditions decided it.
 *
 * SAP puts this behind the Analysis button on a sales order item: a tree of every
 * condition the pricing procedure tried, each with a short reason. This is the same idea
 * — a diagnostic you ask for, reading out the rules by name — on its own, where a rule
 * can be tried without an order to hang it on.
 *
 * It sits under the conditions rather than beside them: the fields are short and read
 * across a line, and the grid keeps the whole width of the screen.
 */
import React, { useState } from 'react'
import { Button, Divider, Heading, NumberField, Text, TextField, View } from '@adobe/react-spectrum'
import { conditionOf } from './conditionFormat'
import { money } from '../money'

/*
 * What decided the price. The engine's `source` is a condition kind, or one of two
 * answers that are not conditions at all: `list` when nothing applied, and `ceiling`
 * when the maximum discount held the price up. Naming those two properly matters —
 * reading "from —" is what happens when only the three kinds are handled.
 */
function sourceText (source) {
  if (source === 'list') return 'the list price, with no contract condition applied'
  if (source === 'ceiling') return 'the maximum-discount ceiling, which held the price up'
  const applied = conditionOf(source)
  return `${applied.code}, the ${applied.label.toLowerCase()}`
}

/** The quote in a sentence, naming what set the price. */
function Result ({ quote }) {
  const line = quote.lines && quote.lines[0]
  if (!line) return <Text>Nothing was priced.</Text>
  if (line.unknown) return <Text>No product with that number.</Text>
  return (
    <Text>
      List {money(line.listPrice)} · charged {money(line.contractPrice)} — {line.discountPercent}% off,
      from {sourceText(line.source)}. The ceiling for this customer is {line.maxDiscountPercent}%.
      Total {money(quote.total)} for {quote.partnerId || 'the walk-in customer'}.
    </Text>
  )
}

export default function PriceTest ({ api, onError }) {
  const [input, setInput] = useState({ partnerId: '', sku: '', qty: 1 })
  const [quote, setQuote] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setInput((current) => ({ ...current, ...patch }))

  async function run () {
    setBusy(true)
    try {
      setQuote(await api.quote({ partnerId: input.partnerId || undefined, lines: [{ sku: input.sku, qty: input.qty }] }))
      onError(null)
    } catch (e) {
      onError(e)
    }
    setBusy(false)
  }

  return (
    <View marginTop='size-500'>
      <Heading level={3}>Test a price</Heading>
      <Divider size='S' marginBottom='size-200' />
      <div className='erp-inline-form'>
        <TextField label='Sold-to' value={input.partnerId} onChange={(partnerId) => set({ partnerId })} width='size-2400' />
        <TextField label='Product' value={input.sku} onChange={(sku) => set({ sku })} width='size-2400' isRequired />
        <NumberField label='Quantity' value={input.qty} onChange={(qty) => set({ qty })} minValue={1} width='size-1600' />
        <Button variant='secondary' onPress={run} isDisabled={!input.sku || busy}>
          {busy ? 'Pricing' : 'Price it'}
        </Button>
      </div>
      <Text>Leave Sold-to blank to price it for the walk-in customer.</Text>
      {quote && <View marginTop='size-200'><Result quote={quote} /></View>}
    </View>
  )
}
