/*
 * The frame every document shares: Back to where you came from, the title line with the
 * document's actions on it, and one error banner. Three documents drew this themselves
 * before the shipment and invoice arrived and made it five.
 */
import React from 'react'
import { ActionButton, Content, Heading, InlineAlert, Text } from '@adobe/react-spectrum'
import ChevronLeft from '@spectrum-icons/workflow/ChevronLeft'
import PageLoading from './PageLoading'

export function BackButton ({ label, onBack, marginBottom = 'size-150' }) {
  return (
    <ActionButton isQuiet onPress={onBack} marginBottom={marginBottom}>
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
      {loading && !error && (
        <>
          <BackButton label={backLabel} onBack={onBack} />
          <PageLoading />
        </>
      )}
      {!loading && (
        // Back sits INSIDE the sticky header. Before it, the header's negative top
        // margin (which lets it stick flush under the shell bar) rose over the Back
        // button above it and painted the canvas across its label (2026-10-13).
        // Inside, it stays reachable while the document scrolls, too.
        <div className='erp-page-header'>
          <div className='erp-page-back'>
            <BackButton label={backLabel} onBack={onBack} marginBottom={0} />
          </div>
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
