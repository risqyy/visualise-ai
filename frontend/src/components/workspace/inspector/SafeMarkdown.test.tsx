import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SafeMarkdown } from './SafeMarkdown'
import { feedbackSanitizeSchema, STRIPPED_TAG_NAMES } from './sanitizeSchema'

/**
 * Attack tests for the markdown renderer.
 *
 * `FeedbackEntry.body` is untrusted by contract. These are the payloads an
 * agent — or anything that fed the agent — could publish, and the assertion is
 * always the same pair:
 *
 * 1. **Nothing ran.** A global sentinel the payload tries to write stays
 *    untouched, and where an event could plausibly fire it is fired explicitly
 *    rather than assumed not to.
 * 2. **The dangerous element or attribute is not in the DOM.** Checking the
 *    rendered markup, not the input, so a payload that only *looks* neutralised
 *    still fails.
 *
 * jsdom does not execute injected `<script>` on its own, so "nothing ran" is
 * necessary but never sufficient — that is why every case also asserts absence
 * from the tree. The positive control at the end proves that raw HTML really is
 * parsed (`rehype-raw`) and that the sanitiser, not React's escaping, is what
 * removes the rest. Without it, every test below would pass on a renderer that
 * simply dropped all HTML, and the sanitiser could rot unnoticed.
 */

declare global {
  var __xssMarkers: string[] | undefined
}

function markers(): string[] {
  return globalThis.__xssMarkers ?? []
}

beforeEach(() => {
  globalThis.__xssMarkers = []
})

afterEach(() => {
  globalThis.__xssMarkers = undefined
})

function renderMarkdown(body: string) {
  const view = render(<SafeMarkdown>{body}</SafeMarkdown>)
  return view.container
}

