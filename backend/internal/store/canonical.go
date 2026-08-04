package store

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// canonicalJSON re-encodes a JSON document into its canonical form: object keys
// sorted recursively, no insignificant whitespace, numbers kept verbatim.
//
// This is what makes the idempotency check content based rather than byte
// based. Two retries that serialise the same event with a different key order —
// which JSON libraries are free to do — must produce the same hash, otherwise a
// harmless retry would be answered with a spurious conflict.
//
// Sorting comes for free: encoding/json marshals map[string]any with sorted
// keys, and decoding into `any` turns every object into such a map. UseNumber
// keeps numeric literals as written instead of routing them through float64.
func canonicalJSON(raw []byte) ([]byte, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, fmt.Errorf("payload is empty")
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()

	var document any
	if err := decoder.Decode(&document); err != nil {
		return nil, err
	}
	if decoder.More() {
		return nil, fmt.Errorf("payload carries trailing JSON data")
	}

	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(document); err != nil {
		return nil, err
	}
	// Encode appends a newline that carries no meaning here.
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// payloadHash is the SHA-256 of the canonical payload, hex encoded.
func payloadHash(canonical []byte) string {
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:])
}
