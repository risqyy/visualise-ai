import type { AppliedRelationship, Identifier, Relationship } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { ReportedText } from '@/i18n'
import { useTranslation } from 'react-i18next'

import {
  CHANGE_OPERATION_LABEL_KEYS,
  type ChangeOverlay,
} from '@/canvas/changeOverlays'
import { RELATIONSHIP_KIND_STYLE_BY_ID, relationshipDisplayName } from '@/canvas/relationshipKinds'
import { WORK_STATE_BY_ID } from '@/state/workStates'

export interface RelationshipContextCardProps {
  relationshipId: Identifier
  relationship: AppliedRelationship | Relationship | null
  sourceName?: string
  targetName?: string
  overlay?: ChangeOverlay
  bundle: readonly (AppliedRelationship | Relationship)[]
}

/** Full relationship context kept out of the route label. */
export function RelationshipContextCard({
  relationshipId,
  relationship,
  sourceName,
  targetName,
  overlay,
  bundle,
}: RelationshipContextCardProps) {
  const { t } = useTranslation('inspector')
  const { t: tCanvas } = useTranslation('canvas')
  const style = relationship ? RELATIONSHIP_KIND_STYLE_BY_ID[relationship.kind] : null
  const appliedByAgentId =
    relationship && 'appliedByAgentId' in relationship
      ? relationship.appliedByAgentId
      : null

  return (
    <section
      className="border-border space-y-2 rounded-md border p-2"
      aria-label={t('relationship.label')}
      data-testid="inspector-relationship-context"
      data-relationship-id={relationshipId}
    >
      <div className="space-y-0.5">
        <h3 className="truncate text-sm font-semibold">
          {relationship ? (
            <ReportedText value={relationshipDisplayName(relationship)} />
          ) : (
            <ReportedText value={relationshipId} />
          )}
        </h3>
        <p className="text-muted-foreground truncate font-mono text-2xs">
          <ReportedText value={relationshipId} />
        </p>
      </div>

      {relationship ? (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="text-2xs font-normal">
              {style?.abbreviation ?? relationship.kind}
            </Badge>
            <Badge variant="secondary" className="text-2xs font-normal">
              {style ? tCanvas(style.labelKey) : relationship.kind}
            </Badge>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
            <Detail label={t('relationship.source')} value={sourceName ?? relationship.sourceComponentId} />
            <Detail label={t('relationship.target')} value={targetName ?? relationship.targetComponentId} />
            <Detail label={t('relationship.channel')} value={relationship.channel} />
            <Detail label={t('relationship.operation')} value={relationship.operation} />
            <Detail label={t('relationship.protocol')} value={relationship.protocol} />
            <Detail label={t('relationship.reportedLabel')} value={relationship.label} />
          </dl>

          <section className="space-y-1" aria-label={t('relationship.changeLabel')}>
            <h4 className="pane-heading">{t('relationship.changeLabel')}</h4>
            {overlay ? (
              <div className="space-y-1 text-xs" data-testid="relationship-change-state">
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-2xs font-normal">
                    {tCanvas(WORK_STATE_BY_ID[overlay.state].labelKey)}
                  </Badge>
                  {overlay.operation && (
                    <Badge variant="secondary" className="text-2xs font-normal">
                      {tCanvas(CHANGE_OPERATION_LABEL_KEYS[overlay.operation])}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground">
                  {t('relationship.agents', { count: overlay.agentIds.length })}
                  {overlay.agentIds.length > 0 && (
                    <>
                      :{' '}
                      {overlay.agentIds.map((agentId, index) => (
                        <span key={agentId}>
                          {index > 0 && ', '}
                          <ReportedText value={agentId} />
                        </span>
                      ))}
                    </>
                  )}
                </p>
              </div>
            ) : (
              <>
                <p className="text-muted-foreground text-xs">{t('relationship.noChange')}</p>
                {appliedByAgentId && (
                  <p className="text-muted-foreground text-xs" data-testid="relationship-reporting-agents">
                    {t('relationship.reportedBy')}: <ReportedText value={appliedByAgentId} />
                  </p>
                )}
              </>
            )}
          </section>

          {bundle.length > 1 && (
            <section className="space-y-1" aria-label={t('relationship.bundleLabel')} data-testid="inspector-relationship-bundle">
              <h4 className="pane-heading">{t('relationship.bundleLabel')}</h4>
              <ul className="space-y-1 text-xs">
                {bundle.map((entry) => (
                  <li
                    key={entry.relationshipId}
                    className={
                      entry.relationshipId === relationshipId
                        ? 'font-medium text-foreground break-words'
                        : 'text-muted-foreground break-words'
                    }
                    data-selected={entry.relationshipId === relationshipId ? 'true' : 'false'}
                  >
                    <ReportedText value={relationshipDisplayName(entry)} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-xs">{t('relationship.notFound')}</p>
      )}
    </section>
  )
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words" title={value ?? ''}>
        {value && value.trim() !== '' ? <ReportedText value={value} /> : <span className="text-muted-foreground">—</span>}
      </dd>
    </>
  )
}
