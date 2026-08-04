/**
 * The builder every scenario is written against.
 *
 * It owns the three things that must not be left to the scenario author:
 * the client event ids, the reported timeline and the parent agent of an
 * envelope. All three come from seeded streams, which is what makes a scenario
 * a document rather than a recording.
 */
import type { VirtualClock } from './clock.js'
import { createClock } from './clock.js'
import { createPrng, mixSeed, uuidFrom, type Prng } from './prng.js'
import type { EventEnvelope, EventPayload, ExpectedResponse, ScenarioStep } from './types.js'

/** One agent of the simulated run. */
export interface Agent {
  agentId: string
  /** `null` for the root orchestrator. */
  parentAgentId: string | null
}

export interface SequenceOptions {
  projectId: string
  runId: string
  seed: number
  /** Mixed into the seed so scenarios sharing a `--seed` get disjoint ids. */
  scenarioLabel: string
}

/**
 * Three independent streams, so adding a pause never shifts a client event id
 * and changing the pacing never changes the identity of an event.
 */
interface Streams {
  ids: Prng
  pauses: Prng
  clock: Prng
}

export class SequenceBuilder {
  private readonly steps: ScenarioStep[] = []
  private readonly streams: Streams
  private readonly clock: VirtualClock
  private phase = 'start'
  private nextPauseMs = 0

  constructor(private readonly options: SequenceOptions) {
    const base = mixSeed(options.seed, options.scenarioLabel)
    this.streams = {
      ids: createPrng(mixSeed(base, 'ids')),
      pauses: createPrng(mixSeed(base, 'pauses')),
      clock: createPrng(mixSeed(base, 'clock')),
    }
    this.clock = createClock()
  }

  /**
   * Opens a narrated phase. The pause before the first event of a phase is the
   * long one — that is the beat a human watching the browser needs to see the
   * previous phase land.
   */
  beginPhase(name: string): this {
    this.phase = name
    this.nextPauseMs = this.streams.pauses.nextInt(900, 1800)
    return this
  }

  /** Appends one event and returns its client event id. */
  emit(
    agent: Agent,
    type: string,
    payload: EventPayload,
    expect: ExpectedResponse = { status: 201, duplicate: false },
  ): string {
    const event: EventEnvelope = {
      schemaVersion: '1.0',
      clientEventId: uuidFrom(this.streams.ids),
      projectId: this.options.projectId,
      runId: this.options.runId,
      agentId: agent.agentId,
      parentAgentId: agent.parentAgentId,
      // Reported time moves in plausible steps of seconds; the pause the runner
      // waits is unrelated and much shorter.
      occurredAt: this.clock.advance(this.streams.clock.nextInt(7, 95) * 1000),
      type,
      payload,
    }

    const pauseMs = this.nextPauseMs
    this.nextPauseMs = this.streams.pauses.nextInt(120, 420)
    this.steps.push({ phase: this.phase, pauseMs, event, expect })
    return event.clientEventId
  }

  /**
   * Appends a byte-identical copy of an already emitted event. The copy shares
   * its client event id, so the server must answer `200 duplicate: true` with
   * the position it assigned the first time.
   */
  emitRetryOf(clientEventId: string): void {
    const original = this.steps.find((step) => step.event.clientEventId === clientEventId)
    if (!original) {
      throw new Error(`emitRetryOf: no earlier step with clientEventId ${clientEventId}`)
    }
    this.steps.push({
      phase: this.phase,
      pauseMs: this.nextPauseMs,
      // Structured clone keeps the retry byte-identical without sharing the
      // object, so a later mutation of one cannot silently change the other.
      event: structuredClone(original.event),
      expect: { status: 200, duplicate: true, samePositionAs: clientEventId },
    })
    this.nextPauseMs = this.streams.pauses.nextInt(120, 420)
  }

  /**
   * Appends an event that reuses an already emitted client event id with a
   * different payload. The server must refuse it with `409`.
   */
  emitConflictWith(clientEventId: string, agent: Agent, type: string, payload: EventPayload): void {
    const original = this.steps.find((step) => step.event.clientEventId === clientEventId)
    if (!original) {
      throw new Error(`emitConflictWith: no earlier step with clientEventId ${clientEventId}`)
    }
    this.steps.push({
      phase: this.phase,
      pauseMs: this.nextPauseMs,
      event: {
        schemaVersion: '1.0',
        clientEventId,
        projectId: this.options.projectId,
        runId: this.options.runId,
        agentId: agent.agentId,
        parentAgentId: agent.parentAgentId,
        occurredAt: this.clock.advance(this.streams.clock.nextInt(7, 95) * 1000),
        type,
        payload,
      },
      expect: { status: 409, code: 'client_event_id_conflict' },
    })
    this.nextPauseMs = this.streams.pauses.nextInt(120, 420)
  }

  build(): ScenarioStep[] {
    return this.steps
  }
}
