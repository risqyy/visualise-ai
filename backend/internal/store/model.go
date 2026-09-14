package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ModelMutationPayload and ModelOperation mirror generated schema fixtures; the
// ingestion contract is the structural authority and validates them before use.
type ModelMutationPayload struct {
	ExpectedModelRevision int64            `json:"expectedModelRevision"`
	Operations            []ModelOperation `json:"operations"`
}
type ModelOperation struct {
	Op             string                     `json:"op"`
	ComponentID    string                     `json:"componentId,omitempty"`
	RelationshipID string                     `json:"relationshipId,omitempty"`
	Component      json.RawMessage            `json:"component,omitempty"`
	Relationship   json.RawMessage            `json:"relationship,omitempty"`
	Set            map[string]json.RawMessage `json:"set,omitempty"`
}

func (op ModelOperation) target() (string, string) {
	kind, _, _ := strings.Cut(op.Op, ".")
	id := op.ComponentID
	raw := op.Component
	if kind == "relationship" {
		id = op.RelationshipID
		raw = op.Relationship
	}
	if len(raw) > 0 {
		var doc map[string]json.RawMessage
		_ = json.Unmarshal(raw, &doc)
		_ = json.Unmarshal(doc[kind+"Id"], &id)
	}
	return kind, id
}

type modelGraph struct {
	components    map[string]componentDescriptor
	relationships map[string]relationshipDescriptor
}

