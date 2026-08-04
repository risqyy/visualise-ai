import { expect, test } from '@playwright/test'

import { asAccepted, bootstrapEvent, postEvent, streamUrl } from '../src/api.js'
import {
  REPLAY_BOOTSTRAP_AGENT,
  REPLAY_BOOTSTRAP_RUN,
  REPLAY_PROJECT,
} from '../src/config.js'
import { SseRecorder } from '../src/sse.js'
import { startSimulator } from '../src/simulator.js'

/**
 * Mandatory check 7 — a forced SSE disconnect, and a replay from the last
 * project position that arrives gapless, ordered and without a duplicate.
 *
 * **This check is trivially easy to write as a vacuum, and the guards below are
 * the point of the file.** The failure mode is concrete: a stream opened for a
 * project that does not exist yet is answered `404`, no frame ever arrives, the
 * cut lands at `0`, and "no gaps, no duplicates, ascending" is then true of the
 * empty sequence. Everything is green and nothing was tested.
 *
 * Four guards make that impossible:
 *
 * 1. both connections must have answered **HTTP 200**,
 * 2. both must have carried **real traffic** (at least one frame each),
 * 3. the cut must lie **strictly inside** the sequence: `0 < cut < endPosition`,
 * 4. the union must cover the run **completely**, from position 1 to the
 *    `endPosition` the server itself assigned — which comes from the simulator's
 *    `--json` summary, not from what the stream happened to deliver.
 *
 * The cut is made **while the simulator is still running**, so the second
 * connection has to do both halves of the job: replay what it missed from the
 * log, then continue live.
 */

const BOOTSTRAP_ID = '33333333-0000-4000-8000-000000000001'

/** Frames to collect before cutting. Well inside a 62-event run. */
const FRAMES_BEFORE_CUT = 8

