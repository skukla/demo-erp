/*
 * One labelled fact on a document header: the label small above, the value below. SAP
 * and Business Central both print a document's header this way, and two documents
 * (order, customer) printing it two ways is how a screen stops reading as one system.
 */
import React from 'react'
import { Flex, Text } from '@adobe/react-spectrum'

/** An absent value reads as a dash, never as an empty gap. */
export default function Field ({ label, children }) {
  // alignItems start, not the default stretch: a status badge is as wide as its word,
  // and a flex column would otherwise pull it across the whole field.
  return (
    <Flex direction='column' gap='size-25' alignItems='start'>
      <Text UNSAFE_className='erp-field-label'>{label}</Text>
      {typeof children === 'string' || typeof children === 'number'
        ? <Text>{children}</Text>
        : (children || <Text>—</Text>)}
    </Flex>
  )
}
