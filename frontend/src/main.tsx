import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { createQueryClient } from './api/queryClient'
import { createAppRouter } from './routes/router'
import './index.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('root container is missing from index.html')
}

const queryClient = createQueryClient()
const router = createAppRouter({ queryClient })

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
