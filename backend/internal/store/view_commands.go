package store

import (
	"encoding/json"
	"errors"
	"fmt"

	"gorm.io/gorm"
)

const (
	TypeViewSaved   = "view.saved"
	TypeViewRemoved = "view.removed"
)

type viewCommand struct {
	ExpectedModelRevision int64
	ExpectedViewRevision  int64
	View                  SavedView
	ViewID                string
}

// Revision values use exactly the same JSON Schema integer parser as model
// mutations, including 1.0 and 1e0; raw tokens still remain in command identity.
func viewRevision(raw json.RawMessage, field string) (int64, error) {
	var parsed ModelMutationPayload
	wrapped := append([]byte(`{"expectedModelRevision":`), raw...)
	wrapped = append(wrapped, '}')
	err := json.Unmarshal(wrapped, &parsed)
	var domain *DomainError
	if errors.As(err, &domain) {
		domain.Field = "/payload/" + field
	}
	return parsed.ExpectedModelRevision, err
}
func decodeViewCommand(kind string, raw []byte) (viewCommand, error) {
	var wire struct {
		ExpectedModelRevision json.RawMessage `json:"expectedModelRevision"`
		ExpectedViewRevision  json.RawMessage `json:"expectedViewRevision"`
		View                  SavedView       `json:"view"`
		ViewID                string          `json:"viewId"`
	}
	var command viewCommand
	if err := json.Unmarshal(raw, &wire); err != nil {
		return command, err
	}
	var err error
	command.ExpectedViewRevision, err = viewRevision(wire.ExpectedViewRevision, "expectedViewRevision")
	if err != nil {
		return command, err
	}
	command.View, command.ViewID = wire.View, wire.ViewID
	if kind == TypeViewSaved {
		command.ViewID = wire.View.ViewID
		command.ExpectedModelRevision, err = viewRevision(wire.ExpectedModelRevision, "expectedModelRevision")
	}
	return command, err
}

// prepareViewWrite runs under the same project row lock as every model/event
// append, after exact retry lookup and lifecycle validation.
func prepareViewWrite(tx *gorm.DB, env Envelope, project Project) (*int64, error) {
	if env.Type != TypeViewSaved && env.Type != TypeViewRemoved {
		return nil, nil
	}
	command, err := decodeViewCommand(env.Type, env.Payload)
	if err != nil {
		return nil, err
	}
	var existing ArchitectureView
	err = tx.Where("project_id = ? AND view_id = ?", env.ProjectID, command.ViewID).Take(&existing).Error
	found := err == nil
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}
	current := existing.Revision
	if env.Type == TypeViewRemoved && (!found || existing.Removed) {
		return nil, domainError("view_not_found", "/payload/viewId", "view %q does not exist", command.ViewID)
	}
	if env.Type == TypeViewSaved && existing.Removed {
		return nil, domainError("element_exists", "/payload/view/viewId", "view ID %q is retired and cannot be reused", command.ViewID)
	}
	if command.ExpectedViewRevision != current || (env.Type == TypeViewSaved && command.ExpectedModelRevision != project.ModelRevision) {
		field := "/payload/expectedViewRevision"
		if env.Type == TypeViewSaved && command.ExpectedModelRevision != project.ModelRevision {
			field = "/payload/expectedModelRevision"
		}
		return nil, &DomainError{Code: "revision_conflict", Detail: "model or view revision changed; read and reconcile", Field: field, CurrentModelRevision: &project.ModelRevision, CurrentViewRevision: &current}
	}
	if env.Type == TypeViewSaved {
		if err := validateViewReferences(tx, env.ProjectID, command.View); err != nil {
			return nil, err
		}
	}
	revision := current + 1
	return &revision, nil
}

func validateViewReferences(tx *gorm.DB, projectID string, view SavedView) error {
	if view.Kind != "architecture" {
		return domainError("invalid_input", "/payload/view/kind", "only architecture views are implemented")
	}
	if view.Selection.Mode != "all" && view.Selection.Mode != "explicit" {
		return domainError("invalid_input", "/payload/view/selection/mode", "unknown selection mode")
	}
	if view.Selection.Mode == "explicit" && view.Selection.Scope == nil {
		return domainError("invalid_input", "/payload/view/selection/scope", "explicit selection requires a scope")
	}
	graph, err := loadGraph(tx, projectID)
	if err != nil {
		return err
	}
	model := ModelSnapshot{}
	for _, c := range graph.components {
		model.Components = append(model.Components, c)
	}
	for _, r := range graph.relationships {
		model.Relationships = append(model.Relationships, r)
	}
	resolved := ResolveArchitectureView(model, view)
	if len(resolved.MissingReferences.ComponentIDs) > 0 || len(resolved.MissingReferences.RelationshipIDs) > 0 || len(resolved.BoundaryRelationshipIDs) > 0 {
		return domainError("reference_invalid", "/payload/view/selection", "view references must exist and selected relationships must have explicitly selected endpoints")
	}
	included := map[string]bool{}
	for _, id := range resolved.ComponentIDs {
		included[id] = true
	}
	for i, id := range view.CollapsedComponentIDs {
		if !included[id] {
			return domainError("reference_invalid", fmt.Sprintf("/payload/view/collapsedComponentIds/%d", i), "collapsed component %q is outside the view", id)
		}
	}
	return nil
}

func applyViewCommand(tx *gorm.DB, ev *Event) error {
	command, err := decodeViewCommand(ev.Type, ev.Payload)
	if err != nil {
		return err
	}
	if ev.Type == TypeViewRemoved {
		return tx.Model(&ArchitectureView{}).Where("project_id = ? AND view_id = ?", ev.ProjectID, command.ViewID).Updates(map[string]any{"removed": true, "revision": command.ExpectedViewRevision + 1, "position": ev.Position}).Error
	}
	raw, err := json.Marshal(command.View)
	if err != nil {
		return err
	}
	row := ArchitectureView{ProjectID: ev.ProjectID, ViewID: command.ViewID, Definition: JSON(raw), Revision: command.ExpectedViewRevision + 1, Position: ev.Position}
	if command.ExpectedViewRevision == 0 {
		return tx.Create(&row).Error
	}
	return tx.Model(&ArchitectureView{}).Where("project_id = ? AND view_id = ?", ev.ProjectID, command.ViewID).Updates(map[string]any{"definition": row.Definition, "revision": row.Revision, "position": row.Position}).Error
}
