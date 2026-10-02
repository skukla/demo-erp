/*
 * Settings: the ERP's setup, four sections shaped like Business Central's setup pages
 * (AB-59): Company, Sales & Receivables, Number Series and Sales Organizations. Only fields
 * the ERP acts on; each says where in one line at most.
 *
 * What is not here on purpose: wiping the records and a maintenance window, which are the
 * demo's, not the ERP's, and live on the ERP's card in Demo Builder (their routes are
 * unchanged); and the screen's appearance, which is the SC's own preference and sits in the
 * user menu at the end of the shell bar (UserMenu.js). So someone changing a real setting
 * mid-demo never meets them.
 */
import React, { useEffect, useState } from 'react'
import Frame from './Frame'
import SetupCompany from './SetupCompany'
import SetupSales from './SetupSales'
import SetupNumberSeries from './SetupNumberSeries'
import SetupSalesOrganizations from './SetupSalesOrganizations'

export default function Settings ({ api, onChanged }) {
  const [setup, setSetup] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { api.setup().then(setSetup).catch(setError) }, [api])

  /* A change answers the whole setup; the company's currency and code also reach health. */
  async function keep (call) {
    const next = await call()
    setSetup(next)
    await onChanged()
    return next
  }

  return (
    <Frame title='Settings' error={error} loading={!setup}>
      {setup && (
        /* Two columns, so a wide monitor is not half empty: the forms on the left, the two
           tables on the right. Narrow, they stack in that order (design/app.css). */
        <div className='erp-settings-columns'>
          <div className='erp-settings-column'>
            <SetupCompany company={setup.company} onSave={(patch) => keep(() => api.saveSetup(patch))} />
            <SetupSales sales={setup.sales} onSave={(patch) => keep(() => api.saveSetup(patch))} />
          </div>
          <div className='erp-settings-column'>
            <SetupNumberSeries series={setup.numberSeries} onSave={(patch) => keep(() => api.saveSetup(patch))} />
            <SetupSalesOrganizations
              salesOrganizations={setup.salesOrganizations}
              onAdd={(org) => keep(() => api.addSalesOrganization(org))}
              onEdit={(code, patch) => keep(() => api.updateSalesOrganization(code, patch))}
            />
          </div>
        </div>
      )}
    </Frame>
  )
}
