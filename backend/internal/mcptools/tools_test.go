package mcptools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/risqyy/visualise-ai/backend/internal/ingest"
	"github.com/risqyy/visualise-ai/backend/internal/mcptransport"
	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/store"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type publisher struct {
	mu     sync.Mutex
	events []ingest.CommittedEvent
}

func (p *publisher) Publish(_ context.Context, e ingest.CommittedEvent) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, e)
}

type fixture struct {
	t            *testing.T
	db           *gorm.DB
	s            *Service
	session      *mcp.ClientSession
	url, project string
	publisher    *publisher
}

func setup(t *testing.T) *fixture {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is required for actual PostgreSQL MCP acceptance")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(db); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	pub := &publisher{}
	commands, err := ingest.NewService(ingest.HandlerOptions{Store: store.New(db), Publisher: pub, MaxEventBytes: 1048576})
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(db, commands)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewUnstartedServer(nil)
	handler, err := mcptransport.New(mcptransport.Options{AllowedHosts: []string{ts.Listener.Addr().String()}, Register: service.Register})
	if err != nil {
		t.Fatal(err)
	}
	ts.Config.Handler = handler
	ts.Start()
	t.Cleanup(func() { _ = handler.Close(); ts.Close() })
	f := &fixture{t: t, db: db, s: service, url: ts.URL, project: "mcp-" + uuid.NewString(), publisher: pub}
	f.connect()
	return f
}
func (f *fixture) connect() {
	f.t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "fresh-domain-client", Version: "1"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: f.url}, nil)
	if err != nil {
		f.t.Fatal(err)
	}
	f.session = session
	f.t.Cleanup(func() { _ = session.Close() })
}
func (f *fixture) identity(agent string) map[string]any {
	var parent any
	if agent != "root-agent" {
		parent = "root-agent"
	}
	return map[string]any{"contractVersion": "2.0.0", "projectId": f.project, "runId": "run-one", "agentId": agent, "parentAgentId": parent, "clientEventId": uuid.NewString(), "occurredAt": "2026-09-14T10:00:00Z"}
}
func (f *fixture) readArgs() map[string]any {
	return map[string]any{"contractVersion": "2.0.0", "projectId": f.project}
}
func (f *fixture) call(name string, args any, code string) map[string]any {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	result, err := f.session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		f.t.Fatal(name, err)
	}
	raw, err := json.Marshal(result.StructuredContent)
	if err != nil {
		f.t.Fatal(err)
	}
	var value map[string]any
	if err = json.Unmarshal(raw, &value); err != nil {
		f.t.Fatal(err)
	}
	if result.IsError != (code != "") || code != "" && value["code"] != code {
		f.t.Fatalf("%s wanted error %q: %s", name, code, raw)
	}
	if len(result.Content) != 1 {
		f.t.Fatal("textual result missing")
	}
	return value
}
func (f *fixture) open(agent string) map[string]any {
	args := f.identity(agent)
	role := "subagent"
	if agent == "root-agent" {
		role = "orchestrator"
	}
	args["role"] = role
	args["displayName"] = agent
	args["assignedTask"] = "Implement the architecture"
	f.call("visualise_context_open", args, "")
	return args
}
func (f *fixture) mutate(revision int, ops ...any) map[string]any {
	args := f.identity("root-agent")
	args["expectedModelRevision"] = revision
	args["operations"] = ops
	return args
}
func component(id string) map[string]any {
	return map[string]any{"op": "component.add", "component": map[string]any{"componentId": id, "name": id, "kind": "service", "parentComponentId": nil}}
}
func report(f *fixture, agent, action string, fields map[string]any) map[string]any {
	args := f.identity(agent)
	fields["action"] = action
	args["report"] = fields
	return args
}

