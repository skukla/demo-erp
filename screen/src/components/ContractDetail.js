/*
 * One customer price list's document: the header of labelled fields, and its lines. Modelled
 * on Business Central's sales price list: it applies to one customer or one customer price
 * group; lines are edited while it is a Draft, which is "not included in price calculations";
 * Activate puts it in force between its dates, and Deactivate takes it out again. Each line
 * has a from quantity and may carry dates of its own. Which move is open follows the stored
 * status, as the ERP decides it (lib/contracts), so the screen offers nothing it would refuse.
 */
import React, { useMemo, useState } from 'react'
import { ActionButton, Button, Grid, StatusLight, Text, TableView, TableHeader, Column, TableBody, Row, Cell } from '@adobe/react-spectrum'
import DocumentPage from './DocumentPage'
import Card from './Card'
import Field from './Field'
import AddContractLine from './AddContractLine'
import { useLoad } from './useLoad'
import { toastSaved } from './toast'
import { appliesToText, contractStatus, lineAmountText, lineDatesText, lineKindText } from './contractFormat'
import { todayIso } from './pricingRuleFormat'
import { formatDate } from '../formatStamp'

/* A list's dates are calendar days (YYYY-MM-DD), read as UTC midnight: printed in the
   browser's own zone they would show the day before anywhere west of Greenwich. */
const ON_THE_DAY = { timeZone: 'UTC' }

function LinesCard ({ contract, products, busy, onLines }) {
  const draft = contract.status === 'draft'
  const lines = contract.lines || []
  const remove = (at) => onLines(lines.filter((_, i) => i !== at), 'Line removed')
  return (
    <Card
      title='Lines'
      actions={draft && <AddContractLine products={products} isDisabled={busy} onAdd={(line) => onLines([...lines, line], 'Line added')} />}
    >
      {!draft && <Text UNSAFE_className='erp-subtle'>Lines are edited while the price list is a draft.</Text>}
      {lines.length === 0
        ? <Text>No lines yet. Add a line for each product with an agreed price or a line discount.</Text>
        : (
          <TableView aria-label='Price list lines' density='compact' overflowMode='wrap'>
            <TableHeader>
              <Column key='sku' width='1fr' minWidth={150}>Product</Column>
              <Column key='kind' width={150}>Line type</Column>
              <Column key='amount' width={130} align='end'>Amount</Column>
              <Column key='minQty' width={130} align='end'>From quantity</Column>
              <Column key='dates' width={230}>Dates</Column>
              <Column key='remove' width={100}> </Column>
            </TableHeader>
            <TableBody items={lines.map((l, i) => ({ ...l, id: `${i}` }))}>
              {(l) => (
                <Row key={l.id}>
                  <Cell>{l.sku}</Cell>
                  <Cell>{lineKindText(l.kind)}</Cell>
                  <Cell>{lineAmountText(l)}</Cell>
                  <Cell>{l.minQty}</Cell>
                  <Cell>{lineDatesText(l)}</Cell>
                  <Cell>{draft ? <ActionButton isQuiet isDisabled={busy} onPress={() => remove(Number(l.id))}>Remove</ActionButton> : ''}</Cell>
                </Row>
              )}
            </TableBody>
          </TableView>
          )}
    </Card>
  )
}

/* Applies to: the customer opens on the same trail; a price group names itself. */
function AppliesTo ({ contract, text, onOpen }) {
  if (contract.appliesTo === 'priceGroup') return <Text>{text}</Text>
  return <button type='button' className='erp-link' onClick={() => onOpen('customer', contract.partnerId)}>{text}</button>
}

export default function ContractDetail ({ api, number, backLabel = 'Price Lists', onBack, onOpen, onChanged }) {
  const { rows, error, reload } = useLoad(async () => [await api.contract(number)], [api, number])
  const { rows: customers } = useLoad(() => api.partners(), [api])
  const { rows: groups } = useLoad(() => api.priceGroups(), [api])
  const { rows: products } = useLoad(() => api.products(), [api])
  const contract = rows && rows[0]
  const who = useMemo(() => contract && appliesToText(
    contract,
    new Map((customers || []).map((c) => [c.id, c.name])),
    new Map((groups || []).map((g) => [g.code, g.name]))
  ), [contract, customers, groups])
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function act (call, saved) {
    setBusy(true)
    try {
      await call()
      setActionError(null)
      await reload()
      toastSaved(saved)
      onChanged()
    } catch (e) { setActionError(e) }
    setBusy(false)
  }

  const status = contract && contractStatus(contract, todayIso())
  return (
    <DocumentPage
      backLabel={backLabel}
      onBack={onBack}
      title={contract ? `Price List ${contract.number}` : ''}
      subtitle={who || undefined}
      error={actionError || error}
      loading={!contract}
      actions={contract && (
        <>
          {contract.status !== 'active' && <Button variant='accent' isDisabled={busy} onPress={() => act(() => api.activateContract(number), 'Price list activated')}>Activate</Button>}
          {contract.status === 'active' && <Button variant='negative' isDisabled={busy} onPress={() => act(() => api.deactivateContract(number), 'Price list deactivated')}>Deactivate</Button>}
        </>
      )}
    >
      {contract && (
        <>
          <Card>
            <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
              <Field label='Price list'>{contract.number}</Field>
              <Field label='Applies to'><AppliesTo contract={contract} text={who} onOpen={onOpen} /></Field>
              <Field label='Description'>{contract.description || '—'}</Field>
              <Field label='Starting date'>{formatDate(contract.startingDate, ON_THE_DAY)}</Field>
              <Field label='Ending date'>{contract.endingDate ? formatDate(contract.endingDate, ON_THE_DAY) : 'No end'}</Field>
              <Field label='Status' help='Draft and inactive price lists price nothing. An active one prices between its dates.'>
                <StatusLight variant={status.variant} marginStart='size-0'>{status.text}</StatusLight>
              </Field>
            </Grid>
          </Card>
          <LinesCard contract={contract} products={products || []} busy={busy} onLines={(lines, saved) => act(() => api.updateContract(number, { lines }), saved)} />
        </>
      )}
    </DocumentPage>
  )
}
