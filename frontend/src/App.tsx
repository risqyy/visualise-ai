import { useEffect, useState } from 'react'

import { fetchBackendStatus, type BackendStatus } from './backendStatus'

export function App() {
  const [status, setStatus] = useState<BackendStatus>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    void fetchBackendStatus().then((next) => {
      if (!cancelled) setStatus(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="shell">
      <h1>Visualise AI — Agent Cockpit</h1>
      <p className="lead">
        Observability scaffold. Nginx serves this bundle and is the only externally
        reachable entry point; the backend and PostgreSQL stay inside the Compose
        network.
      </p>
      <section aria-labelledby="backend-heading" className="panel">
        <h2 id="backend-heading">Backend</h2>
        <p data-testid="backend-status">{describe(status)}</p>
      </section>
    </main>
  )
}

function describe(status: BackendStatus): string {
  switch (status.state) {
    case 'loading':
      return 'Checking readiness…'
    case 'ready':
      return `Ready (version ${status.version})`
    case 'unavailable':
      return `Unavailable: ${status.reason}`
  }
}
