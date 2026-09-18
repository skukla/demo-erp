import React from 'react'
import { Flex, View, Heading, Text } from '@adobe/react-spectrum'
import Frame from './Frame'

function Stat ({ label, value }) {
  return (
    <View backgroundColor='gray-75' borderRadius='medium' padding='size-200' minWidth='size-2000'>
      <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-700)' }}>{label}</Text>
      <Heading level={2} marginY='size-50'>{value}</Heading>
    </View>
  )
}

export default function Dashboard ({ health }) {
  const counts = (health && health.counts) || {}

  // What a prospect sees first: the ERP's size and state. The controls for
  // rehearsing and presenting are on Settings.
  return (
    <Frame title='Dashboard' loading={!health}>
      {health && (
        <>
          <Flex gap='size-200' wrap marginBottom='size-300'>
            <Stat label='Products' value={counts.products ?? 0} />
            <Stat label='Business partners' value={counts.businessPartners ?? 0} />
            <Stat label='Sales orders' value={counts.salesOrders ?? 0} />
            <Stat label='Pricing conditions' value={counts.pricingConditions ?? 0} />
            <Stat label='Events pending' value={counts.events ?? 0} />
          </Flex>
        </>
      )}
    </Frame>
  )
}
