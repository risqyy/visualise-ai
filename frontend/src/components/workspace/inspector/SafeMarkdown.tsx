import type { ComponentProps } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

import { feedbackSanitizeSchema } from './sanitizeSchema'

/**
 * Renders agent published markdown safely.
 *
 * The pipeline is deliberately explicit, because its **order** is the security
 * property:
 *
 * 1. `remark-parse` + `remark-gfm` — markdown, including tables, task lists and
 *    strikethrough, which the simulator's feedback actually uses.
 * 2. `remark-rehype` — markdown syntax tree to HTML syntax tree. `react-markdown`
 *    always runs it with `allowDangerousHtml`, so raw HTML survives as `raw`
 *    nodes at this point. Nothing is safe yet.
 * 3. `rehype-raw` — parses those `raw` nodes into real elements. This is the
 *    step that makes an attack possible at all, and it exists so that harmless
 *    inline HTML an agent writes (`<b>`, `<br>`, `<details>`) is not silently
 *    dropped.
 * 4. `rehype-sanitize` — the allow list of `sanitizeSchema.ts`, applied to the
 *    **HTML tree**, after everything that could produce an element has run. A
 *    plugin added before it would be sanitised; a plugin added after it would
 *    not, which is why the array below is a module constant and not built at
 *    the call site.
 * 5. `react-markdown`'s `defaultUrlTransform` — an independent second check of
 *    `href`/`src` values while the tree is turned into React elements.
 *
 * React's escaping is *not* counted as one of these layers. It is what makes
 * step 3 the only way HTML can appear at all, but the requirement is that the
 * dangerous element never reaches the DOM, and only the sanitiser guarantees
 * that.
 *
 * `dangerouslySetInnerHTML` is never used here, and `rehype-raw` is the only
 * component in the pipeline that reads markup as markup.
 */
type MarkdownPlugins = ComponentProps<typeof ReactMarkdown>['rehypePlugins']

const REMARK_PLUGINS: MarkdownPlugins = [remarkGfm]

const REHYPE_PLUGINS: MarkdownPlugins = [
  rehypeRaw,
  // Must stay last: it is the boundary between untrusted and rendered.
  [rehypeSanitize, feedbackSanitizeSchema],
]

/**
 * Tailwind mapping for the rendered elements.
 *
 * Kept as a component map rather than as global CSS so the markdown surface
 * cannot restyle anything outside the inspector, and so a long code block
 * scrolls inside its own box instead of widening the pane.
 */
const MARKDOWN_COMPONENTS: Components = {
  h1: (props) => <h3 {...props} className="mt-4 mb-1.5 text-sm font-semibold first:mt-0" />,
  h2: (props) => <h4 {...props} className="mt-4 mb-1.5 text-sm font-semibold first:mt-0" />,
  h3: (props) => <h5 {...props} className="mt-3 mb-1 text-xs font-semibold first:mt-0" />,
  h4: (props) => <h6 {...props} className="mt-3 mb-1 text-xs font-semibold first:mt-0" />,
  p: (props) => <p {...props} className="my-1.5 leading-relaxed" />,
  ul: (props) => <ul {...props} className="my-1.5 list-disc space-y-0.5 pl-5" />,
  ol: (props) => <ol {...props} className="my-1.5 list-decimal space-y-0.5 pl-5" />,
  li: (props) => <li {...props} className="leading-relaxed" />,
  blockquote: (props) => (
    <blockquote
      {...props}
      className="border-border text-muted-foreground my-2 border-l-2 pl-3"
    />
  ),
  hr: (props) => <hr {...props} className="border-border my-3" />,
  a: ({ href, ...props }: ComponentProps<'a'>) => (
    <a
      {...props}
      {...(href === undefined ? {} : { href })}
      // No `target`: the allow list drops it anyway, and a link that stays in
      // the tab cannot hand a fresh window an opener reference.
      rel="noreferrer nofollow"
      className="underline underline-offset-2"
    />
  ),
  pre: (props) => (
    <pre
      {...props}
      className="border-border bg-background my-2 overflow-x-auto rounded-md border p-2 font-mono text-xs"
    />
  ),
  code: ({ className, ...props }: ComponentProps<'code'>) => (
    <code
      {...props}
      className={cn(
        'font-mono text-xs',
        // Only inline code gets a chip; a fenced block is styled by its `pre`.
        className ? className : 'bg-muted rounded px-1 py-0.5',
      )}
    />
  ),
  table: (props) => (
    <div className="my-2 overflow-x-auto">
      <table {...props} className="w-full border-collapse text-xs" />
    </div>
  ),
  th: (props) => (
    <th {...props} className="border-border border px-2 py-1 text-left font-semibold" />
  ),
  td: (props) => <td {...props} className="border-border border px-2 py-1 align-top" />,
  img: (props) => <img {...props} className="my-2 max-w-full rounded-md" />,
}

export interface SafeMarkdownProps {
  /** The reported markdown body, verbatim. */
  children: string
  className?: string
}

/**
 * Renders untrusted markdown with the sanitising pipeline described above.
 *
 * `translate="no"` and `data-reported` mark the whole rendered tree as reported
 * data (#42). Agent feedback is the audit source the user reads to decide
 * whether an agent did the right thing; a browser's own page translation
 * rewriting it on a page that declares `lang="de"` would falsify exactly that,
 * and the reader would never learn it happened. The markdown is a tree, not a
 * string, so the marker sits on the container instead of on `<ReportedText>`.
 */
export function SafeMarkdown({ children, className }: SafeMarkdownProps) {
  return (
    <div
      className={cn('min-w-0 text-sm break-words', className)}
      data-testid="safe-markdown"
      translate="no"
      data-reported=""
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
