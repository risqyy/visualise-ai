package store

import (
	"encoding/json"
	"testing"
)

// The idempotency check must survive a retry that serialises the same event
// with a different object key order, otherwise a harmless retry would be
// answered with a spurious conflict.
func TestPayloadHashIsIndependentOfObjectKeyOrder(t *testing.T) {
	first := []byte(`{
		"changeId": "change-2026-08-04-0007",
		"operation": "add",
		"component": {
			"componentId": "shop-platform.orders.domain.tax",
			"name": "Tax Calculation",
			"kind": "module",
			"parentComponentId": "shop-platform.orders.domain",
			"technology": {"language": "Go", "runtime": "Go", "version": "1.24"},
			"tags": ["pricing", "tax"]
		}
	}`)
	second := []byte(`{"component":{"tags":["pricing","tax"],` +
		`"technology":{"version":"1.24","runtime":"Go","language":"Go"},` +
		`"parentComponentId":"shop-platform.orders.domain","kind":"module",` +
		`"name":"Tax Calculation","componentId":"shop-platform.orders.domain.tax"},` +
		`"operation":"add","changeId":"change-2026-08-04-0007"}`)

	firstCanonical, err := canonicalJSON(first)
	if err != nil {
		t.Fatalf("canonicalising the first document: %v", err)
	}
	secondCanonical, err := canonicalJSON(second)
	if err != nil {
		t.Fatalf("canonicalising the second document: %v", err)
	}

	if string(firstCanonical) != string(secondCanonical) {
		t.Fatalf("canonical forms differ:\n%s\n%s", firstCanonical, secondCanonical)
	}
	if payloadHash(firstCanonical) != payloadHash(secondCanonical) {
		t.Fatal("payload hashes differ although the documents are equal")
	}
}

// Array order, in contrast, is content: reordering a list is a different event.
func TestPayloadHashKeepsArrayOrderSignificant(t *testing.T) {
	first, err := canonicalJSON([]byte(`{"componentIds":["a","b"]}`))
	if err != nil {
		t.Fatalf("canonicalising: %v", err)
	}
	second, err := canonicalJSON([]byte(`{"componentIds":["b","a"]}`))
	if err != nil {
		t.Fatalf("canonicalising: %v", err)
	}
	if payloadHash(first) == payloadHash(second) {
		t.Fatal("reordering an array must change the payload hash")
	}
}

func TestCanonicalJSONStripsWhitespaceAndKeepsNumbers(t *testing.T) {
	canonical, err := canonicalJSON([]byte("{\n  \"percent\" : 40,\n  \"basis\":\"completed_steps\"\n}"))
	if err != nil {
		t.Fatalf("canonicalising: %v", err)
	}
	const want = `{"basis":"completed_steps","percent":40}`
	if string(canonical) != want {
		t.Fatalf("canonical form = %s, want %s", canonical, want)
	}
	if !json.Valid(canonical) {
		t.Fatal("canonical form is not valid JSON")
	}
}

func TestCanonicalJSONRejectsBrokenDocuments(t *testing.T) {
	cases := map[string]string{
		"empty":    "",
		"trailing": `{"a":1} {"b":2}`,
		"broken":   `{"a":`,
	}
	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := canonicalJSON([]byte(payload)); err == nil {
				t.Fatalf("expected an error for the %s payload", name)
			}
		})
	}
}
