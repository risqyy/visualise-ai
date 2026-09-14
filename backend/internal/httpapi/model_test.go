package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/risqyy/visualise-ai/backend/internal/ingest"
	"github.com/risqyy/visualise-ai/backend/internal/store"
	"net/http"
	"strings"
	"testing"
)

func commandBody(f *ingestFixture, revision string, ops string) string {
	e := f.event("orchestrator-root", nil, store.TypeModelMutationApplied, `{"expectedModelRevision":`+revision+`,"operations":`+ops+`}`)
	e.SchemaVersion = "2.0"
	return strings.Replace(f.encode(e), `"schemaVersion":"2.0",`, `"schemaVersion":"2.0","parentAgentId":null,`, 1)
}

const commandAdd = `[{"op":"component.add","component":{"componentId":"node-aa","name":"A","kind":"service","parentComponentId":null}}]`

func TestModelCommandRESTAndServiceShareReceiptLifecycleAndPublication(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()
	service, err := ingest.NewService(ingest.HandlerOptions{Store: store.New(f.db), Contract: ingestContract, Publisher: f.publisher, MaxEventBytes: defaultTestMaxEventBytes})
	if err != nil {
		t.Fatal(err)
	}
	body := commandBody(f, "0.0", commandAdd)
	response := f.post(body)
	if response.Code != http.StatusCreated {
		t.Fatalf("%d %s", response.Code, response.Body)
	}
	var receipt store.Result
	if err := json.Unmarshal(response.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt.ModelRevision != 1 || receipt.Position != 2 || receipt.RunID != f.runID || receipt.AgentID != "orchestrator-root" {
		t.Fatalf("receipt %+v", receipt)
	}
	replay, err := service.Submit(context.Background(), []byte(body))
	if err != nil || !replay.Duplicate || replay.ServerEventID != receipt.ServerEventID {
		t.Fatalf("cross-adapter retry %+v %v", replay, err)
	}
	changedNumber := strings.Replace(body, `"expectedModelRevision":0.0`, `"expectedModelRevision":0e0`, 1)
	requireProblem(t, f.post(changedNumber), http.StatusConflict, "client_event_id_conflict")
	invalid := commandBody(f, "1", `[{"op":"component.update","componentId":"node-aa","set":{"parentComponentId":"missing"}}]`)
	requireProblem(t, f.post(invalid), http.StatusUnprocessableEntity, "reference_invalid")
	conflict := commandBody(f, "0", `[{"op":"component.update","componentId":"node-aa","set":{"name":"stale"}}]`)
	requireProblem(t, f.post(conflict), http.StatusConflict, "revision_conflict")
	if len(f.publisher.published()) != 2 || f.lastPosition() != 2 {
		t.Fatal("replay/rejection published or advanced position")
	}
	f.accept(f.event("orchestrator-root", nil, store.TypeRunFinished, `{"outcome":"completed","summary":"done"}`))
	replay, err = service.Submit(context.Background(), []byte(body))
	if err != nil || !replay.Duplicate {
		t.Fatalf("closed-run retry %v", err)
	}
	// Changed reporter/expected revision must conflict before the closed-run guard.
	changed := strings.Replace(body, `"agentId":"orchestrator-root"`, `"agentId":"unknown-agent"`, 1)
	requireProblem(t, f.post(changed), http.StatusConflict, "client_event_id_conflict")
	fresh := commandBody(f, "1", `[{"op":"component.update","componentId":"node-aa","set":{"name":"closed"}}]`)
	requireProblem(t, f.post(fresh), http.StatusUnprocessableEntity, "run_already_finished")
	if len(f.publisher.published()) != 3 {
		t.Fatal("retry or failed mutation published")
	}
}
func TestModelCommandLimitsAndSchemaFailuresAcrossAdapters(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()
	service, err := ingest.NewService(ingest.HandlerOptions{Store: store.New(f.db), Contract: ingestContract, Publisher: f.publisher, MaxEventBytes: defaultTestMaxEventBytes})
	if err != nil {
		t.Fatal(err)
	}
	body := commandBody(f, "0", commandAdd)
	oversized := body + strings.Repeat(" ", 1048577-len(body))
	requireProblem(t, f.post(oversized), http.StatusRequestEntityTooLarge, ingest.CodeEventTooLarge)
	_, err = service.Submit(context.Background(), []byte(oversized))
	var domain *store.DomainError
	if !errors.As(err, &domain) || domain.Code != "invalid_input" {
		t.Fatalf("service size gate %v", err)
	}
	for _, ops := range []string{`[]`, `[{"op":"component.update","componentId":"node-aa","set":{"componentId":"changed"}}]`, `[{"op":"component.add","component":{"componentId":"node-aa","name":null,"kind":"service","parentComponentId":null}}]`} {
		bad := commandBody(f, "0", ops)
		requireProblem(t, f.post(bad), http.StatusBadRequest, ingest.CodeInvalidField)
		_, err = service.Submit(context.Background(), []byte(bad))
		var validation *ingest.ValidationError
		if !errors.As(err, &validation) || len(validation.Fields) == 0 {
			t.Fatalf("schema fields missing: %v", err)
		}
	}
	if f.lastPosition() != 1 || len(f.publisher.published()) != 1 {
		t.Fatal("failed validation wrote state")
	}
}
func TestModelCommandOwnershipAndEffectiveCorrectionGuards(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	requireProblem(t, f.post(commandBody(f, "0", commandAdd)), http.StatusNotFound, "project_not_found")
	f.startRun()
	f.startSubagent("worker-aa")
	f.startSubagent("worker-bb")
	body := commandBody(f, "0", commandAdd)
	for _, tc := range []struct{ from, to, code string }{{`"runId":"` + f.runID + `"`, `"runId":"unknown-run"`, "run_not_started"}, {`"agentId":"orchestrator-root"`, `"agentId":"unknown-agent"`, "unknown_agent"}, {`"parentAgentId":null`, `"parentAgentId":"worker-aa"`, "parent_agent_unknown"}} {
		requireProblem(t, f.post(strings.Replace(body, tc.from, tc.to, 1)), http.StatusUnprocessableEntity, tc.code)
	}
	root := f.event("orchestrator-root", nil, store.TypeAgentStatusReported, `{"status":"working"}`)
	f.accept(root)
	parent := "worker-bb"
	restart := f.event("worker-aa", &parent, store.TypeAgentStarted, `{"role":"subagent","displayName":"Again","assignedTask":"reparent"}`)
	requireProblem(t, f.send(restart), http.StatusUnprocessableEntity, "agent_already_started")
	correct := f.event("worker-aa", &parent, store.TypeCorrectionIssued, fmt.Sprintf(`{"correctsClientEventId":%q,"reason":"bad parent","correctedType":"agent.started","correctedPayload":{"role":"subagent","displayName":"Worker","assignedTask":"task"}}`, root.ClientEventID))
	requireProblem(t, f.send(correct), http.StatusUnprocessableEntity, "parent_agent_unknown")
	parent = "orchestrator-root"
	correct.ParentAgentID = &parent
	correct.ClientEventID = uuid.NewString()
	correct.Payload = json.RawMessage(fmt.Sprintf(`{"correctsClientEventId":%q,"reason":"bad closer","correctedType":"run.finished","correctedPayload":{"outcome":"completed","summary":"done"}}`, root.ClientEventID))
	requireProblem(t, f.send(correct), http.StatusUnprocessableEntity, "terminal_event_not_allowed")
	// A valid model correction remains available after closure and moves revision
	// exactly once; an evidence correction does not change that revision.
	added := f.post(body)
	if added.Code != http.StatusCreated {
		t.Fatal(added.Body)
	}
	f.accept(f.event("orchestrator-root", nil, store.TypeRunFinished, `{"outcome":"completed","summary":"done"}`))
	correction := f.event("orchestrator-root", nil, store.TypeCorrectionIssued, fmt.Sprintf(`{"correctsClientEventId":%q,"reason":"rename","correctedType":"component.change_applied","correctedPayload":{"operation":"modify","component":{"componentId":"node-aa","name":"Corrected","kind":"service","parentComponentId":null}}}`, root.ClientEventID))
	f.accept(correction)
	snapshot, err := store.New(f.db).ReadModel(context.Background(), f.projectID)
	if err != nil || snapshot.ModelRevision != 2 || snapshot.Components[0].Name != "Corrected" {
		t.Fatalf("effective correction %+v %v", snapshot, err)
	}
}
func TestCorrectionCannotBypassDescriptorSchemaOrIntroduceCommands(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	root := f.startRun()
	for _, corrected := range []string{
		`"correctedType":"component.change_applied","correctedPayload":{"operation":"add","component":{"componentId":"node-aa","name":"A","kind":"invented","parentComponentId":null,"smuggled":true}}`,
		`"correctedType":"model.mutation_applied","correctedPayload":{"expectedModelRevision":0,"operations":` + commandAdd + `}`,
	} {
		correction := f.event("orchestrator-root", nil, store.TypeCorrectionIssued, `{"correctsClientEventId":"`+root.ClientEventID+`","reason":"schema bypass",`+corrected+`}`)
		problem := requireProblem(t, f.send(correction), http.StatusBadRequest, ingest.CodeInvalidField)
		if len(problem.Errors) == 0 || !strings.HasPrefix(problem.Errors[0].Field, "/payload/") {
			t.Fatalf("no corrective pointer %+v", problem)
		}
	}
	if f.lastPosition() != 1 || len(f.publisher.published()) != 1 {
		t.Fatal("malformed effective correction changed state")
	}
}
