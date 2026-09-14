package mcptools

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/store"
	"gorm.io/gorm"
	"sort"
	"strings"
)

type cursor struct {
	Operation string `json:"o"`
	Project   string `json:"p"`
	Run       string `json:"r"`
	Snapshot  string `json:"s"`
	Last      string `json:"k"`
}

func (s *Service) encodeCursor(c cursor) string {
	raw, _ := json.Marshal(c)
	mac := hmac.New(sha256.New, s.cursorKey[:])
	mac.Write(raw)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Service) decodeCursor(raw string, expected cursor) (cursor, error) {
	if raw == "" {
		return expected, nil
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return cursor{}, domain("invalid_input", "/cursor", "cursor is invalid or belongs to an earlier server session")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return cursor{}, domain("invalid_input", "/cursor", "malformed cursor")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return cursor{}, domain("invalid_input", "/cursor", "malformed cursor")
	}
	mac := hmac.New(sha256.New, s.cursorKey[:])
	mac.Write(payload)
	var got cursor
	if !hmac.Equal(signature, mac.Sum(nil)) || json.Unmarshal(payload, &got) != nil {
		return cursor{}, domain("invalid_input", "/cursor", "cursor is invalid or belongs to an earlier server session")
	}
	if got.Operation != expected.Operation || got.Project != expected.Project || got.Run != expected.Run {
		return cursor{}, domain("invalid_input", "/cursor", "cursor belongs to another operation, project or run")
	}
	if got.Snapshot != expected.Snapshot {
		return cursor{}, domain("stale_cursor", "/cursor", "snapshot changed; restart pagination without the cursor")
	}
	return got, nil
}
func (s *Service) read(ctx context.Context, name string, args map[string]any) (any, error) {
	switch name {
	case "visualise_view_get":
		return store.New(s.db).ReadView(ctx, args["projectId"].(string), args["viewId"].(string))
	case "visualise_views_list":
		project := args["projectId"].(string)
		snapshot, err := store.New(s.db).ListViews(ctx, project)
		if err != nil {
			return nil, err
		}
		items := make([]keyed, 0, len(snapshot.Items))
		for _, item := range snapshot.Items {
			items = append(items, keyed{item.ViewID, item})
		}
		return s.page(args, cursor{Operation: name, Project: project, Snapshot: decimal(snapshot.ProjectPosition)}, counters(project, snapshot.ModelRevision, snapshot.ProjectPosition), items)

	case "visualise_discover":
		return map[string]any{"contractVersion": "2.0.0", "tools": Names(), "viewKinds": []string{"architecture"}, "limits": map[string]int{"maxOperations": 100, "maxPageSize": 200, "maxRequestBytes": 1048576, "maxStructuredResponseBytes": 1048576, "maxImageBytes": 4194304}}, nil
	case "visualise_projects_list":
		ids := []string{}
		if err := s.db.WithContext(ctx).Model(&store.Project{}).Order("project_id").Pluck("project_id", &ids).Error; err != nil {
			return nil, err
		}
		raw, _ := json.Marshal(ids)
		sum := sha256.Sum256(raw)
		items := make([]keyed, 0, len(ids))
		for _, id := range ids {
			items = append(items, keyed{id, id})
		}
		return s.page(args, cursor{Operation: name, Snapshot: hex.EncodeToString(sum[:])}, map[string]any{}, items)
	case "visualise_model_read":
		project := args["projectId"].(string)
		snapshot, err := store.New(s.db).ReadModel(ctx, project)
		if err != nil {
			return nil, err
		}
		if err = expectedRevision(args, snapshot.ModelRevision); err != nil {
			return nil, err
		}
		items := make([]keyed, 0, len(snapshot.Components)+len(snapshot.Relationships))
		for _, c := range snapshot.Components {
			items = append(items, keyed{"component/" + c.ComponentID, map[string]any{"type": "component", "value": c}})
		}
		for _, r := range snapshot.Relationships {
			items = append(items, keyed{"relationship/" + r.RelationshipID, map[string]any{"type": "relationship", "value": r}})
		}
		head := counters(project, snapshot.ModelRevision, snapshot.ProjectPosition)
		head["diagnostics"] = snapshot.Diagnostics
		head["diagnosticOverflow"] = snapshot.DiagnosticOverflow
		return s.page(args, cursor{Operation: name, Project: project, Snapshot: decimal(snapshot.ModelRevision)}, head, items)
	case "visualise_element_get":
		return s.element(ctx, args)
	case "visualise_context_read":
		project, run := args["projectId"].(string), args["runId"].(string)
		snapshot, err := readapi.New(s.db).Context(ctx, project, run)
		if err != nil {
			return nil, err
		}
		items := make([]keyed, 0, len(snapshot.Agents))
		for _, agent := range snapshot.Agents {
			items = append(items, keyed{agent.AgentID, map[string]any{"agent": agent, "scope": agent.WorkScope, "scopePosition": agent.WorkScopePosition, "missingReferences": agent.MissingScopeReferences}})
		}
		sort.Slice(items, func(i, j int) bool { return items[i].key < items[j].key })
		head := counters(project, snapshot.Project.ModelRevision, snapshot.Project.LastPosition)
		head["runId"] = run
		head["isOpen"] = snapshot.Run.IsOpen
		return s.page(args, cursor{Operation: name, Project: project, Run: run, Snapshot: decimal(snapshot.Project.LastPosition)}, head, items)
	}
	return nil, domain("internal_error", "", "unknown registered operation")
}

