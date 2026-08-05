import type { ParseKeys } from 'i18next'

/**
 * Namespace-bound key types.
 *
 * A closed vocabulary of the read model — the four work states, the nine
 * component kinds, the six relationship kinds, the twenty event types — is a
 * `Record` keyed by the *contract* value. After the migration (#42) its values
 * are no longer German strings but **translation keys**, and these aliases are
 * what makes a wrong one a compile error at the place the map is written rather
 * than at the place it is rendered.
 *
 * The maps live next to the domain they describe (`state/workStates.ts`,
 * `canvas/relationshipKinds.ts`, …) and not in the catalogue directory, because
 * what a work state *is* — its icon, its stroke pattern, its border style — is
 * not a translation concern. Only its words are.
 *
 * Every helper that formats such a vocabulary takes the `t` of exactly one
 * namespace (`TFunction<'canvas'>`), and its callers obtain it with
 * `useTranslation('canvas')`. Binding a helper to one namespace keeps the keys
 * unprefixed and the function type an exact match, so nothing has to be cast.
 */
export type CommonKey = ParseKeys<'common'>
export type ErrorsKey = ParseKeys<'errors'>
export type ProjectsKey = ParseKeys<'projects'>
export type WorkspaceKey = ParseKeys<'workspace'>
export type CanvasKey = ParseKeys<'canvas'>
export type AgentsKey = ParseKeys<'agents'>
export type InspectorKey = ParseKeys<'inspector'>
