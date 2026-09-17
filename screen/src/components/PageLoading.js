/* A page that is still loading: one large spinner in the middle of the content area. */
import React from 'react'
import { Flex, ProgressCircle } from '@adobe/react-spectrum'

export default function PageLoading ({ label = 'Loading' }) {
  return (
    <Flex alignItems='center' justifyContent='center' width='100%' UNSAFE_style={{ minHeight: '70vh' }}>
      <ProgressCircle size='L' aria-label={label} isIndeterminate />
    </Flex>
  )
}
