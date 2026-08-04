package ingest

import (
	"bytes"
	"encoding/json"
	"sync"
	"testing"
)

var (
	sharedContractOnce sync.Once
	sharedContract     *Contract
	sharedContractErr  error
)

// testContract compiles the embedded contract once for the whole package.
func testContract(t *testing.T) *Contract {
	t.Helper()
	sharedContractOnce.Do(func() { sharedContract, sharedContractErr = LoadContract() })
	if sharedContractErr != nil {
		t.Fatalf("loading the event contract: %v", sharedContractErr)
	}
	return sharedContract
}

// decode parses a test document the way the handler does.
func decode(t *testing.T, body string) any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader([]byte(body)))
	decoder.UseNumber()
	var document any
	if err := decoder.Decode(&document); err != nil {
		t.Fatalf("decoding the test document: %v", err)
	}
	return document
}

// violation looks up one expected field error by its JSON Pointer.
func violation(errs []FieldError, field string) (FieldError, bool) {
	for _, err := range errs {
		if err.Field == field {
			return err, true
		}
	}
	return FieldError{}, false
}

func TestValidateAcceptsARootAgentStarted(t *testing.T) {
	document := decode(t, `{
		"schemaVersion": "1.0",
		"clientEventId": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
		"projectId": "visualise-ai",
		"runId": "run-2026-08-04-0001",
		"agentId": "orchestrator-root",
		"parentAgentId": null,
		"occurredAt": "2026-08-04T09:12:00Z",
		"type": "agent.started",
		"payload": {
			"role": "orchestrator",
			"displayName": "Root Orchestrator",
			"assignedTask": "Deliver the v0 agent project cockpit."
		}
	}`)

	if errs := testContract(t).Validate("agent.started", document); len(errs) > 0 {
		t.Fatalf("a contract-conformant event must validate, got %+v", errs)
	}
}

// TestValidateReportsEveryViolationWithItsPointer is the core of the field
// error contract: one response has to describe every mistake, each located by
// an RFC 6901 pointer, not just the first one the validator tripped over.
func TestValidateReportsEveryViolationWithItsPointer(t *testing.T) {
	document := decode(t, `{
		"schemaVersion": "1.0",
		"clientEventId": "not-a-uuid",
		"projectId": "Visualise-AI",
		"runId": "run-2026-08-04-0001",
		"agentId": "subagent-one",
		"parentAgentId": "orchestrator-root",
		"occurredAt": "yesterday",
		"type": "agent.progress_reported",
		"smuggled": true,
		"payload": {
			"percent": 140,
			"scope": "guesswork",
			"rawTerminalOutput": "$ npm test"
		}
	}`)

	errs := testContract(t).Validate("agent.progress_reported", document)

	want := map[string]string{
		"/clientEventId":             CodeInvalidFormat,
		"/projectId":                 CodePatternMismatch,
		"/occurredAt":                CodeInvalidFormat,
		"/smuggled":                  CodeUnknownProperty,
		"/payload/percent":           CodeOutOfRange,
		"/payload/scope":             CodeInvalidEnum,
		"/payload/basis":             CodeRequired,
		"/payload/rawTerminalOutput": CodeUnknownProperty,
	}
	for field, code := range want {
		found, ok := violation(errs, field)
		if !ok {
			t.Errorf("no violation reported for %s, got %+v", field, errs)
			continue
		}
		if found.Code != code {
			t.Errorf("%s: want code %q, got %q", field, code, found.Code)
		}
		if found.Message == "" {
			t.Errorf("%s: the violation carries no message", field)
		}
	}
	if len(errs) != len(want) {
		t.Errorf("want %d violations, got %d: %+v", len(want), len(errs), errs)
	}
}