func TestFreshSDKWorkflowLifecycleReplayAndScopes(t *testing.T) {
	f := setup(t)
	discovery := f.call("visualise_discover", map[string]any{}, "")
	if len(discovery["tools"].([]any)) != len(Names()) {
		t.Fatal(discovery)
	}
	listing, err := f.session.ListTools(context.Background(), nil)
	if err != nil || len(listing.Tools) != len(Names()) {
		t.Fatalf("tools %v %v", listing, err)
	}
	for _, tool := range listing.Tools {
		if tool.Description == "" || tool.InputSchema == nil || tool.OutputSchema == nil || tool.Annotations == nil {
			t.Fatal("incomplete tool definition", tool.Name)
		}
	}
	opened := f.open("root-agent")
	f.call("visualise_context_open", opened, "")
	fresh := f.identity("root-agent")
	fresh["role"] = "orchestrator"
	fresh["displayName"] = "Root"
	fresh["assignedTask"] = "bad restart"
	f.call("visualise_context_open", fresh, "run_already_started")
	add := f.mutate(0, component("service-aa"), component("service-bb"), map[string]any{"op": "relationship.add", "relationship": map[string]any{"relationshipId": "calls-ab", "sourceComponentId": "service-aa", "targetComponentId": "service-bb", "kind": "dependency"}})
	receipt := f.call("visualise_model_mutate", add, "")
	if receipt["modelRevision"] != float64(1) || receipt["projectPosition"] != float64(2) || receipt["agentId"] != "root-agent" || receipt["viewRevision"] != nil {
		t.Fatal(receipt)
	}
	f.session.Close()
	f.connect()
	retry := f.call("visualise_model_mutate", add, "")
	if retry["duplicate"] != true || retry["serverEventId"] != receipt["serverEventId"] {
		t.Fatal(retry)
	}
	model := f.call("visualise_model_read", f.readArgs(), "")
	if len(model["items"].([]any)) != 3 || model["modelRevision"] != float64(1) {
		t.Fatal(model)
	}
	target := f.readArgs()
	target["target"] = map[string]any{"type": "component", "id": "service-aa"}
	f.call("visualise_element_get", target, "")
	update := f.mutate(1, map[string]any{"op": "component.update", "componentId": "service-aa", "set": map[string]any{"name": "Renamed", "description": "explicit patch"}})
	f.call("visualise_model_mutate", update, "")
	stale := f.mutate(1, map[string]any{"op": "component.update", "componentId": "service-aa", "set": map[string]any{"name": "stale"}})
	conflict := f.call("visualise_model_mutate", stale, "revision_conflict")
	if conflict["currentModelRevision"] != float64(2) {
		t.Fatal(conflict)
	}
	bad := f.mutate(2, map[string]any{"op": "component.remove", "componentId": "service-aa"})
	f.call("visualise_model_mutate", bad, "reference_invalid")
	f.open("worker-one")
	f.open("worker-two")
	for _, agent := range []string{"worker-one", "worker-two"} {
		scope := f.identity(agent)
		scope["scope"] = map[string]any{"componentIds": []string{"service-aa"}, "relationshipIds": []string{"calls-ab"}}
		f.call("visualise_work_scope_set", scope, "")
	}
	start := report(f, "worker-one", "step_start", map[string]any{"workStepId": "step-one", "title": "Change service", "componentIds": []string{"service-aa"}})
	f.call("visualise_work_report", start, "")
	duplicateStart := report(f, "worker-two", "step_start", map[string]any{"workStepId": "step-one", "title": "Steal step", "componentIds": []string{}})
	f.call("visualise_work_report", duplicateStart, "work_step_already_started")
	f.call("visualise_work_report", report(f, "worker-two", "step_complete", map[string]any{"workStepId": "step-one", "summary": "Not mine"}), "work_step_not_started")
	f.call("visualise_work_report", report(f, "worker-one", "status", map[string]any{"status": "working", "note": "Explicit report"}), "")
	f.call("visualise_work_report", report(f, "worker-one", "progress", map[string]any{"percent": json.Number("25.0"), "scope": "own_task", "basis": "reported_estimate"}), "")
	ctx := f.readArgs()
	ctx["runId"] = "run-one"
	contextResult := f.call("visualise_context_read", ctx, "")
	if len(contextResult["items"].([]any)) != 3 || contextResult["modelRevision"] != float64(2) {
		t.Fatal(contextResult)
	}
	hydrated, err := readapi.New(f.db).Agents(context.Background(), f.project, "run-one")
	if err != nil || hydrated.ModelRevision != 2 || hydrated.Agents[1].WorkScope == nil {
		t.Fatalf("hydration %+v %v", hydrated, err)
	}
	removed := f.mutate(2, map[string]any{"op": "component.remove", "componentId": "service-aa"}, map[string]any{"op": "relationship.remove", "relationshipId": "calls-ab"})
	f.call("visualise_model_mutate", removed, "")
	complete := f.call("visualise_work_report", report(f, "worker-one", "step_complete", map[string]any{"workStepId": "step-one", "summary": "Explicit completion"}), "")
	affected := complete["affected"].(map[string]any)["componentIds"].([]any)
	if len(affected) != 1 || affected[0] != "service-aa" {
		t.Fatal(complete)
	}
	contextResult = f.call("visualise_context_read", ctx, "")
	for _, item := range contextResult["items"].([]any) {
		entry := item.(map[string]any)
		if entry["scope"] != nil && len(entry["missingReferences"].(map[string]any)["componentIds"].([]any)) != 1 {
			t.Fatal(entry)
		}
	}
	badParent := report(f, "worker-one", "status", map[string]any{"status": "done"})
	badParent["parentAgentId"] = "worker-two"
	f.call("visualise_work_report", badParent, "parent_agent_unknown")
	f.call("visualise_work_report", report(f, "worker-one", "run_finish", map[string]any{"outcome": "completed", "summary": "Not allowed"}), "terminal_event_not_allowed")
	f.call("visualise_work_report", report(f, "worker-one", "agent_finish", map[string]any{"outcome": "completed", "summary": "Done"}), "")
	finish := report(f, "root-agent", "run_finish", map[string]any{"outcome": "completed", "summary": "All done"})
	f.call("visualise_work_report", finish, "")
	f.call("visualise_work_report", report(f, "worker-two", "status", map[string]any{"status": "working"}), "run_already_finished")
	replay := f.call("visualise_model_mutate", add, "")
	if replay["modelRevision"] != float64(1) || replay["projectPosition"] != float64(2) {
		t.Fatal(replay)
	}
	add["agentId"] = "worker-two"
	f.call("visualise_model_mutate", add, "client_event_id_conflict")
	var p store.Project
	f.db.Where("project_id = ?", f.project).Take(&p)
	if int64(len(f.publisher.events)) != p.LastPosition || p.ModelRevision != 3 {
		t.Fatalf("events %d head %+v", len(f.publisher.events), p)
	}
}

