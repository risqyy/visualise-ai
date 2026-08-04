package readapi

import (
	"encoding/base64"
	"strconv"
	"strings"
)

// Paging bounds of every paginated read endpoint.
const (
	// DefaultLimit applies when the client sends no limit.
	DefaultLimit = 50
	// MaxLimit is the largest page a client may ask for. A larger value is a
	// client error rather than a silently clamped page, so a UI cannot believe
	// it received everything.
	MaxLimit = 200
)

// cursorVersion prefixes every cursor payload. It makes the encoding
// recognisable and lets a future format be rejected instead of misread.
const cursorVersion = "v1"

// cursorSeparator joins the key parts inside a cursor. No identifier of the
// contract may contain it: run and component ids are restricted to lowercase
// alphanumerics plus `-`, `.` and `_`, and positions are decimal digits.
const cursorSeparator = "|"

// Violation codes reported through ValidationError.
const (
	codeOutOfRange = "out_of_range"
	codeInvalid    = "invalid_format"
)

// Page is a validated pagination request.
type Page struct {
	// Limit is the number of rows to return, already defaulted and bounded.
	Limit int
	// Cursor is the raw cursor as sent by the client, empty for a first page.
	Cursor string
}

// parsePage validates the `limit` and `cursor` query parameters.
//
// Both are reported together when both are wrong, so a client fixes one round
// trip instead of two. The `field` prefix lets one request carry several
// paginated collections — the inspector paginates its diffs under `diffLimit`
// and `diffCursor`.
func parsePage(limitParam, cursorParam, rawLimit, rawCursor string) (Page, *ValidationError) {
	page := Page{Limit: DefaultLimit, Cursor: strings.TrimSpace(rawCursor)}
	var problem ValidationError

	if trimmed := strings.TrimSpace(rawLimit); trimmed != "" {
		limit, err := strconv.Atoi(trimmed)
		switch {
		case err != nil:
			problem.Errors = append(problem.Errors, FieldError{
				Field:   "/" + limitParam,
				Code:    codeInvalid,
				Message: "limit must be an integer",
			})
		case limit < 1 || limit > MaxLimit:
			problem.Errors = append(problem.Errors, FieldError{
				Field:   "/" + limitParam,
				Code:    codeOutOfRange,
				Message: "limit must be between 1 and " + strconv.Itoa(MaxLimit),
			})
		default:
			page.Limit = limit
		}
	}

	if page.Cursor != "" {
		if _, err := decodeCursor(page.Cursor); err != nil {
			problem.Errors = append(problem.Errors, FieldError{
				Field:   "/" + cursorParam,
				Code:    codeInvalid,
				Message: "cursor is not a cursor issued by this API",
			})
		}
	}

	if len(problem.Errors) > 0 {
		return Page{}, &problem
	}
	return page, nil
}

// encodeCursor renders an opaque continuation token.
//
// The token is base64url over a versioned, internal sort key. Clients must
// treat it as opaque: it is echoed back unchanged and its shape is free to
// change with the version prefix.
func encodeCursor(parts ...string) string {
	joined := strings.Join(append([]string{cursorVersion}, parts...), cursorSeparator)
	return base64.RawURLEncoding.EncodeToString([]byte(joined))
}

// decodeCursor reads a token produced by encodeCursor.
func decodeCursor(raw string) ([]string, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(string(decoded), cursorSeparator)
	if len(parts) < 2 || parts[0] != cursorVersion {
		return nil, errUnknownCursor
	}
	return parts[1:], nil
}

// positionCursor renders the cursor of a collection ordered by project position.
func positionCursor(position int64) string {
	return encodeCursor(strconv.FormatInt(position, 10))
}

// parsePositionCursor reads a cursor produced by positionCursor. An unusable
// token yields ok=false; the caller has already validated the encoding through
// parsePage, so this only guards against a mismatching key shape.
func parsePositionCursor(raw string) (int64, bool) {
	parts, err := decodeCursor(raw)
	if err != nil || len(parts) != 1 {
		return 0, false
	}
	position, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, false
	}
	return position, true
}

// runCursor renders the cursor of the run list.
//
// Runs are ordered by reported start time, which is not a project position and
// can repeat, so the key is the pair (startedAt, runId). The pair is unique —
// runId is a primary key column — which is what makes paging gap free and
// duplicate free.
func runCursor(startedAtUnixNano int64, runID string) string {
	return encodeCursor(strconv.FormatInt(startedAtUnixNano, 10), runID)
}

// parseRunCursor reads a cursor produced by runCursor.
func parseRunCursor(raw string) (int64, string, bool) {
	parts, err := decodeCursor(raw)
	if err != nil || len(parts) != 2 {
		return 0, "", false
	}
	nanos, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, "", false
	}
	return nanos, parts[1], true
}

// errUnknownCursor marks a token this version cannot read.
var errUnknownCursor = &cursorError{}

type cursorError struct{}

func (*cursorError) Error() string { return "readapi: unknown cursor format" }
