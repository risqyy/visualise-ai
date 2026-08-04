package ingest

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Problem is an RFC 9457 error document.
//
// One struct covers both response schemas of the contract: `errors` is omitted
// for a plain Problem and populated for a ValidationProblem, which the contract
// defines as a Problem plus that array.
type Problem struct {
	Type     string       `json:"type"`
	Title    string       `json:"title"`
	Status   int          `json:"status"`
	Detail   string       `json:"detail"`
	Code     string       `json:"code"`
	Instance string       `json:"instance,omitempty"`
	Errors   []FieldError `json:"errors,omitempty"`
}

// problemContentType is the media type RFC 9457 prescribes.
const problemContentType = "application/problem+json"

// problemTypePrefix namespaces the problem type URIs of this service.
const problemTypePrefix = "https://visualise-ai.local/problems/"

// Stable, machine-readable error codes. These are the values clients branch on;
// the contract lists them next to the responses that carry them.
const (
	CodeInvalidField             = "invalid_field"
	CodeUnsupportedEventType     = "unsupported_event_type"
	CodeUnsupportedSchemaVersion = "unsupported_schema_version"
	CodeClientEventIDConflict    = "client_event_id_conflict"
	CodeEventTooLarge            = "event_too_large"
	CodeUnsupportedMediaType     = "unsupported_media_type"
	CodeUnknownAgent             = "unknown_agent"
	CodeRunAlreadyFinished       = "run_already_finished"
	CodeRunNotStarted            = "run_not_started"
	CodeParentAgentUnknown       = "parent_agent_unknown"
	CodeTerminalEventNotAllowed  = "terminal_event_not_allowed"
	CodeCorrectionTargetUnknown  = "correction_target_unknown"
	CodeInternalError            = "internal_error"

	// CodeRunAlreadyStarted is the counterpart of run_not_started: a root
	// agent.started for a run that another root agent.started already opened.
	// The contract names no code for it — its 422 list covers the opposite
	// direction only — so this one is added rather than misusing an existing
	// code for a different situation. `code` is an open string in the contract,
	// so adding a value does not break it.
	CodeRunAlreadyStarted = "run_already_started"
)

// problemTitles maps a code to the short human-readable summary of its problem
// type. A code without an entry is a programming error, not a client error, so
// the fallback stays generic rather than inventing a title.
var problemTitles = map[string]string{
	CodeInvalidField:             "Invalid field",
	CodeUnsupportedEventType:     "Unsupported event type",
	CodeUnsupportedSchemaVersion: "Unsupported schema version",
	CodeClientEventIDConflict:    "Client event id conflict",
	CodeEventTooLarge:            "Event too large",
	CodeUnsupportedMediaType:     "Unsupported media type",
	CodeUnknownAgent:             "Unknown agent",
	CodeRunAlreadyFinished:       "Run already finished",
	CodeRunNotStarted:            "Run not started",
	CodeRunAlreadyStarted:        "Run already started",
	CodeParentAgentUnknown:       "Parent agent unknown",
	CodeTerminalEventNotAllowed:  "Terminal event not allowed",
	CodeCorrectionTargetUnknown:  "Correction target unknown",
	CodeInternalError:            "Internal server error",
}

// newProblem assembles the RFC 9457 document for one rejection.
func newProblem(status int, code, detail string) Problem {
	title, ok := problemTitles[code]
	if !ok {
		title = http.StatusText(status)
	}
	return Problem{
		Type:   problemTypePrefix + strings.ReplaceAll(code, "_", "-"),
		Title:  title,
		Status: status,
		Detail: detail,
		Code:   code,
	}
}

// writeProblem answers the request with a problem document and stops the chain.
func writeProblem(c *gin.Context, status int, code, detail string) {
	respond(c, status, newProblem(status, code, detail))
}

// writeValidationProblem answers with a problem document carrying field errors.
//
// The contract requires `errors` to hold at least one entry, so a caller that
// found no specific violation still gets one describing the body as a whole.
func writeValidationProblem(c *gin.Context, status int, code, detail string, errs []FieldError) {
	problem := newProblem(status, code, detail)
	if len(errs) == 0 {
		errs = []FieldError{{Field: rootPointer, Code: CodeInvalidField, Message: detail}}
	}
	problem.Errors = errs
	respond(c, status, problem)
}

func respond(c *gin.Context, status int, problem Problem) {
	problem.Instance = c.Request.URL.Path
	c.Abort()
	c.Header("Content-Type", problemContentType)
	c.JSON(status, problem)
}
