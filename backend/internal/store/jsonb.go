package store

import (
	"database/sql/driver"
	"fmt"
)

// JSON is a `jsonb` column holding one raw JSON document.
//
// The store keeps payloads and reported descriptors as JSON instead of
// exploding them into columns: the contract already fixes their shape, and the
// cockpit hands them back to the UI unchanged.
type JSON []byte

// emptyObject and emptyArray are the placeholders for optional JSON documents
// the agent did not report, so the columns stay NOT NULL.
var (
	emptyObject = JSON(`{}`)
	emptyArray  = JSON(`[]`)
)

// GormDataType makes GORM create the column as `jsonb`.
func (JSON) GormDataType() string { return "jsonb" }

// Value implements driver.Valuer.
func (j JSON) Value() (driver.Value, error) {
	if len(j) == 0 {
		return nil, nil
	}
	return string(j), nil
}

// Scan implements sql.Scanner.
func (j *JSON) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*j = nil
	case []byte:
		*j = append(JSON(nil), v...)
	case string:
		*j = JSON(v)
	default:
		return fmt.Errorf("store: cannot scan %T into a jsonb column", src)
	}
	return nil
}

// orEmpty returns fallback when raw carries no document, so optional reported
// objects and arrays never become SQL NULL.
func orEmpty(raw []byte, fallback JSON) JSON {
	if len(raw) == 0 {
		return fallback
	}
	return JSON(raw)
}