func loadGraph(tx *gorm.DB, project string) (modelGraph, error) {
	g := modelGraph{components: map[string]componentDescriptor{}, relationships: map[string]relationshipDescriptor{}}
	var cs []Component
	var rs []Relationship
	if err := tx.Where("project_id = ?", project).Find(&cs).Error; err != nil {
		return g, err
	}
	if err := tx.Where("project_id = ?", project).Find(&rs).Error; err != nil {
		return g, err
	}
	for _, c := range cs {
		g.components[c.ComponentID] = componentDescriptor{c.ComponentID, c.Name, c.Kind, c.ParentComponentID, c.Description, json.RawMessage(c.Technology), json.RawMessage(c.Tags)}
	}
	for _, r := range rs {
		g.relationships[r.RelationshipID] = relationshipDescriptor{r.RelationshipID, r.SourceComponentID, r.TargetComponentID, r.Kind, r.Label, r.Protocol, r.Operation, r.Channel}
	}
	return g, nil
}
func (g modelGraph) has(kind, id string) bool {
	if kind == "component" {
		_, ok := g.components[id]
		return ok
	}
	_, ok := g.relationships[id]
	return ok
}
func modelEffect(kind string, payload []byte) (string, []byte) {
	if kind == TypeCorrectionIssued {
		var p correctionIssuedPayload
		if json.Unmarshal(payload, &p) != nil {
			return "", nil
		}
		kind = p.CorrectedType
		payload = p.CorrectedPayload
	}
	switch kind {
	case TypeModelMutationApplied, TypeArchitectureSnapshotPublished, TypeComponentChangeApplied, TypeRelationshipChangeApplied:
		return kind, payload
	}
	return "", nil
}
func prepareModelWrite(tx *gorm.DB, env Envelope, project Project) (modelGraph, bool, error) {
	kind, payload := modelEffect(env.Type, env.Payload)
	if kind == "" {
		return modelGraph{}, false, nil
	}
	g, err := loadGraph(tx, env.ProjectID)
	if err != nil {
		return g, true, err
	}
	if kind == TypeModelMutationApplied {
		var p ModelMutationPayload
		if err = json.Unmarshal(payload, &p); err != nil {
			return g, true, err
		}
		if p.ExpectedModelRevision != project.ModelRevision {
			return g, true, &DomainError{Code: "revision_conflict", Detail: "expectedModelRevision does not match the current model", Field: "/payload/expectedModelRevision", CurrentModelRevision: &project.ModelRevision}
		}
		if len(p.Operations) < 1 || len(p.Operations) > 100 {
			return g, true, domainError("invalid_input", "/payload/operations", "expected 1–100 operations")
		}
		seen := map[string]bool{}
		for i, op := range p.Operations {
			k, id := op.target()
			pointer := fmt.Sprintf("/payload/operations/%d", i)
			if seen[k+":"+id] {
				return g, true, domainError("invalid_input", pointer, "target %s %q occurs more than once", k, id)
			}
			seen[k+":"+id] = true
			if strings.HasSuffix(op.Op, ".add") {
				if g.has(k, id) {
					return g, true, domainError("element_exists", pointer, "%s %q exists", k, id)
				}
				var n int64
				if err = tx.Model(&ModelIdentity{}).Where("project_id = ? AND kind = ? AND id = ?", env.ProjectID, k, id).Count(&n).Error; err != nil {
					return g, true, err
				}
				if n > 0 {
					return g, true, domainError("element_exists", pointer, "%s %q is reserved", k, id)
				}
			} else if !g.has(k, id) {
				return g, true, domainError("element_not_found", pointer, "%s %q does not exist", k, id)
			}
		}
	}
	if kind == TypeArchitectureSnapshotPublished {
		var p architectureSnapshotPayload
		if err = json.Unmarshal(payload, &p); err != nil {
			return g, true, err
		}
		seen := map[string]bool{}
		for _, c := range p.Components {
			if seen["c:"+c.ComponentID] {
				return g, true, domainError("invalid_input", "/payload/components", "duplicate component %q", c.ComponentID)
			}
			seen["c:"+c.ComponentID] = true
		}
		for _, r := range p.Relationships {
			if seen["r:"+r.RelationshipID] {
				return g, true, domainError("invalid_input", "/payload/relationships", "duplicate relationship %q", r.RelationshipID)
			}
			seen["r:"+r.RelationshipID] = true
		}
	}
	return g, true, nil
}
func applyModelMutation(tx *gorm.DB, ev *Event, payload []byte) error {
	graph, err := loadGraph(tx, ev.ProjectID)
	if err != nil {
		return err
	}
	var p ModelMutationPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	// Every operation targets a different identity. Reference checking happens only
	// after all writes, so add/remove/reparent order does not change validity.
	for _, op := range p.Operations {
		kind, id := op.target()
		switch op.Op {
		case "component.remove":
			if err := tx.Where("project_id = ? AND component_id = ?", ev.ProjectID, id).Delete(&Component{}).Error; err != nil {
				return err
			}
		case "relationship.remove":
			if err := tx.Where("project_id = ? AND relationship_id = ?", ev.ProjectID, id).Delete(&Relationship{}).Error; err != nil {
				return err
			}
		case "component.add", "component.update", "relationship.add", "relationship.update":
			raw := op.Component
			if kind == "relationship" {
				raw = op.Relationship
			}
			if strings.HasSuffix(op.Op, ".update") {
				var value any = graph.components[id]
				if kind == "relationship" {
					value = graph.relationships[id]
				}
				raw, err = json.Marshal(value)
				if err != nil {
					return err
				}
				var fields map[string]json.RawMessage
				if err = json.Unmarshal(raw, &fields); err != nil {
					return err
				}
				for key, value := range op.Set {
					if string(value) == "null" && key != "parentComponentId" {
						delete(fields, key)
					} else {
						fields[key] = value
					}
				}
				raw, err = json.Marshal(fields)
				if err != nil {
					return err
				}
			}
			if kind == "component" {
				var c componentDescriptor
				if err := json.Unmarshal(raw, &c); err != nil {
					return err
				}
				if err := writeComponent(tx, ev, c); err != nil {
					return err
				}
			} else {
				var r relationshipDescriptor
				if err := json.Unmarshal(raw, &r); err != nil {
					return err
				}
				if err := writeRelationship(tx, ev, r); err != nil {
					return err
				}
			}
		default:
			return domainError("invalid_input", "/payload/operations", "unknown operation %q", op.Op)
		}
	}
	return nil
}
func finishModelWrite(tx *gorm.DB, ev *Event, before modelGraph) error {
	after, err := loadGraph(tx, ev.ProjectID)
	if err != nil {
		return err
	}
	diagnostics := graphDiagnostics(after)
	if len(diagnostics) > 0 {
		return domainError("reference_invalid", "/payload", "%s", diagnostics[0].Message)
	}
	for _, kind := range []string{"component", "relationship"} {
		ids := []string{}
		if kind == "component" {
			for id := range after.components {
				ids = append(ids, id)
			}
		} else {
			for id := range after.relationships {
				ids = append(ids, id)
			}
		}
		sort.Strings(ids)
		for _, id := range ids {
			var n int64
			if !before.has(kind, id) {
				if err = tx.Model(&ModelIdentity{}).Where("project_id = ? AND kind = ? AND id = ?", ev.ProjectID, kind, id).Count(&n).Error; err != nil {
					return err
				}
				if n > 0 {
					return domainError("element_exists", "/payload", "%s %q is retired and cannot be reused", kind, id)
				}
			}
			if err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ModelIdentity{ProjectID: ev.ProjectID, Kind: kind, ID: id, FirstPosition: ev.Position}).Error; err != nil {
				return err
			}
		}
	}
	if ev.Type == TypeModelMutationApplied {
		var p ModelMutationPayload
		if err := json.Unmarshal(ev.Payload, &p); err != nil {
			return err
		}
		ids := []string{}
		for _, op := range p.Operations {
			kind, id := op.target()
			if kind != "relationship" {
				continue
			}
			for _, graph := range []modelGraph{before, after} {
				if r, ok := graph.relationships[id]; ok {
					ids = append(ids, r.SourceComponentID, r.TargetComponentID)
				}
			}
		}
		for _, id := range normaliseIDs(ids) {
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&EventComponent{ProjectID: ev.ProjectID, Position: ev.Position, ComponentID: id}).Error; err != nil {
				return err
			}
		}
	}
	return tx.Model(&Project{}).Where("project_id = ?", ev.ProjectID).Update("model_revision", gorm.Expr("model_revision + 1")).Error
}

