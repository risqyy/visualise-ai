package store

import (
	"sort"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// linkEventComponents writes one event_components row per component the event
// touches, so component history is served by an index instead of a JSONB scan.
func linkEventComponents(tx *gorm.DB, ev *Event) error {
	ids, err := eventComponentIDs(ev.Type, ev.Payload)
	if err != nil {
		return err
	}
	for _, id := range ids {
		link := &EventComponent{ProjectID: ev.ProjectID, Position: ev.Position, ComponentID: id}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(link).Error; err != nil {
			return err
		}
	}
	return nil
}

// eventComponentIDs collects every component an event refers to, either through
// a componentIds array or through a reported component or relationship
// descriptor. Relationships contribute both of their endpoints.
func eventComponentIDs(evType string, payload []byte) ([]string, error) {
	switch evType {
	case TypeWorkStepStarted:
		var p workStepStartedPayload
		if err := decodePayload(payload, &p); err != nil {
			return nil, err
		}
		return normaliseIDs(p.ComponentIDs), nil

	case TypeFeedbackPublished:
		var p feedbackPublishedPayload
		if err := decodePayload(payload, &p); err != nil {
			return nil, err
		}
		return normaliseIDs(p.ComponentIDs), nil

	case TypeDiffReported:
		var p diffReportedPayload
		if err := decodePayload(payload, &p); err != nil {
			return nil, err
		}
		return normaliseIDs(p.ComponentIDs), nil

	case TypeRiskReported:
		var p riskReportedPayload
		if err := decodePayload(payload, &p); err != nil {
			return nil, err
		}
		return normaliseIDs(p.ComponentIDs), nil

	case TypeProblemReported:
		var p problemReportedPayload
		if err := decodePayload(payload, &p); err != nil {
			return nil, err
		}
		return normaliseIDs(p.ComponentIDs), nil

	case TypePlanPublished:
		var p planPublishedPayload
		if err := decodePayload(payload, &p); err != nil {
			return nil, err
		}
		var ids []string
		for _, step := range p.Steps {
			ids = append(ids, step.ComponentIDs...)
		}
		return normaliseIDs(ids), nil

	case TypeComponentChangePlanned, TypeComponentChangeApplied:
		component, _, err := decodeComponentChange(payload)
		if err != nil {
			return nil, err
		}
		return normaliseIDs([]string{component.ComponentID}), nil

	case TypeRelationshipChangePlanned, TypeRelationshipChangeApplied:
		relationship, _, err := decodeRelationshipChange(payload)
		if err != nil {
			return nil, err
		}
		return normaliseIDs([]string{relationship.SourceComponentID, relationship.TargetComponentID}), nil

	case TypeArchitectureSnapshotPublished:
		var p architectureSnapshotPayload
		if err := decodePayload(payload, &p); err != nil {
			return nil, err
		}
		var ids []string
		for _, component := range p.Components {
			ids = append(ids, component.ComponentID)
		}
		for _, relationship := range p.Relationships {
			ids = append(ids, relationship.SourceComponentID, relationship.TargetComponentID)
		}
		return normaliseIDs(ids), nil

	case TypeCorrectionIssued:
		// A correction carries the corrected content, so it touches the same
		// components as the event it replaces.
		var p correctionIssuedPayload
		if err := decodePayload(payload, &p); err != nil {
			return nil, err
		}
		if p.CorrectedType == TypeCorrectionIssued || p.CorrectedType == TypeRetractionIssued {
			return nil, nil
		}
		return eventComponentIDs(p.CorrectedType, p.CorrectedPayload)

	default:
		return nil, nil
	}
}

// normaliseIDs drops empty entries and duplicates and sorts the rest, so the
// generated rows do not depend on the order the agent reported them in.
func normaliseIDs(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}