func TestBoundedPagesTargetedReadsAndCorrectableErrors(t *testing.T) {
	f := setup(t)
	f.open("root-agent")
	for batch := 0; batch < 3; batch++ {
		ops := []any{}
		for i := 0; i < 100; i++ {
			ops = append(ops, component(fmt.Sprintf("node-%03d", batch*100+i)))
		}
		f.call("visualise_model_mutate", f.mutate(batch, ops...), "")
	}
	pageArgs := f.readArgs()
	pageArgs["limit"] = 1
	page := f.call("visualise_model_read", pageArgs, "")
	if len(page["items"].([]any)) != 1 || page["nextCursor"] == nil {
		t.Fatal(page)
	}
	pageArgs["cursor"] = page["nextCursor"]
	next := f.call("visualise_model_read", pageArgs, "")
	if fmt.Sprint(next["items"]) == fmt.Sprint(page["items"]) {
		t.Fatal("repeated page")
	}
	f.call("visualise_model_mutate", f.mutate(3, map[string]any{"op": "component.update", "componentId": "node-001", "set": map[string]any{"name": "changed"}}), "")
	f.call("visualise_model_read", pageArgs, "stale_cursor")
	targeted := f.readArgs()
	targeted["target"] = map[string]any{"type": "component", "id": "node-299"}
	f.call("visualise_element_get", targeted, "")
	targeted["expectedModelRevision"] = 1
	f.call("visualise_element_get", targeted, "revision_conflict")
	delete(targeted, "expectedModelRevision")
	targeted["target"] = map[string]any{"type": "relationship", "id": "missing"}
	f.call("visualise_element_get", targeted, "element_not_found")
	bad := f.readArgs()
	bad["limit"] = 201
	invalid := f.call("visualise_model_read", bad, "invalid_input")
	if len(invalid["fields"].([]any)) == 0 {
		t.Fatal(invalid)
	}
	bad["limit"] = 1
	bad["contractVersion"] = "3.0.0"
	f.call("visualise_model_read", bad, "unsupported_contract_version")
	// Legacy rows can exceed current command string bounds. One oversized item
	// fails with its stable ID; it never produces an empty continuation loop.
	if err := f.db.Model(&store.Component{}).Where("project_id = ? AND component_id = ?", f.project, "node-000").Update("description", strings.Repeat("x", MaxResponseBytes)).Error; err != nil {
		t.Fatal(err)
	}
	f.call("visualise_model_read", f.readArgs(), "response_too_large")
	targeted["target"] = map[string]any{"type": "component", "id": "node-000"}
	oversize := f.call("visualise_element_get", targeted, "response_too_large")
	if !strings.Contains(oversize["message"].(string), "node-000") {
		t.Fatal(oversize)
	}
}

func TestGeneratedSchemasCompileWithoutDatabase(t *testing.T) {
	if _, err := New(nil, nil); err != nil {
		t.Fatal(err)
	}
}

