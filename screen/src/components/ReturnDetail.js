/*
 * One return order's document: what came back from which sales order, and why. Its moves
 * follow its state (lib/return-moves, the rule Home's cues read too): Receive while it is
 * open — the goods are back and stock goes up where the order shipped from — then Post
 * credit memo once received. Credited, it offers nothing and names its credit memo.
 *
 * The return order carries the sales order's number and line items; the order is read
 * beside it for what the return does not repeat: the sold-to's name, the products' names
 * and units, and the currency.
 */
import React from 'react'
import { Button, Grid, StatusLight, TableView, TableHeader, Column, TableBody, Row, Cell, Text, View } from '@adobe/react-spectrum'
import DocumentPage from './DocumentPage'
import Card from './Card'
import Field from './Field'
import Timeline, { returnMomentsOf } from './Timeline'
import { Box } from './RelatedDocuments'
import PostCreditMemo from './PostCreditMemo'
import ProcessFlow from './ProcessFlow'
import { returnFlowOf } from './orderFlow'
import { useLoad } from './useLoad'
import { useDocumentAction } from './useDocumentAction'
import { returnStatusText, returnStatusLight, returnReasonText } from './returnFormat'
import { returnMoves } from '../../../lib/return-moves'
import { formatDate } from '../formatStamp'
import { money } from '../money'

/** The sales order line a return line takes back, for its product name and unit. */
const orderLineOf = (order, item) => (order.lines || []).find((l) => l.item === item) || {}

function Related ({ returnOrder, order, onOpen }) {
  const memo = returnOrder.creditMemo
  return (
    <Card title='Related Documents'>
      <div className='erp-doc-flow'>
        <Box kind='Sales order' number={order.number} when={formatDate(order.createdAt)} status={order.overall} variant='info' onOpen={() => onOpen('order', order.number)} />
        {order.invoice && order.invoice.number && (
          <Box kind='Invoice' number={order.invoice.number} when={formatDate(order.invoice.createdAt)} status={order.invoice.status === 'credited' ? 'Credited' : 'Open'} variant='positive' onOpen={() => onOpen('invoice', order.invoice.number)} />
        )}
        <Box kind='Return order' number={returnOrder.number} when={formatDate(returnOrder.createdAt)} status={returnStatusText(returnOrder)} variant={returnStatusLight(returnOrder)} />
        {memo && (
          <Box kind='Credit memo' number={memo.number} when={formatDate(memo.createdAt)} note={money(memo.total, order.currency)} status='Posted' variant='positive' onOpen={() => onOpen('creditMemo', memo.number)} />
        )}
      </div>
    </Card>
  )
}

export default function ReturnDetail ({ api, number, backLabel = 'Returns', onBack, onOpen, onChanged }) {
  const { rows, error, reload } = useLoad(async () => {
    const returnOrder = await api.returnOrder(number)
    return [{ returnOrder, order: await api.order(returnOrder.orderNumber) }]
  }, [api, number])
  const loaded = rows && rows[0]
  const { act, busy, error: actionError } = useDocumentAction(reload, onChanged)
  const returnOrder = loaded && loaded.returnOrder
  const order = loaded && loaded.order
  const can = returnMoves(returnOrder)
  return (
    <DocumentPage
      backLabel={backLabel}
      onBack={onBack}
      title={returnOrder ? `Return Order ${returnOrder.number}` : ''}
      subtitle={order && order.partner ? `${order.partner.id} · ${order.partner.name}` : undefined}
      error={actionError || error}
      loading={!loaded}
      actions={returnOrder && (
        <>
          {can.receive && <Button variant='accent' isDisabled={busy} onPress={() => act(() => api.receiveReturn(number), 'Return order received — the goods are back in stock')}>Receive</Button>}
          {can.credit && <PostCreditMemo what='the returned lines' isDisabled={busy} onPost={() => act(() => api.creditReturn(number), 'Credit memo posted')} />}
        </>
      )}
    >
      {loaded && (
        <>
          <ProcessFlow flow={returnFlowOf(returnOrder)} onOpen={onOpen} />
          <Card>
            <Grid columns={{ base: ['1fr'], M: ['1fr', '1fr', '1fr'] }} gap='size-250'>
              <Field label='Document type'>Return order</Field>
              <Field label='Created'>{formatDate(returnOrder.createdAt)}</Field>
              <Field label='Status'>
                <StatusLight variant={returnStatusLight(returnOrder)} marginStart='size-0'>{returnStatusText(returnOrder)}</StatusLight>
              </Field>
              <Field label='Sales order'>
                <button type='button' className='erp-link' onClick={() => onOpen('order', returnOrder.orderNumber)}>{returnOrder.orderNumber}</button>
              </Field>
              <Field label='Customer return reference'>{returnOrder.customerReturnReference || '—'}</Field>
              <Field label='Received'>{returnOrder.receivedAt ? formatDate(returnOrder.receivedAt) : '—'}</Field>
            </Grid>
            {returnOrder.creditMemo && (
              <View marginTop='size-200'>
                <Text>Credited by credit memo </Text>
                <button type='button' className='erp-link' onClick={() => onOpen('creditMemo', returnOrder.creditMemo.number)}>{returnOrder.creditMemo.number}</button>
              </View>
            )}
          </Card>
          <Card>
            <TableView aria-label='Return lines' density='compact' overflowMode='wrap'>
              <TableHeader>
                <Column key='item' width={90}>Item</Column>
                <Column key='sku' width={170}>Product</Column>
                <Column key='name' width='1fr' minWidth={200}>Description</Column>
                <Column key='qty' width={130} align='end'>Returned qty</Column>
                <Column key='unit' width={110}>Base unit</Column>
                <Column key='reason' width='1fr' minWidth={160}>Reason</Column>
              </TableHeader>
              <TableBody items={returnOrder.lines.map((l) => ({ ...l, id: l.item }))}>
                {(line) => (
                  <Row key={line.item}>
                    <Cell>{line.item}</Cell>
                    <Cell>{line.sku}</Cell>
                    <Cell>{orderLineOf(order, line.item).name || line.sku}</Cell>
                    <Cell>{line.qty}</Cell>
                    <Cell>{orderLineOf(order, line.item).unit || 'EA'}</Cell>
                    <Cell>{returnReasonText(line)}</Cell>
                  </Row>
                )}
              </TableBody>
            </TableView>
            {can.receive && (
              <View marginTop='size-200'>
                <Text UNSAFE_className='erp-subtle'>
                  Open: the goods are not back yet. Receiving puts them back in stock where the order shipped them from.
                </Text>
              </View>
            )}
          </Card>
          <Related returnOrder={returnOrder} order={order} onOpen={onOpen} />
          <Timeline moments={returnMomentsOf(returnOrder)} onOpen={onOpen} />
        </>
      )}
    </DocumentPage>
  )
}