describe('SafeMarkdown — sanitisation of untrusted agent markdown', () => {
  it('vector 1: <script> is removed with its payload and never executes', () => {
    const container = renderMarkdown(
      ['Vorher.', '', '<script>globalThis.__xssMarkers.push("script")</script>', '', 'Nachher.'].join(
        '\n',
      ),
    )

    expect(markers()).toEqual([])
    expect(container.querySelector('script')).toBeNull()
    // `script` is in the strip list, so its source must not survive as text
    // either — a visible `globalThis…` line would be a rendering bug of its own.
    expect(container.textContent).not.toContain('__xssMarkers')
    expect(container.textContent).toContain('Nachher.')
  })

  it('vector 2: an event-handler attribute (onerror) is stripped and never fires', () => {
    const container = renderMarkdown(
      '<img src="https://example.invalid/x.png" onerror="globalThis.__xssMarkers.push(\'onerror\')" alt="x">',
    )

    const image = container.querySelector('img')
    expect(image).not.toBeNull()
    expect(image?.getAttribute('onerror')).toBeNull()
    expect(container.innerHTML).not.toContain('onerror')

    // Fire the very event the payload was waiting for.
    fireEvent.error(image as HTMLImageElement)
    expect(markers()).toEqual([])
  })

  it('vector 3: an <iframe>, including its srcdoc, never reaches the DOM', () => {
    const container = renderMarkdown(
      '<iframe srcdoc="&lt;script&gt;globalThis.__xssMarkers.push(\'srcdoc\')&lt;/script&gt;" src="https://example.invalid/"></iframe>',
    )

    expect(markers()).toEqual([])
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('[srcdoc]')).toBeNull()
    expect(container.innerHTML).not.toContain('srcdoc')
  })

  it('vector 4: <object> and <embed> are removed together with their data', () => {
    const container = renderMarkdown(
      [
        '<object data="data:text/html;base64,PHNjcmlwdD5nbG9iYWxUaGlzLl9feHNzTWFya2Vycy5wdXNoKCdvYmplY3QnKTwvc2NyaXB0Pg=="></object>',
        '<embed src="https://example.invalid/evil.svg" onload="globalThis.__xssMarkers.push(\'embed\')">',
      ].join('\n\n'),
    )

    expect(markers()).toEqual([])
    expect(container.querySelector('object')).toBeNull()
    expect(container.querySelector('embed')).toBeNull()
    expect(container.innerHTML).not.toContain('onload')
    expect(container.innerHTML).not.toContain('base64')
  })

  it('vector 5: a javascript: URL in a markdown link is not rendered as an href', async () => {
    const user = userEvent.setup()
    const container = renderMarkdown(
      '[Bericht öffnen](javascript:globalThis.__xssMarkers.push("href"))',
    )

    const link = screen.getByText('Bericht öffnen')
    // The whole attribute is dropped, so `?? ''` guards against reading `null`.
    expect(link.getAttribute('href') ?? '').not.toContain('javascript:')
    expect(container.innerHTML).not.toContain('javascript:')

    await user.click(link)
    expect(markers()).toEqual([])
  })

  it('vector 6: a javascript: URL in an image src is not rendered as a src', () => {
    const container = renderMarkdown(
      '![Diagramm](javascript:globalThis.__xssMarkers.push("src"))',
    )

    const image = container.querySelector('img')
    expect(image?.getAttribute('src') ?? '').not.toContain('javascript:')
    expect(container.innerHTML).not.toContain('javascript:')
    expect(markers()).toEqual([])
  })

  it('vector 7: <style> is removed and its rules never enter the document', () => {
    const container = renderMarkdown(
      '<style>body { background: url("javascript:globalThis.__xssMarkers.push(\'style\')") }</style>\n\nText.',
    )

    expect(markers()).toEqual([])
    expect(container.querySelector('style')).toBeNull()
    expect(container.textContent).not.toContain('background')
    expect(container.textContent).toContain('Text.')
  })

  it('vector 8: an inline style attribute and an onclick handler are both stripped', async () => {
    const user = userEvent.setup()
    const container = renderMarkdown(
      '<a href="#hinweis" style="position:fixed;inset:0;z-index:9999" onclick="globalThis.__xssMarkers.push(\'onclick\')">Klick</a>',
    )

    const link = screen.getByText('Klick')
    expect(link.getAttribute('style')).toBeNull()
    expect(link.getAttribute('onclick')).toBeNull()
    expect(container.innerHTML).not.toContain('onclick')
    expect(container.innerHTML).not.toContain('position:fixed')

    await user.click(link)
    expect(markers()).toEqual([])
  })

  it('vector 9: an <svg> with an onload handler is removed entirely', () => {
    const container = renderMarkdown(
      '<svg onload="globalThis.__xssMarkers.push(\'svg\')"><circle r="10" /></svg>',
    )

    expect(markers()).toEqual([])
    expect(container.querySelector('svg')).toBeNull()
    expect(container.innerHTML).not.toContain('onload')
  })

  it('positive control: harmless inline HTML survives, so the sanitiser is what removes the rest', () => {
    const container = renderMarkdown('Ein <b>fetter</b> Hinweis mit <kbd>Esc</kbd>.')

    expect(container.querySelector('b')?.textContent).toBe('fetter')
    expect(container.querySelector('kbd')?.textContent).toBe('Esc')
  })

  it('renders the markdown constructs the simulator actually reports', () => {
    const container = renderMarkdown(
      [
        '## Überschrift',
        '',
        'Ein Absatz mit `inline code`.',
        '',
        '1. erster Punkt',
        '2. zweiter Punkt',
        '',
        '```go',
        'func For(country string) Rate { return rates[country] }',
        '```',
      ].join('\n'),
    )

    expect(screen.getByText('Überschrift')).toBeInTheDocument()
    expect(screen.getByText('inline code')).toBeInTheDocument()
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
    expect(container.querySelector('pre')?.textContent).toContain('func For(country string)')
  })

  it('rebases a report starting at level two below its entry title and closes gaps without changing reported text', () => {
    const container = renderMarkdown([
      '## Root report heading',
      '',
      'Reported text remains complete.',
      '',
      '#### Nested heading with a skipped source level',
      '',
      '###### Deep report heading',
      '',
      '## Another root heading',
    ].join('\n'))
    expect(screen.getAllByRole('heading').map((heading) => [heading.tagName, heading.textContent])).toEqual([
      ['H5', 'Root report heading'],
      ['H6', 'Nested heading with a skipped source level'],
      ['H6', 'Deep report heading'],
      ['H5', 'Another root heading'],
    ])
    expect(container.textContent).toContain('Reported text remains complete.')
    expect(container.querySelector('h1, h2, h3, h4')).toBeNull()
    expect(screen.getByTestId('safe-markdown')).toHaveAttribute('translate', 'no')
    expect(screen.getByTestId('safe-markdown')).toHaveAttribute('data-reported')
  })

  it('rebases raw HTML headings while keeping safe markup and removing executable attributes', () => {
    const container = renderMarkdown([
      '<object><h1>Discarded embedded title</h1></object>',
      '',
      '<h2 onclick="globalThis.__xssMarkers.push(\'heading\')">Raw <em>reported</em> heading</h2>',
      '',
      '<h5>Nested HTML heading</h5>',
      '',
      '<script>globalThis.__xssMarkers.push("script")</script>',
      '',
      '<p>Unchanged <b>evidence</b>.</p>',
    ].join('\n'))
    const root = screen.getByRole('heading', { level: 5, name: 'Raw reported heading' })
    expect(root.querySelector('em')).toHaveTextContent('reported')
    expect(screen.getByRole('heading', { level: 6 })).toHaveTextContent('Nested HTML heading')
    expect(root).not.toHaveAttribute('onclick')
    fireEvent.click(root)
    expect(markers()).toEqual([])
    expect(container.querySelector('script, h1, h2, h3, h4')).toBeNull()
    expect(container.querySelector('b')).toHaveTextContent('evidence')
    expect(container.textContent).not.toContain('Discarded embedded title')
    expect(container.textContent).not.toContain('__xssMarkers')
  })

  it.each([
    ['Markdown', '## First\n\n#### First child\n\n# Later parent\n\n### Later child'],
    ['raw HTML', '<h2>First</h2>\n<h4>First child</h4>\n<h1>Later parent</h1>\n<h3>Later child</h3>'],
  ])('starts out-of-order %s headings below the report title without a skipped level', (_, body) => {
    const container = renderMarkdown(body)
    expect(screen.getAllByRole('heading').map((heading) => [heading.tagName, heading.textContent])).toEqual([
      ['H5', 'First'],
      ['H6', 'First child'],
      ['H5', 'Later parent'],
      ['H6', 'Later child'],
    ])
    expect(container.querySelector('h1, h2, h3, h4')).toBeNull()
    expect(markers()).toEqual([])
  })

  it.each([
    ['Markdown', '## First sibling\n\n## Second sibling\n\n# Later parent'],
    ['raw HTML', '<h2>First sibling</h2>\n<h2>Second sibling</h2>\n<h1>Later parent</h1>'],
  ])('keeps equal %s source levels as siblings when a shallower heading arrives later', (_, body) => {
    renderMarkdown(body)
    expect(screen.getAllByRole('heading').map((heading) => [heading.tagName, heading.textContent])).toEqual([
      ['H5', 'First sibling'],
      ['H5', 'Second sibling'],
      ['H5', 'Later parent'],
    ])
  })
})

describe('the sanitisation schema itself', () => {
  it('strips the active element families instead of unwrapping them', () => {
    for (const tagName of ['script', 'style', 'iframe', 'object', 'embed', 'svg']) {
      expect(feedbackSanitizeSchema.strip).toContain(tagName)
      expect(feedbackSanitizeSchema.tagNames ?? []).not.toContain(tagName)
    }
  })

  it('allows no URL scheme that can execute', () => {
    for (const schemes of Object.values(feedbackSanitizeSchema.protocols ?? {})) {
      expect(schemes).not.toContain('javascript')
      expect(schemes).not.toContain('data')
      expect(schemes).not.toContain('vbscript')
    }
  })

  it('is an allow list: `srcdoc` and every `on*` attribute are simply absent', () => {
    const allowed = Object.values(feedbackSanitizeSchema.attributes ?? {})
      .flat()
      .map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      .filter((entry): entry is string => typeof entry === 'string')

    expect(allowed).not.toContain('srcdoc')
    expect(allowed.filter((name) => name.toLowerCase().startsWith('on'))).toEqual([])
    expect(STRIPPED_TAG_NAMES.length).toBeGreaterThan(0)
  })
})
