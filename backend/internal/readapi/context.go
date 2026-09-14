package readapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/risqyy/visualise-ai/backend/internal/store"
	"gorm.io/gorm"
)

// ContextSnapshot is shared by REST hydration and MCP reads. All provenance,
// scopes, missing-reference diagnostics and counters come from one snapshot.
type ContextSnapshot struct {
	Project store.Project
	Run     store.Run
	Agents  []Agent
}

func (s *Service) Context(ctx context.Context, projectID, runID string) (ContextSnapshot, error) {
	return s.context(ctx, projectID, runID, false)
}

func (s *Service) context(ctx context.Context, projectID, runID string, currentAlias bool) (ContextSnapshot, error) {
	var result ContextSnapshot
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		service := New(tx)
		var err error
		result.Project, err = service.project(ctx, projectID)
		if err != nil {
			return err
		}
		if currentAlias && runID == "current" {
			if result.Project.CurrentRunID == "" {
				return ErrCurrentRunNotFound
			}
			runID = result.Project.CurrentRunID
		}
		err = tx.Where("project_id = ? AND run_id = ?", projectID, runID).Take(&result.Run).Error
		if err == gorm.ErrRecordNotFound {
			return ErrRunNotFound
		}
		if err != nil {
			return err
		}
		var rows []store.Agent
		if err := tx.Where("project_id = ? AND run_id = ?", projectID, result.Run.RunID).Order("started_at ASC, agent_id ASC").Find(&rows).Error; err != nil {
			return err
		}
		var scopes []store.AgentWorkScope
		if err := tx.Where("project_id = ? AND run_id = ?", projectID, result.Run.RunID).Find(&scopes).Error; err != nil {
			return err
		}
		byAgent := map[string]store.AgentWorkScope{}
		componentIDs, relationshipIDs := []string{}, []string{}
		for _, scope := range scopes {
			byAgent[scope.AgentID] = scope
			var ids store.AffectedIDs
			if err := json.Unmarshal(scope.Scope, &ids); err != nil {
				return err
			}
			componentIDs = append(componentIDs, ids.ComponentIDs...)
			relationshipIDs = append(relationshipIDs, ids.RelationshipIDs...)
		}
		existingComponents, err := scopeReferences(tx, projectID, "components", "component_id", componentIDs)
		if err != nil {
			return err
		}
		existingRelationships, err := scopeReferences(tx, projectID, "relationships", "relationship_id", relationshipIDs)
		if err != nil {
			return err
		}
		components, relationships := map[string]bool{}, map[string]bool{}
		for _, id := range existingComponents {
			components[id] = true
		}
		for _, id := range existingRelationships {
			relationships[id] = true
		}
		result.Agents = make([]Agent, 0, len(rows))
		for _, row := range rows {
			agent := agentOf(row)
			agent.MissingScopeReferences = &store.AffectedIDs{ComponentIDs: []string{}, RelationshipIDs: []string{}}
			if scope, ok := byAgent[row.AgentID]; ok {
				var ids store.AffectedIDs
				if err := json.Unmarshal(scope.Scope, &ids); err != nil {
					return err
				}
				agent.WorkScope = &ids
				position := scope.Position
				agent.WorkScopePosition = &position
				for _, id := range ids.ComponentIDs {
					if !components[id] {
						agent.MissingScopeReferences.ComponentIDs = append(agent.MissingScopeReferences.ComponentIDs, id)
					}
				}
				for _, id := range ids.RelationshipIDs {
					if !relationships[id] {
						agent.MissingScopeReferences.RelationshipIDs = append(agent.MissingScopeReferences.RelationshipIDs, id)
					}
				}
			}
			result.Agents = append(result.Agents, agent)
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

// Deduplicate overlapping scopes and cap SQL bind counts even when all IDs are
// distinct. All batches still execute in the caller's repeatable-read snapshot.
func scopeReferences(tx *gorm.DB, projectID, table, column string, ids []string) ([]string, error) {
	seen := map[string]bool{}
	unique := make([]string, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	result := []string{}
	for start := 0; start < len(unique); start += 1000 {
		end := min(start+1000, len(unique))
		var batch []string
		if err := tx.Table(table).Where("project_id = ? AND "+column+" IN ?", projectID, unique[start:end]).Pluck(column, &batch).Error; err != nil {
			return nil, err
		}
		result = append(result, batch...)
	}
	return result, nil
}
