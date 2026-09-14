// Package mcptools adapts the frozen domain catalogue to the official MCP SDK.
// Domain writes always use the same ingestion service as REST.
package mcptools

import (
	"bytes"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/risqyy/visualise-ai/backend/internal/ingest"
	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/store"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"gorm.io/gorm"
)

const MaxResponseBytes = 1048576

//go:embed schemas.json
var schemasJSON []byte

type toolSpec struct {
	Input     map[string]any `json:"input"`
	Output    map[string]any `json:"output"`
	EventType string         `json:"eventType"`
}
type definition struct {
	Name, Description string
	ReadOnly          bool
}

var definitions = []definition{
	{"visualise_discover", "Discover the available native architecture workflow and limits. Open a context explicitly, read IDs and modelRevision, then mutate with a fresh clientEventId. Connections do not start or finish work; views and rendering are advertised only when implemented.", true},
	{"visualise_projects_list", "List known project IDs in lexical order. Use limit (default 50, maximum 200) and nextCursor; restart on stale_cursor when catalogue membership changes.", true},
	{"visualise_model_read", "Read a consistent page of stable native component and relationship IDs with modelRevision and projectPosition. Read all nextCursor pages at one model revision; restart on stale_cursor. Use the revision for atomic mutation CAS.", true},
	{"visualise_element_get", "Read exactly one component or relationship by stable typed ID, with the current modelRevision. Optionally require an exact revision; missing identities produce element_not_found. Names and positions are not identities.", true},
	{"visualise_context_read", "Read explicitly reported agents, lifecycle and work scopes for one named run. Missing scope references are diagnosed. Null scope means none was reported; empty arrays mean explicitly cleared. No status is inferred from connection or silence.", true},
	{"visualise_context_open", "Explicitly open a root orchestrator run (null parent, creating its project if needed) or register a subagent with a known parent in an open run. Save project/run/agent IDs and clientEventId. Reconnect by reading the same context; retry an uncertain write with exactly the same full input and key, even after closure. A new key cannot restart an existing agent.", false},
	{"visualise_work_report", "Explicitly report one typed action: step_start with existing component IDs; step_complete for your own unfinished step; status; progress with reported scope and basis; agent_finish; or root-only run_finish. One accepted command occupies one event position, does not change modelRevision, and does not imply code changed. Retry only with identical full input and clientEventId.", false},
	{"visualise_work_scope_set", "Replace your explicit run-scoped component/relationship work scope. Targets must exist; empty arrays clear scope. Scopes from different agents may overlap and do not lock the model. Finishing retains the last report as evidence. Use the original full input and clientEventId for retries.", false},
	{"visualise_model_mutate", "Apply 1–100 typed model operations atomically and immediately at expectedModelRevision. Stable IDs cannot be reused after removal. Updates change only supplied fields; removals require explicit child/edge handling in the same batch. No approval step. On revision_conflict read and reconcile using a NEW clientEventId; after lost response retry the identical input/key to recover its original receipt. Mutation does not report work scope or code implementation.", false},
}

type Service struct {
	errorOutput     map[string]any
	db              *gorm.DB
	ingest          *ingest.Service
	specs           map[string]toolSpec
	inputs, outputs map[string]*jsonschema.Schema
	cursorKey       [32]byte
}

