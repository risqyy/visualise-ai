import agentsDe from './locales/de/agents.json'
import canvasDe from './locales/de/canvas.json'
import commonDe from './locales/de/common.json'
import errorsDe from './locales/de/errors.json'
import inspectorDe from './locales/de/inspector.json'
import projectsDe from './locales/de/projects.json'
import workspaceDe from './locales/de/workspace.json'
import agentsEn from './locales/en/agents.json'
import canvasEn from './locales/en/canvas.json'
import commonEn from './locales/en/common.json'
import errorsEn from './locales/en/errors.json'
import inspectorEn from './locales/en/inspector.json'
import projectsEn from './locales/en/projects.json'
import workspaceEn from './locales/en/workspace.json'

/**
 * Every catalogue, statically imported.
 *
 * There is no HTTP backend and no lazy namespace loading on purpose: the
 * catalogues are part of the bundle, so `i18next.init()` finishes synchronously
 * and the very first render already has its texts. An async loader would show
 * one language (or bare keys) and replace it a tick later — the visible
 * language switch at start-up that #38 forbids.
 *
 * `workspace`, `canvas`, `agents` and `inspector` exist but are still empty.
 * Their texts are migrated in #42; the namespaces are created here so #42 only
 * has to fill files, not invent a structure.
 */
export const resources = {
  de: {
    common: commonDe,
    errors: errorsDe,
    projects: projectsDe,
    workspace: workspaceDe,
    canvas: canvasDe,
    agents: agentsDe,
    inspector: inspectorDe,
  },
  en: {
    common: commonEn,
    errors: errorsEn,
    projects: projectsEn,
    workspace: workspaceEn,
    canvas: canvasEn,
    agents: agentsEn,
    inspector: inspectorEn,
  },
} as const

/** The namespace whose keys need no `ns:` prefix. */
export const DEFAULT_NAMESPACE = 'common'

export const NAMESPACES = [
  'common',
  'errors',
  'projects',
  'workspace',
  'canvas',
  'agents',
  'inspector',
] as const

export type Namespace = (typeof NAMESPACES)[number]

/**
 * The shape `t()` is typed against. German is the reference: it is the source
 * language, so a key exists once it exists in German. That the English
 * catalogue carries the same keys is not a matter of types but of
 * `npm run check:locales`, which compares the two files.
 */
export type AppResources = (typeof resources)['de']
