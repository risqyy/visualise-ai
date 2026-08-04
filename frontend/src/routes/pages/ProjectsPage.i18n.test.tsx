import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { type Language, createI18n } from '@/i18n'
import { PROJECT_ID, RUN_ID, createFakeFetch, projectsResponse } from '@/test/fixtures'
import { renderApp } from '@/test/renderApp'

/**
 * The project list is the area migrated onto the catalogues in #38, and it is
 * the proof that the foundation carries: the same components render German and
 * English, the reported data does not move, and the start-up shows one language
 * and not two.
 */

const EMPTY_PROJECTS = { ...projectsResponse, projects: [] }

async function reportedValuesOf(language: Language): Promise<(string | null)[]> {
  const { container, unmount } = renderApp('/projects', { language })
  await screen.findAllByRole('link')
  const values = [...container.querySelectorAll('[data-reported]')].map(
    (node) => node.textContent,
  )
  unmount()
  return values
}

describe('project list — languages', () => {
  it('renders German by default, without a language change during start-up', async () => {
    const i18n = createI18n({ language: 'de' })
    const changes: string[] = []
    i18n.on('languageChanged', (language: string) => changes.push(language))

    renderApp('/projects', { i18n })

    expect(await screen.findByRole('heading', { name: 'Projekte' })).toBeVisible()
    expect(
      screen.getByText('Beobachtete Projekte. Ein Projekt öffnet direkt seinen aktuellen Run.'),
    ).toBeVisible()
    // Nothing switched the language while the app came up, so no text was ever
    // shown in one language and replaced by another.
    expect(changes).toEqual([])
  })

  it('renders the same components in English', async () => {
    renderApp('/projects', { language: 'en' })

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible()
    expect(
      screen.getByText('Observed projects. Opening a project goes straight to its current run.'),
    ).toBeVisible()
  })

  it('translates the accessible name and keeps the reported id inside it', async () => {
    renderApp('/projects', { language: 'en' })

    expect(
      await screen.findByRole('link', { name: `Open project ${PROJECT_ID}` }),
    ).toBeVisible()
  })

  it('leaves reported project data identical in both languages', async () => {
    const german = await reportedValuesOf('de')
    const english = await reportedValuesOf('en')

    expect(german).toEqual([PROJECT_ID, '2026-08-04T09:12:00Z', RUN_ID])
    expect(english).toEqual(german)
  })
})

describe('project list — loading, empty and error states', () => {
  it('announces loading in the active language', async () => {
    renderApp('/projects', { language: 'en' })

    expect(await screen.findByText('Loading data…')).toBeInTheDocument()
    // …and disappears once the list arrives, rather than lingering as a label.
    await screen.findAllByRole('link')
    expect(screen.queryByText('Loading data…')).not.toBeInTheDocument()
  })

  it('translates the empty state in both languages', async () => {
    renderApp('/projects', {
      language: 'de',
      fetchImpl: createFakeFetch({ '/api/v1/projects': EMPTY_PROJECTS }),
    })
    expect(await screen.findByText('Noch keine Projekte gemeldet')).toBeVisible()
    expect(
      screen.getByText(
        'Ein Projekt entsteht, sobald ein Agent das erste Ereignis an /api/v1/events sendet.',
      ),
    ).toBeVisible()
  })

  it('translates the empty state in English', async () => {
    renderApp('/projects', {
      language: 'en',
      fetchImpl: createFakeFetch({ '/api/v1/projects': EMPTY_PROJECTS }),
    })

    expect(await screen.findByText('No projects reported yet')).toBeVisible()
    expect(
      screen.getByText(
        'A project appears as soon as an agent sends its first event to /api/v1/events.',
      ),
    ).toBeVisible()
  })

  it('translates the error state but not what the backend reported', async () => {
    const problem = {
      type: 'https://visualise.ai/problems/internal',
      title: 'Projections are rebuilding',
      status: 503,
      detail: 'The read model is not available yet.',
      code: 'projections_unavailable',
    }
    const failing = createFakeFetch({
      '/api/v1/projects': () =>
        new Response(JSON.stringify(problem), {
          status: 503,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
    })

    renderApp('/projects', { language: 'en', fetchImpl: failing })

    expect(await screen.findByText('Data could not be loaded')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    // The backend's own words are reported data and stay as they came.
    await waitFor(() => {
      expect(
        screen.getByText('Projections are rebuilding (projections_unavailable)'),
      ).toBeVisible()
    })
  })
})