func New(db *gorm.DB, commandService *ingest.Service) (*Service, error) {
	s := &Service{db: db, ingest: commandService, specs: map[string]toolSpec{}, inputs: map[string]*jsonschema.Schema{}, outputs: map[string]*jsonschema.Schema{}}
	if _, err := rand.Read(s.cursorKey[:]); err != nil {
		return nil, err
	}
	var documents map[string]json.RawMessage
	if err := json.Unmarshal(schemasJSON, &documents); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(documents["error"], &s.errorOutput); err != nil {
		return nil, err
	}
	for _, def := range definitions {
		var spec toolSpec
		if err := json.Unmarshal(documents[def.Name], &spec); err != nil {
			return nil, err
		}
		s.specs[def.Name] = spec
		for name, document := range map[string]map[string]any{"input": spec.Input, "output": spec.Output} {
			compiler := jsonschema.NewCompiler()
			compiler.AssertFormat()
			url := "https://visualise.invalid/" + def.Name + "/" + name
			if err := compiler.AddResource(url, document); err != nil {
				return nil, err
			}
			schema, err := compiler.Compile(url)
			if err != nil {
				return nil, err
			}
			if name == "input" {
				s.inputs[def.Name] = schema
			} else {
				s.outputs[def.Name] = schema
			}
		}
	}
	return s, nil
}
func Names() []string {
	names := make([]string, 0, len(definitions))
	for _, def := range definitions {
		names = append(names, def.Name)
	}
	return names
}
func (s *Service) Register(server *mcp.Server) error {
	for _, def := range definitions {
		spec := s.specs[def.Name]
		closed, destructive := false, def.Name == "visualise_model_mutate"
		output := map[string]any{"type": "object", "anyOf": []any{spec.Output, s.errorOutput}}
		server.AddTool(&mcp.Tool{Name: def.Name, Description: def.Description, InputSchema: spec.Input, OutputSchema: output, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: def.ReadOnly, IdempotentHint: true, DestructiveHint: &destructive, OpenWorldHint: &closed}}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return s.call(ctx, def.Name, req.Params.Arguments), nil
		})
	}
	return nil
}
func (s *Service) call(ctx context.Context, name string, raw json.RawMessage) *mcp.CallToolResult {
	if err := ctx.Err(); err != nil {
		return errorResult(err)
	}
	if len(raw) > MaxResponseBytes {
		return errorResult(domain("invalid_input", "", "request exceeds 1 MiB"))
	}
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var args map[string]any
	if err := decoder.Decode(&args); err != nil {
		return errorResult(domain("invalid_input", "", "arguments must be a JSON object"))
	}
	if version, ok := args["contractVersion"]; ok && version != "2.0.0" {
		return errorResult(domain("unsupported_contract_version", "/contractVersion", "supported contractVersion is 2.0.0"))
	}
	if err := s.inputs[name].Validate(args); err != nil {
		return errorResult(err)
	}
	var result any
	var err error
	if s.specs[name].EventType != "" {
		result, err = s.write(ctx, name, raw)
	} else {
		result, err = s.read(ctx, name, args)
	}
	if err != nil {
		return errorResult(err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return errorResult(err)
	}
	if len(encoded) > MaxResponseBytes {
		return errorResult(domain("response_too_large", "", "structured result exceeds 1 MiB"))
	}
	var value any
	decoder = json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	if err = decoder.Decode(&value); err != nil {
		return errorResult(err)
	}
	if err = s.outputs[name].Validate(value); err != nil {
		return errorResult(domain("internal_error", "", "result does not match the published contract"))
	}
	return &mcp.CallToolResult{StructuredContent: json.RawMessage(encoded), Content: []mcp.Content{&mcp.TextContent{Text: string(encoded)}}}
}
func (s *Service) write(ctx context.Context, name string, raw []byte) (store.Result, error) {
	var args map[string]json.RawMessage
	if err := json.Unmarshal(raw, &args); err != nil {
		return store.Result{}, err
	}
	env := map[string]json.RawMessage{"schemaVersion": json.RawMessage(`"2.0"`)}
	for _, key := range []string{"projectId", "runId", "agentId", "parentAgentId", "clientEventId", "occurredAt"} {
		env[key] = args[key]
		delete(args, key)
	}
	delete(args, "contractVersion")
	eventType, _ := json.Marshal(s.specs[name].EventType)
	env["type"] = eventType
	payload, err := json.Marshal(args)
	if err != nil {
		return store.Result{}, err
	}
	env["payload"] = payload
	body, err := json.Marshal(env)
	if err != nil {
		return store.Result{}, err
	}
	return s.ingest.Submit(ctx, body)
}
func domain(code, pointer, message string) *store.DomainError {
	return &store.DomainError{Code: code, Field: pointer, Detail: message}
}

type field struct {
	Pointer string `json:"pointer"`
	Message string `json:"message"`
}
type failure struct {
	Code                    string  `json:"code"`
	Message                 string  `json:"message"`
	Fields                  []field `json:"fields"`
	CurrentModelRevision    *int64  `json:"currentModelRevision,omitempty"`
	ExistingProjectPosition *int64  `json:"existingProjectPosition,omitempty"`
}

func errorResult(err error) *mcp.CallToolResult {
	data := failure{Code: "internal_error", Message: "The operation could not be completed.", Fields: []field{}}
	var d *store.DomainError
	var life *ingest.LifecycleError
	var validation *ingest.ValidationError
	var schema *jsonschema.ValidationError
	var conflict *store.ClientEventIDConflictError
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		data.Code = "cancelled"
		data.Message = "The request was cancelled. Retry an uncertain write using the same input and key."
	case errors.As(err, &d):
		data.Code = d.Code
		data.Message = d.Detail
		data.CurrentModelRevision = d.CurrentModelRevision
		data.Fields = append(data.Fields, field{mcpPointer(d.Field), d.Detail})
	case errors.As(err, &life):
		data.Code = life.Code
		data.Message = life.Detail
	case errors.As(err, &conflict):
		data.Code = "client_event_id_conflict"
		data.Message = "This clientEventId was accepted with different input; use the original input or a new key."
		data.ExistingProjectPosition = &conflict.ExistingPosition
		data.Fields = append(data.Fields, field{"/clientEventId", data.Message})
	case errors.As(err, &validation):
		data.Code = "invalid_input"
		data.Message = "Correct the reported input fields."
		for _, f := range validation.Fields {
			data.Fields = append(data.Fields, field{mcpPointer(f.Field), f.Message})
		}
	case errors.As(err, &schema):
		data.Code = "invalid_input"
		data.Message = "Correct the reported input fields."
		var visit func(*jsonschema.ValidationError)
		visit = func(e *jsonschema.ValidationError) {
			if len(data.Fields) >= 100 {
				return
			}
			if len(e.Causes) > 0 {
				for _, cause := range e.Causes {
					visit(cause)
				}
				return
			}
			parts := make([]string, len(e.InstanceLocation))
			for i, p := range e.InstanceLocation {
				parts[i] = strings.ReplaceAll(strings.ReplaceAll(p, "~", "~0"), "/", "~1")
			}
			pointer := ""
			if len(parts) > 0 {
				pointer = "/" + strings.Join(parts, "/")
			}
			data.Fields = append(data.Fields, field{pointer, e.Error()})
		}
		visit(schema)
	case errors.Is(err, readapi.ErrProjectNotFound):
		data.Code = "project_not_found"
		data.Message = "The project does not exist."
	case errors.Is(err, readapi.ErrRunNotFound):
		data.Code = "run_not_found"
		data.Message = "The requested run does not exist."
	}
	if len(data.Fields) > 100 {
		data.Fields = data.Fields[:100]
	}
	data.Message = truncate(data.Message, 2000)
	for i := range data.Fields {
		data.Fields[i].Message = truncate(data.Fields[i].Message, 1000)
		data.Fields[i].Pointer = truncate(data.Fields[i].Pointer, 2048)
	}
	raw, _ := json.Marshal(data)
	return &mcp.CallToolResult{IsError: true, StructuredContent: json.RawMessage(raw), Content: []mcp.Content{&mcp.TextContent{Text: string(raw)}}}
}
func mcpPointer(p string) string { return strings.TrimPrefix(p, "/payload") }
func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}
func integer(v any) int64 {
	n := fmt.Sprint(v)
	var p store.ModelMutationPayload
	_ = json.Unmarshal([]byte(`{"expectedModelRevision":`+n+`,"operations":[]}`), &p)
	return p.ExpectedModelRevision
}
