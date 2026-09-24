/*
 * The three money figures under a document's lines: net, tax when there is any, total.
 * Net is the lines. Total is what Commerce charged. The ERP does not calculate tax; it
 * reports the difference, which is why the row is absent when there is none rather than
 * printing a zero it did not work out.
 */
import React from 'react'
import { Flex, Text, View } from '@adobe/react-spectrum'
import { money } from '../money'

/** One figure: a label on the left, the amount right-aligned. */
function Total ({ label, amount, currency, strong }) {
  return (
    <Flex justifyContent='space-between' gap='size-400'>
      <Text UNSAFE_className={strong ? undefined : 'erp-subtle'}>
        {strong ? <strong>{label}</strong> : label}
      </Text>
      <Text>{strong ? <strong>{money(amount, currency)}</strong> : money(amount, currency)}</Text>
    </Flex>
  )
}

export default function Totals ({ net, tax, total, currency }) {
  return (
    <View marginTop='size-300' marginStart='auto' width='size-3600'>
      <Flex direction='column' gap='size-100'>
        <Total label='Net amount' amount={net} currency={currency} />
        {tax !== 0 && <Total label='Tax' amount={tax} currency={currency} />}
        <Total label='Total' amount={total} currency={currency} strong />
      </Flex>
    </View>
  )
}
