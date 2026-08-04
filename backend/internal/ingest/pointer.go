package ingest

import (
	"bytes"
	"encoding/json"
	"strconv"
)

// jsonFrame is one container that is open while the token stream is replayed.
type jsonFrame struct {
	object bool
	// key is the member of an object currently being read.
	key string
	// index is the element of an array currently being read.
	index int
	// awaitingKey is true while the next token of an object is a member name,
	// which is also how "the previous member is complete" is recognised.
	awaitingKey bool
}

// pointerAtSyntaxError locates a JSON syntax error as precisely as the document
// still allows.
//
// A malformed body cannot be validated against the contract, but reporting only
// "invalid JSON" leaves the agent hunting through a 2 MiB document. Replaying
// the token stream until it breaks reconstructs the containers that were open
// at that moment, which is the path to the member the parser choked on. When
// the document breaks before any member is open — an empty body, a stray
// character at the very start — the root pointer is returned.
func pointerAtSyntaxError(body []byte) string {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()

	var stack []jsonFrame
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}

		if delim, ok := token.(json.Delim); ok {
			switch delim {
			case '{':
				stack = append(stack, jsonFrame{object: true, awaitingKey: true})
			case '[':
				stack = append(stack, jsonFrame{})
			case '}', ']':
				if len(stack) > 0 {
					stack = stack[:len(stack)-1]
				}
				completeValue(stack)
			}
			continue
		}

		// A scalar token: either the member name of the enclosing object or a
		// complete value.
		if len(stack) == 0 {
			continue
		}
		top := &stack[len(stack)-1]
		if top.object && top.awaitingKey {
			if key, ok := token.(string); ok {
				top.key = key
			}
			top.awaitingKey = false
			continue
		}
		completeValue(stack)
	}

	segments := make([]string, 0, len(stack))
	for _, open := range stack {
		if !open.object {
			segments = append(segments, strconv.Itoa(open.index))
			continue
		}
		// An object frame names a member only while that member is being read.
		// Once its value is complete the parser stands between members, so the
		// stale name would point at something that parsed fine — the path ends
		// at the enclosing container instead.
		if open.awaitingKey || open.key == "" {
			break
		}
		segments = append(segments, open.key)
	}
	return pointerOf(segments)
}

// completeValue records that the innermost open container consumed one whole
// value, so the next token belongs to the following member or element.
func completeValue(stack []jsonFrame) {
	if len(stack) == 0 {
		return
	}
	top := &stack[len(stack)-1]
	if top.object {
		top.awaitingKey = true
		return
	}
	top.index++
}
