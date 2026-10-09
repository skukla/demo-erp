/*
 * One sales order's document. The list holds a row; this holds the order the way an ERP
 * holds it — a header of labelled fields, numbered lines, the money, and what the order
 * became: its shipments and its invoice, each a document that opens.
 * Above the header, the process flow strip says where the order stands and what comes next
 * (ProcessFlow.js, orderFlow.js).
 *
 * The actions live here rather than on the list. An ERP acts on an order from the
 * order's own document: you look at what you are about to change before you change it.
 * Which actions are open is the ERP's call (`can`), not the screen's — Create invoice
 * appears only when every line has shipped or been closed, because that is the rule.
 *
 * The main button is always the next step, even when that step is made on another document
 * (owner 2026-10-09). A created shipment ships nothing until it is posted, so while one waits
 * the button is Post shipment for it (`can.post` names it, the oldest first) — the same call
 * the shipment's own page makes — and Create shipment steps aside until it is posted, then
 * returns for any quantity no shipment covers. Invoiced with money open, it is Post payment
 * (`can.pay`), the invoice page's dialog and call. Cancel removes any shipment still waiting
 * to be posted (nothing on it has left), and its dialog and toast say which.
 * Cancelling asks why, from the ERP's own list of reasons (lib/orders CANCEL_REASONS,
 * sent with the document so the screen keeps no second copy of it).
 */
import React, { useState } from 'react'
import { Button, ButtonGroup, Content, DialogTrigger, Dialog, Divider, Heading, Item, Picker, Text } from '@adobe/react-spectrum'
import DocumentPage from './DocumentPage'
import OrderHeader from './OrderHeader'
import OrderLines from './OrderLines'
import RelatedDocuments from './RelatedDocuments'
import CreateShipment from './CreateShipment'
import PostPayment from './PostPayment'
import Timeline from './Timeline'
import ProcessFlow from './ProcessFlow'
import { flowOf } from './orderFlow'
import { useLoad } from './useLoad'
import { useDocumentAction } from './useDocumentAction'

