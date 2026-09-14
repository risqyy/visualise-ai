package store

import (
	"encoding/json"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// migrateModelTracking is repeatable and serialized against normal appends by
// the same project row lock. It does not replay or rewrite historical projections.
func migrateModelTracking(db *gorm.DB) error {
	var projects []Project
	if err := db.Where("model_activated_at_position IS NULL").Find(&projects).Error; err != nil {
		return err
	}
	for _, project := range projects {
		if err := db.Transaction(func(tx *gorm.DB) error {
			var p Project
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("project_id = ?", project.ProjectID).Take(&p).Error; err != nil {
				return err
			}
			return activateModelTracking(tx, p)
		}); err != nil {
			return err
		}
	}
	return nil
}

// activateModelTracking requires the project row lock and also runs on the
// append path: startup migration can never reset an already accepted revision.
func activateModelTracking(tx *gorm.DB, p Project) error {
	if p.ModelActivatedAtPosition != nil {
		return nil
	}
	live := map[string]bool{}
	identities := map[string]*ModelIdentity{}
	materialize := func(kind, id string, position int64) {
		if id == "" {
			return
		}
		key := kind + ":" + id
		if old := identities[key]; old != nil {
			if !live[key] {
				old.HistoricalReuse = true
			}
		} else {
			identities[key] = &ModelIdentity{ProjectID: p.ProjectID, Kind: kind, ID: id, FirstPosition: position}
		}
		live[key] = true
	}
	var events []Event
	if err := tx.Where("project_id = ?", p.ProjectID).Order("position ASC").Find(&events).Error; err != nil {
		return err
	}
	for _, ev := range events {
		kind, payload := modelEffect(ev.Type, ev.Payload)
		switch kind {
		case TypeArchitectureSnapshotPublished:
			var snapshot architectureSnapshotPayload
			if err := json.Unmarshal(payload, &snapshot); err != nil {
				return err
			}
			next := map[string]bool{}
			for _, c := range snapshot.Components {
				materialize("component", c.ComponentID, ev.Position)
				next["component:"+c.ComponentID] = true
			}
			for _, r := range snapshot.Relationships {
				materialize("relationship", r.RelationshipID, ev.Position)
				next["relationship:"+r.RelationshipID] = true
			}
			live = next
		case TypeComponentChangeApplied:
			c, change, err := decodeComponentChange(payload)
			if err != nil {
				return err
			}
			if change.Operation == OperationRemove {
				delete(live, "component:"+c.ComponentID)
			} else {
				materialize("component", c.ComponentID, ev.Position)
			}
		case TypeRelationshipChangeApplied:
			r, change, err := decodeRelationshipChange(payload)
			if err != nil {
				return err
			}
			if change.Operation == OperationRemove {
				delete(live, "relationship:"+r.RelationshipID)
			} else {
				materialize("relationship", r.RelationshipID, ev.Position)
			}
		case TypeModelMutationApplied:
			var mutation ModelMutationPayload
			if err := json.Unmarshal(payload, &mutation); err != nil {
				return err
			}
			for _, op := range mutation.Operations {
				k, id := op.target()
				switch op.Op {
				case "component.remove", "relationship.remove":
					delete(live, k+":"+id)
				case "component.add", "relationship.add":
					materialize(k, id, ev.Position)
				}
			}
		}
	}
	current, err := loadGraph(tx, p.ProjectID)
	if err != nil {
		return err
	}
	// Current projections are materialization evidence even when historical data
	// was imported without a complete log. Do not invent a second historical use.
	for id := range current.components {
		key := "component:" + id
		if identities[key] == nil {
			identities[key] = &ModelIdentity{ProjectID: p.ProjectID, Kind: "component", ID: id, FirstPosition: p.LastPosition}
		}
	}
	for id := range current.relationships {
		key := "relationship:" + id
		if identities[key] == nil {
			identities[key] = &ModelIdentity{ProjectID: p.ProjectID, Kind: "relationship", ID: id, FirstPosition: p.LastPosition}
		}
	}
	for _, id := range identities {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(id).Error; err != nil {
			return err
		}
	}
	return tx.Model(&Project{}).Where("project_id = ?", p.ProjectID).Updates(map[string]any{"model_revision": 0, "model_activated_at_position": p.LastPosition}).Error
}