func TestPublishedDomainWorkflow(t *testing.T) {
	endpoint := os.Getenv("TEST_MCP_ENDPOINT")
	if endpoint == "" {
		t.Skip("TEST_MCP_ENDPOINT enables the published Compose/Nginx workflow")
	}
	f := &fixture{t: t, url: endpoint, project: "published-" + uuid.NewString()}
	f.connect()
	f.call("visualise_discover", map[string]any{}, "")
	f.open("root-agent")
	add := f.mutate(0, component("service-aa"), component("service-bb"), map[string]any{"op": "relationship.add", "relationship": map[string]any{"relationshipId": "calls-ab", "sourceComponentId": "service-aa", "targetComponentId": "service-bb", "kind": "dependency"}})
	first := f.call("visualise_model_mutate", add, "")
	f.open("worker-one")
	scope := f.identity("worker-one")
	scope["scope"] = map[string]any{"componentIds": []string{"service-aa"}, "relationshipIds": []string{"calls-ab"}}
	f.call("visualise_work_scope_set", scope, "")
	base := strings.TrimSuffix(endpoint, "/mcp")
	response, err := http.Get(base + "/api/v1/projects/" + f.project + "/runs/run-one/agents")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(response.Body)
	if response.StatusCode != 200 || !strings.Contains(string(raw), `"workScope"`) || !strings.Contains(string(raw), `"calls-ab"`) {
		t.Fatalf("published hydration %d %s", response.StatusCode, raw)
	}
	f.session.Close()
	f.connect()
	retry := f.call("visualise_model_mutate", add, "")
	if retry["duplicate"] != true || retry["serverEventId"] != first["serverEventId"] {
		t.Fatal(retry)
	}
	f.call("visualise_model_mutate", f.mutate(1, map[string]any{"op": "component.update", "componentId": "service-aa", "set": map[string]any{"name": "Changed through MCP"}}), "")
	f.call("visualise_model_mutate", f.mutate(1, map[string]any{"op": "component.update", "componentId": "service-bb", "set": map[string]any{"name": "Stale"}}), "revision_conflict")
	f.call("visualise_work_report", report(f, "worker-one", "run_finish", map[string]any{"outcome": "completed", "summary": "Not root"}), "terminal_event_not_allowed")
	f.call("visualise_work_report", report(f, "root-agent", "run_finish", map[string]any{"outcome": "completed", "summary": "Explicit finish"}), "")
	f.call("visualise_model_mutate", add, "")
}

func TestLiteralRunAndSharedScopesBeyondPostgresParameterLimit(t *testing.T) {
	f := setup(t)
	f.open("root-agent")
	read := f.readArgs()
	read["runId"] = "current"
	f.call("visualise_context_read", read, "run_not_found")
	open := f.identity("root-agent")
	open["runId"] = "current"
	open["role"] = "orchestrator"
	open["displayName"] = "literal"
	open["assignedTask"] = "Literal run"
	f.call("visualise_context_open", open, "")
	open = f.identity("root-agent")
	open["runId"] = "run-later"
	open["role"] = "orchestrator"
	open["displayName"] = "later"
	open["assignedTask"] = "Later run"
	f.call("visualise_context_open", open, "")
	actual := f.call("visualise_context_read", read, "")
	agent := actual["items"].([]any)[0].(map[string]any)["agent"].(map[string]any)
	if actual["runId"] != "current" || agent["runId"] != "current" {
		t.Fatal(actual)
	}
	rest, err := readapi.New(f.db).Agents(context.Background(), f.project, "current")
	if err != nil || rest.Agents[0].RunID != "run-later" {
		t.Fatalf("REST alias %+v %v", rest, err)
	}
	for _, distinct := range []bool{false, true} {
		agents := []store.Agent{}
		scopes := []store.AgentWorkScope{}
		for i := 0; i < 330; i++ {
			id := fmt.Sprintf("agent-%t-%03d", distinct, i)
			parent := "root-agent"
			agents = append(agents, store.Agent{ProjectID: f.project, RunID: "run-one", AgentID: id, ParentAgentID: &parent, Role: "subagent", DisplayName: id, AssignedTask: "reported", StartedAt: time.Now().UTC(), LastEventAt: time.Now().UTC()})
			ids := []string{}
			for j := 0; j < 200; j++ {
				n := j
				if distinct {
					n = i*200 + j
				}
				ids = append(ids, fmt.Sprintf("node-%05d", n))
			}
			raw, _ := json.Marshal(store.AffectedIDs{ComponentIDs: ids, RelationshipIDs: []string{}})
			scopes = append(scopes, store.AgentWorkScope{ProjectID: f.project, RunID: "run-one", AgentID: id, Scope: store.JSON(raw), Position: 1})
		}
		if err := f.db.CreateInBatches(agents, 50).Error; err != nil {
			t.Fatal(err)
		}
		if err := f.db.CreateInBatches(scopes, 50).Error; err != nil {
			t.Fatal(err)
		}
		read = f.readArgs()
		read["runId"] = "run-one"
		read["limit"] = 1
		result := f.call("visualise_context_read", read, "")
		if len(result["items"].([]any)) != 1 || result["nextCursor"] == nil {
			t.Fatal(result)
		}
	}
}

