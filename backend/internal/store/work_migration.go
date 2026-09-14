package store

import (
	"encoding/json"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Old links lack run ownership. Reconstruct associations from accepted start
// events and effective corrections. Unattributable legacy links remain under
// an empty run ID; never assign a union of old links to unrelated runs.
func migrateWorkStepRuns(db *gorm.DB) error {
	if !db.Migrator().HasTable(&WorkStepComponent{}) || db.Migrator().HasColumn(&WorkStepComponent{}, "run_id") {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, statement := range []string{
			"ALTER TABLE work_step_components ADD COLUMN run_id text NOT NULL DEFAULT ''",
			"ALTER TABLE work_step_components DROP CONSTRAINT work_step_components_pkey",
			"ALTER TABLE work_step_components ADD PRIMARY KEY (project_id,run_id,work_step_id,component_id)",
		} {
			if err := tx.Exec(statement).Error; err != nil {
				return err
			}
		}
		var events []Event
		if err := tx.Where("type IN ?", []string{TypeWorkStepStarted, TypeCorrectionIssued}).Order("project_id,position").Find(&events).Error; err != nil {
			return err
		}
		for _, event := range events {
			payload := []byte(event.Payload)
			if event.Type == TypeCorrectionIssued {
				var p correctionIssuedPayload
				if err := json.Unmarshal(payload, &p); err != nil {
					return err
				}
				if p.CorrectedType != TypeWorkStepStarted {
					continue
				}
				payload = p.CorrectedPayload
			}
			var p workStepStartedPayload
			if err := json.Unmarshal(payload, &p); err != nil {
				return err
			}
			for _, id := range normaliseIDs(p.ComponentIDs) {
				link := WorkStepComponent{ProjectID: event.ProjectID, RunID: event.RunID, WorkStepID: p.WorkStepID, ComponentID: id, LastAppliedProjectPosition: event.Position}
				if err := tx.Clauses(clause.OnConflict{Columns: workStepComponentKey, DoUpdates: clause.AssignmentColumns([]string{"last_applied_project_position"})}).Create(&link).Error; err != nil {
					return err
				}
				if err := tx.Where("project_id = ? AND run_id = '' AND work_step_id = ? AND component_id = ?", event.ProjectID, p.WorkStepID, id).Delete(&WorkStepComponent{}).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}
