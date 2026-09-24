import React from 'react'
import { Flex, View, Heading, Text } from '@adobe/react-spectrum'
import Frame from './Frame'

function Stat ({ label, value }) {
  return (
    <View backgroundColor='gray-75' borderRadius='medium' padding='size-200' minWidth='size-2000'>
      <Text UNSAFE_className='erp-subtle'>{label}</Text>
      <Heading level={2} marginY='size-50'>{value}</Heading>
    </View>
  )
}

/*
 * `reloading` comes from App: this screen's numbers ARE the health read, which App holds
 * so the rail can show the ERP's name. Without the flag the Dashboard would be the one
 * page that answered a rail click by sitting still.
 */
export default function Dashboard ({ health, reloading }) {
  const counts = (health && health.counts) || {}

  // What a prospect sees first: the ERP's size and state. The controls for
  // rehearsing and presenting are on Settings.
  return (
    <Frame title='Dashboard' loading={!health || reloading}>
      {health && (
        <>
          <Flex gap='size-200' wrap marginBottom='size-300'>
            <Stat label='Products' value={counts.products ?? 0} />
            <Stat label='Customers' value={counts.businessPartners ?? 0} />
            <Stat label='Sales Orders' value={counts.salesOrders ?? 0} />
            <Stat label='Pricing Rules' value={counts.pricingConditions ?? 0} />
            {/* Waiting to be delivered, not the journal's size: it also holds
                delivered and incoming entries. */}
            <Stat label='Events Pending' value={health.eventsPending ?? 0} />
          </Flex>
        </>
      )}
    </Frame>
  )
}
