import { defaultSchema } from 'rehype-sanitize'

/**
 * Sanitisation schema for agent published markdown.
 *
 * Feedback bodies are **untrusted input**. The contract says so in as many
 * words: `FeedbackEntry.body` is "untrusted markdown … handed through verbatim
 * — sanitising it before rendering is the client's job". Whatever wrote the
 * event — a model, a tool it called, a file it read — is outside this system's
 * trust boundary, and the cockpit renders it into the same origin that talks to
 * the read API.
 *
 * The schema below is the GitHub-style allow list of `hast-util-sanitize` with
 * the dangerous element families named explicitly. It is an **allow list**: a
 * tag or attribute that is not enumerated is removed, so a vector nobody
 * thought of is rejected by default rather than by having been predicted. A
 * hand-written list of forbidden patterns would have the opposite failure mode,
 * which is why this file does not contain one.
 *
 * Two behaviours of the sanitiser matter for reading the tests:
 *
 * * A tag in `strip` is removed **with its children** — the payload of a
 *   `<script>` or a `<style>` never becomes visible text.
 * * Any other disallowed tag is unwrapped: the element disappears, its text
 *   children survive. That is deliberate — dropping the text of an unknown
 *   inline wrapper would silently lose reported content.
 */

/** Alias of the schema type; `rehype-sanitize` re-exports it as `Options`. */
type SanitizeSchema = typeof defaultSchema

/**
 * Element names that are removed together with everything inside them.
 *
 * None of them is in the allow list to begin with — they are named here so the
 * *content* of an active element cannot leak into the page as text, and so the
 * intent is reviewable in one place.
 */
export const STRIPPED_TAG_NAMES = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'form',
  'frame',
  'frameset',
  'applet',
  'link',
  'meta',
  'base',
  'svg',
  'math',
] as const

/**
 * URL schemes an attribute may carry. `javascript:`, `data:` and `vbscript:`
 * are absent, so a markdown link or image cannot smuggle an active URL past the
 * renderer even though markdown itself has no HTML in it.
 */
const PROTOCOLS = {
  cite: ['http', 'https'],
  href: ['http', 'https', 'mailto'],
  longDesc: ['http', 'https'],
  src: ['http', 'https'],
}

export const feedbackSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  // Belt and braces: the allow list already omits these, filtering them keeps
  // the two lists from drifting if `defaultSchema` ever grows one of them.
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (tag) => !(STRIPPED_TAG_NAMES as readonly string[]).includes(tag),
  ),
  strip: [...STRIPPED_TAG_NAMES],
  protocols: PROTOCOLS,
  // Comments can carry conditional-comment payloads; nothing in v0 needs them.
  allowComments: false,
  allowDoctypes: false,
}
