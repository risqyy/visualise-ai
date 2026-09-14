package store

import (
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	TypeContextOpened     = "context.opened"
	TypeWorkReported      = "work.reported"
	TypeWorkScopeReported = "work.scope_reported"
)

// AgentWorkScope is the last explicitly reported scope in one run. Finishing
// an agent or deleting a model element does not rewrite this evidence.
type AgentWorkScope struct {
	ProjectID string `gorm:"primaryKey;type:text"`
	RunID     string `gorm:"primaryKey;type:text"`
	AgentID   string `gorm:"primaryKey;type:text"`
	Scope     JSON   `gorm:"type:jsonb;not null"`
	Position  int64  `gorm:"not null"`
}

func (AgentWorkScope) TableName() string { return "agent_work_scopes" }

// EffectiveWork maps typed commands to the existing domain projection. The
// caller keeps the original envelope for persistence and full replay identity.
func EffectiveWork(env Envelope) (Envelope, error) {
	switch env.Type {
	case TypeContextOpened:
		env.Type = TypeAgentStarted
	case TypeWorkReported:
		var p struct {
			Report map[string]json.RawMessage `json:"report"`
		}
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			return env, err
		}
		var action string
		if err := json.Unmarshal(p.Report["action"], &action); err != nil {
			return env, err
		}
		kinds := map[string]string{"step_start": TypeWorkStepStarted, "step_complete": TypeWorkStepCompleted, "status": TypeAgentStatusReported, "progress": TypeAgentProgressReported, "agent_finish": TypeAgentFinished, "run_finish": TypeRunFinished}
		kind, ok := kinds[action]
		if !ok {
			return env, domainError("invalid_input", "/payload/report/action", "unknown work action")
		}
		delete(p.Report, "action")
		// JSON Schema accepts integral number spellings such as 20.0. Only the
		// projection normalises them; the original command bytes stay untouched.
		if kind == TypeAgentProgressReported {
			var n ModelMutationPayload
			raw := append([]byte(`{"expectedModelRevision":`), p.Report["percent"]...)
			raw = append(raw, []byte(`,"operations":[]}`)...)
			if err := json.Unmarshal(raw, &n); err != nil {
				return env, err
			}
			p.Report["percent"] = json.RawMessage(fmt.Sprint(n.ExpectedModelRevision))
		}
		var err error
		env.Payload, err = json.Marshal(p.Report)
		if err != nil {
			return env, err
		}
		env.Type = kind
	}
	return env, nil
}

