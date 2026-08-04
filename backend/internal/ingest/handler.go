package ingest

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
	"gorm.io/gorm"

	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// EventsPath is the ingestion route, relative to the versioned API prefix.
const EventsPath = "/events"

// expectedMediaType is the only request media type the contract defines.
const expectedMediaType = "application/json"

// EventAccepted acknowledges an ingested event. It matches the EventAccepted
// schema of the contract field for field.
type EventAccepted struct {
	ProjectID     string    `json:"projectId"`
	Position      int64     `json:"position"`
	ServerEventID string    `json:"serverEventId"`
	ClientEventID string    `json:"clientEventId"`
	Duplicate     bool      `json:"duplicate"`
	ReceivedAt    time.Time `json:"receivedAt"`
}

// HandlerOptions carries the collaborators of the ingestion handler.
type HandlerOptions struct {
	// Store appends accepted events. Required.
	Store *store.Store
	// Contract is the compiled event contract. Loaded from the embedded
	// document when nil.
	Contract *Contract
	// Publisher is notified after a commit. A nil publisher discards events.
	Publisher Publisher
	// MaxEventBytes bounds the request body, MAX_EVENT_BYTES in the config.
	MaxEventBytes int64
	// Logger records the failures a client cannot act on.
	Logger zerolog.Logger
}

// Handler serves POST /api/v1/events.
type Handler struct {
	store     *store.Store
	contract  *Contract
	publisher Publisher
	maxBytes  int64
	logger    zerolog.Logger
}

// NewHandler compiles the contract and returns the ingestion handler.
func NewHandler(opts HandlerOptions) (*Handler, error) {
	if opts.Store == nil {
		return nil, fmt.Errorf("ingest: a store is required")
	}
	if opts.MaxEventBytes <= 0 {
		return nil, fmt.Errorf("ingest: MaxEventBytes must be positive, got %d", opts.MaxEventBytes)
	}

	contract := opts.Contract
	if contract == nil {
		loaded, err := LoadContract()
		if err != nil {
			return nil, err
		}
		contract = loaded
	}

	publisher := opts.Publisher
	if publisher == nil {
		publisher = NopPublisher{}
	}

	return &Handler{
		store:     opts.Store,
		contract:  contract,
		publisher: publisher,
		maxBytes:  opts.MaxEventBytes,
		logger:    opts.Logger,
	}, nil
}

// acceptedEvent is a contract-valid event on its way into the store, together
// with the two payload facts the lifecycle rules need.
type acceptedEvent struct {
	envelope store.Envelope
	// role is the reported role of an agent.started; empty for every other
	// event type.
	role string
	// correctionTarget is the clientEventId a correction or retraction refers
	// to; empty for every other event type.
	correctionTarget string
}

// Ingest accepts exactly one event.
//
// The checks run in the order the status codes depend on, from the cheapest and
// most general to the most specific:
//
//	415  the media type is not application/json
//	413  the body exceeds MAX_EVENT_BYTES
//	400  the body is not well-formed JSON
//	400  the event type is outside the closed catalogue
//	400  the payload schema version is not accepted
//	400  envelope or payload violate the contract, all violations reported
//	422  the event contradicts the current state of the project
//	409  the clientEventId was reused with different content
//	200  an idempotent retry, answered with the original position
//	201  the event was appended
//
// The last four are decided by the store, inside the transaction that appends
// the event, so a rejected event occupies no position and changes no
// projection.
func (h *Handler) Ingest(c *gin.Context) {
	if !h.checkMediaType(c) {
		return
	}
	body, ok := h.readBody(c)
	if !ok {
		return
	}
	document, ok := h.decodeBody(c, body)
	if !ok {
		return
	}
	eventType, ok := h.eventType(c, document)
	if !ok {
		return
	}
	if !h.checkSchemaVersion(c, document) {
		return
	}
	if violations := h.contract.Validate(eventType, document); len(violations) > 0 {
		writeValidationProblem(c, http.StatusBadRequest, CodeInvalidField,
			fmt.Sprintf("the %s event violates the contract in %d place(s).", eventType, len(violations)),
			violations)
		return
	}

	event, ok := h.buildEvent(c, body)
	if !ok {
		return
	}
	h.append(c, event)
}

// checkMediaType rejects everything but application/json. Parameters such as a
// charset are allowed; only the media type itself is checked.
func (h *Handler) checkMediaType(c *gin.Context) bool {
	header := c.GetHeader("Content-Type")
	if header == "" {
		writeProblem(c, http.StatusUnsupportedMediaType, CodeUnsupportedMediaType,
			"Expected application/json but the request carries no Content-Type.")
		return false
	}
	mediaType, _, err := mime.ParseMediaType(header)
	if err != nil || mediaType != expectedMediaType {
		writeProblem(c, http.StatusUnsupportedMediaType, CodeUnsupportedMediaType,
			fmt.Sprintf("Expected %s but received %s.", expectedMediaType, header))
		return false
	}
	return true
}

