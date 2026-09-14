package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"

	"gorm.io/gorm"
)

// SavedView is the closed architecture definition from contract 2.0.0. It
// contains references only; descriptors and browser interaction state live elsewhere.
type SavedView struct {
	ViewID                string        `json:"viewId"`
	Name                  string        `json:"name"`
	Kind                  string        `json:"kind"`
	Selection             ViewSelection `json:"selection"`
	Orientation           string        `json:"orientation"`
	CollapsedComponentIDs []string      `json:"collapsedComponentIds"`
}
type ViewSelection struct {
	Mode  string       `json:"mode"`
	Scope *AffectedIDs `json:"scope,omitempty"`
}

// ArchitectureView keeps a removed ID and its last revision forever. Removing a
// view never touches the shared graph or its historical references.
type ArchitectureView struct {
	ProjectID  string `gorm:"primaryKey;type:text"`
	ViewID     string `gorm:"primaryKey;type:text"`
	Definition JSON   `gorm:"type:jsonb;not null"`
	Revision   int64  `gorm:"not null"`
	Position   int64  `gorm:"not null"`
	Removed    bool   `gorm:"not null;default:false"`
}

func (ArchitectureView) TableName() string { return "architecture_views" }

type ViewSnapshotRequest struct {
	ProjectID             string
	ViewID                string
	ExpectedModelRevision int64
	ExpectedViewRevision  int64
}

// ViewSnapshot is detached from the database after capture. A render must use
// this model and view together, even when later writes advance either head.
type ViewSnapshot struct {
	Model        ModelSnapshot `json:"model"`
	View         SavedView     `json:"view"`
	ViewRevision int64         `json:"viewRevision"`
}

func (s *Store) CaptureViewSnapshot(ctx context.Context, request ViewSnapshotRequest) (ViewSnapshot, error) {
	var result ViewSnapshot
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		model, err := readModelSnapshot(tx, request.ProjectID)
		if err != nil {
			return err
		}
		row, view, err := readSavedView(tx, request.ProjectID, request.ViewID)
		if err != nil {
			return err
		}
		if model.ModelRevision != request.ExpectedModelRevision || row.Revision != request.ExpectedViewRevision {
			return &DomainError{Code: "revision_conflict", Detail: "model or view revision changed", CurrentModelRevision: &model.ModelRevision, CurrentViewRevision: &row.Revision}
		}
		result = ViewSnapshot{Model: model, View: view, ViewRevision: row.Revision}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

func readSavedView(tx *gorm.DB, projectID, viewID string) (ArchitectureView, SavedView, error) {
	var row ArchitectureView
	var view SavedView
	err := tx.Where("project_id = ? AND view_id = ? AND NOT removed", projectID, viewID).Take(&row).Error
	if err == gorm.ErrRecordNotFound {
		err = domainError("view_not_found", "/viewId", "view %q does not exist", viewID)
	}
	if err != nil {
		return row, view, err
	}
	err = json.Unmarshal(row.Definition, &view)
	return row, view, err
}

type ViewResolution struct {
	ComponentIDs            []string    `json:"componentIds"`
	RelationshipIDs         []string    `json:"relationshipIds"`
	StructuralContextIDs    []string    `json:"structuralContextIds"`
	CollapsedComponentIDs   []string    `json:"collapsedComponentIds"`
	MissingReferences       AffectedIDs `json:"missingReferences"`
	BoundaryRelationshipIDs []string    `json:"boundaryRelationshipIds"`
}

// ResolveArchitectureView mirrors the pure native frontend resolver. Ancestors
// provide containment only: they never expand the explicitly selected edge boundary.
func ResolveArchitectureView(model ModelSnapshot, view SavedView) ViewResolution {
	result := ViewResolution{ComponentIDs: []string{}, RelationshipIDs: []string{}, StructuralContextIDs: []string{}, CollapsedComponentIDs: []string{}, MissingReferences: AffectedIDs{ComponentIDs: []string{}, RelationshipIDs: []string{}}, BoundaryRelationshipIDs: []string{}}
	components := map[string]componentDescriptor{}
	relationships := map[string]relationshipDescriptor{}
	for _, c := range model.Components {
		components[c.ComponentID] = c
	}
	for _, r := range model.Relationships {
		relationships[r.RelationshipID] = r
	}
	selected := map[string]bool{}
	included := map[string]bool{}
	missing := map[string]bool{}
	edgeIDs := []string{}
	if view.Selection.Mode == "all" {
		for id := range components {
			selected[id] = true
		}
		for id := range relationships {
			edgeIDs = append(edgeIDs, id)
		}
	} else if view.Selection.Scope != nil {
		for _, id := range view.Selection.Scope.ComponentIDs {
			if _, ok := components[id]; ok {
				selected[id] = true
			} else {
				missing[id] = true
			}
		}
		edgeIDs = view.Selection.Scope.RelationshipIDs
	}
	for id := range selected {
		included[id] = true
	}
	for id := range selected {
		seen := map[string]bool{id: true}
		c := components[id]
		for c.ParentComponentID != nil {
			parent := *c.ParentComponentID
			if seen[parent] {
				break
			}
			seen[parent] = true
			next, ok := components[parent]
			if !ok {
				break
			}
			included[parent] = true
			c = next
		}
	}
	for id := range included {
		result.ComponentIDs = append(result.ComponentIDs, id)
		if !selected[id] {
			result.StructuralContextIDs = append(result.StructuralContextIDs, id)
		}
	}
	for _, id := range edgeIDs {
		r, ok := relationships[id]
		if !ok {
			result.MissingReferences.RelationshipIDs = append(result.MissingReferences.RelationshipIDs, id)
			continue
		}
		if !selected[r.SourceComponentID] || !selected[r.TargetComponentID] {
			result.BoundaryRelationshipIDs = append(result.BoundaryRelationshipIDs, id)
			continue
		}
		result.RelationshipIDs = append(result.RelationshipIDs, id)
	}
	for _, id := range view.CollapsedComponentIDs {
		if _, ok := components[id]; !ok {
			missing[id] = true
		} else if included[id] {
			result.CollapsedComponentIDs = append(result.CollapsedComponentIDs, id)
		}
	}
	for id := range missing {
		result.MissingReferences.ComponentIDs = append(result.MissingReferences.ComponentIDs, id)
	}
	for _, ids := range [][]string{result.ComponentIDs, result.RelationshipIDs, result.StructuralContextIDs, result.CollapsedComponentIDs, result.MissingReferences.ComponentIDs, result.MissingReferences.RelationshipIDs, result.BoundaryRelationshipIDs} {
		sort.Strings(ids)
	}
	return result
}
