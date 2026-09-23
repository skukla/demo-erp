import React, { useState } from 'react'
import { Flex, Form, Picker, Item, TextField, NumberField, Button, TableView, TableHeader, Column, TableBody, Row, Cell, ActionButton, Heading, Text, View } from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'
import { toastSaved } from './toast'
import { useColumnWidths } from './columnWidths'

const KINDS = [
  { key: 'contractPrice', label: 'Contract price (partner + product)' },
  { key: 'contractDiscount', label: 'Contract discount % (partner, optional product)' },
  { key: 'maxDiscount', label: 'Max discount % ceiling (optional partner, optional product)' }
]

/* The rule takes the slack. It used to go to the Remove button at the end, which
   cannot use it. */
const CONDITION_COLUMNS = [
  { key: 'kind', width: 190 },
  { key: 'text', width: '1fr', minWidth: 260 },
  { key: 'remove', width: 110 }
]

function describe (c) {
  const scope = [c.partnerId ? `partner ${c.partnerId}` : 'all partners', c.sku ? `product ${c.sku}` : 'all products'].join(', ')
  if (c.kind === 'contractPrice') return `Price ${c.price} for ${scope}`
  if (c.kind === 'contractDiscount') return `${c.percent}% discount for ${scope}`
  return `At most ${c.percent}% below list for ${scope}`
}

export default function Pricing ({ api, onChanged }) {
  const widths = useColumnWidths('pricing', CONDITION_COLUMNS)
  const { rows, error, reload } = useLoad(() => api.conditions(), [api])
  const [form, setForm] = useState({ kind: 'contractDiscount', partnerId: '', sku: '', price: 0, percent: 10 })
  const [quoteIn, setQuoteIn] = useState({ partnerId: '', sku: '', qty: 1 })
  const [quoteOut, setQuoteOut] = useState(null)
  const [actionError, setActionError] = useState(null)

  async function add () {
    try {
      await api.saveCondition({ kind: form.kind, partnerId: form.partnerId || null, sku: form.sku || null, price: form.price, percent: form.percent })
      setActionError(null); toastSaved('Pricing condition added'); await reload(); onChanged()
    } catch (e) { setActionError(e) }
  }
  async function remove (id) {
    try { await api.deleteCondition(id); setActionError(null); toastSaved('Pricing condition deleted'); await reload(); onChanged() } catch (e) { setActionError(e) }
  }
  async function runQuote () {
    try {
      setQuoteOut(await api.quote({ partnerId: quoteIn.partnerId || undefined, lines: [{ sku: quoteIn.sku, qty: quoteIn.qty }] }))
      setActionError(null)
    } catch (e) { setActionError(e) }
  }
  const isPrice = form.kind === 'contractPrice'

  return (
    <Frame title='Pricing' error={actionError || error} loading={!rows}>
      <Flex gap='size-400' wrap alignItems='start'>
        <View flex='1 1 480px'>
          <TableView {...widths.tableProps} aria-label='Pricing conditions' density='compact' overflowMode='wrap'>
            <TableHeader>
              <Column key='kind' {...widths.columnProps('kind')}>Condition</Column>
              <Column key='text' {...widths.columnProps('text')}>Rule</Column>
              <Column key='remove' {...widths.columnProps('remove')}>Remove</Column>
            </TableHeader>
            <TableBody items={rows || []}>
              {(c) => (
                <Row key={c._id}>
                  <Cell>{c.kind}</Cell>
                  <Cell>{describe(c)}</Cell>
                  <Cell><ActionButton isQuiet onPress={() => remove(c._id)}>Remove</ActionButton></Cell>
                </Row>
              )}
            </TableBody>
          </TableView>
        </View>
        <View flex='0 0 320px'>
          <Heading level={3} marginTop={0}>Add a condition</Heading>
          <Form>
            <Picker label='Kind' selectedKey={form.kind} onSelectionChange={(k) => setForm({ ...form, kind: String(k) })}>
              {KINDS.map((k) => <Item key={k.key}>{k.label}</Item>)}
            </Picker>
            <TextField label='Partner id' value={form.partnerId} onChange={(v) => setForm({ ...form, partnerId: v })} isRequired={form.kind !== 'maxDiscount'} />
            <TextField label='Product (SKU)' value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} isRequired={isPrice} />
            {isPrice
              ? <NumberField label='Price' value={form.price} onChange={(v) => setForm({ ...form, price: v })} minValue={0} step={0.01} />
              : <NumberField label='Percent' value={form.percent} onChange={(v) => setForm({ ...form, percent: v })} minValue={0} maxValue={100} />}
            <Button variant='primary' onPress={add}>Add</Button>
          </Form>
          <Heading level={3}>Try a quote</Heading>
          <Form>
            <TextField label='Partner id (blank = default partner)' value={quoteIn.partnerId} onChange={(v) => setQuoteIn({ ...quoteIn, partnerId: v })} />
            <TextField label='Product (SKU)' value={quoteIn.sku} onChange={(v) => setQuoteIn({ ...quoteIn, sku: v })} isRequired />
            <NumberField label='Quantity' value={quoteIn.qty} onChange={(v) => setQuoteIn({ ...quoteIn, qty: v })} minValue={1} />
            <Button variant='secondary' onPress={runQuote} isDisabled={!quoteIn.sku}>Quote</Button>
          </Form>
          {quoteOut && quoteOut.lines[0] && (
            <View marginTop='size-200'>
              {quoteOut.lines[0].unknown
                ? <Text>Unknown product.</Text>
                : <Text>List {quoteOut.lines[0].listPrice}, contract {quoteOut.lines[0].contractPrice} ({quoteOut.lines[0].discountPercent}% off, from {quoteOut.lines[0].source}; ceiling {quoteOut.lines[0].maxDiscountPercent}%). Total {quoteOut.total} for partner {quoteOut.partnerId}.</Text>}
            </View>
          )}
        </View>
      </Flex>
    </Frame>
  )
}
