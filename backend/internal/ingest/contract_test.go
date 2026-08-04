package ingest

import (
	"bytes"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// authorityPath is api/openapi.yaml, seen from this test's directory.
var authorityPath = filepath.Join("..", "..", "..", "api", "openapi.yaml")

// TestEmbeddedContractMatchesTheAuthority is the guard that makes embedding the
// contract safe.
//
// api/openapi.yaml is the contract; contract/openapi.yaml is only a copy,
// because go:embed cannot reach above the module root. Without this test the
// backend could validate against a stale copy while everyone else reads the
// current spec — the exact drift the copy risks. With it, changing the contract
// and forgetting the copy turns the backend test suite red.
func TestEmbeddedContractMatchesTheAuthority(t *testing.T) {
	authority, err := os.ReadFile(authorityPath)
	if err != nil {
		t.Fatalf("reading the contract authority %s: %v", authorityPath, err)
	}

	// Line endings are a checkout detail, not contract content.
	want := normaliseNewlines(authority)
	got := normaliseNewlines(contractDocument)
	if !bytes.Equal(want, got) {
		t.Fatalf("backend/internal/ingest/contract/openapi.yaml has drifted from %s.\n"+
			"Copy the contract again: cp api/openapi.yaml backend/internal/ingest/contract/openapi.yaml\n"+
			"(authority %d bytes, embedded copy %d bytes)", authorityPath, len(want), len(got))
	}
}

func normaliseNewlines(in []byte) []byte {
	return bytes.ReplaceAll(in, []byte("\r\n"), []byte("\n"))
}

// TestContractExposesTheClosedCatalogue checks that the compiled contract is
// usable at all: the catalogue is complete and every type resolves to a schema.
func TestContractExposesTheClosedCatalogue(t *testing.T) {
	contract := testContract(t)

	types := contract.EventTypes()
	if len(types) != 20 {
		t.Fatalf("want the 20 v0 event types, got %d: %v", len(types), types)
	}
	for _, eventType := range types {
		if !contract.KnowsEventType(eventType) {
			t.Errorf("event type %q is listed but has no schema", eventType)
		}
	}
	if contract.KnowsEventType("tool.invoked") {
		t.Error("tool.invoked must not be part of the closed catalogue")
	}
}

// TestCatalogueMatchesTheStore keeps the two halves of the backend aligned.
//
// The store projects a fixed list of types and errors on anything else. If the
// contract gained a type the projector does not know, ingestion would accept
// events the store cannot apply, and every append of that type would fail with
// a 500 instead of being caught here.
func TestCatalogueMatchesTheStore(t *testing.T) {
	fromContract := testContract(t).EventTypes()
	fromStore := store.EventTypes()

	sort.Strings(fromContract)
	sort.Strings(fromStore)

	if len(fromContract) != len(fromStore) {
		t.Fatalf("contract lists %d event types, the store projects %d:\ncontract: %v\nstore:    %v",
			len(fromContract), len(fromStore), fromContract, fromStore)
	}
	for i := range fromContract {
		if fromContract[i] != fromStore[i] {
			t.Errorf("event type %d differs: contract %q, store %q", i, fromContract[i], fromStore[i])
		}
	}
}

// TestOnlySchemaVersionOneZeroIsAccepted pins the version gate to the contract.
func TestOnlySchemaVersionOneZeroIsAccepted(t *testing.T) {
	contract := testContract(t)

	versions := contract.SchemaVersions()
	if len(versions) != 1 || versions[0] != "1.0" {
		t.Fatalf("want exactly the accepted version 1.0, got %v", versions)
	}
	if !contract.AcceptsSchemaVersion("1.0") {
		t.Error("1.0 must be accepted")
	}
	if contract.AcceptsSchemaVersion("2.0") {
		t.Error("2.0 must not be accepted")
	}
}