// ValidateWork runs under the append lock after replay resolution. Step
// ownership and references are checked before any projection is written.
func ValidateWork(tx *gorm.DB, original Envelope) error {
	correctionWrite := original.Type == TypeCorrectionIssued
	fieldBase := "/payload"
	if original.Type == TypeWorkReported {
		fieldBase += "/report"
	}
	if correctionWrite {
		fieldBase += "/correctedPayload"
		var correction correctionIssuedPayload
		if err := json.Unmarshal(original.Payload, &correction); err != nil {
			return err
		}
		if correction.CorrectedType != TypeWorkStepStarted && correction.CorrectedType != TypeWorkStepCompleted {
			return nil
		}
		original.Type = correction.CorrectedType
		original.Payload = correction.CorrectedPayload
	}
	env, err := EffectiveWork(original)
	if err != nil {
		return err
	}
	var ids AffectedIDs
	switch original.Type {
	case TypeWorkScopeReported:
		var p struct {
			Scope AffectedIDs `json:"scope"`
		}
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			return err
		}
		ids = p.Scope
	case TypeWorkReported, TypeWorkStepStarted, TypeWorkStepCompleted:
		if env.Type == TypeWorkStepStarted || env.Type == TypeWorkStepCompleted {
			var p workStepStartedPayload
			if err := json.Unmarshal(env.Payload, &p); err != nil {
				return err
			}
			var step WorkStep
			err := tx.Where("project_id = ? AND run_id = ? AND work_step_id = ?", env.ProjectID, env.RunID, p.WorkStepID).Take(&step).Error
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if correctionWrite {
				if err == gorm.ErrRecordNotFound || step.AgentID != env.AgentID {
					return domainError("work_step_not_started", fieldBase+"/workStepId", "a correction requires an existing step owned by its reporter")
				}
				if env.Type == TypeWorkStepStarted {
					var originalIDs []string
					if err := tx.Model(&WorkStepComponent{}).Where("project_id = ? AND run_id = ? AND work_step_id = ?", env.ProjectID, env.RunID, p.WorkStepID).Pluck("component_id", &originalIDs).Error; err != nil {
						return err
					}
					a, _ := json.Marshal(normaliseIDs(originalIDs))
					b, _ := json.Marshal(normaliseIDs(p.ComponentIDs))
					if string(a) != string(b) {
						return domainError("reference_invalid", fieldBase+"/componentIds", "a step correction must retain its originally reported component IDs")
					}
				}
				// Metadata corrections remain valid after completion/closure and
				// after a referenced model element has been removed.
				return nil
			}
			if env.Type == TypeWorkStepStarted {
				if err == nil {
					return domainError("work_step_already_started", fieldBase+"/workStepId", "step %q already exists in this run", p.WorkStepID)
				}
				// Legacy reports can name planned components. Typed commands
				// require materialized IDs; neither path reserves identities.
				if original.Type == TypeWorkReported {
					ids.ComponentIDs = p.ComponentIDs
				}
			} else if err == gorm.ErrRecordNotFound || step.AgentID != env.AgentID || step.CompletedAt != nil {
				return domainError("work_step_not_started", fieldBase+"/workStepId", "step %q must be started, unfinished and owned by reporting agent", p.WorkStepID)
			}
		}
	}
	for _, kind := range []string{"component", "relationship"} {
		targets := ids.ComponentIDs
		table, column := "components", "component_id"
		if kind == "relationship" {
			targets = ids.RelationshipIDs
			table, column = "relationships", "relationship_id"
		}
		for i, id := range targets {
			var count int64
			if err := tx.Table(table).Where("project_id = ? AND "+column+" = ?", env.ProjectID, id).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				path := "/payload/scope/" + kind + "Ids"
				if original.Type == TypeWorkReported {
					path = "/payload/report/componentIds"
				} else if original.Type == TypeWorkStepStarted {
					path = "/payload/componentIds"
				}
				return domainError("reference_invalid", fmt.Sprintf("%s/%d", path, i), "%s %q does not exist", kind, id)
			}
		}
	}
	return nil
}

func applyWorkScope(tx *gorm.DB, ev *Event, payload []byte) error {
	var p struct {
		Scope json.RawMessage `json:"scope"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "project_id"}, {Name: "run_id"}, {Name: "agent_id"}}, DoUpdates: clause.AssignmentColumns([]string{"scope", "position"})}).Create(&AgentWorkScope{ProjectID: ev.ProjectID, RunID: ev.RunID, AgentID: ev.AgentID, Scope: JSON(p.Scope), Position: ev.Position}).Error
}

func workAffected(tx *gorm.DB, env Envelope) (AffectedIDs, error) {
	result := affectedIDs(env.Type, env.Payload)
	if env.Type == TypeWorkScopeReported {
		var p struct {
			Scope AffectedIDs `json:"scope"`
		}
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			return result, err
		}
		result = p.Scope
	}
	if env.Type == TypeWorkReported {
		effective, err := EffectiveWork(env)
		if err != nil {
			return result, err
		}
		var p workStepStartedPayload
		if err := json.Unmarshal(effective.Payload, &p); err != nil {
			return result, err
		}
		if effective.Type == TypeWorkStepStarted {
			result.ComponentIDs = p.ComponentIDs
		}
		if effective.Type == TypeWorkStepCompleted {
			if err := tx.Model(&WorkStepComponent{}).Where("project_id = ? AND run_id = ? AND work_step_id = ?", env.ProjectID, env.RunID, p.WorkStepID).Pluck("component_id", &result.ComponentIDs).Error; err != nil {
				return result, err
			}
		}
	}
	result.ComponentIDs = normaliseIDs(result.ComponentIDs)
	result.RelationshipIDs = normaliseIDs(result.RelationshipIDs)
	return result, nil
}