func TestValidateRejectsAnAbsoluteDiffPath(t *testing.T) {
	document := decode(t, `{
		"schemaVersion": "1.0",
		"clientEventId": "6b6e9b6a-4f5f-4a1f-9b7d-2f0f2a5b1c04",
		"projectId": "demo-shop",
		"runId": "run-2026-08-04-a",
		"agentId": "subagent-checkout",
		"parentAgentId": "orchestrator-root",
		"occurredAt": "2026-08-04T09:00:00Z",
		"type": "diff.reported",
		"payload": {
			"diffId": "diff-0001",
			"componentIds": ["checkout-service"],
			"filePath": "/etc/passwd",
			"unifiedDiff": "--- a\n+++ b\n"
		}
	}`)

	errs := testContract(t).Validate("diff.reported", document)
	found, ok := violation(errs, "/payload/filePath")
	if !ok {
		t.Fatalf("an absolute file path must be rejected, got %+v", errs)
	}
	if found.Code != CodePatternMismatch {
		t.Fatalf("want %q, got %q", CodePatternMismatch, found.Code)
	}
}

// TestValidateRejectsAMistypedNullableField covers the oneOf collapse: a
// nullable field that is neither the declared type nor null is one violation,
// not one per rejected branch.
func TestValidateRejectsAMistypedNullableField(t *testing.T) {
	document := decode(t, `{
		"schemaVersion": "1.0",
		"clientEventId": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
		"projectId": "visualise-ai",
		"runId": "run-2026-08-04-0001",
		"agentId": "subagent-one",
		"parentAgentId": 7,
		"occurredAt": "2026-08-04T09:12:00Z",
		"type": "agent.status_reported",
		"payload": {"status": "working"}
	}`)

	errs := testContract(t).Validate("agent.status_reported", document)
	if len(errs) != 1 {
		t.Fatalf("want exactly one violation, got %+v", errs)
	}
	if errs[0].Field != "/parentAgentId" || errs[0].Code != CodeInvalidType {
		t.Fatalf("want /parentAgentId invalid_type, got %+v", errs[0])
	}
}

// TestValidateChecksNestedPayloadObjects proves the pointers stay correct
// inside arrays and nested descriptors, where a flat error list would be
// useless.
func TestValidateChecksNestedPayloadObjects(t *testing.T) {
	document := decode(t, `{
		"schemaVersion": "1.0",
		"clientEventId": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
		"projectId": "visualise-ai",
		"runId": "run-2026-08-04-0001",
		"agentId": "orchestrator-root",
		"occurredAt": "2026-08-04T09:12:00Z",
		"type": "plan.published",
		"payload": {
			"planId": "plan-1",
			"revision": 0,
			"steps": [
				{"stepId": "s1", "order": 0, "title": "Fine", "state": "pending"},
				{"stepId": "s2", "order": -1, "title": "Broken", "state": "half-done"}
			]
		}
	}`)

	errs := testContract(t).Validate("plan.published", document)
	for _, field := range []string{"/payload/revision", "/payload/steps/1/order", "/payload/steps/1/state"} {
		if _, ok := violation(errs, field); !ok {
			t.Errorf("no violation reported for %s, got %+v", field, errs)
		}
	}
}

func TestPointerAtSyntaxError(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"empty body", ``, rootPointer},
		{"garbage at the start", `not json`, rootPointer},
		{"broken top level member", `{"projectId": }`, "/projectId"},
		{"broken nested member", `{"payload": {"percent": tru}}`, "/payload/percent"},
		{"broken array element", `{"payload": {"componentIds": ["a", ]}}`, "/payload/componentIds/1"},
		{"unterminated object", `{"payload": {"percent": 5`, "/payload"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pointerAtSyntaxError([]byte(tc.body)); got != tc.want {
				t.Fatalf("want %q, got %q", tc.want, got)
			}
		})
	}
}

func TestEscapePointerSegment(t *testing.T) {
	if got := escapePointerSegment("a/b~c"); got != "a~1b~0c" {
		t.Fatalf("want RFC 6901 escaping, got %q", got)
	}
}

func TestIsWorkEvent(t *testing.T) {
	if isWorkEvent("correction.issued") || isWorkEvent("retraction.issued") {
		t.Error("corrections and retractions must stay accepted by a finished run")
	}
	for _, eventType := range []string{"agent.started", "work.step_started", "run.finished"} {
		if !isWorkEvent(eventType) {
			t.Errorf("%s must count as a work event", eventType)
		}
	}
}