type keyed struct {
	key   string
	value any
}

func (s *Service) page(args map[string]any, base cursor, result map[string]any, items []keyed) (any, error) {
	raw, _ := args["cursor"].(string)
	current, err := s.decodeCursor(raw, base)
	if err != nil {
		return nil, err
	}
	limit := 50
	if value, ok := args["limit"]; ok {
		limit = int(integer(value))
	}
	start := sort.Search(len(items), func(i int) bool { return items[i].key > current.Last })
	values := []any{}
	result["items"] = values
	result["nextCursor"] = nil
	for i := start; i < len(items) && len(values) < limit; i++ {
		candidate := append(values, items[i].value)
		result["items"] = candidate
		base.Last = items[i].key
		var next any
		if i+1 < len(items) {
			next = s.encodeCursor(base)
		}
		result["nextCursor"] = next
		encoded, err := json.Marshal(result)
		if err != nil {
			return nil, err
		}
		if len(encoded) > MaxResponseBytes {
			if len(values) == 0 {
				return nil, domain("response_too_large", "/target", "element "+items[i].key+" exceeds the structured response budget")
			}
			base.Last = items[i-1].key
			result["items"] = values
			result["nextCursor"] = s.encodeCursor(base)
			return result, nil
		}
		values = candidate
	}
	return result, nil
}
func expectedRevision(args map[string]any, revision int64) error {
	if expected, ok := args["expectedModelRevision"]; ok && integer(expected) != revision {
		return &store.DomainError{Code: "revision_conflict", Detail: "model revision changed; read the current model and reconcile", Field: "/expectedModelRevision", CurrentModelRevision: &revision}
	}
	return nil
}
func counters(project string, revision, position int64) map[string]any {
	return map[string]any{"projectId": project, "modelRevision": revision, "projectPosition": position}
}
func decimal(value int64) string { raw, _ := json.Marshal(value); return string(raw) }

// A targeted read queries exactly one descriptor, independent of model size.
func (s *Service) element(ctx context.Context, args map[string]any) (any, error) {
	project := args["projectId"].(string)
	target := args["target"].(map[string]any)
	kind, id := target["type"].(string), target["id"].(string)
	var result map[string]any
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var p store.Project
		if err := tx.Where("project_id = ?", project).Take(&p).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return domain("project_not_found", "/projectId", "project does not exist")
			}
			return err
		}
		if err := expectedRevision(args, p.ModelRevision); err != nil {
			return err
		}
		var value map[string]any
		if kind == "component" {
			var c store.Component
			if err := tx.Where("project_id = ? AND component_id = ?", project, id).Take(&c).Error; err != nil {
				if err == gorm.ErrRecordNotFound {
					return domain("element_not_found", "/target/id", "component "+id+" does not exist")
				}
				return err
			}
			value = map[string]any{"componentId": c.ComponentID, "name": c.Name, "kind": c.Kind, "parentComponentId": c.ParentComponentID}
			if c.Description != "" {
				value["description"] = c.Description
			}
			if len(c.Technology) > 0 && string(c.Technology) != "null" {
				value["technology"] = json.RawMessage(c.Technology)
			}
			if len(c.Tags) > 0 && string(c.Tags) != "null" {
				value["tags"] = json.RawMessage(c.Tags)
			}
		} else {
			var r store.Relationship
			if err := tx.Where("project_id = ? AND relationship_id = ?", project, id).Take(&r).Error; err != nil {
				if err == gorm.ErrRecordNotFound {
					return domain("element_not_found", "/target/id", "relationship "+id+" does not exist")
				}
				return err
			}
			value = map[string]any{"relationshipId": r.RelationshipID, "sourceComponentId": r.SourceComponentID, "targetComponentId": r.TargetComponentID, "kind": r.Kind}
			for key, text := range map[string]string{"label": r.Label, "protocol": r.Protocol, "operation": r.Operation, "channel": r.Channel} {
				if text != "" {
					value[key] = text
				}
			}
		}
		result = counters(project, p.ModelRevision, p.LastPosition)
		result["element"] = map[string]any{"type": kind, "value": value}
		raw, err := json.Marshal(result)
		if err != nil {
			return err
		}
		if len(raw) > MaxResponseBytes {
			return domain("response_too_large", "/target/id", "element "+id+" exceeds the structured response budget")
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