test('7 · a forced disconnect replays from the last position, gapless, ordered and without duplicates', async () => {
  // ---- open the project so the stream is not answered 404 -----------------
  const opened = await postEvent(
    bootstrapEvent({
      clientEventId: BOOTSTRAP_ID,
      projectId: REPLAY_PROJECT,
      runId: REPLAY_BOOTSTRAP_RUN,
      agentId: REPLAY_BOOTSTRAP_AGENT,
      displayName: 'Replay probe bootstrap',
      assignedTask: 'Open the project so the replay probe can subscribe from position 0.',
    }),
  )
  expect(opened.status, JSON.stringify(opened.body)).toBe(201)
  expect(asAccepted(opened).position).toBe(1)

  // `lastEventPosition=0` means "replay everything", so the first connection
  // starts at position 1 and the union below can be checked against the whole
  // project rather than against an arbitrary tail.
  const first = new SseRecorder(streamUrl(REPLAY_PROJECT, 0))
  expect(
    await first.open(),
    'the first stream must be a real 200, not a 404 for a project that does not exist',
  ).toBe(200)
  await first.waitForCount(1)

  const simulator = startSimulator({ scenario: 'full', projectId: REPLAY_PROJECT, speed: 1 })

  // ---- cut in the middle of the running simulator -------------------------
  await first.waitForCount(FRAMES_BEFORE_CUT)
  // The cut is read *after* the abort completed, never before: a frame that
  // arrives between reading the cursor and closing the socket would otherwise
  // be counted as received and requested again, which would look like a
  // duplicate the server never produced.
  await first.abort()

  const firstPositions = [...first.positions]
  const cut = firstPositions.at(-1) ?? 0

  // ---- resume from exactly where the cut happened -------------------------
  const second = new SseRecorder(streamUrl(REPLAY_PROJECT, cut))
  expect(await second.open(), 'the resumed stream must answer 200').toBe(200)

  const summary = await simulator.done
  expect(summary.projectId).toBe(REPLAY_PROJECT)
  expect(summary.conflicts).toBe(0)
  expect(summary.duplicates).toBe(0)
  expect(summary.created).toBe(summary.eventsSent)

  const endPosition = summary.endPosition
  await second.waitForPosition(endPosition)
  await second.abort()

  const secondPositions = [...second.positions]

  // ---- guard 1: both connections were real --------------------------------
  expect(first.status).toBe(200)
  expect(second.status).toBe(200)
  expect(first.error ?? null).toBeNull()
  expect(second.error ?? null).toBeNull()

  // ---- guard 2: both carried traffic --------------------------------------
  expect(
    firstPositions.length,
    'the first connection carried no events — nothing was cut',
  ).toBeGreaterThanOrEqual(FRAMES_BEFORE_CUT)
  expect(
    secondPositions.length,
    'the resumed connection carried no events — nothing was replayed',
  ).toBeGreaterThan(0)

  // ---- guard 3: the cut lies strictly inside the sequence -----------------
  expect(endPosition).toBe(summary.eventsSent + 1)
  expect(cut, 'the cut must not be at the very beginning').toBeGreaterThan(0)
  expect(cut, 'the cut must not be at or beyond the end of the run').toBeLessThan(
    endPosition,
  )

  // ---- guard 4: the union is the complete run, exactly once each ----------
  const combined = [...firstPositions, ...secondPositions]
  const expected = Array.from({ length: endPosition }, (_, index) => index + 1)

  expect(
    [...new Set(combined)].sort((a, b) => a - b),
    'the two connections together must cover every position of the project',
  ).toEqual(expected)

  const duplicates = combined.filter(
    (position, index) => combined.indexOf(position) !== index,
  )
  expect(duplicates, 'a position was delivered twice across the reconnect').toEqual([])
  expect(combined).toHaveLength(endPosition)

  // Ordered within each connection, and the seam is exactly the cut.
  expectStrictlyAscending(firstPositions, 'first connection')
  expectStrictlyAscending(secondPositions, 'resumed connection')
  expect(firstPositions[0]).toBe(1)
  expect(firstPositions.at(-1)).toBe(cut)
  expect(
    secondPositions[0],
    'the resumed stream must continue at the position after the cut',
  ).toBe(cut + 1)
  expect(secondPositions.at(-1)).toBe(endPosition)

  // The frames are self-consistent: the SSE `id:` is the project position the
  // payload carries, for the replayed half as well as for the live half.
  for (const frame of [...first.frames, ...second.frames]) {
    expect(frame.payloadPosition).toBe(frame.position)
    expect(frame.projectId).toBe(REPLAY_PROJECT)
    expect(frame.type).not.toBe('')
  }

  // The replayed half is not a special case of the live half: the resumed
  // connection had to serve both, which is only true if the cut happened while
  // the simulator was still sending.
  const replayedAfterCut = summary.events.filter(
    (event) => event.position !== null && event.position > cut,
  ).length
  expect(replayedAfterCut).toBeGreaterThan(0)
})

test('7 · a cursor the project has not reached yet does not produce a silent stream', async () => {
  // ADR 0006: a cursor beyond the end of the log is clamped to the current end
  // rather than filtering everything away, because a working-but-silent stream
  // is the worst failure mode for an observability tool.
  const recorder = new SseRecorder(streamUrl(REPLAY_PROJECT, 10_000_000))
  expect(await recorder.open()).toBe(200)

  const probe = await postEvent({
    schemaVersion: '1.0',
    clientEventId: '33333333-0000-4000-8000-000000000002',
    projectId: REPLAY_PROJECT,
    runId: REPLAY_BOOTSTRAP_RUN,
    agentId: REPLAY_BOOTSTRAP_AGENT,
    parentAgentId: null,
    occurredAt: '2026-08-04T12:00:00Z',
    type: 'agent.status_reported',
    payload: { status: 'idle', note: 'Probe after an over-long cursor.' },
  })
  expect(probe.status, JSON.stringify(probe.body)).toBe(201)
  const probePosition = asAccepted(probe).position

  await recorder.waitForPosition(probePosition, 30_000)
  await recorder.abort()

  expect(recorder.positions).toContain(probePosition)
})

function expectStrictlyAscending(positions: readonly number[], label: string): void {
  for (let index = 1; index < positions.length; index += 1) {
    expect(
      positions[index] as number,
      `${label}: position ${String(positions[index])} arrived after ${String(positions[index - 1])}`,
    ).toBeGreaterThan(positions[index - 1] as number)
  }
}
