// Package ingest implements the write path of the event contract: the
// POST /api/v1/events endpoint, contract validation, the project lifecycle
// rules, RFC 9457 error responses and the post-commit publish hook.
//
// The layering is deliberate. This package decides *whether* an event may be
// accepted; the store decides *how* it is appended and projected. Nothing here
// writes to a read model, and nothing in the store knows an HTTP status code.
package ingest

import (
	_ "embed"
	"fmt"

	"github.com/pb33f/libopenapi"
	"github.com/pb33f/libopenapi-validator/config"
	schemavalidation "github.com/pb33f/libopenapi-validator/schema_validation"
	"github.com/pb33f/libopenapi/datamodel/high/base"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
)

// contractDocument is the event contract the backend validates against.
//
// api/openapi.yaml is the authority, but it lives outside this Go module and
// go:embed cannot reach above the module root. The file below is therefore a
// verbatim copy, and TestEmbeddedContractMatchesTheAuthority fails the build as
// soon as the two differ — the copy cannot drift silently.
//
//go:embed contract/openapi.yaml
var contractDocument []byte

// ingestRequestSchema is the discriminated union of the ingestion request body.
// Its discriminator mapping is the single source of the event catalogue.
const ingestRequestSchema = "IngestEventRequest"

// schemaVersionSchema carries the enum of accepted payload schema versions.
const schemaVersionSchema = "SchemaVersion"

// componentSchemaPrefix is the local $ref prefix used throughout the contract.
const componentSchemaPrefix = "#/components/schemas/"

// Contract is the compiled event contract.
//
// Everything it knows — which event types exist, which schema versions are
// accepted and what each event must look like — is read out of the contract
// document at startup. There is no hand-maintained mirror of the spec in Go
// that could fall behind it.
type Contract struct {
	// eventSchemas maps an event type to the concrete envelope schema the
	// contract's discriminator selects for it.
	eventSchemas map[string]*base.Schema
	// eventTypes lists the catalogue in contract order.
	eventTypes []string
	// schemaVersions lists the accepted values of the schemaVersion field.
	schemaVersions []string

	validator schemavalidation.SchemaValidator
	printer   *message.Printer
}

// LoadContract parses the embedded contract and compiles it for validation.
//
// It fails loudly: a contract that cannot be read, or that no longer exposes
// the discriminated union the ingestion endpoint is built on, must keep the
// backend from starting rather than degrade validation at runtime.
func LoadContract() (*Contract, error) {
	document, err := libopenapi.NewDocument(contractDocument)
	if err != nil {
		return nil, fmt.Errorf("ingest: parsing the event contract: %w", err)
	}
	model, modelErr := document.BuildV3Model()
	if modelErr != nil {
		return nil, fmt.Errorf("ingest: building the contract model: %w", modelErr)
	}
	if model.Model.Components == nil || model.Model.Components.Schemas == nil {
		return nil, fmt.Errorf("ingest: the event contract declares no component schemas")
	}
	schemas := model.Model.Components.Schemas

	request, ok := schemas.Get(ingestRequestSchema)
	if !ok {
		return nil, fmt.Errorf("ingest: the event contract has no %s schema", ingestRequestSchema)
	}
	discriminator := request.Schema().Discriminator
	if discriminator == nil || discriminator.Mapping == nil {
		return nil, fmt.Errorf("ingest: %s carries no discriminator mapping", ingestRequestSchema)
	}

	contract := &Contract{
		eventSchemas: make(map[string]*base.Schema),
		// Format assertions are off by default in JSON Schema 2020-12, which
		// would silently accept a clientEventId that is not a UUID and an
		// occurredAt that is not a timestamp. The contract means them as
		// constraints, so they are switched on.
		validator: schemavalidation.NewSchemaValidator(config.WithFormatAssertions()),
		printer:   message.NewPrinter(language.English),
	}

	for pair := discriminator.Mapping.First(); pair != nil; pair = pair.Next() {
		eventType, ref := pair.Key(), pair.Value()
		name, err := schemaNameFromRef(ref)
		if err != nil {
			return nil, fmt.Errorf("ingest: event type %q: %w", eventType, err)
		}
		schema, ok := schemas.Get(name)
		if !ok {
			return nil, fmt.Errorf("ingest: event type %q maps to unknown schema %q", eventType, name)
		}
		contract.eventSchemas[eventType] = schema.Schema()
		contract.eventTypes = append(contract.eventTypes, eventType)
	}
	if len(contract.eventTypes) == 0 {
		return nil, fmt.Errorf("ingest: the event catalogue is empty")
	}

	version, ok := schemas.Get(schemaVersionSchema)
	if !ok {
		return nil, fmt.Errorf("ingest: the event contract has no %s schema", schemaVersionSchema)
	}
	for _, value := range version.Schema().Enum {
		if value != nil {
			contract.schemaVersions = append(contract.schemaVersions, value.Value)
		}
	}
	if len(contract.schemaVersions) == 0 {
		return nil, fmt.Errorf("ingest: %s declares no accepted values", schemaVersionSchema)
	}

	return contract, nil
}

// EventTypes returns the closed catalogue in contract order.
func (c *Contract) EventTypes() []string {
	return append([]string(nil), c.eventTypes...)
}

// SchemaVersions returns the accepted payload schema versions.
func (c *Contract) SchemaVersions() []string {
	return append([]string(nil), c.schemaVersions...)
}

// KnowsEventType reports whether the type is part of the closed catalogue.
func (c *Contract) KnowsEventType(eventType string) bool {
	_, ok := c.eventSchemas[eventType]
	return ok
}

// AcceptsSchemaVersion reports whether the payload schema version is accepted.
func (c *Contract) AcceptsSchemaVersion(version string) bool {
	for _, accepted := range c.schemaVersions {
		if accepted == version {
			return true
		}
	}
	return false
}

// Validate checks one decoded request body against the envelope schema the
// contract selects for eventType and returns every violation it finds.
//
// The document is validated against that single branch rather than against the
// whole oneOf: a union of twenty branches reports the nineteen the client never
// meant as failures too, which would bury the real errors. The discriminator is
// what the contract itself prescribes for choosing the branch.
func (c *Contract) Validate(eventType string, document any) []FieldError {
	schema, ok := c.eventSchemas[eventType]
	if !ok {
		return []FieldError{{
			Field:   pointerOf(nil),
			Code:    CodeInvalidEnum,
			Message: fmt.Sprintf("event type %q is not part of the v0 catalogue", eventType),
		}}
	}

	valid, failures := c.validator.ValidateSchemaObject(schema, document)
	if valid {
		return nil
	}

	// Every reported failure carries the same underlying validation tree, so
	// the collected violations are de-duplicated rather than concatenated.
	collector := newFieldErrorCollector(c.printer)
	for _, failure := range failures {
		for _, schemaFailure := range failure.SchemaValidationErrors {
			if schemaFailure.OriginalJsonSchemaError != nil {
				collector.collect(schemaFailure.OriginalJsonSchemaError)
				continue
			}
			// A failure without the underlying error still has to surface;
			// falling through silently would turn it into a false accept.
			collector.add(pointerOf(schemaFailure.InstancePath), CodeInvalidField, schemaFailure.Reason)
		}
	}
	return collector.errors()
}

// schemaNameFromRef turns a local component reference into its schema name.
func schemaNameFromRef(ref string) (string, error) {
	if len(ref) <= len(componentSchemaPrefix) || ref[:len(componentSchemaPrefix)] != componentSchemaPrefix {
		return "", fmt.Errorf("reference %q is not a local component schema", ref)
	}
	return ref[len(componentSchemaPrefix):], nil
}