func TestMixedRESTCannotTakeOverTypedStepAndRunScopedCompletion(t *testing.T) {
	f := setup(t)
	f.open("root-agent")
	f.open("worker-one")
	f.open("worker-two")
	f.call("visualise_model_mutate", f.mutate(0, component("node-aa"), component("node-bb")), "")
	start := report(f, "worker-one", "step_start", map[string]any{"workStepId": "shared-step", "title": "Owned", "componentIds": []string{"node-aa"}})
	f.call("visualise_work_report", start, "")
	legacy := func(kind, payload, agent, run string) error {
		var parent any
		if agent != "root-agent" {
			parent = "root-agent"
		}
		env := map[string]any{"schemaVersion": "1.0", "type": kind, "projectId": f.project, "runId": run, "agentId": agent, "parentAgentId": parent, "clientEventId": uuid.NewString(), "occurredAt": "2026-09-14T10:00:00Z", "payload": json.RawMessage(payload)}
		raw, _ := json.Marshal(env)
		_, err := f.s.ingest.Submit(context.Background(), raw)
		return err
	}
	for _, test := range []struct{ kind, payload, code string }{
		{store.TypeWorkStepStarted, `{"workStepId":"shared-step","title":"Stolen","componentIds":["node-bb"]}`, "work_step_already_started"},
		{store.TypeWorkStepCompleted, `{"workStepId":"shared-step","summary":"Stolen"}`, "work_step_not_started"},
		{store.TypeCorrectionIssued, fmt.Sprintf(`{"correctsClientEventId":%q,"reason":"Stolen","correctedType":"work.step_completed","correctedPayload":{"workStepId":"shared-step","summary":"Stolen"}}`, start["clientEventId"]), "work_step_not_started"},
	} {
		err := legacy(test.kind, test.payload, "worker-two", "run-one")
		var domain *store.DomainError
		if !errors.As(err, &domain) || domain.Code != test.code {
			t.Fatalf("%s: %v", test.kind, err)
		}
	}
	if err := legacy(store.TypeWorkStepStarted, `{"workStepId":"planned-step","title":"Planned work","componentIds":["future-node"]}`, "worker-two", "run-one"); err != nil {
		t.Fatalf("legacy planned work must remain valid: %v", err)
	}
	f.call("visualise_work_report", report(f, "worker-two", "step_start", map[string]any{"workStepId": "typed-planned-step", "title": "Future work", "componentIds": []string{"future-node"}}), "reference_invalid")
	open := f.identity("root-agent")
	open["runId"] = "run-two"
	open["role"] = "orchestrator"
	open["displayName"] = "Root"
	open["assignedTask"] = "Second run"
	f.call("visualise_context_open", open, "")
	other := report(f, "root-agent", "step_start", map[string]any{"workStepId": "shared-step", "title": "Different run", "componentIds": []string{"node-bb"}})
	other["runId"] = "run-two"
	f.call("visualise_work_report", other, "")
	complete := f.call("visualise_work_report", report(f, "worker-one", "step_complete", map[string]any{"workStepId": "shared-step", "summary": "Done"}), "")
	ids := complete["affected"].(map[string]any)["componentIds"].([]any)
	if len(ids) != 1 || ids[0] != "node-aa" {
		t.Fatal(complete)
	}
	f.call("visualise_work_report", report(f, "root-agent", "run_finish", map[string]any{"outcome": "completed", "summary": "Closed"}), "")
	for _, corrected := range []string{
		`"correctedType":"work.step_started","correctedPayload":{"workStepId":"shared-step","title":"Correct title","componentIds":["node-aa"]}`,
		`"correctedType":"work.step_completed","correctedPayload":{"workStepId":"shared-step","summary":"Correct summary"}`,
	} {
		payload := fmt.Sprintf(`{"correctsClientEventId":%q,"reason":"Correct metadata",%s}`, start["clientEventId"], corrected)
		if err := legacy(store.TypeCorrectionIssued, payload, "worker-one", "run-one"); err != nil {
			t.Fatalf("valid owner correction after closure: %v", err)
		}
	}
}
