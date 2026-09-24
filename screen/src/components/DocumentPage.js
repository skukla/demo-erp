/*
 * The frame every document shares: Back to where you came from, the title line with the
 * document's actions on it, and one error banner. Three documents drew this themselves
 * before the shipment and invoice arrived and made it five.
 */
import React from 'react'
import { ActionButton, Content, Heading, InlineAlert, Text } from '@adobe/react-spectrum'
import ChevronLeft from '@spectrum-icons/workflow/ChevronLeft'
import PageLoading from './PageLoading'

export function BackButton ({ label, onBack }) {
  return (
    <ActionButton isQuiet onPress={onBack} marginBottom='size-150'>
      <ChevronLeft />
      <Text>{label}</Text>
    </ActionButton>
  )
}

/**
 * @param {object} props `title`; `subtitle` under it; `actions` on the title line;
 *   `error` (an Error, or null); `loading` shows the spinner instead of the body
 */
export default function DocumentPage ({ backLabel, onBack, title, subtitle, actions, error, loading, children }) {
  return (
    <>
      <BackButton label={backLabel} onBack={onBack} />
      {loading && !error && <PageLoading />}
      {!loading && (
        <div className='erp-page-header'>
          <div>
            <Heading level={1} marginY={0}>{title}</Heading>
            {subtitle && <Text UNSAFE_className='erp-subtle'>{subtitle}</Text>}
          </div>
          {actions && <div className='erp-page-actions'>{actions}</div>}
        </div>
      )}
      {error && (
        <InlineAlert variant='negative' marginBottom='size-200'>
          <Heading>Something went wrong</Heading>
          <Content>{error.message}</Content>
        </InlineAlert>
      )}
      {!loading && children}
    </>
  )
}
