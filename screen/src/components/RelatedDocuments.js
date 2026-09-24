/*
 * What this order became. SAP calls it the document flow and puts it one click from the
 * order; Business Central heads the same idea Related documents.
 *
 * The ERP raises a shipment and an invoice as events today but keeps no shipment or
 * invoice DOCUMENT, so this strip is honest about having nothing to show rather than
 * absent — an order that has been shipped and invoiced should say where those went.
 */
import React from 'react'
import { Text } from '@adobe/react-spectrum'
import Card from './Card'

export default function RelatedDocuments ({ order }) {
  const shipped = ['shipped', 'invoiced'].includes(order.status)
  const invoiced = order.status === 'invoiced'
  return (
    <Card title='Related Documents'>
      {shipped || invoiced
        ? (
          <Text>
            {invoiced
              ? 'Shipped and invoiced in Commerce. The ERP keeps no shipment or invoice document of its own yet.'
              : 'Shipped in Commerce. The ERP keeps no shipment document of its own yet.'}
          </Text>
          )
        : <Text>No related documents yet.</Text>}
    </Card>
  )
}