// readBody reads the request body under the configured size limit.
//
// The limit is enforced by http.MaxBytesReader rather than by measuring
// afterwards, so an oversized body is refused while it is being read instead of
// being buffered in full first.
func (h *Handler) readBody(c *gin.Context) ([]byte, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.maxBytes)

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeProblem(c, http.StatusRequestEntityTooLarge, CodeEventTooLarge,
				fmt.Sprintf("The event body exceeds the configured limit of %d bytes.", h.maxBytes))
			return nil, false
		}
		writeValidationProblem(c, http.StatusBadRequest, CodeInvalidField,
			"The request body could not be read.", []FieldError{{
				Field:   rootPointer,
				Code:    CodeInvalidJSON,
				Message: err.Error(),
			}})
		return nil, false
	}
	return body, true
}

// decodeBody parses the body into a generic document.
//
// Numbers are kept as written: routing an integer through float64 would let a
// value outside the contract's range slip through as a rounded one.
func (h *Handler) decodeBody(c *gin.Context, body []byte) (map[string]any, bool) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()

	var document any
	if err := decoder.Decode(&document); err != nil {
		writeValidationProblem(c, http.StatusBadRequest, CodeInvalidField,
			"The request body is not well-formed JSON.", []FieldError{{
				Field:   pointerAtSyntaxError(body),
				Code:    CodeInvalidJSON,
				Message: err.Error(),
			}})
		return nil, false
	}
	if decoder.More() {
		writeValidationProblem(c, http.StatusBadRequest, CodeInvalidField,
			"The request body carries more than one JSON document.", []FieldError{{
				Field:   rootPointer,
				Code:    CodeInvalidJSON,
				Message: "exactly one event is accepted per request",
			}})
		return nil, false
	}

	object, ok := document.(map[string]any)
	if !ok {
		writeValidationProblem(c, http.StatusBadRequest, CodeInvalidField,
			"The request body must be one event object.", []FieldError{{
				Field:   rootPointer,
				Code:    CodeInvalidType,
				Message: "got a non-object JSON value, want an event envelope",
			}})
		return nil, false
	}
	return object, true
}

// eventType reads and checks the discriminator of the request body.
func (h *Handler) eventType(c *gin.Context, document map[string]any) (string, bool) {
	raw, present := document["type"]
	if !present {
		writeValidationProblem(c, http.StatusBadRequest, CodeInvalidField,
			"The event carries no type.", []FieldError{{
				Field:   "/type",
				Code:    CodeRequired,
				Message: "required property \"type\" is missing",
			}})
		return "", false
	}
	eventType, ok := raw.(string)
	if !ok {
		writeValidationProblem(c, http.StatusBadRequest, CodeInvalidField,
			"The event type must be a string.", []FieldError{{
				Field:   "/type",
				Code:    CodeInvalidType,
				Message: "want a string naming one of the v0 event types",
			}})
		return "", false
	}
	if !h.contract.KnowsEventType(eventType) {
		writeValidationProblem(c, http.StatusBadRequest, CodeUnsupportedEventType,
			fmt.Sprintf("Event type %q is not part of the closed v0 catalogue.", eventType),
			[]FieldError{{
				Field:   "/type",
				Code:    CodeInvalidEnum,
				Message: fmt.Sprintf("value must be one of %v", h.contract.EventTypes()),
			}})
		return "", false
	}
	return eventType, true
}

// checkSchemaVersion rejects a payload schema version v0 does not implement.
//
// A missing or non-string value is left to the full contract validation, which
// reports it as a field violation together with everything else that is wrong.
func (h *Handler) checkSchemaVersion(c *gin.Context, document map[string]any) bool {
	version, ok := document["schemaVersion"].(string)
	if !ok || h.contract.AcceptsSchemaVersion(version) {
		return true
	}
	writeValidationProblem(c, http.StatusBadRequest, CodeUnsupportedSchemaVersion,
		fmt.Sprintf("Payload schema version %q is not accepted by v0.", version),
		[]FieldError{{
			Field:   "/schemaVersion",
			Code:    CodeInvalidEnum,
			Message: fmt.Sprintf("value must be one of %v", h.contract.SchemaVersions()),
		}})
	return false
}

// rawEnvelope is the contract envelope with the payload left untouched, so the
// document the agent reported is stored as reported.
type rawEnvelope struct {
	SchemaVersion string          `json:"schemaVersion"`
	ClientEventID string          `json:"clientEventId"`
	ProjectID     string          `json:"projectId"`
	RunID         string          `json:"runId"`
	AgentID       string          `json:"agentId"`
	ParentAgentID *string         `json:"parentAgentId"`
	OccurredAt    string          `json:"occurredAt"`
	Type          string          `json:"type"`
	Payload       json.RawMessage `json:"payload"`
}

