package ingest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/risqyy/visualise-ai/backend/internal/store"
	"gorm.io/gorm"
)

// ValidationError preserves all actionable schema errors for non-HTTP adapters.
type ValidationError struct{ Fields []FieldError }

func (e *ValidationError) Error() string {
	return fmt.Sprintf("invalid_input: %d contract violation(s)", len(e.Fields))
}

// Service is the transport-independent ingestion entry point. MCP maps its
// versioned input into the same REST envelope and submits it here.
type Service struct{ handler *Handler }

func NewService(opts HandlerOptions) (*Service, error) {
	h, err := NewHandler(opts)
	if err != nil {
		return nil, err
	}
	return &Service{handler: h}, nil
}
func (s *Service) Submit(ctx context.Context, body []byte) (store.Result, error) {
	h := s.handler
	if int64(len(body)) > h.maxBytes || len(body) > 1048576 {
		return store.Result{}, &store.DomainError{Code: "invalid_input", Detail: "request exceeds the byte limit", Field: ""}
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var document map[string]any
	if err := decoder.Decode(&document); err != nil {
		return store.Result{}, &ValidationError{[]FieldError{{Field: "", Code: CodeInvalidJSON, Message: err.Error()}}}
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return store.Result{}, &ValidationError{[]FieldError{{Field: "", Code: CodeInvalidJSON, Message: "exactly one JSON document is required"}}}
	}
	kind, _ := document["type"].(string)
	if violations := h.contract.Validate(kind, document); len(violations) > 0 {
		return store.Result{}, &ValidationError{violations}
	}
	var raw rawEnvelope
	if err := json.Unmarshal(body, &raw); err != nil {
		return store.Result{}, err
	}
	timestamp, err := time.Parse(time.RFC3339Nano, raw.OccurredAt)
	if err != nil {
		return store.Result{}, err
	}
	env := store.Envelope{ProjectID: raw.ProjectID, RunID: raw.RunID, AgentID: raw.AgentID, ParentAgentID: raw.ParentAgentID, ClientEventID: raw.ClientEventID, Type: raw.Type, SchemaVersion: raw.SchemaVersion, OccurredAt: timestamp, OccurredAtText: raw.OccurredAt, Payload: raw.Payload}
	return h.submit(ctx, env)
}
func (h *Handler) submit(ctx context.Context, env store.Envelope) (store.Result, error) {
	effective, err := store.EffectiveWork(env)
	if err != nil {
		return store.Result{}, err
	}
	role, target, err := payloadFacts(effective.Type, effective.Payload)
	if err != nil {
		return store.Result{}, err
	}
	ev := acceptedEvent{envelope: effective, role: role, correctionTarget: target}
	result, err := h.store.AppendGuarded(ctx, env, func(tx *gorm.DB, _ store.Envelope) error {
		if err := checkLifecycle(tx, ev); err != nil {
			return err
		}
		return store.ValidateWork(tx, env)
	})
	if err == nil && !result.Duplicate {
		h.publisher.Publish(ctx, committedEvent(env, result))
	}
	return result, err
}
