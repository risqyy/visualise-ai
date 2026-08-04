import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'

import { createQueryClient } from './api/queryClient'
import { bindDocumentLanguage, createI18n } from './i18n'
import { createAppRouter } from './routes/router'
import './index.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('root container is missing from index.html')
}

// The language is decided, and the catalogues are in place, before the router
// exists — let alone renders. `createI18n` returns an initialised instance
// synchronously because the catalogues are bundled, so the first paint is
// already in the final language and start-up shows no language switch.
// `bindDocumentLanguage` keeps `<html lang>` on the same value.
const i18n = createI18n()
bindDocumentLanguage(i18n)

const queryClient = createQueryClient()
const router = createAppRouter({ queryClient })

createRoot(container).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
)
