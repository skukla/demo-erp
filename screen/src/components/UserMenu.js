/*
 * The user menu at the end of the shell bar. How the screen looks is the SC's preference,
 * not the ERP's setup, so it lives here and not in Settings: Fiori keeps it under the user
 * menu (Settings > Appearance), Business Central under My Settings.
 *
 * The button names nobody — no name, no initials. The ERP has no sign-in (the key in the
 * link is the only credential), so it cannot know who is looking, and a generic person is
 * the honest mark.
 */
import React, { useState } from 'react'
import { ActionButton, DialogContainer, Item, Menu, MenuTrigger } from '@adobe/react-spectrum'
import User from '@spectrum-icons/workflow/User'
import AppearancePanel from './AppearancePanel'

/**
 * @param {object} props `api`; `saved` — the ERP's look now; `onPreview(look|null)` shows a
 *   look before it is saved; `onChanged` reads health again
 */
export default function UserMenu ({ api, saved, onPreview, onChanged }) {
  // The open panel's key from the menu, or null.
  const [open, setOpen] = useState(null)
  return (
    <>
      <MenuTrigger align='end'>
        <ActionButton isQuiet staticColor='white' aria-label='User menu' UNSAFE_className='erp-user-menu'>
          <User />
        </ActionButton>
        <Menu onAction={(key) => setOpen(String(key))}>
          <Item key='appearance'>Appearance</Item>
        </Menu>
      </MenuTrigger>
      {/* Escape dismisses as Cancel does: the panel unmounts and its preview goes with it. */}
      <DialogContainer onDismiss={() => setOpen(null)}>
        {open === 'appearance' && (
          <AppearancePanel api={api} saved={saved} onPreview={onPreview} onChanged={onChanged} close={() => setOpen(null)} />
        )}
      </DialogContainer>
    </>
  )
}
