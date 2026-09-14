package store

import (
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// DomainError is transport independent; adapters preserve Code and field pointers.
type DomainError struct {
	Code                 string `json:"code"`
	Detail               string `json:"message"`
	Field                string `json:"-"`
	CurrentModelRevision *int64 `json:"currentModelRevision,omitempty"`
	CurrentViewRevision  *int64 `json:"currentViewRevision,omitempty"`
}

func (e *DomainError) Error() string { return e.Code + ": " + e.Detail }
func domainError(code, field, format string, args ...any) *DomainError {
	return &DomainError{Code: code, Field: field, Detail: fmt.Sprintf(format, args...)}
}

// AffectedIDs identifies explicit command targets, including removals.
type AffectedIDs struct {
	ComponentIDs    []string `json:"componentIds"`
	RelationshipIDs []string `json:"relationshipIds"`
}

// ModelIdentity reserves materialized identities forever, independently of projections.
type ModelIdentity struct {
	ProjectID       string `gorm:"primaryKey;type:text"`
	Kind            string `gorm:"primaryKey;type:text"`
	ID              string `gorm:"primaryKey;type:text"`
	FirstPosition   int64  `gorm:"not null"`
	HistoricalReuse bool   `gorm:"not null;default:false"`
}

func (ModelIdentity) TableName() string { return "model_identities" }

// CommandReceipt is immutable alongside its event; legacy entries have an empty identity.
type CommandReceipt struct {
	ProjectID     string `gorm:"primaryKey;type:text"`
	ClientEventID string `gorm:"primaryKey;type:uuid"`
	Identity      string `gorm:"type:text;not null"`
	Receipt       JSON   `gorm:"type:jsonb;not null"`
}

func (CommandReceipt) TableName() string { return "command_receipts" }
func commandIdentity(env Envelope) (string, error) {
	if env.SchemaVersion != "2.0" {
		return "", nil
	}
	timestamp := env.OccurredAtText
	if timestamp == "" {
		timestamp = env.OccurredAt.UTC().Format(time.RFC3339Nano)
	}
	raw, err := json.Marshal(map[string]any{"contractVersion": "2.0.0", "schemaVersion": env.SchemaVersion, "type": env.Type, "projectId": env.ProjectID, "clientEventId": env.ClientEventID, "runId": env.RunID, "agentId": env.AgentID, "parentAgentId": env.ParentAgentID, "occurredAt": timestamp, "payload": env.Payload})
	if err != nil {
		return "", err
	}
	canonical, err := canonicalJSON(raw)
	return string(canonical), err
}
func replayCommand(tx *gorm.DB, existing *Event, identity string) (bool, *Result, error) {
	var record CommandReceipt
	err := tx.Where("project_id = ? AND client_event_id = ?", existing.ProjectID, existing.ClientEventID).Take(&record).Error
	if err == gorm.ErrRecordNotFound {
		return identity == "", nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	if record.Identity != identity {
		return false, nil, nil
	}
	var result Result
	if err = json.Unmarshal(record.Receipt, &result); err != nil {
		return false, nil, err
	}
	return true, &result, nil
}
func saveReceipt(tx *gorm.DB, env Envelope, identity string, result Result) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return tx.Create(&CommandReceipt{ProjectID: env.ProjectID, ClientEventID: env.ClientEventID, Identity: identity, Receipt: JSON(raw)}).Error
}
func affectedIDs(kind string, payload []byte) AffectedIDs {
	result := AffectedIDs{ComponentIDs: []string{}, RelationshipIDs: []string{}}
	if kind == TypeModelMutationApplied {
		var p ModelMutationPayload
		if json.Unmarshal(payload, &p) == nil {
			for _, op := range p.Operations {
				kind, id := op.target()
				if kind == "component" {
					result.ComponentIDs = append(result.ComponentIDs, id)
				} else {
					result.RelationshipIDs = append(result.RelationshipIDs, id)
				}
			}
		}
	}
	result.ComponentIDs = normaliseIDs(result.ComponentIDs)
	result.RelationshipIDs = normaliseIDs(result.RelationshipIDs)
	return result
}