// ModelDiagnostic describes legacy graph defects without rewriting data.
type ModelDiagnostic struct {
	Code    string      `json:"code"`
	Target  ModelTarget `json:"target"`
	Message string      `json:"message"`
}
type ModelTarget struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

func graphDiagnostics(g modelGraph) []ModelDiagnostic {
	ds := []ModelDiagnostic{}
	for id, c := range g.components {
		if c.ParentComponentID != nil && !g.has("component", *c.ParentComponentID) {
			ds = append(ds, ModelDiagnostic{"missing_reference", ModelTarget{"component", id}, fmt.Sprintf("component %q references missing parent %q", id, *c.ParentComponentID)})
		}
		visited := map[string]bool{}
		current := id
		for {
			if visited[current] {
				ds = append(ds, ModelDiagnostic{"hierarchy_cycle", ModelTarget{"component", id}, fmt.Sprintf("component %q has a cyclic parent hierarchy", id)})
				break
			}
			visited[current] = true
			c, ok := g.components[current]
			if !ok || c.ParentComponentID == nil {
				break
			}
			current = *c.ParentComponentID
		}
	}
	for id, r := range g.relationships {
		if !g.has("component", r.SourceComponentID) || !g.has("component", r.TargetComponentID) {
			ds = append(ds, ModelDiagnostic{"missing_reference", ModelTarget{"relationship", id}, fmt.Sprintf("relationship %q has a missing endpoint", id)})
		}
	}
	sort.Slice(ds, func(i, j int) bool {
		a, b := ds[i], ds[j]
		return a.Target.Type+a.Target.ID+a.Code < b.Target.Type+b.Target.ID+b.Code
	})
	return ds
}

