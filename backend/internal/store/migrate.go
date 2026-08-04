package store

import (
	"fmt"

	"gorm.io/gorm"
)

// Models lists every table the store owns.
//
// The order is the order AutoMigrate creates them in; the schema declares no
// foreign keys, so read models can be rebuilt or truncated independently of the
// log without fighting reference constraints.
func Models() []any {
	return []any{
		&Project{},
		&Run{},
		&Agent{},
		&Event{},
		&EventCorrection{},
		&EventComponent{},
		&Plan{},
		&PlanRevision{},
		&PlanStep{},
		&WorkStep{},
		&WorkStepComponent{},
		&Component{},
		&Relationship{},
		&ActiveChange{},
		&FeedbackEntry{},
		&FeedbackComponent{},
		&Diff{},
		&DiffComponent{},
		&Risk{},
		&RiskComponent{},
		&Problem{},
		&ProblemComponent{},
	}
}

// Migrate brings the schema in line with the models, including the composite
// primary keys, the two unique constraints of the event log and every index.
//
// v0 deliberately has no SQL migration engine and no rebuild command: GORM
// AutoMigrate on startup is the single schema authority. A failure here must
// keep the backend from reporting readiness.
func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(Models()...); err != nil {
		return fmt.Errorf("store: automigrate: %w", err)
	}
	return nil
}
