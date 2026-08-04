import { useMemo } from 'react'

import { cn } from '@/lib/utils'

import { formatDiffStat } from './formatting'
import { parseUnifiedDiff, type DiffLineKind } from './unifiedDiff'

/**
 * One reported unified diff, of exactly one repository file.
 *
 * The point of this view is that a reviewer never has to open the repository:
 * the file path, what was added and what was removed are all here. Three
 * channels carry that information so it survives greyscale and colour vision
 * deficiency, in the same spirit as `state/workStates.ts`:
 *
 * * the leading `+`/`-` of the reported line, kept verbatim,
 * * a gutter with the original and the new line number,
 * * a background tint.
 *
 * The diff scrolls **inside its own box**. Wide lines are common in real diffs
 * and the workspace body must never scroll sideways (`index.css` sets
 * `overflow: hidden` on `body` for exactly this reason).
 */

const LINE_CLASSES: Record<DiffLineKind, string> = {
  addition: 'bg-state-applied/12 text-foreground',
  removal: 'bg-state-removed/12 text-foreground',
  context: 'text-muted-foreground',
  hunk: 'bg-muted/60 text-muted-foreground',
  meta: 'text-muted-foreground/70',
}

/** Screen-reader prefix, so a diff is not read as one run-on paragraph. */
const LINE_ROLE_LABELS: Record<DiffLineKind, string> = {
  addition: 'hinzugefügt',
  removal: 'entfernt',
  context: 'unverändert',
  hunk: 'Abschnitt',
  meta: 'Kopfzeile',
}

export interface UnifiedDiffViewProps {
  filePath: string
  unifiedDiff: string
  className?: string
}

export function UnifiedDiffView({
  filePath,
  unifiedDiff,
  className,
}: UnifiedDiffViewProps) {
  const parsed = useMemo(() => parseUnifiedDiff(unifiedDiff), [unifiedDiff])

  return (
    <figure
      className={cn('border-border overflow-hidden rounded-md border', className)}
      data-testid="unified-diff"
      data-file-path={filePath}
    >
      <figcaption className="bg-muted/50 border-border flex items-center gap-2 border-b px-2 py-1">
        <code className="min-w-0 flex-1 truncate font-mono text-xs" title={filePath}>
          {filePath}
        </code>
        <span className="text-2xs shrink-0 tabular-nums">
          <span className="text-state-applied">+{parsed.additions}</span>
          <span className="text-muted-foreground"> / </span>
          <span className="text-state-removed">−{parsed.removals}</span>
        </span>
        <span className="sr-only">
          {formatDiffStat(parsed.additions, parsed.removals)} in {filePath}
        </span>
      </figcaption>

      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <tbody>
            {parsed.lines.map((line, index) => (
              <tr
                key={index}
                className={cn('align-top', LINE_CLASSES[line.kind])}
                data-line-kind={line.kind}
              >
                <td className="text-muted-foreground/60 w-10 border-r border-r-border/60 px-1 text-right tabular-nums select-none">
                  {line.oldNumber ?? ''}
                </td>
                <td className="text-muted-foreground/60 w-10 border-r border-r-border/60 px-1 text-right tabular-nums select-none">
                  {line.newNumber ?? ''}
                </td>
                <td className="px-2 whitespace-pre">
                  <span className="sr-only">{LINE_ROLE_LABELS[line.kind]}: </span>
                  {line.content === '' ? ' ' : line.content}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
