/*
 * A section of a page, on its own surface.
 *
 * Every screen in the ERP is cards over the canvas — that contrast is most of what makes
 * a page read as arranged rather than as a run of text. The surface itself is one CSS
 * rule (.erp-card in design/app.css); this component is the heading-and-rule that goes
 * on top of it, so four screens cannot each decide what a card's title looks like.
 *
 * A card with no title is ordinary: an order's header card sits under the page title and
 * needs no second one.
 */
import React from 'react'
import { Divider, Heading } from '@adobe/react-spectrum'

export default function Card ({ title, actions, children }) {
  return (
    <div className='erp-card'>
      {title && (
        <>
          <div className='erp-card-header'>
            <Heading level={3} marginY={0}>{title}</Heading>
            {actions && <div className='erp-card-actions'>{actions}</div>}
          </div>
          <Divider size='S' marginBottom='size-200' />
        </>
      )}
      {children}
    </div>
  )
}
