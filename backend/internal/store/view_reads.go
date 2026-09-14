package store

import (
	"context"
	"database/sql"

	"gorm.io/gorm"
)

type ViewSummary struct {
	ViewID       string `json:"viewId"`
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	ViewRevision int64  `json:"viewRevision"`
}
type ViewsSnapshot struct {
	ProjectID       string        `json:"projectId"`
	ModelRevision   int64         `json:"modelRevision"`
	ProjectPosition int64         `json:"projectPosition"`
	Items           []ViewSummary `json:"items"`
}
type ViewResponse struct {
	ProjectID               string      `json:"projectId"`
	ModelRevision           int64       `json:"modelRevision"`
	ProjectPosition         int64       `json:"projectPosition"`
	View                    SavedView   `json:"view"`
	ViewRevision            int64       `json:"viewRevision"`
	MissingReferences       AffectedIDs `json:"missingReferences"`
	BoundaryRelationshipIDs []string    `json:"boundaryRelationshipIds"`
}

func (s *Store) ListViews(ctx context.Context, projectID string) (ViewsSnapshot, error) {
	result := ViewsSnapshot{ProjectID: projectID, Items: []ViewSummary{}}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var project Project
		if err := tx.Where("project_id = ?", projectID).Take(&project).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return domainError("project_not_found", "/projectId", "project does not exist")
			}
			return err
		}
		result.ModelRevision, result.ProjectPosition = project.ModelRevision, project.LastPosition
		return tx.Model(&ArchitectureView{}).Select("view_id, definition->>'name' AS name, definition->>'kind' AS kind, revision AS view_revision").Where("project_id = ? AND NOT removed", projectID).Order("view_id").Scan(&result.Items).Error
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

func (s *Store) ReadView(ctx context.Context, projectID, viewID string) (ViewResponse, error) {
	var result ViewResponse
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		model, err := readModelSnapshot(tx, projectID)
		if err != nil {
			return err
		}
		row, view, err := readSavedView(tx, projectID, viewID)
		if err != nil {
			return err
		}
		resolved := ResolveArchitectureView(model, view)
		result = ViewResponse{ProjectID: projectID, ModelRevision: model.ModelRevision, ProjectPosition: model.ProjectPosition, View: view, ViewRevision: row.Revision, MissingReferences: resolved.MissingReferences, BoundaryRelationshipIDs: resolved.BoundaryRelationshipIDs}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
