/**
 * Seeded pseudo-random number generation.
 *
 * Everything the simulator "invents" — client event ids and the length of the
 * pauses between phases — comes from here. `Math.random`, `Date.now` and
 * `crypto.randomUUID` are banned by the ESLint config, so a scenario has no
 * other source of entropy and two runs with the same seed are byte-identical.
 */

/** A 32-bit integer stream. Small, fast and, above all, reproducible. */
export interface Prng {
  /** Next unsigned 32-bit integer. */
  nextUint32(): number
  /** Next integer in `[min, max]`, both inclusive. */
  nextInt(min: number, max: number): number
}

/**
 * mulberry32 — a 32-bit state generator. It is not cryptographically strong and
 * does not need to be: its only job is to be identical on every machine and in
 * every Node version, which a hand-rolled integer recurrence guarantees and a
 * platform RNG does not.
 */
export function createPrng(seed: number): Prng {
  let state = seed >>> 0

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }

  return {
    nextUint32,
    nextInt(min: number, max: number): number {
      if (max < min) {
        throw new Error(`nextInt: max (${max}) must not be below min (${min})`)
      }
      return min + (nextUint32() % (max - min + 1))
    },
  }
}

/**
 * Mixes a string into a seed, so scenarios that share a `--seed` still get
 * disjoint client event ids. Without it, `full` and `retry` would collide on the
 * same project and the retry scenario would see a duplicate where it expects a
 * first delivery.
 *
 * FNV-1a, 32 bit.
 */
export function mixSeed(seed: number, label: string): number {
  let hash = (seed >>> 0) ^ 0x811c9dc5
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

const HEX = '0123456789abcdef'

/**
 * Draws a UUIDv4-shaped identifier from the stream.
 *
 * The contract types `clientEventId` as `format: uuid`, so the value has to
 * carry the version and variant nibbles of a real RFC 4122 v4 UUID even though
 * its randomness is seeded. Only the 6 fixed bits differ from a genuine v4;
 * everything else comes from the generator.
 */
export function uuidFrom(prng: Prng): string {
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i += 4) {
    const word = prng.nextUint32()
    bytes[i] = (word >>> 24) & 0xff
    bytes[i + 1] = (word >>> 16) & 0xff
    bytes[i + 2] = (word >>> 8) & 0xff
    bytes[i + 3] = word & 0xff
  }
  // Version 4 and RFC 4122 variant.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80

  let out = ''
  for (let i = 0; i < 16; i += 1) {
    const byte = bytes[i] as number
    out += HEX[byte >>> 4]
    out += HEX[byte & 0x0f]
    if (i === 3 || i === 5 || i === 7 || i === 9) {
      out += '-'
    }
  }
  return out
}
