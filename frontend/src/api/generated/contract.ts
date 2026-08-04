/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced from `api/openapi.yaml` by `npm run generate:contract`
 * (openapi-typescript). Edit the contract, then regenerate.
 *
 * authority: api/openapi.yaml
 * sha256:    7e96a6f09ee1c901eeeb02dedaa7c0fe1edd94173046ebaf51e286f75684e618
 *
 * `npm run check:contract` — also run by the Vitest suite — fails when this
 * file no longer matches the authority above.
 */
export interface paths {
    "/api/v1/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ingest a single agent event
         * @description Accepts exactly one event. The request body is a discriminated union over the closed
         *     v0 event catalogue; the `type` field selects the concrete envelope schema and therefore
         *     the concrete payload schema.
         *
         *     The endpoint is idempotent on `clientEventId` within a project:
         *
         *     * first delivery -> `201 Created`, `duplicate: false`
         *     * byte-identical redelivery -> `200 OK`, `duplicate: true`, original `position`
         *     * same `clientEventId` with different content -> `409 Conflict`
         *
         *     Requests larger than the configured limit (default 2 MiB / 2097152 bytes,
         *     `MAX_EVENT_BYTES`) are rejected with `413`.
         */
        post: operations["ingestEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Stream project events via Server-Sent Events
         * @description Opens a Server-Sent Events stream for one project. The stream first replays every
         *     committed event after the requested position and then continues seamlessly with live
         *     events. Each committed event is delivered **exactly once, in position order, without
         *     duplicates and without gaps**.
         *
         *     ## Choosing the start position
         *
         *     1. `Last-Event-ID` request header (the standard SSE reconnect path). It carries the
         *        server-side project `position` of the last event the client processed.
         *     2. `lastEventPosition` query parameter, for clients that persist the cursor themselves.
         *     3. Neither given -> the stream starts with the live tail only, no replay.
         *
         *     If both are present, `lastEventPosition` wins. Replay starts at
         *     `lastEventPosition + 1`.
         *
         *     ## Frame format
         *
         *     OpenAPI cannot describe SSE frames structurally, so the wire format is documented here.
         *     The response schema describes the JSON object carried in a single `data:` line.
         *
         *     * `id:` — server-side project `position` (an integer). Browsers echo it back as
         *       `Last-Event-ID` on reconnect.
         *     * `event:` — the event `type` from the catalogue, so clients can subscribe per type.
         *     * `data:` — one line of compact JSON, a `StreamedEvent`.
         *     * Keepalives are sent as SSE comment lines (`: keepalive`) and carry no `id:`.
         *
         *     ```text
         *     id: 41
         *     event: agent.status_reported
         *     data: {"schemaVersion":"1.0","clientEventId":"9a1f...","projectId":"visualise-ai","runId":"run-2026-08-04-0001","agentId":"subagent-openapi-contract","parentAgentId":"orchestrator-root","occurredAt":"2026-08-04T09:31:02Z","type":"agent.status_reported","payload":{"status":"working","note":"Writing the OpenAPI document."},"position":41,"serverEventId":"1d2c...","receivedAt":"2026-08-04T09:31:02.117Z"}
         *
         *     : keepalive
         *
         *     id: 42
         *     event: diff.reported
         *     data: {"schemaVersion":"1.0", ...}
         *
         *     ```
         *
         *     A full reconnect walkthrough is documented in
         *     [`examples/sse-reconnect.md`](./examples/sse-reconnect.md).
         */
        get: operations["streamProjectEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List every known project
         * @description Lists every project the backend has accepted an event for, ordered by `projectId`.
         *
         *     This is the only read endpoint that is not scoped to a single project, so its
         *     `projectPosition` is the highest position across the listed projects. The value a
         *     client needs for reconciling one project is repeated on every entry as `lastPosition`.
         */
        get: operations["listProjects"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one project with the sizes of its read models
         * @description Returns the project head row together with the sizes of its read models, so the shell
         *     can render its navigation without fetching every collection first.
         *
         *     `counts.activeChanges` counts pending proposals only — see the architecture endpoint.
         */
        get: operations["getProject"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/architecture": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the applied architecture model and the pending proposals
         * @description Returns the **applied** architecture model — every component and every relationship the
         *     project currently has — plus the change proposals that are still pending.
         *
         *     The two are kept strictly apart:
         *
         *     * `components` and `relationships` are what `architecture.snapshot_published` and the
         *       `*.change_applied` events produced. Every NATS topic keeps its own relationship; edges
         *       are never aggregated server side.
         *     * `activeChanges` holds the changes in state `planned`. An applied change *is* the model
         *       and a retracted change was withdrawn, so neither is active any more. A planned change
         *       never modifies `components` or `relationships`.
         *
         *     The component hierarchy is expressed exclusively through `parentComponentId`; the list
         *     itself is flat and ordered by `componentId`, which makes the layout deterministic.
         */
        get: operations["getProjectArchitecture"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List current and historical runs
         * @description Lists the runs of one project, descending by reported start time. Current and
         *     historical runs appear in the same list; `isOpen` and `isCurrent` distinguish them.
         *
         *     A run stays open until an explicit `run.finished` closes it — silence never produces a
         *     terminal state, so an abandoned run keeps `isOpen: true` and its last reported values.
         */
        get: operations["listProjectRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one run, or the current one
         * @description Returns one run together with the sizes of the collections hanging off it.
         *
         *     The literal `current` resolves to the run a root orchestrator opened last. A project
         *     that never saw a root orchestrator has no current run, which is reported as `404` with
         *     the distinct code `current_run_not_found` — "no run yet" is not the same failure as
         *     "this run id is wrong".
         */
        get: operations["getProjectRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/runs/{runId}/agents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the agent tree of one run
         * @description Returns every agent of one run as a **flat list**; the tree is expressed through
         *     `parentAgentId`. A flat list keeps arbitrarily deep spawn chains renderable without the
         *     server committing to a nesting depth.
         *
         *     Entries are ordered by start time, so a parent always precedes the subagents it
         *     spawned and a consumer can build the tree in a single pass.
         *
         *     Reported values stay where they were reported: `status` is empty until the agent sent
         *     `agent.status_reported`, `progress` is `null` until it reported a number itself, and
         *     `finishedOutcome` is `null` until it sent `agent.finished`. Nothing is derived from
         *     silence. `progress.scope` separates a subagent's own task from an orchestrator's
         *     overall estimate.
         */
        get: operations["listRunAgents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/runs/{runId}/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get every plan of one run with all of its revisions
         * @description Returns every plan of one run together with **all** of its revisions and their steps.
         *
         *     Revisions are append-only: publishing a new revision never rewrites an earlier one, and
         *     a `plan.step_updated` only reaches the revision that was current when it was reported.
         *     An earlier revision therefore keeps exactly the step states it was last seen with,
         *     which is what makes a plan change reviewable rather than invisible.
         */
        get: operations["listRunPlans"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/components/{componentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the component inspector for one run
         * @description Returns everything the inspector shows for one component: the applied descriptor, the
         *     responsible agent, the current work step and the component scoped feedback, unified
         *     diffs, risks, problems and pending proposals.
         *
         *     The response carries the evidence of **exactly one run** — the one named by `runId`, or
         *     the current run when the parameter is omitted. Evidence of other runs is never mixed
         *     in; the run spanning view is `…/history`.
         *
         *     `component` is `null` when the component left the applied model, for example after a
         *     `remove` or a snapshot that no longer lists it. Its evidence and its history survive,
         *     which is why that case is a body with `component: null` and not a `404`. A component
         *     the project never mentioned at all is a `404`.
         *
         *     `responsibleAgent` is read from evidence rather than guessed: it is the agent of
         *     `currentWorkStep`, or — when no work step named this component in this run — the agent
         *     that applied the component in this run. Otherwise it is `null`.
         *
         *     Unified diffs are paged, because one component can accumulate more of them than a
         *     single response should carry; every other collection is complete. See `diffLimit` and
         *     `diffCursor`.
         */
        get: operations["getComponentInspector"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/components/{componentId}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Page through everything ever reported about one component
         * @description Returns every event that touched one component, **across all runs** of the project,
         *     descending by project position. Each entry names the run it belongs to, so the UI can
         *     separate the current run from older evidence without a second request.
         *
         *     Entries are the reported events as they were stored. Corrections and retractions appear
         *     as their own entries: the log is append-only and nothing is ever overwritten, so a
         *     withdrawn statement stays visible as history rather than disappearing.
         *
         *     The list is served from the component index the backend maintains for exactly this
         *     purpose; it is not a scan over event payloads.
         */
        get: operations["getComponentHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Liveness probe (internal)
         * @description Liveness probe of the Go backend container. It reports only that the process is
         *     running and answering; it never touches PostgreSQL.
         *
         *     Nginx proxies this route, so it answers on the published port as well as inside the
         *     Compose network. It carries no project data, but like every other route in v0 it is
         *     unauthenticated — see the trust boundary in `docs/security-and-boundaries.md`.
         */
        get: operations["getLiveness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/readyz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Readiness probe (internal)
         * @description Readiness probe of the Go backend container. It reports whether the backend can serve
         *     traffic, which includes a reachable PostgreSQL and applied migrations.
         *
         *     Nginx proxies this route, so it answers on the published port as well as inside the
         *     Compose network. The Compose healthcheck probes it, which is why a backend that failed
         *     to start is never routed to as ready.
         */
        get: operations["getReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * @description Stable, human-readable project slug. Lowercase alphanumerics and hyphens,
         *     3 to 64 characters, must start and end with an alphanumeric character.
         * @example visualise-ai
         */
        ProjectId: string;
        /**
         * @description Identifier of one agent run inside a project. Same character rules as `ProjectId`.
         *     A run groups every agent, plan and work event of a single orchestrated session.
         * @example run-2026-08-04-0001
         */
        RunId: string;
        /**
         * @description Identifier of the reporting agent, unique within a run. Same character rules as
         *     `ProjectId`.
         * @example subagent-openapi-contract
         */
        AgentId: string;
        /**
         * @description Identifier of an architecture component, stable across snapshots. Lowercase
         *     alphanumerics plus `.`, `_` and `-`; must start and end with an alphanumeric
         *     character. Dotted paths are a convention, not a hierarchy: the hierarchy is expressed
         *     exclusively through `parentComponentId`.
         * @example shop-platform.orders.domain
         */
        ComponentId: string;
        /**
         * @description Opaque, agent-assigned identifier for a domain object such as a plan, work step,
         *     feedback item, diff, risk or relationship. Stable for the lifetime of the run.
         * @example plan-2026-08-04-0001
         */
        Identifier: string;
        /**
         * Format: uuid
         * @description RFC 4122 UUID.
         * @example 3f2504e0-4f89-41d3-9a0c-0305e82c3301
         */
        Uuid: string;
        /**
         * Format: date-time
         * @description RFC 3339 timestamp. Agents must report in UTC (`Z` suffix).
         * @example 2026-08-04T09:12:00Z
         */
        Timestamp: string;
        /**
         * @description Version of the payload schema of the reported event type. v0 accepts `1.0` only; any
         *     other value is rejected with `400` and code `unsupported_schema_version`.
         * @enum {string}
         */
        SchemaVersion: "1.0";
        /**
         * @description Repository-relative POSIX path of exactly one file. Must not start with `/`, must not
         *     contain a `.` or `..` path segment, must not contain backslashes and must not end with
         *     a slash. Absolute paths and traversal are rejected by the pattern itself.
         * @example internal/ingest/handler.go
         */
        RepositoryFilePath: string;
        /**
         * @description The closed v0 event catalogue. There is no free-form or fallback event type; anything
         *     outside this enumeration is rejected with `400` and code `unsupported_event_type`.
         *     Low-level tool, terminal and file-read events are intentionally absent.
         * @enum {string}
         */
        EventType: "agent.started" | "agent.status_reported" | "agent.progress_reported" | "agent.finished" | "plan.published" | "plan.step_updated" | "work.step_started" | "work.step_completed" | "feedback.published" | "architecture.snapshot_published" | "component.change_planned" | "component.change_applied" | "relationship.change_planned" | "relationship.change_applied" | "diff.reported" | "risk.reported" | "problem.reported" | "correction.issued" | "retraction.issued" | "run.finished";
        /**
         * @description Kind of change applied to a component or relationship of the architecture model.
         * @enum {string}
         */
        ChangeOperation: "add" | "modify" | "remove";
        /**
         * @description Terminal outcome reported by an agent or for a run.
         * @enum {string}
         */
        Outcome: "completed" | "failed" | "cancelled";
        /**
         * @description Reported state of a single plan step.
         * @enum {string}
         */
        PlanStepState: "pending" | "in_progress" | "done" | "skipped";
        /**
         * @description Technology metadata of a component. Every field is optional; agents report what they
         *     know and omit the rest.
         */
        Technology: {
            /** @description Primary implementation language, for example `Go` or `TypeScript`. */
            language?: string;
            /** @description Dominant framework or library, for example `React` or `chi`. */
            framework?: string;
            /** @description Execution runtime, for example `Node.js`, `JVM` or `PostgreSQL`. */
            runtime?: string;
            /** @description Version of the language, framework or runtime, as reported. */
            version?: string;
        };
        /**
         * @description One node of the application architecture. Components form a tree through
         *     `parentComponentId`; the root of a tree has `parentComponentId: null`. Arbitrary
         *     nesting depth is allowed, for example system -> service -> module -> module.
         */
        Component: {
            componentId: components["schemas"]["ComponentId"];
            /** @description Human-readable display name shown on the architecture canvas. */
            name: string;
            /**
             * @description Structural role of the component. `topic` models a single message topic as its own
             *     node so that topic-level relationships stay visible.
             * @enum {string}
             */
            kind: "system" | "service" | "module" | "datastore" | "queue" | "topic" | "ui" | "external" | "library";
            /**
             * @description Parent node in the component hierarchy, or `null` for a root component. The value
             *     must reference a `componentId` contained in the same architecture model.
             */
            parentComponentId: components["schemas"]["ComponentId"] | null;
            /** @description Short explanation of the component's responsibility. */
            description?: string;
            technology?: components["schemas"]["Technology"];
            /** @description Free-form labels for filtering and grouping on the canvas. */
            tags?: string[];
        };
        /**
         * @description A typed, directed edge between two components.
         *
         *     Message topics are never aggregated server-side: **every NATS topic is its own
         *     relationship** with its own `relationshipId`, `kind: nats_topic` and the topic name in
         *     `channel`. Two producers publishing to two topics therefore yield two relationships,
         *     not one merged "messaging" edge.
         */
        Relationship: {
            relationshipId: components["schemas"]["Identifier"];
            sourceComponentId: components["schemas"]["ComponentId"];
            targetComponentId: components["schemas"]["ComponentId"];
            /**
             * @description Interaction type of the edge. `nats_topic` denotes exactly one topic, named in
             *     `channel`.
             * @enum {string}
             */
            kind: "http" | "grpc" | "data" | "async" | "nats_topic" | "dependency";
            /** @description Short human-readable edge label for the canvas. */
            label?: string;
            /** @description Concrete protocol, for example `HTTPS`, `gRPC/HTTP2` or `postgresql`. */
            protocol?: string;
            /**
             * @description Concrete operation carried by the edge, for example `GET /orders` or
             *     `orders.v1.OrderService/PlaceOrder`.
             */
            operation?: string;
            /**
             * @description Channel name for message-based edges. For `kind: nats_topic` this is the NATS
             *     topic name and identifies the relationship semantically.
             */
            channel?: string;
        };
        /** @description One step of a published plan revision. */
        PlanStep: {
            stepId: components["schemas"]["Identifier"];
            /** @description Zero-based position of the step within the plan revision. */
            order: number;
            /** @description Short description of what the step achieves. */
            title: string;
            state: components["schemas"]["PlanStepState"];
            /** @description Architecture components the step touches. */
            componentIds?: components["schemas"]["ComponentId"][];
        };
        /**
         * @description An agent has begun working. Root orchestrators report `role: orchestrator` and send
         *     `parentAgentId: null`; subagents report `role: subagent` and set `parentAgentId`.
         */
        AgentStartedPayload: {
            /**
             * @description Position of the agent in the run hierarchy.
             * @enum {string}
             */
            role: "orchestrator" | "subagent";
            /** @description Name shown for this agent in the cockpit. */
            displayName: string;
            /** @description The task the agent was given, in the agent's own words. */
            assignedTask: string;
            /** @description Self-declared capabilities, used for grouping and filtering only. */
            capabilities?: string[];
        };
        /**
         * @description Explicitly reported agent status. The system never derives status from silence,
         *     timeouts or event frequency; the last reported status stays valid until the agent
         *     reports a new one.
         */
        AgentStatusReportedPayload: {
            /**
             * @description Status as stated by the agent itself.
             * @enum {string}
             */
            status: "working" | "waiting" | "blocked" | "idle" | "done";
            /** @description Optional one-line explanation, for example what the agent waits for. */
            note?: string;
        };
        /**
         * @description Self-assessed progress of the reporting agent. This is a claim, not a measurement; the
         *     cockpit displays it as reported and performs no plausibility check.
         */
        AgentProgressReportedPayload: {
            /** @description Reported completion in percent. */
            percent: number;
            /**
             * @description What the percentage refers to: the agent's own assigned task, or the agent's
             *     estimate for the overall run.
             * @enum {string}
             */
            scope: "own_task" | "overall_estimate";
            /**
             * @description How the number was derived: a free estimate by the agent, or the ratio of completed
             *     plan or work steps.
             * @enum {string}
             */
            basis: "reported_estimate" | "completed_steps";
            /** @description Optional explanation of the reported number. */
            note?: string;
        };
        /** @description The reporting agent has finished. Terminal for this agent, not for the run. */
        AgentFinishedPayload: {
            outcome: components["schemas"]["Outcome"];
            /** @description Short closing summary of what the agent achieved. */
            summary?: string;
        };
        /**
         * @description A complete plan revision. Revisions are append-only: a changed plan is published as a
         *     new `revision` of the same `planId` and replaces the previously displayed revision.
         *     Earlier revisions stay in the event log and remain inspectable.
         */
        PlanPublishedPayload: {
            planId: components["schemas"]["Identifier"];
            /** @description Revision number, starting at 1 and strictly increasing per `planId`. */
            revision: number;
            /** @description All steps of this revision, in full. Partial plans are not supported. */
            steps: components["schemas"]["PlanStep"][];
        };
        /**
         * @description State change of a single step of the currently published plan revision. Used instead of
         *     republishing the whole plan when only a step state changes.
         */
        PlanStepUpdatedPayload: {
            planId: components["schemas"]["Identifier"];
            stepId: components["schemas"]["Identifier"];
            state: components["schemas"]["PlanStepState"];
            /** @description Optional explanation of the state change. */
            note?: string;
        };
        /**
         * @description The agent has started a concrete unit of work. A work step is what actually happens;
         *     `planStepId` links it back to the plan when the work follows a planned step.
         */
        WorkStepStartedPayload: {
            workStepId: components["schemas"]["Identifier"];
            /** @description Short description of the work being started. */
            title: string;
            /** @description Architecture components affected by this work step. */
            componentIds: components["schemas"]["ComponentId"][];
            planStepId?: components["schemas"]["Identifier"];
        };
        /** @description The work step identified by `workStepId` has been completed. */
        WorkStepCompletedPayload: {
            workStepId: components["schemas"]["Identifier"];
            /** @description Short summary of the result. */
            summary?: string;
        };
        /**
         * @description Component-scoped feedback written by the agent. v0 supports markdown only; the body is
         *     rendered as untrusted markdown in the inspector.
         */
        FeedbackPublishedPayload: {
            feedbackId: components["schemas"]["Identifier"];
            /** @description Components the feedback refers to. At least one is required. */
            componentIds: components["schemas"]["ComponentId"][];
            /**
             * @description Body format. v0 accepts markdown only.
             * @enum {string}
             */
            format: "markdown";
            /** @description The feedback text. */
            body: string;
            /** @description Optional short headline. */
            title?: string;
        };
        /**
         * @description A complete architecture model. The snapshot **replaces the applied model entirely**:
         *     components and relationships not contained in the snapshot no longer exist in the
         *     current model. Use it for the initial model and for full re-syncs; use
         *     `component.change_*` and `relationship.change_*` for incremental updates.
         */
        ArchitectureSnapshotPublishedPayload: {
            snapshotId: components["schemas"]["Identifier"];
            /** @description All components of the model, including nested children. */
            components: components["schemas"]["Component"][];
            /** @description All relationships of the model. One entry per NATS topic. */
            relationships: components["schemas"]["Relationship"][];
        };
        /**
         * @description The agent intends to change a component. Planned changes are shown as proposals and do
         *     not modify the applied architecture model.
         */
        ComponentChangePlannedPayload: {
            changeId: components["schemas"]["Identifier"];
            operation: components["schemas"]["ChangeOperation"];
            component: components["schemas"]["Component"];
            /** @description Why the change is planned. */
            rationale?: string;
        };
        /**
         * @description A component change has been carried out and is merged into the applied architecture
         *     model. `changeId` references the corresponding `component.change_planned` event when
         *     the change was planned beforehand; unplanned changes omit it.
         */
        ComponentChangeAppliedPayload: {
            changeId?: components["schemas"]["Identifier"];
            operation: components["schemas"]["ChangeOperation"];
            component: components["schemas"]["Component"];
        };
        /**
         * @description The agent intends to change a relationship. Planned changes are shown as proposals and
         *     do not modify the applied architecture model.
         */
        RelationshipChangePlannedPayload: {
            changeId: components["schemas"]["Identifier"];
            operation: components["schemas"]["ChangeOperation"];
            relationship: components["schemas"]["Relationship"];
            /** @description Why the change is planned. */
            rationale?: string;
        };
        /**
         * @description A relationship change has been carried out and is merged into the applied architecture
         *     model. `changeId` references the corresponding `relationship.change_planned` event when
         *     the change was planned beforehand.
         */
        RelationshipChangeAppliedPayload: {
            changeId?: components["schemas"]["Identifier"];
            operation: components["schemas"]["ChangeOperation"];
            relationship: components["schemas"]["Relationship"];
        };
        /**
         * @description A unified diff for **exactly one repository file**. Multi-file changes are reported as
         *     one `diff.reported` event per file, each with its own `diffId`. The backend never
         *     splits or merges diffs, and v0 has no repository access: `unifiedDiff` is taken as
         *     reported.
         */
        DiffReportedPayload: {
            diffId: components["schemas"]["Identifier"];
            changeId?: components["schemas"]["Identifier"];
            /** @description Components the changed file belongs to. At least one is required. */
            componentIds: components["schemas"]["ComponentId"][];
            filePath: components["schemas"]["RepositoryFilePath"];
            /** @description Unified diff of this one file, including the `---`, `+++` and `@@` markers. */
            unifiedDiff: string;
        };
        /**
         * @description A risk **as reported by the agent**. This is an agent statement, not a quality or drift
         *     assessment produced by the system. The cockpit displays it verbatim and never derives,
         *     scores or aggregates risks on its own; the human reviewer judges it.
         */
        RiskReportedPayload: {
            riskId: components["schemas"]["Identifier"];
            /** @description Components the risk applies to. */
            componentIds: components["schemas"]["ComponentId"][];
            /** @description Short headline of the risk. */
            title: string;
            /** @description Longer explanation of the risk. */
            detail?: string;
            /**
             * @description Severity as assessed by the reporting agent.
             * @enum {string}
             */
            severity: "low" | "medium" | "high";
        };
        /**
         * @description A concrete problem the agent has run into, as reported by the agent. Like
         *     `risk.reported`, this is an agent statement and never a system-side evaluation.
         */
        ProblemReportedPayload: {
            problemId: components["schemas"]["Identifier"];
            /** @description Components the problem applies to. */
            componentIds: components["schemas"]["ComponentId"][];
            /** @description Short headline of the problem. */
            title: string;
            /** @description Longer explanation of the problem. */
            detail?: string;
        };
        /**
         * @description Corrects the content of a previously accepted event. The event log stays append-only:
         *     the original event is never mutated, the correction is appended and the cockpit renders
         *     the corrected content while keeping the original inspectable.
         */
        CorrectionIssuedPayload: {
            correctsClientEventId: components["schemas"]["Uuid"];
            /** @description Why the original event was wrong. */
            reason: string;
            correctedType: components["schemas"]["EventType"];
            /**
             * @description Payload of the corrected event, valid for the corrected event type. It must satisfy
             *     the payload schema selected by `correctedType`.
             */
            correctedPayload: Record<string, unknown>;
        };
        /**
         * @description Withdraws a previously accepted event without replacing it. The original event is kept
         *     in the log and marked as retracted in the cockpit.
         */
        RetractionIssuedPayload: {
            retractsClientEventId: components["schemas"]["Uuid"];
            /** @description Why the original event is withdrawn. */
            reason: string;
        };
        /**
         * @description Optional terminal event for the whole run, reported by the orchestrator only.
         *
         *     * It is optional. A run may simply stop emitting events.
         *     * No state is derived from silence: without `run.finished` the run keeps its last
         *       reported state and is never auto-completed or auto-failed.
         *     * After `run.finished`, further work events of that run are rejected with `422` and
         *       code `run_already_finished`.
         */
        RunFinishedPayload: {
            outcome: components["schemas"]["Outcome"];
            /** @description Closing summary of the run. */
            summary?: string;
        };
        /**
         * @description Common envelope of every event. It is a base schema only: the concrete event schemas
         *     below narrow `type` to a single value and `payload` to the matching payload schema.
         *     `additionalProperties: false` closes the envelope, so unknown top-level fields are
         *     rejected for every event type.
         */
        EventEnvelope: {
            schemaVersion: components["schemas"]["SchemaVersion"];
            /**
             * @description Agent-assigned idempotency key, unique per project. Retries must reuse the same
             *     value; distinct events must never share one.
             */
            clientEventId: components["schemas"]["Uuid"];
            projectId: components["schemas"]["ProjectId"];
            runId: components["schemas"]["RunId"];
            agentId: components["schemas"]["AgentId"];
            /**
             * @description The delegating agent. Set for subagents, `null` (or omitted) for the root
             *     orchestrator. The value must reference an agent that already reported
             *     `agent.started` in the same run, otherwise the event is rejected with `422` and
             *     code `parent_agent_unknown`.
             */
            parentAgentId?: components["schemas"]["AgentId"] | null;
            /**
             * @description When the reported step happened, as observed by the agent. Independent of the
             *     server-side `receivedAt`.
             */
            occurredAt: components["schemas"]["Timestamp"];
            type: components["schemas"]["EventType"];
            /**
             * @description Type-specific payload. The effective schema is fixed by `type`; see the concrete
             *     event schemas.
             */
            payload: Record<string, unknown>;
        };
        /** @description An agent started working. */
        AgentStartedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "agent.started";
            payload?: components["schemas"]["AgentStartedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agent.started";
        };
        /** @description An agent explicitly reported its status. */
        AgentStatusReportedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "agent.status_reported";
            payload?: components["schemas"]["AgentStatusReportedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agent.status_reported";
        };
        /** @description An agent reported self-assessed progress. */
        AgentProgressReportedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "agent.progress_reported";
            payload?: components["schemas"]["AgentProgressReportedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agent.progress_reported";
        };
        /** @description An agent finished its assigned task. */
        AgentFinishedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "agent.finished";
            payload?: components["schemas"]["AgentFinishedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agent.finished";
        };
        /** @description A plan revision was published. */
        PlanPublishedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "plan.published";
            payload?: components["schemas"]["PlanPublishedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "plan.published";
        };
        /** @description The state of a single plan step changed. */
        PlanStepUpdatedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "plan.step_updated";
            payload?: components["schemas"]["PlanStepUpdatedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "plan.step_updated";
        };
        /** @description A concrete work step started. */
        WorkStepStartedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "work.step_started";
            payload?: components["schemas"]["WorkStepStartedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "work.step_started";
        };
        /** @description A concrete work step completed. */
        WorkStepCompletedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "work.step_completed";
            payload?: components["schemas"]["WorkStepCompletedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "work.step_completed";
        };
        /** @description Component-scoped markdown feedback was published. */
        FeedbackPublishedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "feedback.published";
            payload?: components["schemas"]["FeedbackPublishedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "feedback.published";
        };
        /** @description A complete architecture model was published and replaces the applied model. */
        ArchitectureSnapshotPublishedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "architecture.snapshot_published";
            payload?: components["schemas"]["ArchitectureSnapshotPublishedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "architecture.snapshot_published";
        };
        /** @description A component change was planned. */
        ComponentChangePlannedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "component.change_planned";
            payload?: components["schemas"]["ComponentChangePlannedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "component.change_planned";
        };
        /** @description A component change was applied. */
        ComponentChangeAppliedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "component.change_applied";
            payload?: components["schemas"]["ComponentChangeAppliedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "component.change_applied";
        };
        /** @description A relationship change was planned. */
        RelationshipChangePlannedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "relationship.change_planned";
            payload?: components["schemas"]["RelationshipChangePlannedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "relationship.change_planned";
        };
        /** @description A relationship change was applied. */
        RelationshipChangeAppliedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "relationship.change_applied";
            payload?: components["schemas"]["RelationshipChangeAppliedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "relationship.change_applied";
        };
        /** @description A unified diff for exactly one repository file was reported. */
        DiffReportedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "diff.reported";
            payload?: components["schemas"]["DiffReportedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "diff.reported";
        };
        /** @description The agent reported a risk. */
        RiskReportedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "risk.reported";
            payload?: components["schemas"]["RiskReportedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "risk.reported";
        };
        /** @description The agent reported a problem. */
        ProblemReportedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "problem.reported";
            payload?: components["schemas"]["ProblemReportedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "problem.reported";
        };
        /** @description A previously accepted event was corrected. */
        CorrectionIssuedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "correction.issued";
            payload?: components["schemas"]["CorrectionIssuedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "correction.issued";
        };
        /** @description A previously accepted event was retracted. */
        RetractionIssuedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "retraction.issued";
            payload?: components["schemas"]["RetractionIssuedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "retraction.issued";
        };
        /** @description Optional terminal event of the run, orchestrator only. */
        RunFinishedEvent: components["schemas"]["EventEnvelope"] & {
            /** @enum {unknown} */
            type?: "run.finished";
            payload?: components["schemas"]["RunFinishedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "run.finished";
        };
        /**
         * @description The closed union of all v0 events. `type` acts as the discriminator and selects exactly
         *     one envelope schema, which in turn fixes the payload schema. A body whose `type` is not
         *     in the mapping cannot match any branch and is rejected.
         */
        IngestEventRequest: components["schemas"]["AgentStartedEvent"] | components["schemas"]["AgentStatusReportedEvent"] | components["schemas"]["AgentProgressReportedEvent"] | components["schemas"]["AgentFinishedEvent"] | components["schemas"]["PlanPublishedEvent"] | components["schemas"]["PlanStepUpdatedEvent"] | components["schemas"]["WorkStepStartedEvent"] | components["schemas"]["WorkStepCompletedEvent"] | components["schemas"]["FeedbackPublishedEvent"] | components["schemas"]["ArchitectureSnapshotPublishedEvent"] | components["schemas"]["ComponentChangePlannedEvent"] | components["schemas"]["ComponentChangeAppliedEvent"] | components["schemas"]["RelationshipChangePlannedEvent"] | components["schemas"]["RelationshipChangeAppliedEvent"] | components["schemas"]["DiffReportedEvent"] | components["schemas"]["RiskReportedEvent"] | components["schemas"]["ProblemReportedEvent"] | components["schemas"]["CorrectionIssuedEvent"] | components["schemas"]["RetractionIssuedEvent"] | components["schemas"]["RunFinishedEvent"];
        /**
         * @description Envelope of a streamed event: the ingested envelope plus the server-assigned metadata
         *     `position`, `serverEventId` and `receivedAt`. Base schema only; the concrete streamed
         *     event schemas narrow `type` and `payload`.
         */
        StreamedEventEnvelope: {
            schemaVersion: components["schemas"]["SchemaVersion"];
            /** @description Idempotency key as reported by the agent. */
            clientEventId: components["schemas"]["Uuid"];
            projectId: components["schemas"]["ProjectId"];
            runId: components["schemas"]["RunId"];
            agentId: components["schemas"]["AgentId"];
            /** @description The delegating agent, or `null` for the root orchestrator. */
            parentAgentId?: components["schemas"]["AgentId"] | null;
            /** @description When the reported step happened, as observed by the agent. */
            occurredAt: components["schemas"]["Timestamp"];
            type: components["schemas"]["EventType"];
            /** @description Type-specific payload, fixed by `type`. */
            payload: Record<string, unknown>;
            /**
             * Format: int64
             * @description Server-assigned, strictly increasing position of the event within the project. This
             *     is the value sent as the SSE `id:` field and the cursor for replay.
             */
            position: number;
            /** @description Server-assigned identity of the stored event. */
            serverEventId: components["schemas"]["Uuid"];
            /** @description When the backend accepted and committed the event. */
            receivedAt: components["schemas"]["Timestamp"];
        };
        /** @description Streamed `agent.started` event. */
        StreamedAgentStartedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "agent.started";
            payload?: components["schemas"]["AgentStartedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agent.started";
        };
        /** @description Streamed `agent.status_reported` event. */
        StreamedAgentStatusReportedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "agent.status_reported";
            payload?: components["schemas"]["AgentStatusReportedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agent.status_reported";
        };
        /** @description Streamed `agent.progress_reported` event. */
        StreamedAgentProgressReportedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "agent.progress_reported";
            payload?: components["schemas"]["AgentProgressReportedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agent.progress_reported";
        };
        /** @description Streamed `agent.finished` event. */
        StreamedAgentFinishedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "agent.finished";
            payload?: components["schemas"]["AgentFinishedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "agent.finished";
        };
        /** @description Streamed `plan.published` event. */
        StreamedPlanPublishedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "plan.published";
            payload?: components["schemas"]["PlanPublishedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "plan.published";
        };
        /** @description Streamed `plan.step_updated` event. */
        StreamedPlanStepUpdatedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "plan.step_updated";
            payload?: components["schemas"]["PlanStepUpdatedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "plan.step_updated";
        };
        /** @description Streamed `work.step_started` event. */
        StreamedWorkStepStartedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "work.step_started";
            payload?: components["schemas"]["WorkStepStartedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "work.step_started";
        };
        /** @description Streamed `work.step_completed` event. */
        StreamedWorkStepCompletedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "work.step_completed";
            payload?: components["schemas"]["WorkStepCompletedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "work.step_completed";
        };
        /** @description Streamed `feedback.published` event. */
        StreamedFeedbackPublishedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "feedback.published";
            payload?: components["schemas"]["FeedbackPublishedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "feedback.published";
        };
        /** @description Streamed `architecture.snapshot_published` event. */
        StreamedArchitectureSnapshotPublishedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "architecture.snapshot_published";
            payload?: components["schemas"]["ArchitectureSnapshotPublishedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "architecture.snapshot_published";
        };
        /** @description Streamed `component.change_planned` event. */
        StreamedComponentChangePlannedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "component.change_planned";
            payload?: components["schemas"]["ComponentChangePlannedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "component.change_planned";
        };
        /** @description Streamed `component.change_applied` event. */
        StreamedComponentChangeAppliedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "component.change_applied";
            payload?: components["schemas"]["ComponentChangeAppliedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "component.change_applied";
        };
        /** @description Streamed `relationship.change_planned` event. */
        StreamedRelationshipChangePlannedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "relationship.change_planned";
            payload?: components["schemas"]["RelationshipChangePlannedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "relationship.change_planned";
        };
        /** @description Streamed `relationship.change_applied` event. */
        StreamedRelationshipChangeAppliedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "relationship.change_applied";
            payload?: components["schemas"]["RelationshipChangeAppliedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "relationship.change_applied";
        };
        /** @description Streamed `diff.reported` event. */
        StreamedDiffReportedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "diff.reported";
            payload?: components["schemas"]["DiffReportedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "diff.reported";
        };
        /** @description Streamed `risk.reported` event. */
        StreamedRiskReportedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "risk.reported";
            payload?: components["schemas"]["RiskReportedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "risk.reported";
        };
        /** @description Streamed `problem.reported` event. */
        StreamedProblemReportedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "problem.reported";
            payload?: components["schemas"]["ProblemReportedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "problem.reported";
        };
        /** @description Streamed `correction.issued` event. */
        StreamedCorrectionIssuedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "correction.issued";
            payload?: components["schemas"]["CorrectionIssuedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "correction.issued";
        };
        /** @description Streamed `retraction.issued` event. */
        StreamedRetractionIssuedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "retraction.issued";
            payload?: components["schemas"]["RetractionIssuedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "retraction.issued";
        };
        /** @description Streamed `run.finished` event. */
        StreamedRunFinishedEvent: components["schemas"]["StreamedEventEnvelope"] & {
            /** @enum {unknown} */
            type?: "run.finished";
            payload?: components["schemas"]["RunFinishedPayload"];
        } & {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "run.finished";
        };
        /**
         * @description JSON object carried in a single SSE `data:` line. Same closed union as ingestion, plus
         *     the server-assigned `position`, `serverEventId` and `receivedAt`. The SSE `event:`
         *     field always equals the `type` of the object.
         */
        StreamedEvent: components["schemas"]["StreamedAgentStartedEvent"] | components["schemas"]["StreamedAgentStatusReportedEvent"] | components["schemas"]["StreamedAgentProgressReportedEvent"] | components["schemas"]["StreamedAgentFinishedEvent"] | components["schemas"]["StreamedPlanPublishedEvent"] | components["schemas"]["StreamedPlanStepUpdatedEvent"] | components["schemas"]["StreamedWorkStepStartedEvent"] | components["schemas"]["StreamedWorkStepCompletedEvent"] | components["schemas"]["StreamedFeedbackPublishedEvent"] | components["schemas"]["StreamedArchitectureSnapshotPublishedEvent"] | components["schemas"]["StreamedComponentChangePlannedEvent"] | components["schemas"]["StreamedComponentChangeAppliedEvent"] | components["schemas"]["StreamedRelationshipChangePlannedEvent"] | components["schemas"]["StreamedRelationshipChangeAppliedEvent"] | components["schemas"]["StreamedDiffReportedEvent"] | components["schemas"]["StreamedRiskReportedEvent"] | components["schemas"]["StreamedProblemReportedEvent"] | components["schemas"]["StreamedCorrectionIssuedEvent"] | components["schemas"]["StreamedRetractionIssuedEvent"] | components["schemas"]["StreamedRunFinishedEvent"];
        /**
         * @description Acknowledgement of an ingested event. Returned with `201` for a first delivery and with
         *     `200` for an idempotent retry, in which case the originally assigned `position` and
         *     `serverEventId` are repeated unchanged.
         */
        EventAccepted: {
            projectId: components["schemas"]["ProjectId"];
            /**
             * Format: int64
             * @description Server-assigned, strictly increasing position of the event within the project.
             */
            position: number;
            /** @description Server-assigned identity of the stored event. */
            serverEventId: components["schemas"]["Uuid"];
            /** @description The idempotency key echoed back from the request. */
            clientEventId: components["schemas"]["Uuid"];
            /** @description `false` for a newly appended event (`201`), `true` for an idempotent retry (`200`). */
            duplicate: boolean;
            /** @description When the backend accepted and committed the event. */
            receivedAt: components["schemas"]["Timestamp"];
        };
        /**
         * @description Error object following RFC 9457, served as `application/problem+json`. `code` is the
         *     stable, machine-readable discriminator that clients should branch on; `type`, `title`
         *     and `detail` are for humans.
         */
        Problem: {
            /**
             * Format: uri
             * @description URI identifying the problem type.
             */
            type: string;
            /** @description Short, human-readable summary of the problem type. */
            title: string;
            /** @description HTTP status code, repeated for convenience. */
            status: number;
            /** @description Human-readable explanation specific to this occurrence. */
            detail: string;
            /**
             * @description Stable machine-readable error code, for example `invalid_field`,
             *     `unsupported_event_type`, `unsupported_schema_version`,
             *     `client_event_id_conflict`, `event_too_large`, `unsupported_media_type`,
             *     `unknown_agent`, `run_already_finished`, `run_not_started`,
             *     `run_already_started`, `parent_agent_unknown`, `terminal_event_not_allowed`,
             *     `correction_target_unknown`, `project_not_found`, `run_not_found`,
             *     `current_run_not_found`, `component_not_found`, `invalid_query_parameter` or
             *     `not_ready`.
             */
            code: string;
            /**
             * Format: uri-reference
             * @description URI reference identifying this specific occurrence.
             */
            instance?: string;
        };
        /** @description One field-level violation inside a `ValidationProblem`. */
        ValidationError: {
            /**
             * @description RFC 6901 JSON Pointer into the rejected request body, for example
             *     `/payload/percent`. Read requests have no body, so there the pointer names the
             *     rejected query parameter, for example `/limit`.
             */
            field: string;
            /**
             * @description Machine-readable violation code, for example `required`, `out_of_range`,
             *     `pattern_mismatch`, `unknown_property` or `invalid_format`.
             */
            code: string;
            /** @description Human-readable explanation of this single violation. */
            message: string;
        };
        /**
         * @description RFC 9457 problem extended with structured field errors. Returned for `400` responses
         *     with codes `invalid_field`, `unsupported_event_type` or `unsupported_schema_version`.
         */
        ValidationProblem: {
            /**
             * Format: uri
             * @description URI identifying the problem type.
             */
            type: string;
            /** @description Short, human-readable summary of the problem type. */
            title: string;
            /** @description HTTP status code, repeated for convenience. */
            status: number;
            /** @description Human-readable explanation specific to this occurrence. */
            detail: string;
            /**
             * @description Stable machine-readable error code: `invalid_field`, `unsupported_event_type` or
             *     `unsupported_schema_version`.
             */
            code: string;
            /**
             * Format: uri-reference
             * @description URI reference identifying this specific occurrence.
             */
            instance?: string;
            /** @description All detected field-level violations, never empty. */
            errors: components["schemas"]["ValidationError"][];
        };
        /**
         * Format: int64
         * @description Server side project position at the moment the snapshot was read. It is the position of
         *     the last event committed for the project, so a client can compare an HTTP snapshot with
         *     its SSE cursor and know exactly which events it still has to apply. `0` means nothing
         *     has been reported yet.
         * @example 17
         */
        ProjectPosition: number;
        /**
         * Format: int64
         * @description Project position of the event that last wrote this row. It lets the UI reconcile a
         *     single node when a live event arrives instead of refetching the whole snapshot.
         * @example 11
         */
        AppliedPosition: number;
        /**
         * @description Opaque continuation token. It encodes the sort key of the last returned entry; clients
         *     echo it back unchanged and must not parse it.
         * @example djF8MTY
         */
        Cursor: string;
        /** @description One project as shown in the project list. */
        ProjectSummary: {
            projectId: components["schemas"]["ProjectId"];
            /** @description When the first accepted event of this project was reported. */
            firstSeenAt: components["schemas"]["Timestamp"];
            /** @description When the most recent accepted event of this project was reported. */
            lastEventAt: components["schemas"]["Timestamp"];
            lastPosition: components["schemas"]["ProjectPosition"];
            /**
             * @description The run a root orchestrator opened last, or `null` while no root orchestrator has
             *     opened one.
             */
            currentRunId: components["schemas"]["RunId"] | null;
        };
        /** @description Sizes of the read models of one project. */
        ProjectCounts: {
            /** @description Runs of this project, current and historical. */
            runs: number;
            /** @description Runs without an explicit `run.finished`. */
            openRuns: number;
            /** @description Components of the applied architecture model. */
            components: number;
            /** @description Relationships of the applied architecture model. */
            relationships: number;
            /** @description Pending change proposals, that is changes in state `planned`. */
            activeChanges: number;
        };
        /** @description One project together with the sizes of its read models. */
        ProjectDetail: {
            projectId: components["schemas"]["ProjectId"];
            /** @description When the first accepted event of this project was reported. */
            firstSeenAt: components["schemas"]["Timestamp"];
            /** @description When the most recent accepted event of this project was reported. */
            lastEventAt: components["schemas"]["Timestamp"];
            lastPosition: components["schemas"]["ProjectPosition"];
            /** @description The run a root orchestrator opened last, or `null`. */
            currentRunId: components["schemas"]["RunId"] | null;
            counts: components["schemas"]["ProjectCounts"];
        };
        /**
         * @description Body of `GET /api/v1/projects`. Not scoped to one project, so `projectPosition` is the
         *     highest position across the listed projects.
         */
        ProjectListResponse: {
            projectPosition: components["schemas"]["ProjectPosition"];
            /** @description Every known project, ordered by `projectId`. */
            projects: components["schemas"]["ProjectSummary"][];
        };
        /** @description Body of `GET /api/v1/projects/{projectId}`. */
        ProjectResponse: {
            projectPosition: components["schemas"]["ProjectPosition"];
            project: components["schemas"]["ProjectDetail"];
        };
        /**
         * @description One node of the applied architecture model. `parentComponentId` is the only expression
         *     of the hierarchy; the list itself is flat.
         */
        AppliedComponent: {
            componentId: components["schemas"]["ComponentId"];
            /** @description Human-readable display name shown on the architecture canvas. */
            name: string;
            /**
             * @description Structural role of the component, as reported.
             * @enum {string}
             */
            kind: "system" | "service" | "module" | "datastore" | "queue" | "topic" | "ui" | "external" | "library";
            /** @description Parent node in the component hierarchy, or `null` for a root component. */
            parentComponentId: components["schemas"]["ComponentId"] | null;
            /** @description Short explanation of the component's responsibility, empty when none was reported. */
            description: string;
            /**
             * @description Reported technology metadata, handed through unchanged. An empty object means the
             *     agent reported none.
             */
            technology: components["schemas"]["Technology"];
            /** @description Reported free-form labels, empty when none were reported. */
            tags: string[];
            /** @description When the event that last wrote this component was reported. */
            appliedAt: components["schemas"]["Timestamp"];
            appliedByAgentId: components["schemas"]["AgentId"];
            appliedRunId: components["schemas"]["RunId"];
            position: components["schemas"]["AppliedPosition"];
        };
        /**
         * @description One typed, directed edge of the applied model. Every NATS topic keeps its own row with
         *     the topic name in `channel`; edges are never aggregated server side.
         */
        AppliedRelationship: {
            relationshipId: components["schemas"]["Identifier"];
            sourceComponentId: components["schemas"]["ComponentId"];
            targetComponentId: components["schemas"]["ComponentId"];
            /**
             * @description Interaction type of the edge, as reported.
             * @enum {string}
             */
            kind: "http" | "grpc" | "data" | "async" | "nats_topic" | "dependency";
            /** @description Reported edge label, empty when none was reported. */
            label: string;
            /** @description Reported protocol, empty when none was reported. */
            protocol: string;
            /** @description Reported operation, empty when none was reported. */
            operation: string;
            /**
             * @description Reported channel. For `kind: nats_topic` this is the topic name and identifies the
             *     relationship semantically. Empty when none was reported.
             */
            channel: string;
            /** @description When the event that last wrote this relationship was reported. */
            appliedAt: components["schemas"]["Timestamp"];
            appliedByAgentId: components["schemas"]["AgentId"];
            appliedRunId: components["schemas"]["RunId"];
            position: components["schemas"]["AppliedPosition"];
        };
        /**
         * @description A pending change proposal, that is a reported change that is still in state `planned`.
         *     `snapshot` carries the reported component or relationship descriptor verbatim, so the
         *     canvas can draw the proposal next to the applied model without a second lookup.
         */
        ActiveChange: {
            changeId: components["schemas"]["Identifier"];
            /**
             * @description What the change is about.
             * @enum {string}
             */
            targetKind: "component" | "relationship";
            /** @description Identifier of the component or relationship the change targets. */
            targetId: string;
            operation: components["schemas"]["ChangeOperation"];
            /**
             * @description Lifecycle state of the change. The read endpoints only return `planned`; `applied`
             *     has become the model and `retracted` was withdrawn.
             * @enum {string}
             */
            state: "planned" | "applied" | "retracted";
            runId: components["schemas"]["RunId"];
            agentId: components["schemas"]["AgentId"];
            /** @description When the change was announced, or `null` when it was never planned. */
            plannedAt: components["schemas"]["Timestamp"] | null;
            /** @description When the change was applied, `null` while it is pending. */
            appliedAt: components["schemas"]["Timestamp"] | null;
            /** @description When the change was withdrawn, `null` while it stands. */
            retractedAt: components["schemas"]["Timestamp"] | null;
            /**
             * @description The reported descriptor of the proposal — a `Component` or a `Relationship`
             *     document, selected by `targetKind` — stored and returned as reported.
             */
            snapshot: Record<string, unknown>;
            position: components["schemas"]["AppliedPosition"];
        };
        /**
         * @description Body of `GET /api/v1/projects/{projectId}/architecture`: the applied model plus the
         *     proposals that are still pending. A planned change never appears in `components` or
         *     `relationships`.
         */
        ArchitectureResponse: {
            projectPosition: components["schemas"]["ProjectPosition"];
            /** @description Every component of the applied model, ordered by `componentId`. */
            components: components["schemas"]["AppliedComponent"][];
            /** @description Every relationship of the applied model, ordered by `relationshipId`. */
            relationships: components["schemas"]["AppliedRelationship"][];
            /** @description Pending proposals, newest first. */
            activeChanges: components["schemas"]["ActiveChange"][];
        };
        /**
         * @description One run. It stays open until an explicit `run.finished` closes it; silence never
         *     produces a terminal state.
         */
        RunSummary: {
            runId: components["schemas"]["RunId"];
            /**
             * @description The orchestrator that opened the run, or `null` while no root orchestrator reported
             *     `agent.started` for it.
             */
            rootAgentId: components["schemas"]["AgentId"] | null;
            /** @description When the run was first seen. */
            startedAt: components["schemas"]["Timestamp"];
            /** @description When `run.finished` was reported, `null` while the run is open. */
            finishedAt: components["schemas"]["Timestamp"] | null;
            /** @description Reported terminal outcome, `null` while the run is open. */
            outcome: components["schemas"]["Outcome"] | null;
            /** @description `false` only after an explicit `run.finished`. */
            isOpen: boolean;
            /** @description Whether this is the run `current` resolves to. */
            isCurrent: boolean;
            position: components["schemas"]["AppliedPosition"];
        };
        /** @description Sizes of the read models of one run. */
        RunCounts: {
            /** @description Agents that reported `agent.started` in this run. */
            agents: number;
            /** @description Plans published in this run. */
            plans: number;
            /** @description Work steps reported in this run. */
            workSteps: number;
        };
        /** @description One run together with the sizes of the collections hanging off it. */
        RunDetail: {
            runId: components["schemas"]["RunId"];
            /** @description The orchestrator that opened the run, or `null`. */
            rootAgentId: components["schemas"]["AgentId"] | null;
            /** @description When the run was first seen. */
            startedAt: components["schemas"]["Timestamp"];
            /** @description When `run.finished` was reported, `null` while the run is open. */
            finishedAt: components["schemas"]["Timestamp"] | null;
            /** @description Reported terminal outcome, `null` while the run is open. */
            outcome: components["schemas"]["Outcome"] | null;
            /** @description `false` only after an explicit `run.finished`. */
            isOpen: boolean;
            /** @description Whether this is the run `current` resolves to. */
            isCurrent: boolean;
            position: components["schemas"]["AppliedPosition"];
            counts: components["schemas"]["RunCounts"];
        };
        /**
         * @description Body of `GET /api/v1/projects/{projectId}/runs`. Current and historical runs in one
         *     list, descending by start.
         */
        RunListResponse: {
            projectPosition: components["schemas"]["ProjectPosition"];
            /** @description One page of runs. */
            runs: components["schemas"]["RunSummary"][];
            /** @description Cursor of the next page, `null` on the last one. */
            nextCursor: components["schemas"]["Cursor"] | null;
        };
        /** @description Body of `GET /api/v1/projects/{projectId}/runs/{runId}`. */
        RunResponse: {
            projectPosition: components["schemas"]["ProjectPosition"];
            run: components["schemas"]["RunDetail"];
        };
        /**
         * @description Progress **as reported by the agent itself**. `scope` separates a subagent's own task
         *     from an orchestrator's estimate for the whole run; `basis` separates a free estimate
         *     from counted steps. The cockpit displays it as reported and checks nothing.
         */
        AgentProgress: {
            /** @description Reported completion in percent. */
            percent: number;
            /** @description What the percentage refers to, `null` when it was not reported. */
            scope: ("own_task" | "overall_estimate") | null;
            /** @description How the number was derived, `null` when it was not reported. */
            basis: ("reported_estimate" | "completed_steps") | null;
        };
        /**
         * @description One node of the agent tree of a run. The tree is expressed through `parentAgentId`;
         *     the list is flat.
         *
         *     Nothing here is derived: `status` stays empty until `agent.status_reported` arrives,
         *     `progress` stays `null` until the agent reported a number, and `finishedOutcome` stays
         *     `null` until `agent.finished`. Silence changes nothing.
         */
        RunAgent: {
            agentId: components["schemas"]["AgentId"];
            runId: components["schemas"]["RunId"];
            /** @description The delegating agent, `null` for the root orchestrator. */
            parentAgentId: components["schemas"]["AgentId"] | null;
            /**
             * @description Position of the agent in the run hierarchy, as reported.
             * @enum {string}
             */
            role: "" | "orchestrator" | "subagent";
            /** @description Name shown for this agent, empty when the agent never reported `agent.started`. */
            displayName: string;
            /** @description The task the agent was given, in its own words. Empty when never reported. */
            assignedTask: string;
            /**
             * @description Last explicitly reported status. Empty means none was ever reported.
             * @enum {string}
             */
            status: "" | "working" | "waiting" | "blocked" | "idle" | "done";
            /** @description Optional one-line explanation that came with the status. */
            statusNote: string;
            /** @description Self-assessed progress, `null` until the agent reported one. */
            progress: components["schemas"]["AgentProgress"] | null;
            /** @description Reported outcome of `agent.finished`, `null` while the agent has not finished. */
            finishedOutcome: components["schemas"]["Outcome"] | null;
            /** @description When the agent was first seen in this run. */
            startedAt: components["schemas"]["Timestamp"];
            /** @description When this agent last reported anything. */
            lastEventAt: components["schemas"]["Timestamp"];
            position: components["schemas"]["AppliedPosition"];
        };
        /**
         * @description Body of `GET /api/v1/projects/{projectId}/runs/{runId}/agents`. Flat, ordered so a
         *     parent precedes the subagents it spawned.
         */
        AgentListResponse: {
            projectPosition: components["schemas"]["ProjectPosition"];
            /** @description Every agent of the run. */
            agents: components["schemas"]["RunAgent"][];
        };
        /** @description One step of one plan revision, in the reported order. */
        RunPlanStep: {
            stepId: components["schemas"]["Identifier"];
            /** @description Zero-based position of the step within its revision. */
            order: number;
            /** @description Short description of what the step achieves. */
            title: string;
            state: components["schemas"]["PlanStepState"];
            position: components["schemas"]["AppliedPosition"];
        };
        /**
         * @description One published revision of a plan. Revisions are append-only: a `plan.step_updated` only
         *     reaches the revision that was current when it was reported, so an earlier revision keeps
         *     exactly the states it was last seen with.
         */
        RunPlanRevision: {
            /** @description Revision number, starting at 1 and strictly increasing per plan. */
            revision: number;
            /** @description When this revision was published. */
            createdAt: components["schemas"]["Timestamp"];
            createdByAgentId: components["schemas"]["AgentId"];
            /** @description Whether `plan.step_updated` currently writes to this revision. */
            isCurrent: boolean;
            /** @description All steps of this revision, ordered by `order`. */
            steps: components["schemas"]["RunPlanStep"][];
            position: components["schemas"]["AppliedPosition"];
        };
        /** @description One plan of a run with every revision it ever had, ascending. */
        RunPlan: {
            planId: components["schemas"]["Identifier"];
            runId: components["schemas"]["RunId"];
            agentId: components["schemas"]["AgentId"];
            /** @description The revision the cockpit shows by default. */
            currentRevision: number;
            /** @description Every published revision, ascending. */
            revisions: components["schemas"]["RunPlanRevision"][];
            position: components["schemas"]["AppliedPosition"];
        };
        /** @description Body of `GET /api/v1/projects/{projectId}/runs/{runId}/plans`. */
        PlanListResponse: {
            projectPosition: components["schemas"]["ProjectPosition"];
            /** @description Every plan of the run, ordered by `planId`. */
            plans: components["schemas"]["RunPlan"][];
        };
        /**
         * @description A concrete unit of work an agent reported. The inspector shows the open work step of
         *     the selected run, or the most recently started one when all of them completed.
         */
        InspectorWorkStep: {
            workStepId: components["schemas"]["Identifier"];
            runId: components["schemas"]["RunId"];
            agentId: components["schemas"]["AgentId"];
            /** @description The planned step this work followed, `null` for unplanned work. */
            planStepId: components["schemas"]["Identifier"] | null;
            /** @description Short description of the work. */
            title: string;
            /** @description When the work step was reported as started. */
            startedAt: components["schemas"]["Timestamp"];
            /** @description When it was reported as completed, `null` while it is open. */
            completedAt: components["schemas"]["Timestamp"] | null;
            /** @description Reported result summary, `null` while the step is open. */
            summary: string | null;
            position: components["schemas"]["AppliedPosition"];
        };
        /**
         * @description One published, component scoped feedback item. `body` is untrusted markdown and is
         *     handed through verbatim — sanitising it before rendering is the client's job.
         */
        FeedbackEntry: {
            feedbackId: components["schemas"]["Identifier"];
            runId: components["schemas"]["RunId"];
            agentId: components["schemas"]["AgentId"];
            /**
             * @description Body format. v0 reports markdown only.
             * @enum {string}
             */
            format: "markdown";
            /** @description Reported headline, empty when none was reported. */
            title: string;
            /** @description The feedback text as reported. */
            body: string;
            /** @description When the feedback was reported. */
            createdAt: components["schemas"]["Timestamp"];
            position: components["schemas"]["AppliedPosition"];
        };
        /**
         * @description One reported unified diff of exactly one repository file. The backend never splits or
         *     merges diffs; `changeId` is what groups the files of one logical change.
         */
        ReportedDiff: {
            diffId: components["schemas"]["Identifier"];
            runId: components["schemas"]["RunId"];
            agentId: components["schemas"]["AgentId"];
            /** @description The change this file belongs to, `null` for an unattributed diff. */
            changeId: components["schemas"]["Identifier"] | null;
            filePath: components["schemas"]["RepositoryFilePath"];
            /** @description The unified diff of this one file, exactly as reported. */
            unifiedDiff: string;
            /** @description When the diff was reported. */
            createdAt: components["schemas"]["Timestamp"];
            position: components["schemas"]["AppliedPosition"];
        };
        /**
         * @description A risk **as stated by the reporting agent**. The system never derives, scores or
         *     aggregates risks; the human reviewer judges.
         */
        ReportedRisk: {
            riskId: components["schemas"]["Identifier"];
            runId: components["schemas"]["RunId"];
            agentId: components["schemas"]["AgentId"];
            /** @description Short headline of the risk. */
            title: string;
            /** @description Longer explanation, empty when none was reported. */
            detail: string;
            /**
             * @description Severity as assessed by the reporting agent.
             * @enum {string}
             */
            severity: "low" | "medium" | "high";
            /** @description When the risk was reported. */
            createdAt: components["schemas"]["Timestamp"];
            position: components["schemas"]["AppliedPosition"];
        };
        /** @description A problem as stated by the reporting agent, never a system-side evaluation. */
        ReportedProblem: {
            problemId: components["schemas"]["Identifier"];
            runId: components["schemas"]["RunId"];
            agentId: components["schemas"]["AgentId"];
            /** @description Short headline of the problem. */
            title: string;
            /** @description Longer explanation, empty when none was reported. */
            detail: string;
            /** @description When the problem was reported. */
            createdAt: components["schemas"]["Timestamp"];
            position: components["schemas"]["AppliedPosition"];
        };
        /**
         * @description Body of `GET /api/v1/projects/{projectId}/components/{componentId}`. Everything here
         *     belongs to **one** run — the one named in `runId`. Evidence of other runs is reachable
         *     through `…/history` only.
         */
        ComponentInspectorResponse: {
            projectPosition: components["schemas"]["ProjectPosition"];
            /** @description The run this evidence belongs to, `null` when the project has no run at all yet. */
            runId: components["schemas"]["RunId"] | null;
            /**
             * @description The applied descriptor, `null` when the component left the applied model but is
             *     still known from the history.
             */
            component: components["schemas"]["AppliedComponent"] | null;
            /**
             * @description The agent of `currentWorkStep`, or the agent that applied the component in this run.
             *     `null` when neither was reported — responsibility is read from evidence, not guessed.
             */
            responsibleAgent: components["schemas"]["RunAgent"] | null;
            /**
             * @description The open work step of this run touching the component, or the most recently started
             *     one when all of them completed. `null` when no work step named the component.
             */
            currentWorkStep: components["schemas"]["InspectorWorkStep"] | null;
            /** @description Component scoped feedback of this run, newest first. Complete, not paged. */
            feedback: components["schemas"]["FeedbackEntry"][];
            /**
             * @description Unified diffs of this run touching the component, newest first. Paged — see
             *     `nextDiffCursor`.
             */
            diffs: components["schemas"]["ReportedDiff"][];
            /** @description Cursor for the next page of diffs, `null` when the last page was returned. */
            nextDiffCursor: components["schemas"]["Cursor"] | null;
            /** @description Risks reported for this component in this run, newest first. */
            risks: components["schemas"]["ReportedRisk"][];
            /** @description Problems reported for this component in this run, newest first. */
            problems: components["schemas"]["ReportedProblem"][];
            /**
             * @description Pending proposals of this run that target this component. Proposals that target a
             *     relationship are shown on the architecture endpoint instead.
             */
            activeChanges: components["schemas"]["ActiveChange"][];
        };
        /**
         * @description One reported event that touched the component, as it was stored. Corrections and
         *     retractions appear as their own entries; nothing is ever overwritten.
         */
        ComponentHistoryEntry: {
            position: components["schemas"]["AppliedPosition"];
            /** @description Server-assigned identity of the stored event. */
            serverEventId: components["schemas"]["Uuid"];
            /** @description The idempotency key the agent assigned. */
            clientEventId: components["schemas"]["Uuid"];
            runId: components["schemas"]["RunId"];
            agentId: components["schemas"]["AgentId"];
            /** @description The delegating agent, `null` for the root orchestrator. */
            parentAgentId: components["schemas"]["AgentId"] | null;
            type: components["schemas"]["EventType"];
            schemaVersion: components["schemas"]["SchemaVersion"];
            /** @description When the reported step happened, as observed by the agent. */
            occurredAt: components["schemas"]["Timestamp"];
            /** @description When the backend accepted and committed the event. */
            receivedAt: components["schemas"]["Timestamp"];
            /**
             * @description The reported payload, canonicalised but otherwise unchanged. Its effective schema is
             *     fixed by `type`, exactly as during ingestion.
             */
            payload: Record<string, unknown>;
        };
        /**
         * @description Body of `GET /api/v1/projects/{projectId}/components/{componentId}/history`: the run
         *     spanning evidence of one component, descending by project position.
         */
        ComponentHistoryResponse: {
            projectPosition: components["schemas"]["ProjectPosition"];
            /** @description One page of history, newest first. */
            entries: components["schemas"]["ComponentHistoryEntry"][];
            /** @description Cursor of the next page, `null` on the last one. */
            nextCursor: components["schemas"]["Cursor"] | null;
        };
        /** @description Liveness probe response of the internal backend. */
        LivenessStatus: {
            /**
             * @description Always `ok` while the process is answering.
             * @enum {string}
             */
            status: "ok";
        };
        /** @description Readiness probe response of the internal backend. */
        ReadinessStatus: {
            /**
             * @description Always `ready`; a backend that is not ready answers `503` instead.
             * @enum {string}
             */
            status: "ready";
        };
    };
    responses: {
        /**
         * @description The request body is syntactically valid JSON but violates the contract. Common codes:
         *     `invalid_field`, `unsupported_event_type`, `unsupported_schema_version`.
         */
        BadRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["ValidationProblem"];
            };
        };
        /**
         * @description The `clientEventId` was already used within this project for an event with different
         *     content. Code: `client_event_id_conflict`.
         */
        Conflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description The request body exceeds the configured maximum event size. The default limit is
         *     2 MiB (2097152 bytes) and is configurable server-side via `MAX_EVENT_BYTES`.
         *     Code: `event_too_large`.
         */
        ContentTooLarge: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The request `Content-Type` is not `application/json`. Code: `unsupported_media_type`. */
        UnsupportedMediaType: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description The event is well-formed and schema-valid but contradicts the current state of the
         *     project. Codes: `unknown_agent`, `run_already_finished`, `run_not_started`,
         *     `run_already_started`, `parent_agent_unknown`, `terminal_event_not_allowed`,
         *     `correction_target_unknown`.
         */
        UnprocessableContent: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The project is unknown. Code: `project_not_found`. */
        ProjectNotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description The project, or the requested run inside it, is unknown. Codes: `project_not_found`,
         *     `run_not_found`, `current_run_not_found`. The last one is distinct on purpose: a project
         *     whose runs were never opened by a root orchestrator has no current run, which a client
         *     must be able to tell apart from a wrong run id.
         */
        RunNotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description The project, the requested run or the component is unknown. Codes:
         *     `project_not_found`, `run_not_found`, `current_run_not_found`, `component_not_found`.
         *
         *     A component that left the applied model but still has history is **not** an error: it
         *     is answered with `200` and `component: null`.
         */
        ComponentNotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description A query parameter of a read request is not acceptable. Code:
         *     `invalid_query_parameter`. `errors[].field` names the rejected query parameter.
         */
        InvalidQueryParameter: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["ValidationProblem"];
            };
        };
    };
    parameters: {
        /** @description Project the request is scoped to. */
        ProjectIdPath: components["schemas"]["ProjectId"];
        /**
         * @description Run inside the project, or the literal `current` for the run a root orchestrator opened
         *     last. The alias wins over a run that happens to carry that identifier: the default view
         *     of the cockpit must not depend on how an agent named its run.
         * @example current
         */
        RunIdPath: components["schemas"]["RunId"];
        /** @description Component of the project's architecture model. */
        ComponentIdPath: components["schemas"]["ComponentId"];
        /**
         * @description Run the component evidence is read from. Omitted means the current run; `current` means
         *     the same thing explicitly. Any other value must name a run of this project, otherwise
         *     the request is rejected with `404` and code `run_not_found` rather than silently falling
         *     back to the current run.
         * @example run-2026-08-04-0001
         */
        RunIdQuery: components["schemas"]["RunId"];
        /**
         * @description Number of entries per page. Defaults to 50, maximum 200. A value outside that range is
         *     rejected with `400` rather than clamped, so a client cannot believe it received
         *     everything.
         * @example 50
         */
        LimitQuery: number;
        /**
         * @description Continuation token of the previous page, taken from its `nextCursor`. Opaque: it is
         *     echoed back unchanged and its encoding is free to change.
         */
        CursorQuery: components["schemas"]["Cursor"];
        /**
         * @description Number of unified diffs in the component inspector. Defaults to 50, maximum 200; a value
         *     outside that range is rejected with `400`.
         * @example 50
         */
        DiffLimitQuery: number;
        /**
         * @description Continuation token for the diffs of the component inspector, taken from the previous
         *     response's `nextDiffCursor`.
         */
        DiffCursorQuery: components["schemas"]["Cursor"];
        /**
         * @description Last server-side project position the client has already processed. Replay starts at
         *     `lastEventPosition + 1`. Use `0` to replay the whole project from the beginning.
         *     Takes precedence over the `Last-Event-ID` header.
         *
         *     A value that cannot be used as a cursor is rejected with `400`
         *     (`invalid_query_parameter`) rather than silently ignored, because a client that spells
         *     its own cursor wrongly must not believe it received a gap-free replay. An unusable
         *     `Last-Event-ID` header is ignored instead: browsers set it automatically and a stream
         *     that refuses to open would be worse than one that starts live. A position beyond the
         *     end of the log is clamped to the current end.
         * @example 41
         */
        LastEventPositionQuery: number;
        /**
         * @description Standard SSE reconnect header. Browsers set it automatically to the `id:` of the last
         *     received frame, which is the server-side project position. Ignored when
         *     `lastEventPosition` is present.
         * @example 41
         */
        LastEventIdHeader: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    ingestEvent: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description One event envelope from the closed v0 catalogue. */
        requestBody: {
            content: {
                "application/json": components["schemas"]["IngestEventRequest"];
            };
        };
        responses: {
            /**
             * @description Idempotent retry. The event was already stored under this `clientEventId` with
             *     identical content; the original `position` is returned and nothing is appended.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventAccepted"];
                };
            };
            /** @description Event accepted and appended to the project event log. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventAccepted"];
                };
            };
            400: components["responses"]["BadRequest"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["ContentTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableContent"];
        };
    };
    streamProjectEvents: {
        parameters: {
            query?: {
                /**
                 * @description Last server-side project position the client has already processed. Replay starts at
                 *     `lastEventPosition + 1`. Use `0` to replay the whole project from the beginning.
                 *     Takes precedence over the `Last-Event-ID` header.
                 *
                 *     A value that cannot be used as a cursor is rejected with `400`
                 *     (`invalid_query_parameter`) rather than silently ignored, because a client that spells
                 *     its own cursor wrongly must not believe it received a gap-free replay. An unusable
                 *     `Last-Event-ID` header is ignored instead: browsers set it automatically and a stream
                 *     that refuses to open would be worse than one that starts live. A position beyond the
                 *     end of the log is clamped to the current end.
                 * @example 41
                 */
                lastEventPosition?: components["parameters"]["LastEventPositionQuery"];
            };
            header?: {
                /**
                 * @description Standard SSE reconnect header. Browsers set it automatically to the `id:` of the last
                 *     received frame, which is the server-side project position. Ignored when
                 *     `lastEventPosition` is present.
                 * @example 41
                 */
                "Last-Event-ID"?: components["parameters"]["LastEventIdHeader"];
            };
            path: {
                /** @description Project the request is scoped to. */
                projectId: components["parameters"]["ProjectIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description The event stream. The body is an endless `text/event-stream` document; the schema
             *     below describes the JSON payload of a single `data:` line.
             */
            200: {
                headers: {
                    /** @description Always `no-cache`; the stream must never be cached. */
                    "Cache-Control"?: string;
                    /** @description Always `keep-alive`. */
                    Connection?: string;
                    /**
                     * @description Always `no`. Disables response buffering in the Nginx frontend so that events
                     *     reach the browser immediately.
                     */
                    "X-Accel-Buffering"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": components["schemas"]["StreamedEvent"];
                };
            };
            400: components["responses"]["InvalidQueryParameter"];
            404: components["responses"]["ProjectNotFound"];
        };
    };
    listProjects: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The known projects. Empty, with `projectPosition: 0`, before the first event. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectListResponse"];
                };
            };
        };
    };
    getProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Project the request is scoped to. */
                projectId: components["parameters"]["ProjectIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The project. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectResponse"];
                };
            };
            404: components["responses"]["ProjectNotFound"];
        };
    };
    getProjectArchitecture: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Project the request is scoped to. */
                projectId: components["parameters"]["ProjectIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The applied model and the pending proposals. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArchitectureResponse"];
                };
            };
            404: components["responses"]["ProjectNotFound"];
        };
    };
    listProjectRuns: {
        parameters: {
            query?: {
                /**
                 * @description Number of entries per page. Defaults to 50, maximum 200. A value outside that range is
                 *     rejected with `400` rather than clamped, so a client cannot believe it received
                 *     everything.
                 * @example 50
                 */
                limit?: components["parameters"]["LimitQuery"];
                /**
                 * @description Continuation token of the previous page, taken from its `nextCursor`. Opaque: it is
                 *     echoed back unchanged and its encoding is free to change.
                 */
                cursor?: components["parameters"]["CursorQuery"];
            };
            header?: never;
            path: {
                /** @description Project the request is scoped to. */
                projectId: components["parameters"]["ProjectIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of runs. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunListResponse"];
                };
            };
            400: components["responses"]["InvalidQueryParameter"];
            404: components["responses"]["ProjectNotFound"];
        };
    };
    getProjectRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Project the request is scoped to. */
                projectId: components["parameters"]["ProjectIdPath"];
                /**
                 * @description Run inside the project, or the literal `current` for the run a root orchestrator opened
                 *     last. The alias wins over a run that happens to carry that identifier: the default view
                 *     of the cockpit must not depend on how an agent named its run.
                 * @example current
                 */
                runId: components["parameters"]["RunIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunResponse"];
                };
            };
            404: components["responses"]["RunNotFound"];
        };
    };
    listRunAgents: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Project the request is scoped to. */
                projectId: components["parameters"]["ProjectIdPath"];
                /**
                 * @description Run inside the project, or the literal `current` for the run a root orchestrator opened
                 *     last. The alias wins over a run that happens to carry that identifier: the default view
                 *     of the cockpit must not depend on how an agent named its run.
                 * @example current
                 */
                runId: components["parameters"]["RunIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every agent of the run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentListResponse"];
                };
            };
            404: components["responses"]["RunNotFound"];
        };
    };
    listRunPlans: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Project the request is scoped to. */
                projectId: components["parameters"]["ProjectIdPath"];
                /**
                 * @description Run inside the project, or the literal `current` for the run a root orchestrator opened
                 *     last. The alias wins over a run that happens to carry that identifier: the default view
                 *     of the cockpit must not depend on how an agent named its run.
                 * @example current
                 */
                runId: components["parameters"]["RunIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every plan of the run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanListResponse"];
                };
            };
            404: components["responses"]["RunNotFound"];
        };
    };
    getComponentInspector: {
        parameters: {
            query?: {
                /**
                 * @description Run the component evidence is read from. Omitted means the current run; `current` means
                 *     the same thing explicitly. Any other value must name a run of this project, otherwise
                 *     the request is rejected with `404` and code `run_not_found` rather than silently falling
                 *     back to the current run.
                 * @example run-2026-08-04-0001
                 */
                runId?: components["parameters"]["RunIdQuery"];
                /**
                 * @description Number of unified diffs in the component inspector. Defaults to 50, maximum 200; a value
                 *     outside that range is rejected with `400`.
                 * @example 50
                 */
                diffLimit?: components["parameters"]["DiffLimitQuery"];
                /**
                 * @description Continuation token for the diffs of the component inspector, taken from the previous
                 *     response's `nextDiffCursor`.
                 */
                diffCursor?: components["parameters"]["DiffCursorQuery"];
            };
            header?: never;
            path: {
                /** @description Project the request is scoped to. */
                projectId: components["parameters"]["ProjectIdPath"];
                /** @description Component of the project's architecture model. */
                componentId: components["parameters"]["ComponentIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The component evidence of one run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ComponentInspectorResponse"];
                };
            };
            400: components["responses"]["InvalidQueryParameter"];
            404: components["responses"]["ComponentNotFound"];
        };
    };
    getComponentHistory: {
        parameters: {
            query?: {
                /**
                 * @description Number of entries per page. Defaults to 50, maximum 200. A value outside that range is
                 *     rejected with `400` rather than clamped, so a client cannot believe it received
                 *     everything.
                 * @example 50
                 */
                limit?: components["parameters"]["LimitQuery"];
                /**
                 * @description Continuation token of the previous page, taken from its `nextCursor`. Opaque: it is
                 *     echoed back unchanged and its encoding is free to change.
                 */
                cursor?: components["parameters"]["CursorQuery"];
            };
            header?: never;
            path: {
                /** @description Project the request is scoped to. */
                projectId: components["parameters"]["ProjectIdPath"];
                /** @description Component of the project's architecture model. */
                componentId: components["parameters"]["ComponentIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of component history. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ComponentHistoryResponse"];
                };
            };
            400: components["responses"]["InvalidQueryParameter"];
            404: components["responses"]["ComponentNotFound"];
        };
    };
    getLiveness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The process is alive. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LivenessStatus"];
                };
            };
        };
    };
    getReadiness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The backend is ready to serve ingestion and streaming. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadinessStatus"];
                };
            };
            /** @description The backend is not ready, for example because PostgreSQL is unreachable. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
}