/** Cancel: pick a reason, then confirm. The dialog is the only way to reach it. */
function CancelOrder ({ reasons, onCancel, isDisabled, paidByCard, waiting }) {
  const [reason, setReason] = useState(reasons[0])
  return (
    <DialogTrigger>
      <Button variant='negative' isDisabled={isDisabled}>Cancel order</Button>
      {(close) => (
        <Dialog>
          <Heading>Cancel This Order?</Heading>
          <Divider />
          <Content>
            <Text>
              The order stays on record, canceled. It cannot be
              reopened — an order that should run again is placed again.
            </Text>
            {/* Paid at checkout (AB-26s, flow 1): the web shop owns the gateway and the refund. */}
            {paidByCard && <Text UNSAFE_className='erp-subtle'> It was paid by card in the web shop: the card payment is refunded there, not by the ERP.</Text>}
            {/* A shipment waiting to be posted goes with the order (contract version 21): nothing on it has left. */}
            {waiting.length > 0 && <Text UNSAFE_className='erp-subtle'> {waitingText(waiting)}</Text>}
            <Picker
              label='Reason'
              items={reasons.map((r) => ({ id: r }))}
              selectedKey={reason}
              onSelectionChange={(key) => setReason(String(key))}
              marginTop='size-200'
              width='100%'
            >
              {(item) => <Item key={item.id}>{item.id}</Item>}
            </Picker>
          </Content>
          <ButtonGroup>
            <Button variant='secondary' onPress={close}>Keep the order</Button>
            <Button variant='negative' onPress={() => { close(); onCancel(reason) }}>
              Cancel order
            </Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogTrigger>
  )
}

/** What the cancel dialog says of the shipments waiting to be posted, which the cancel removes. */
function waitingText (numbers) {
  return numbers.length > 1
    ? `Shipments ${numbers.join(', ')} are waiting to be posted; they are removed too, since nothing has left.`
    : `Shipment ${numbers[0]} is waiting to be posted; it is removed too, since nothing has left.`
}

/** The toast after a cancel, naming any waiting shipment it removed. */
function canceledText (numbers) {
  if (numbers.length === 0) return 'Order canceled'
  return `Order canceled — ${numbers.length > 1 ? 'shipments' : 'shipment'} ${numbers.join(', ')} removed`
}

/**
 * @param {object} props `backLabel` names where Back goes; `onOpen(kind, number)` opens
 *   a related document (a shipment, the invoice, the customer) on the same trail.
 */
export default function OrderDetail ({ api, number, backLabel = 'Sales Orders', onBack, onOpen, onChanged }) {
  const { rows, error, reload } = useLoad(async () => [await api.order(number)], [api, number])
  const order = rows && rows[0]
  // Every action: ask the ERP, read the document again, tell the shell (useDocumentAction).
  const { act, busy, error: actionError } = useDocumentAction(reload, onChanged)

  const can = (order && order.can) || {}
  // The shipments a cancel would remove: the ones waiting to be posted (lib/fulfilment cancelOrder).
  const waiting = order ? (order.shipments || []).filter((s) => s.status !== 'posted').map((s) => s.number) : []
  return (
    <DocumentPage
      backLabel={backLabel}
      onBack={onBack}
      title={order ? `Sales Order ${order.number}` : ''}
      subtitle={order && order.partner ? `${order.partner.id} · ${order.partner.name}` : undefined}
      error={actionError || error}
      loading={!order}
      actions={order && (
        <>
          {/* SAP's pair on a blocked document. Release lets the order proceed; Reject cancels it
              with the reason Commerce hears. Confirm is not offered while the hold stands. */}
          {can.release && <Button variant='accent' isDisabled={busy} onPress={() => act(() => api.releaseCredit(number), 'Credit hold released')}>Release</Button>}
          {can.reject && <Button variant='negative' isDisabled={busy} onPress={() => act(() => api.rejectCredit(number), 'Order rejected — Credit rejected')}>Reject</Button>}
          {can.confirm && <Button variant='accent' isDisabled={busy} onPress={() => act(() => api.confirmOrder(number), 'Order confirmed')}>Confirm</Button>}
          {can.post && <Button variant='accent' isDisabled={busy} onPress={() => act(() => api.postShipment(number, can.post), `Shipment ${can.post} posted`)}>{`Post shipment ${can.post}`}</Button>}
          {/* A shipment waiting to be posted is the next step; Create shipment waits behind it. */}
          {can.ship && !can.post && <CreateShipment key={order.shipments.length} order={order} isDisabled={busy} onCreate={(body) => act(() => api.createShipment(number, body), 'Shipment created — post it to ship the goods')} />}
          {can.invoice && <Button variant='accent' isDisabled={busy} onPress={() => act(() => api.createInvoice(number), 'Invoice created')}>Create invoice</Button>}
          {can.pay && (
            <PostPayment openAmount={order.invoice.openAmount} currency={order.currency} isDisabled={busy} onPost={(body) => act(() => api.postPayment(order.invoice.number, body), 'Payment posted')} />
          )}
          {can.cancel && (
            <CancelOrder reasons={order.cancelReasons} paidByCard={Boolean(order.payment)} waiting={waiting} isDisabled={busy} onCancel={(reason) => act(() => api.cancelOrder(number, reason), canceledText(waiting))} />
          )}
          {/* A canceled order is terminal (owner O4); the way back is a new order with its lines. */}
          {can.repeat && <Button variant='accent' isDisabled={busy} onPress={() => act(async () => { const made = await api.repeatOrder(number); if (onOpen) onOpen('order', made.number) }, 'Order repeated')}>Repeat order</Button>}
        </>
      )}
    >
      {order && (
        <>
          <ProcessFlow flow={flowOf(order)} onOpen={onOpen} />
          <OrderHeader order={order} onOpen={onOpen} />
          <OrderLines order={order} busy={busy} onOpen={onOpen} onCloseLine={(item, reason) => act(() => api.closeLine(number, item, reason), `Item ${item} closed`)} />
          <RelatedDocuments order={order} onOpen={onOpen} />
          <Timeline order={order} onOpen={onOpen} />
        </>
      )}
    </DocumentPage>
  )
}
