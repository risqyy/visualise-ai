/** Console rendering of a run. */
import type { EventEnvelope } from './types.js'

export interface Reporter {
  phase(name: string): void
  step(line: string): void
  note(line: string): void
  blank(): void
}

/**
 * Writes the narrative. With `--json` it goes to stderr so stdout carries
 * nothing but the machine-readable summary and stays pipeable.
 */
export function createReporter(toStderr: boolean): Reporter {
  const write = (line: string): void => {
    const stream = toStderr ? process.stderr : process.stdout
    stream.write(line + '\n')
  }
  return {
    phase: (name) => write(`\n── ${name} ${'─'.repeat(Math.max(0, 58 - name.length))}`),
    step: write,
    note: write,
    blank: () => write(''),
  }
}

const MAX_COMPONENTS = 3

/**
 * Summarises which architecture components an event talks about, so the console
 * shows what moved rather than only that something did.
 */
export function affectedComponents(event: EventEnvelope): string[] {
  const payload = event.payload as Record<string, unknown>
  const ids = new Set<string>()

  const addAll = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') ids.add(entry)
      }
    }
  }

  addAll(payload.componentIds)

  const component = payload.component as { componentId?: unknown } | undefined
  if (component && typeof component.componentId === 'string') ids.add(component.componentId)

  const relationship = payload.relationship as
    | { sourceComponentId?: unknown; targetComponentId?: unknown }
    | undefined
  if (relationship) {
    if (typeof relationship.sourceComponentId === 'string') ids.add(relationship.sourceComponentId)
    if (typeof relationship.targetComponentId === 'string') ids.add(relationship.targetComponentId)
  }

  const components = payload.components
  if (Array.isArray(components)) {
    for (const entry of components) {
      const id = (entry as { componentId?: unknown }).componentId
      if (typeof id === 'string') ids.add(id)
    }
  }

  const steps = payload.steps
  if (Array.isArray(steps)) {
    for (const entry of steps) {
      addAll((entry as { componentIds?: unknown }).componentIds)
    }
  }

  const corrected = payload.correctedPayload as { componentIds?: unknown } | undefined
  if (corrected) addAll(corrected.componentIds)

  return [...ids]
}

/** Renders the component list of an event, abbreviated when it is long. */
export function formatComponents(event: EventEnvelope): string {
  const ids = affectedComponents(event)
  if (ids.length === 0) return '—'
  if (ids.length <= MAX_COMPONENTS) return ids.join(', ')
  return `${ids.slice(0, MAX_COMPONENTS).join(', ')} +${ids.length - MAX_COMPONENTS} more`
}

export function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

export function padStart(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value
}
