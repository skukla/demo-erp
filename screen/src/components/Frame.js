/*
 * A page's heading, its error banner, and its body.
 *
 * Every page's own actions go in one place: the right of the title, on the title's
 * line. SAP Fiori and Business Central both put a page's commands in its header rather
 * than scattered through the body, and one rule beats each screen deciding for itself.
 * Under the narrow breakpoint they drop below the title (theme.css).
 */
import React from 'react'
import { Heading, InlineAlert, Content } from '@adobe/react-spectrum'
import PageLoading from './PageLoading'

export default function Frame ({ title, error, loading, children, actions }) {
  return (
    <>
      <div className='erp-page-header'>
        <Heading level={1} marginY={0}>{title}</Heading>
        {actions && <div className='erp-page-actions'>{actions}</div>}
      </div>
      {error && (
        <InlineAlert variant='negative' marginBottom='size-200'>
          <Heading>Something went wrong</Heading>
          <Content>{error.message}</Content>
        </InlineAlert>
      )}
      {loading ? <PageLoading /> : children}
    </>
  )
}
