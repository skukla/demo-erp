/* A page's heading, its error banner, and its body. */
import React from 'react'
import { Heading, InlineAlert, Content, ProgressCircle, Flex } from '@adobe/react-spectrum'

export default function Frame ({ title, error, loading, children, actions }) {
  return (
    <>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
        <Heading level={1} marginY={0}>{title}</Heading>
        {actions}
      </Flex>
      {error && (
        <InlineAlert variant='negative' marginBottom='size-200'>
          <Heading>Something went wrong</Heading>
          <Content>{error.message}</Content>
        </InlineAlert>
      )}
      {loading ? <ProgressCircle aria-label='Loading' isIndeterminate /> : children}
    </>
  )
}
