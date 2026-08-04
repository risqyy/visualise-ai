package ingest

import (
	"sort"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/santhosh-tekuri/jsonschema/v6/kind"
	"golang.org/x/text/message"
)

// FieldError is one field-level violation. It mirrors the ValidationError
// schema of the contract exactly, so the JSON encoding of a slice of these is
// the `errors[]` array of a ValidationProblem.
type FieldError struct {
	// Field is an RFC 6901 JSON Pointer into the rejected request body.
	Field string `json:"field"`
	// Code is the machine-readable violation code.
	Code string `json:"code"`
	// Message explains this single violation to a human.
	Message string `json:"message"`
}

// Violation codes. The contract names `required`, `out_of_range`,
// `pattern_mismatch`, `unknown_property` and `invalid_format` as examples; the
// remaining two cover the JSON Schema keywords that map onto neither.
const (
	CodeRequired        = "required"
	CodeUnknownProperty = "unknown_property"
	CodeOutOfRange      = "out_of_range"
	CodePatternMismatch = "pattern_mismatch"
	CodeInvalidFormat   = "invalid_format"
	CodeInvalidType     = "invalid_type"
	CodeInvalidEnum     = "invalid_enum"
	// CodeInvalidJSON marks a body that is not well-formed JSON at all.
	CodeInvalidJSON = "invalid_json"
)

// rootPointer is the fallback location for a violation that cannot be tied to a
// member of the body — a body that is not an object, or a syntax error before
// the first member. RFC 6901 writes the whole document as the empty string, but
// the contract requires `field` to be non-empty, so the root is spelled "/".
const rootPointer = "/"

// fieldErrorCollector turns a jsonschema validation tree into the flat, ordered
// and de-duplicated list of violations the contract asks for.
type fieldErrorCollector struct {
	printer *message.Printer
	seen    map[FieldError]int
	order   []FieldError
}

func newFieldErrorCollector(printer *message.Printer) *fieldErrorCollector {
	return &fieldErrorCollector{printer: printer, seen: make(map[FieldError]int)}
}

// add records one violation, ignoring a repeat of one already recorded.
func (c *fieldErrorCollector) add(field, code, msg string) {
	violation := FieldError{Field: field, Code: code, Message: msg}
	if _, ok := c.seen[violation]; ok {
		return
	}
	c.seen[violation] = len(c.order)
	c.order = append(c.order, violation)
}

// errors returns the collected violations, ordered by their JSON Pointer so a
// response is reproducible regardless of map iteration order.
func (c *fieldErrorCollector) errors() []FieldError {
	out := append([]FieldError(nil), c.order...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Field != out[j].Field {
			return out[i].Field < out[j].Field
		}
		return out[i].Code < out[j].Code
	})
	return out
}

// collect walks one validation error tree and records its leaves.
//
// The tree mixes structural nodes (the schema itself, allOf, the grouping the
// compiler inserts) with the keyword that actually failed. Only the latter
// describes something the reporting agent can fix, so the structural nodes are
// traversed and the keywords are recorded.
func (c *fieldErrorCollector) collect(err *jsonschema.ValidationError) {
	if err == nil {
		return
	}
	at := pointerOf(err.InstanceLocation)

	switch violation := err.ErrorKind.(type) {
	case *kind.Required:
		for _, missing := range violation.Missing {
			c.add(childPointer(at, missing), CodeRequired,
				c.printer.Sprintf("required property %q is missing", missing))
		}
		return

	case *kind.AdditionalProperties:
		for _, unknown := range violation.Properties {
			c.add(childPointer(at, unknown), CodeUnknownProperty,
				c.printer.Sprintf("property %q is not declared by the contract", unknown))
		}
		return

	case *kind.OneOf, *kind.AnyOf:
		// A nullable field is written as `oneOf: [<type>, null]`. Reporting
		// both rejected branches would describe one mistake twice, so the
		// choice itself is the violation and its causes are not traversed.
		c.add(at, CodeInvalidType, c.localize(err))
		return

	case *kind.Enum:
		c.add(at, CodeInvalidEnum, c.localize(err))
		return

	case *kind.Const:
		c.add(at, CodeInvalidEnum, c.localize(err))
		return

	case *kind.Pattern:
		c.add(at, CodePatternMismatch, c.localize(err))
		return

	case *kind.Format:
		c.add(at, CodeInvalidFormat, c.localize(err))
		return

	case *kind.Type:
		c.add(at, CodeInvalidType, c.localize(err))
		return

	case *kind.Minimum, *kind.Maximum, *kind.ExclusiveMinimum, *kind.ExclusiveMaximum,
		*kind.MultipleOf, *kind.MinLength, *kind.MaxLength, *kind.MinItems, *kind.MaxItems,
		*kind.MinProperties, *kind.MaxProperties, *kind.MinContains, *kind.MaxContains,
		*kind.UniqueItems:
		c.add(at, CodeOutOfRange, c.localize(err))
		return
	}

	// Structural nodes: descend. A node that fails without naming a keyword and
	// without causes would otherwise disappear, so it is recorded generically.
	if len(err.Causes) == 0 {
		c.add(at, CodeInvalidField, c.localize(err))
		return
	}
	for _, cause := range err.Causes {
		c.collect(cause)
	}
}

// localize renders the human-readable message of one validation error.
func (c *fieldErrorCollector) localize(err *jsonschema.ValidationError) string {
	if err.ErrorKind == nil {
		return "the value violates the contract"
	}
	return err.ErrorKind.LocalizedString(c.printer)
}

// pointerOf builds an RFC 6901 JSON Pointer from instance path segments.
func pointerOf(segments []string) string {
	if len(segments) == 0 {
		return rootPointer
	}
	var builder strings.Builder
	for _, segment := range segments {
		builder.WriteByte('/')
		builder.WriteString(escapePointerSegment(segment))
	}
	return builder.String()
}

// childPointer extends a pointer by one member name.
func childPointer(parent, name string) string {
	if parent == rootPointer {
		return "/" + escapePointerSegment(name)
	}
	return parent + "/" + escapePointerSegment(name)
}

// escapePointerSegment applies the RFC 6901 escaping rules: `~` becomes `~0`
// and `/` becomes `~1`, in that order.
func escapePointerSegment(segment string) string {
	segment = strings.ReplaceAll(segment, "~", "~0")
	return strings.ReplaceAll(segment, "/", "~1")
}