// ModelSnapshot returns native descriptors from one repeatable-read snapshot.
// Pagination/adapters must bind these counters, never fetch a separate head.
type ModelSnapshot struct {
	ProjectID          string                   `json:"projectId"`
	ModelRevision      int64                    `json:"modelRevision"`
	ProjectPosition    int64                    `json:"projectPosition"`
	Components         []componentDescriptor    `json:"components"`
	Relationships      []relationshipDescriptor `json:"relationships"`
	Diagnostics        []ModelDiagnostic        `json:"diagnostics"`
	DiagnosticOverflow bool                     `json:"diagnosticOverflow"`
}

func (s *Store) ReadModel(ctx context.Context, projectID string) (ModelSnapshot, error) {
	var result ModelSnapshot
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = readModelSnapshot(tx, projectID)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

// readModelSnapshot never opens a transaction: callers supply their snapshot.
func readModelSnapshot(tx *gorm.DB, projectID string) (ModelSnapshot, error) {
	result := ModelSnapshot{ProjectID: projectID, Components: []componentDescriptor{}, Relationships: []relationshipDescriptor{}}
	var p Project
	if err := tx.Where("project_id = ?", projectID).Take(&p).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return result, domainError("project_not_found", "/projectId", "project %q does not exist", projectID)
		}
		return result, err
	}
	g, err := loadGraph(tx, projectID)
	if err != nil {
		return result, err
	}
	result.ModelRevision = p.ModelRevision
	result.ProjectPosition = p.LastPosition
	for _, c := range g.components {
		result.Components = append(result.Components, c)
	}
	for _, r := range g.relationships {
		result.Relationships = append(result.Relationships, r)
	}
	sort.Slice(result.Components, func(i, j int) bool { return result.Components[i].ComponentID < result.Components[j].ComponentID })
	sort.Slice(result.Relationships, func(i, j int) bool {
		return result.Relationships[i].RelationshipID < result.Relationships[j].RelationshipID
	})
	result.Diagnostics = graphDiagnostics(g)
	var reused []ModelIdentity
	if err := tx.Where("project_id = ? AND historical_reuse", projectID).Order("kind, id").Find(&reused).Error; err != nil {
		return result, err
	}
	for _, id := range reused {
		result.Diagnostics = append(result.Diagnostics, ModelDiagnostic{"historical_id_reuse", ModelTarget{id.Kind, id.ID}, "historical materialization reused a retired identity"})
	}
	if len(result.Diagnostics) > 200 {
		result.DiagnosticOverflow = true
		result.Diagnostics = result.Diagnostics[:200]
	}
	return result, nil
}

// UnmarshalJSON accepts every exact JSON Schema integer spelling while leaving
// the original payload untouched for canonical command identity.
func (p *ModelMutationPayload) UnmarshalJSON(raw []byte) error {
	var wire struct {
		Revision   json.Number      `json:"expectedModelRevision"`
		Operations []ModelOperation `json:"operations"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		return err
	}
	token := wire.Revision.String()
	if token == "" {
		return domainError("invalid_input", "/payload/expectedModelRevision", "revision is required")
	}
	mantissa := token
	if i := strings.IndexAny(token, "eE"); i >= 0 {
		mantissa = token[:i]
		exponent, err := strconv.ParseInt(token[i+1:], 10, 64)
		if strings.Trim(mantissa, "-+.0") == "" {
			p.ExpectedModelRevision = 0
			p.Operations = wire.Operations
			return nil
		}
		if err != nil || exponent > int64(len(raw))+20 || exponent < -int64(len(raw))-20 {
			return domainError("invalid_input", "/payload/expectedModelRevision", "revision is outside the integer range")
		}
	}
	value, ok := new(big.Rat).SetString(token)
	if !ok || !value.IsInt() || !value.Num().IsInt64() || value.Sign() < 0 || value.Num().Int64() > 9007199254740991 {
		return domainError("invalid_input", "/payload/expectedModelRevision", "revision must be an integer in [0, 9007199254740991]")
	}
	p.ExpectedModelRevision = value.Num().Int64()
	p.Operations = wire.Operations
	return nil
}