// buildEvent turns a validated body into the envelope the store appends.
func (h *Handler) buildEvent(c *gin.Context, body []byte) (acceptedEvent, bool) {
	var envelope rawEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		// The contract validation already accepted this document, so a failure
		// here is a defect in this service, not in the request.
		h.fail(c, err, "decoding an already validated event")
		return acceptedEvent{}, false
	}

	occurredAt, err := time.Parse(time.RFC3339, envelope.OccurredAt)
	if err != nil {
		writeValidationProblem(c, http.StatusBadRequest, CodeInvalidField,
			"The reported timestamp could not be read.", []FieldError{{
				Field:   "/occurredAt",
				Code:    CodeInvalidFormat,
				Message: err.Error(),
			}})
		return acceptedEvent{}, false
	}

	role, correctionTarget, err := payloadFacts(envelope.Type, envelope.Payload)
	if err != nil {
		h.fail(c, err, "reading the payload of an already validated event")
		return acceptedEvent{}, false
	}

	return acceptedEvent{
		envelope: store.Envelope{
			ProjectID:     envelope.ProjectID,
			ClientEventID: envelope.ClientEventID,
			RunID:         envelope.RunID,
			AgentID:       envelope.AgentID,
			ParentAgentID: envelope.ParentAgentID,
			Type:          envelope.Type,
			SchemaVersion: envelope.SchemaVersion,
			OccurredAt:    occurredAt.UTC(),
			Payload:       envelope.Payload,
		},
		role:             role,
		correctionTarget: correctionTarget,
	}, true
}

// payloadFacts extracts the two payload fields the lifecycle rules depend on.
func payloadFacts(eventType string, payload json.RawMessage) (role, correctionTarget string, err error) {
	switch eventType {
	case store.TypeAgentStarted:
		var p struct {
			Role string `json:"role"`
		}
		if err := json.Unmarshal(payload, &p); err != nil {
			return "", "", err
		}
		return p.Role, "", nil

	case store.TypeCorrectionIssued:
		var p struct {
			Target string `json:"correctsClientEventId"`
		}
		if err := json.Unmarshal(payload, &p); err != nil {
			return "", "", err
		}
		return "", p.Target, nil

	case store.TypeRetractionIssued:
		var p struct {
			Target string `json:"retractsClientEventId"`
		}
		if err := json.Unmarshal(payload, &p); err != nil {
			return "", "", err
		}
		return "", p.Target, nil

	default:
		return "", "", nil
	}
}

// append hands the event to the store and answers with the outcome.
func (h *Handler) append(c *gin.Context, event acceptedEvent) {
	ctx := c.Request.Context()

	result, err := h.store.AppendGuarded(ctx, event.envelope, func(tx *gorm.DB, env store.Envelope) error {
		return checkLifecycle(tx, event)
	})
	if err != nil {
		h.writeAppendError(c, event, err)
		return
	}

	status := http.StatusCreated
	if result.Duplicate {
		status = http.StatusOK
	} else {
		// After the commit and never before: an event reaches a subscriber only
		// once it is durably part of the log at this exact position.
		h.publisher.Publish(ctx, committedEvent(event.envelope, result))
	}

	c.JSON(status, EventAccepted{
		ProjectID:     result.ProjectID,
		Position:      result.Position,
		ServerEventID: result.ServerEventID,
		ClientEventID: result.ClientEventID,
		Duplicate:     result.Duplicate,
		ReceivedAt:    result.ReceivedAt.UTC(),
	})
}

// writeAppendError maps a store failure onto its status code.
func (h *Handler) writeAppendError(c *gin.Context, event acceptedEvent, err error) {
	var lifecycle *LifecycleError
	if errors.As(err, &lifecycle) {
		writeProblem(c, http.StatusUnprocessableEntity, lifecycle.Code, lifecycle.Detail)
		return
	}

	var conflict *store.ClientEventIDConflictError
	if errors.As(err, &conflict) {
		writeProblem(c, http.StatusConflict, CodeClientEventIDConflict, fmt.Sprintf(
			"clientEventId %q was already accepted at position %d of project %q with different content.",
			conflict.ClientEventID, conflict.ExistingPosition, conflict.ProjectID))
		return
	}

	h.fail(c, err, "appending event "+event.envelope.Type)
}

// fail answers with 500 and logs the cause. The client learns that the event
// was not stored, not why — the reason is an operational detail.
func (h *Handler) fail(c *gin.Context, err error, what string) {
	h.logger.Error().Err(err).Str("stage", what).Msg("event ingestion failed")
	writeProblem(c, http.StatusInternalServerError, CodeInternalError,
		"The event could not be stored.")
}

// committedEvent assembles what the publisher receives.
func committedEvent(env store.Envelope, result store.Result) CommittedEvent {
	return CommittedEvent{
		SchemaVersion: env.SchemaVersion,
		ClientEventID: env.ClientEventID,
		ProjectID:     env.ProjectID,
		RunID:         env.RunID,
		AgentID:       env.AgentID,
		ParentAgentID: env.ParentAgentID,
		OccurredAt:    env.OccurredAt.UTC(),
		Type:          env.Type,
		Payload:       env.Payload,
		Position:      result.Position,
		ServerEventID: result.ServerEventID,
		ReceivedAt:    result.ReceivedAt.UTC(),
	}
}
