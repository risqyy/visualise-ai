package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"strings"
	"testing"
)

func TestWorkStepMigrationReconstructsRunOwnershipAndPreservesAmbiguity(t *testing.T) {
	s := newScenario(t)
	rollback := errors.New("test rollback")
	schema := "work_migration_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			return err
		}
		if err := tx.Exec("SET LOCAL search_path TO " + schema).Error; err != nil {
			return err
		}
		if err := tx.AutoMigrate(&Event{}, &WorkStep{}); err != nil {
			return err
		}
		if err := tx.Exec(`CREATE TABLE work_step_components (project_id text,work_step_id text,component_id text,last_applied_project_position bigint NOT NULL, PRIMARY KEY(project_id,work_step_id,component_id))`).Error; err != nil {
			return err
		}
		for i, run := range []string{"run-one", "run-two"} {
			component := []string{"node-aa", "node-bb"}[i]
			payload := fmt.Sprintf(`{"workStepId":"shared-step","title":"Start","componentIds":[%q]}`, component)
			event := Event{ID: uuid.NewString(), ProjectID: "project-one", Position: int64(i + 1), RunID: run, AgentID: "root-agent", ClientEventID: uuid.NewString(), Type: TypeWorkStepStarted, SchemaVersion: "1.0", OccurredAt: baseTime, ReceivedAt: baseTime, Payload: JSON(payload), PayloadHash: "test"}
			if err := tx.Create(&event).Error; err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO work_step_components VALUES ('project-one','shared-step',?,?)`, component, i+1).Error; err != nil {
				return err
			}
		}
		correction := Event{ID: uuid.NewString(), ProjectID: "project-one", Position: 3, RunID: "run-two", AgentID: "root-agent", ClientEventID: uuid.NewString(), Type: TypeCorrectionIssued, SchemaVersion: "1.0", OccurredAt: baseTime, ReceivedAt: baseTime, Payload: JSON(`{"correctedType":"work.step_started","correctedPayload":{"workStepId":"shared-step","title":"Fixed","componentIds":["node-bb"]}}`), PayloadHash: "test"}
		if err := tx.Create(&correction).Error; err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO work_step_components VALUES ('project-one','shared-step','ambiguous-node',4)`).Error; err != nil {
			return err
		}
		if err := migrateWorkStepRuns(tx); err != nil {
			return err
		}
		if err := migrateWorkStepRuns(tx); err != nil {
			return err
		}
		var rows []WorkStepComponent
		if err := tx.Order("run_id,component_id").Find(&rows).Error; err != nil {
			return err
		}
		raw, _ := json.Marshal(rows)
		if len(rows) != 3 || rows[0].RunID != "" || rows[0].ComponentID != "ambiguous-node" || rows[1].RunID != "run-one" || rows[1].ComponentID != "node-aa" || rows[2].RunID != "run-two" || rows[2].ComponentID != "node-bb" || rows[2].LastAppliedProjectPosition != 3 {
			return fmt.Errorf("incorrect reconstructed links %s", raw)
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
}
