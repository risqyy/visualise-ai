import { z } from 'zod'

/**
 * Search parameters of the workspace route.
 *
 * The URL is the single source of truth for what the user is looking at, so a
 * link can reproduce a cockpit view exactly. Every parameter is validated with
 * Zod through TanStack Router's `validateSearch`, which makes the parsed object
 * typed for `useSearch()` *and* for every `navigate()`/`<Link>` that targets the
 * route.
 *
 * Validation never throws the user out of the workspace. Each field falls back
 * to `undefined` when it cannot be understood — a broken bookmark then shows the
 * default view instead of an error page, which is the behaviour an observability
 * surface should have.
 */
export const DEEP_FOCUS_TARGETS = ['feedback', 'diffs'] as const

/** `ComponentId` per contract: max 128 characters, never empty. */
const componentIdSchema = z.preprocess(
  // TanStack Router parses search values as JSON, so a numeric component id
  // such as `?component=42` arrives as a number. Normalise it back to a string.
  (value) => (typeof value === 'number' ? String(value) : value),
  z.string().min(1).max(128),
)

export const workspaceSearchSchema = z.object({
  /** Selected component; drives the inspector. */
  component: componentIdSchema.optional().catch(undefined),
  /** Deep-focus target for large feedback or diff content. */
  focus: z.enum(DEEP_FOCUS_TARGETS).optional().catch(undefined),
  /** Show the component history instead of the current run. */
  history: z.boolean().optional().catch(undefined),
})

export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>
export type DeepFocusTarget = (typeof DEEP_FOCUS_TARGETS)[number]

/**
 * `validateSearch` implementation. Unknown parameters are dropped, invalid ones
 * fall back to `undefined`; the result is always a valid `WorkspaceSearch`.
 */
export function validateWorkspaceSearch(search: Record<string, unknown>): WorkspaceSearch {
  return workspaceSearchSchema.parse(search)
}
