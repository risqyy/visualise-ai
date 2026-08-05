import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SUPPORTED_LANGUAGES, useLanguagePreference } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * The language switch: two segments, German and English.
 *
 * ## Why two buttons and not a menu
 *
 * There are two languages. A dropdown for two options costs a click to find out
 * what the options even are, and it hides the *current* one behind a trigger
 * label. Two segments show the choice and the answer at the same time, in the
 * width of a badge, which is what keeps this off the architecture surface —
 * the canvas stays the widest thing on screen (ADR 0008).
 *
 * ## Why `aria-pressed` and not a radiogroup
 *
 * A radio group is the textbook mapping for "one of n", and it comes with a
 * roving `tabindex` and arrow-key navigation that a correct implementation has
 * to write itself — this repository has no shadcn toggle group to inherit one
 * from. Two toggle buttons inside a named group are operable with `Tab` and
 * `Enter`/`Space` out of the box, and the pressed state is what a screen reader
 * announces for the active language. For two options the group semantics buy
 * nothing that the group's own accessible name does not already give.
 *
 * ## Why the segments are named in their own language
 *
 * Each button's accessible name is the language's own word for itself —
 * "Deutsch" and "English" — identical in both catalogues. A reader who ended up
 * in a language they cannot read has to be able to find their way out, and
 * "Alemán" in a Spanish UI would be exactly the wrong help. The *group* is
 * named in the active language (`common:language.label`), and so is the tooltip
 * on each segment.
 *
 * ## Why the focus does not move
 *
 * The click switches the language and nothing else: no navigation, no remount,
 * no dialog. The button the user pressed stays mounted at the same position in
 * the tree, so it keeps the focus — the switch reads its new pressed state out
 * where the user already is, instead of dropping focus onto `<body>`.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation('common')
  const { language, choose } = useLanguagePreference()

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      data-testid="language-switcher"
      className={cn(
        'border-border bg-background flex items-center gap-0.5 rounded-md border p-0.5',
        className,
      )}
    >
      {SUPPORTED_LANGUAGES.map((option) => {
        const active = option === language
        const name = t(`language.name.${option}`)

        return (
          <Tooltip key={option}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={active ? 'secondary' : 'ghost'}
                size="xs"
                aria-label={name}
                aria-pressed={active}
                data-testid={`language-option-${option}`}
                className={cn(
                  'px-1.5 font-mono text-[0.6875rem] tracking-wide',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
                onClick={() => choose(option)}
              >
                {t(`language.code.${option}`)}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {active
                ? t('language.current', { language: name })
                : t('language.switchTo', { language: name })}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
