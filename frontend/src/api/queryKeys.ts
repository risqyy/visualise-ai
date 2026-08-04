import type { ComponentId, ProjectId, RunId } from './types'

/**
 * The single source of truth for every query key in the cockpit.
 *
 * Every hook builds its key here and the SSE client resolves an incoming event
 * to a **set of these keys**. That is what makes targeted invalidation possible:
 * an `agent.progress_reported` touches the agent tree of one run and nothing
 * else. There is deliberately no `invalidateQueries()` without a key anywhere in
 * the code base.
 *
 * The keys are nested so that a scope key is a prefix of everything below it —
 * TanStack Query matches by prefix, so invalidating `component(p, c)` covers the
 * inspector *and* the history of that component, and nothing outside it.
 *
 *   ['vai']
 *     └ 'projects'                              projects()          list
 *     └ 'project', projectId                    project()           project scope
 *         └ 'detail'                            projectDetail()
 *         └ 'architecture'                      architecture()
 *         └ 'runs'                              runs()              paged list
 *             └ 'current'                       currentRun()        `current` alias
 *         └ 'run', runId                        run()               run scope
 *             └ 'detail'                        runDetail()
 *             └ 'agents'                        agents()
 *             └ 'plans'                         plans()
 *         └ 'component', componentId            component()         component scope
 *             └ 'inspector', runId              componentInspector()
 *             └ 'history'                       componentHistory()
 */
const ROOT = ['vai'] as const

export const queryKeys = {
  /** Everything the cockpit caches. Used only for a full reset, never live. */
  root: () => ROOT,

  /** The project list. */
  projects: () => [...ROOT, 'projects'] as const,

  /** Scope of one project: prefix of every project-bound query. */
  project: (projectId: ProjectId) => [...ROOT, 'project', projectId] as const,

  projectDetail: (projectId: ProjectId) =>
    [...queryKeys.project(projectId), 'detail'] as const,

  architecture: (projectId: ProjectId) =>
    [...queryKeys.project(projectId), 'architecture'] as const,

  /** Paged run list of a project. */
  runs: (projectId: ProjectId) =>
    [...queryKeys.project(projectId), 'runs'] as const,

  /**
   * The `current` alias of `GET /runs/{runId}`.
   *
   * Nested below `runs` on purpose: `run.finished` already invalidates that
   * prefix, so closing a run refreshes the current-run pointer without adding
   * an entry to the event → query-key map.
   */
  currentRun: (projectId: ProjectId) =>
    [...queryKeys.runs(projectId), 'current'] as const,

  /** Scope of one run: prefix of run detail, agents and plans. */
  run: (projectId: ProjectId, runId: RunId) =>
    [...queryKeys.project(projectId), 'run', runId] as const,

  runDetail: (projectId: ProjectId, runId: RunId) =>
    [...queryKeys.run(projectId, runId), 'detail'] as const,

  agents: (projectId: ProjectId, runId: RunId) =>
    [...queryKeys.run(projectId, runId), 'agents'] as const,

  plans: (projectId: ProjectId, runId: RunId) =>
    [...queryKeys.run(projectId, runId), 'plans'] as const,

  /** Scope of every component of a project. */
  components: (projectId: ProjectId) =>
    [...queryKeys.project(projectId), 'component'] as const,

  /** Scope of one component: prefix of its inspector and its history. */
  component: (projectId: ProjectId, componentId: ComponentId) =>
    [...queryKeys.components(projectId), componentId] as const,

  componentInspector: (
    projectId: ProjectId,
    componentId: ComponentId,
    runId: RunId,
  ) => [...queryKeys.component(projectId, componentId), 'inspector', runId] as const,

  componentHistory: (projectId: ProjectId, componentId: ComponentId) =>
    [...queryKeys.component(projectId, componentId), 'history'] as const,
} as const

export type QueryKeyFactory = typeof queryKeys
