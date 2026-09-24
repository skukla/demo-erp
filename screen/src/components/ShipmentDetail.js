/*
 * One shipment's document. Shipping creates a thing, not a word: this is the thing — its
 * number, when, from where, what it carries, and whether the goods have left.
 *
 * Post is the one action. It is here and not on the order because posting IS the
 * shipment's event: what SAP calls the goods issue. Posted, the shipment cannot be
 * changed; the ERP says so, with the date, when asked twice.
 */
import React, { useState } from 'react'
import { Button, Grid, StatusLight, TableView, TableHeader, Column, TableBody, Row, Cell, Text, View } from '@adobe/react-spectrum'
import DocumentPage from './DocumentPage'
import Card from './Card'
import Field from './Field'
import { useLoad } from './useLoad'
import { toastSaved } from './toast'
import { formatDate } from '../formatStamp'

export default function ShipmentDetail ({ api, number, backLabel = 'Shipments', onBack, onOpen, onChanged }) {
  const { rows, error, reload } = useLoad(async () => [await api.shipment(number)], [api, number])
  const shipment = rows && rows[0]
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function post () {
    setBusy(true)
    try {
      await api.postShipment(shipment.orderNumber, number)
      setActionError(null)
      await reload()
      toastSaved('Shipment posted')
      onChanged()
    } catch (e) {
      setActionError(e)
    }
    setBusy(false)
  }

  const posted = shipment && shipment.status === 'posted'
  return (
    <DocumentPage
      backLabel={backLabel}
      onBack={onBack}
      title={shipment ? `Shipment ${shipment.number}` : ''}
      subtitle={shipment ? `Sales order ${shipment.orderNumber}` : undefined}
      error={actionError || error}
      loading={!shipment}
      actions={shipment && !posted && <Button variant='accent' isDisabled={busy} onPress={post}>Post shipment</Button>}
    >
      {shipment && (
        <>
          <Card>
            <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
              <Field label='Document type'>Shipment</Field>
              <Field label='Shipment date'>{formatDate(shipment.postedAt || shipment.createdAt)}</Field>
              <Field label='Status'>
                <StatusLight variant={posted ? 'positive' : 'notice'} marginStart='size-0'>{posted ? 'Posted' : 'Open'}</StatusLight>
              </Field>
              <Field label='Sales order'>
                <button type='button' className='erp-link' onClick={() => onOpen('order', shipment.orderNumber)}>{shipment.orderNumber}</button>
              </Field>
              <Field label='Customer reference'>{shipment.commerceIncrementId || '—'}</Field>
              <Field label='Ship-to'>{shipment.partner ? `${shipment.partner.id} · ${shipment.partner.name}` : 'Same as sold-to'}</Field>
              <Field label='Ship-from warehouse'>{shipment.warehouse ? `${shipment.warehouse.name} · ${shipment.warehouse.code}` : '—'}</Field>
              {posted && <Field label='Posted'>{formatDate(shipment.postedAt)}</Field>}
            </Grid>
          </Card>
          <Card>
            <TableView aria-label='Shipment lines' density='compact' overflowMode='wrap'>
              <TableHeader>
                <Column key='item' width={90}>Item</Column>
                <Column key='sku' width={170}>Product</Column>
                <Column key='name' width='1fr' minWidth={220}>Description</Column>
                <Column key='qty' width={140} align='end'>Shipped qty</Column>
                <Column key='unit' width={110}>Base unit</Column>
              </TableHeader>
              <TableBody items={shipment.lines.map((l) => ({ ...l, id: l.item }))}>
                {(line) => (
                  <Row key={line.item}>
                    <Cell>{line.item}</Cell>
                    <Cell>{line.sku}</Cell>
                    <Cell>{line.name}</Cell>
                    <Cell>{line.qty}</Cell>
                    <Cell>{line.unit}</Cell>
                  </Row>
                )}
              </TableBody>
            </TableView>
            {!posted && (
              <View marginTop='size-200'>
                <Text UNSAFE_className='erp-subtle'>
                  Open: the goods have not left. Posting moves the shipped quantities on the order and tells Commerce.
                </Text>
              </View>
            )}
          </Card>
        </>
      )}
    </DocumentPage>
  )
}
