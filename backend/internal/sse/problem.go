package sse

import "github.com/gin-gonic/gin"

// problemContentType is the media type RFC 9457 prescribes.
const problemContentType = "application/problem+json"

// problemTypePrefix namespaces the problem type URIs of this service.
const problemTypePrefix = "https://visualise-ai.local/problems/"

// Stable, machine-readable error codes of the stream endpoint. The first two
// are the vocabulary the read models already use for the same situations, so a
// client branches on one set of codes across the whole project scope.
const (
	CodeProjectNotFound       = "project_not_found"
	CodeInvalidQueryParameter = "invalid_query_parameter"
	CodeInternalError         = "internal_error"
)

// fieldError is one rejected query parameter.
type fieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// problem is an RFC 9457 error document. `errors` is omitted for a plain
// problem and populated for a validation problem, exactly as the contract
// defines the two schemas.
type problem struct {
	Type   string       `json:"type"`
	Title  string       `json:"title"`
	Status int          `json:"status"`
	Detail string       `json:"detail"`
	Code   string       `json:"code"`
	Errors []fieldError `json:"errors,omitempty"`
}

// writeProblem answers the request with a problem document and stops the chain.
//
// It is only ever called before the first byte of the stream is written: once
// the 200 and the event-stream media type are on the wire there is no status
// code left to report a failure with, and the connection is closed instead.
func writeProblem(c *gin.Context, status int, code, title, detail string, errs ...fieldError) {
	c.Abort()
	c.Header("Content-Type", problemContentType)
	c.JSON(status, problem{
		Type:   problemTypePrefix + problemPath(code),
		Title:  title,
		Status: status,
		Detail: detail,
		Code:   code,
		Errors: errs,
	})
}

// problemPath turns a snake_case code into the kebab-case slug used in `type`.
func problemPath(code string) string {
	out := make([]byte, 0, len(code))
	for i := 0; i < len(code); i++ {
		if code[i] == '_' {
			out = append(out, '-')
			continue
		}
		out = append(out, code[i])
	}
	return string(out)
}

// quoted wraps a value so an identifier stays recognisable inside a sentence.
func quoted(value string) string { return `"` + value + `"` }
