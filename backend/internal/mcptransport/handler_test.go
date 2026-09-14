package mcptransport

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func testServer(t *testing.T, opts Options) (*Handler, *httptest.Server) {
	t.Helper()
	opts.AllowedHosts = []string{"127.0.0.1"}
	opts.AllowedOrigins = []string{"http://trusted.example"}
	h, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewUnstartedServer(h)
	ts.Start()
	u, _ := url.Parse(ts.URL)
	h.hosts[u.Host] = true
	t.Cleanup(func() { _ = h.Close(); ts.Close() })
	return h, ts
}

func clientSession(t *testing.T, endpoint string) *mcp.ClientSession {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c := mcp.NewClient(&mcp.Implementation{Name: "transport-test", Version: "1"}, nil)
	s, err := c.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: endpoint}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestSDKClientEmptyRegistry(t *testing.T) {
	_, ts := testServer(t, Options{})
	assertEmptyRegistry(t, ts.URL)
}

func assertEmptyRegistry(t *testing.T, endpoint string) {
	t.Helper()
	s := clientSession(t, endpoint)
	init := s.InitializeResult()
	if init.ProtocolVersion != "2025-11-25" {
		t.Fatalf("negotiated version %s", init.ProtocolVersion)
	}
	if init.Capabilities.Tools != nil || init.Capabilities.Logging != nil || init.Capabilities.Resources != nil || init.Capabilities.Prompts != nil {
		t.Fatalf("unimplemented capabilities: %+v", init.Capabilities)
	}
	if s.ID() == "" {
		t.Fatal("stateful transport omitted session ID")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	list, err := s.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Tools) != 0 {
		t.Fatalf("unexpected production tools: %+v", list.Tools)
	}
	_, err = s.CallTool(ctx, &mcp.CallToolParams{Name: "visualise_model_mutate", Arguments: map[string]any{}})
	var rpcErr *jsonrpc.Error
	if !errors.As(err, &rpcErr) || rpcErr.Code != -32602 {
		t.Fatalf("unknown tool must be protocol error: %v", err)
	}
}

func TestSDKToolResultAndErrors(t *testing.T) {
	_, ts := testServer(t, Options{Register: func(s *mcp.Server) error {
		s.AddTool(&mcp.Tool{Name: "test_only", InputSchema: map[string]any{"type": "object", "properties": map[string]any{"fail": map[string]any{"type": "boolean"}}, "additionalProperties": false}}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			var args struct {
				Fail bool `json:"fail"`
			}
			_ = json.Unmarshal(req.Params.Arguments, &args)
			if args.Fail {
				return &mcp.CallToolResult{IsError: true, StructuredContent: map[string]any{"code": "project_not_found"}, Content: []mcp.Content{&mcp.TextContent{Text: "project_not_found"}}}, nil
			}
			return &mcp.CallToolResult{StructuredContent: map[string]any{"ok": true}, Content: []mcp.Content{&mcp.TextContent{Text: `{"ok":true}`}}}, nil
		})
		return nil
	}})
	s := clientSession(t, ts.URL)
	if s.InitializeResult().Capabilities.Tools == nil {
		t.Fatal("registered tool not advertised")
	}
	list, err := s.ListTools(context.Background(), nil)
	if err != nil || len(list.Tools) != 1 || list.Tools[0].Name != "test_only" {
		t.Fatalf("list: %+v %v", list, err)
	}
	for _, fail := range []bool{false, true} {
		r, err := s.CallTool(context.Background(), &mcp.CallToolParams{Name: "test_only", Arguments: map[string]any{"fail": fail}})
		if err != nil || r.IsError != fail || r.StructuredContent == nil || len(r.Content) == 0 {
			t.Fatalf("result: %+v %v", r, err)
		}
	}
}

func rpc(t *testing.T, endpoint, body, session, version, host, origin string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if session != "" {
		req.Header.Set("Mcp-Session-Id", session)
	}
	if version != "" {
		req.Header.Set("MCP-Protocol-Version", version)
	}
	if host != "" {
		req.Host = host
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestNegotiationAndHTTPProtection(t *testing.T) {
	_, ts := testServer(t, Options{})
	for _, version := range []string{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "1900-01-01", "2026-07-28"} {
		t.Run(version, func(t *testing.T) {
			res := rpc(t, ts.URL, fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":%q,"clientInfo":{"name":"test","version":"1"},"capabilities":{}}}`, version), "", "", "", "")
			defer res.Body.Close()
			body, _ := io.ReadAll(res.Body)
			want := version
			if version == "1900-01-01" || version == "2026-07-28" {
				want = "2025-11-25"
			}
			if res.StatusCode != 200 || !strings.Contains(string(body), `"protocolVersion":"`+want+`"`) {
				t.Fatalf("initialize %d %s", res.StatusCode, body)
			}
		})
	}
	for _, tc := range []struct {
		name, host, origin, version, body string
		status                            int
	}{
		{name: "absent origin", body: `{`, status: 400},
		{name: "allowed origin", origin: "http://trusted.example", body: `{`, status: 400},
		{name: "disallowed origin", origin: "http://evil.example", body: `{`, status: 403},
		{name: "null origin", origin: "null", body: `{`, status: 403},
		{name: "disallowed host", host: "evil.example", body: `{`, status: 403},
		{name: "wrong port", host: "localhost:9", body: `{`, status: 403},
		{name: "unsupported header", version: "1900-01-01", body: `{`, status: 400},
		{name: "oversize", body: strings.Repeat("x", int(MaxRequestBytes)+1), status: 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := rpc(t, ts.URL, tc.body, "", tc.version, tc.host, tc.origin)
			defer res.Body.Close()
			if res.StatusCode != tc.status {
				body, _ := io.ReadAll(res.Body)
				t.Fatalf("status %d want %d: %s", res.StatusCode, tc.status, body)
			}
		})
	}
}

func TestCancellationDeadlineAndShutdown(t *testing.T) {
	for _, mode := range []string{"cancel", "deadline", "shutdown"} {
		t.Run(mode, func(t *testing.T) {
			started := make(chan struct{})
			stopped := make(chan struct{})
			timeout := 5 * time.Second
			if mode == "deadline" {
				timeout = 50 * time.Millisecond
			}
			h, ts := testServer(t, Options{RequestTimeout: timeout, Register: func(s *mcp.Server) error {
				s.AddTool(&mcp.Tool{Name: "wait", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, _ *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
					close(started)
					<-ctx.Done()
					close(stopped)
					return nil, ctx.Err()
				})
				return nil
			}})
			s := clientSession(t, ts.URL)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, err := s.CallTool(ctx, &mcp.CallToolParams{Name: "wait", Arguments: map[string]any{}})
				done <- err
			}()
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("tool not started")
			}
			if mode == "cancel" {
				cancel()
			}
			if mode == "shutdown" {
				ctx, stop := context.WithTimeout(context.Background(), 2*time.Second)
				defer stop()
				if err := h.Shutdown(ctx); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case <-stopped:
			case <-time.After(3 * time.Second):
				t.Fatal("handler not cancelled")
			}
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Fatal("call not released")
			}
		})
	}
}

func TestDisconnectAndSessionExpiry(t *testing.T) {
	_, ts := testServer(t, Options{SessionTimeout: 60 * time.Millisecond})
	s := clientSession(t, ts.URL)
	id := s.ID()
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	res := rpc(t, ts.URL, `{"jsonrpc":"2.0","id":2,"method":"ping"}`, id, "2025-11-25", "", "")
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("deleted session status %d", res.StatusCode)
	}
	s2 := clientSession(t, ts.URL)
	time.Sleep(150 * time.Millisecond)
	res = rpc(t, ts.URL, `{"jsonrpc":"2.0","id":3,"method":"ping"}`, s2.ID(), "2025-11-25", "", "")
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("expired session status %d", res.StatusCode)
	}
}

// Opt in against the actual published Compose/Nginx endpoint. This test uses
// the real production binary: it must not contain the test-only tool above.
func TestPublishedEndpoint(t *testing.T) {
	endpoint := os.Getenv("TEST_MCP_ENDPOINT")
	if endpoint == "" {
		t.Skip("TEST_MCP_ENDPOINT not set")
	}
	for _, size := range []int{int(MaxRequestBytes) + 1, 5 << 20} {
		oversized := rpc(t, endpoint, strings.Repeat("x", size), "", "", "", "")
		body, _ := io.ReadAll(oversized.Body)
		oversized.Body.Close()
		if oversized.StatusCode != 413 || strings.Contains(string(body), "event_too_large") {
			t.Fatalf("MCP size %d status %d: %s", size, oversized.StatusCode, body)
		}
	}
	base := strings.TrimSuffix(endpoint, "/mcp")
	projectID := "mcp-acceptance-" + uuid.NewString()
	event := map[string]any{"schemaVersion": "1.0", "clientEventId": uuid.NewString(), "projectId": projectID, "runId": "transport-test-run", "agentId": "transport-test-root", "parentAgentId": nil, "occurredAt": time.Now().UTC().Format(time.RFC3339Nano), "type": "agent.started", "payload": map[string]any{"role": "orchestrator", "displayName": "Transport acceptance", "assignedTask": "Check REST and SSE remain available"}}
	payload, _ := json.Marshal(event)
	posted, err := http.Post(base+"/api/v1/events", "application/json", strings.NewReader(string(payload)))
	if err != nil {
		t.Fatal(err)
	}
	accepted, _ := io.ReadAll(posted.Body)
	posted.Body.Close()
	if posted.StatusCode != http.StatusCreated {
		t.Fatalf("REST ingestion %d: %s", posted.StatusCode, accepted)
	}
	read := func() string {
		t.Helper()
		res, err := http.Get(base + "/api/v1/projects/" + projectID)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		if res.StatusCode != 200 {
			t.Fatalf("REST read %d %s", res.StatusCode, body)
		}
		return string(body)
	}
	before := read()
	assertEmptyRegistry(t, endpoint)
	if after := read(); after != before {
		t.Fatalf("MCP connection changed domain state: before %s after %s", before, after)
	}
	streamCtx, stopStream := context.WithTimeout(context.Background(), 5*time.Second)
	defer stopStream()
	req, _ := http.NewRequestWithContext(streamCtx, http.MethodGet, base+"/api/v1/projects/"+projectID+"/stream?lastEventPosition=0", nil)
	stream, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	if stream.StatusCode != 200 || !strings.Contains(stream.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("SSE status %d headers %v", stream.StatusCode, stream.Header)
	}
	scanner := bufio.NewScanner(stream.Body)
	sawEvent := false
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "data:") && strings.Contains(scanner.Text(), "agent.started") {
			sawEvent = true
			break
		}
	}
	if !sawEvent {
		t.Fatalf("SSE replay did not reach proxy: %v", scanner.Err())
	}
	for _, path := range []string{"/healthz", "/readyz"} {
		res, err := http.Get(strings.TrimSuffix(endpoint, "/mcp") + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("%s: %d", path, res.StatusCode)
		}
	}
	res := rpc(t, endpoint, `{`, "", "", "", "http://evil.example")
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatalf("proxy lost origin: %d", res.StatusCode)
	}
	res = rpc(t, endpoint, `{`, "", "", "evil.example", "")
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatalf("proxy lost host: %d", res.StatusCode)
	}
}

func TestInvalidConfiguration(t *testing.T) {
	for _, opts := range []Options{
		{}, {AllowedHosts: []string{"*"}}, {AllowedHosts: []string{"example.com/path"}},
		{AllowedHosts: []string{"localhost"}, AllowedOrigins: []string{"null"}},
		{AllowedHosts: []string{"localhost"}, AllowedOrigins: []string{"https://example.com/path"}},
		{AllowedHosts: []string{"localhost"}, Register: func(*mcp.Server) error { return errors.New("registration failed") }},
	} {
		if h, err := New(opts); err == nil {
			h.Close()
			t.Fatalf("accepted invalid options %+v", opts)
		}
	}
}

func TestShutdownClosesGETStream(t *testing.T) {
	h, ts := testServer(t, Options{})
	init := rpc(t, ts.URL, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","clientInfo":{"name":"test","version":"1"},"capabilities":{}}}`, "", "", "", "")
	_, _ = io.Copy(io.Discard, init.Body)
	init.Body.Close()
	sessionID := init.Header.Get("Mcp-Session-Id")
	if sessionID == "" {
		t.Fatal("missing session")
	}
	initialized := rpc(t, ts.URL, `{"jsonrpc":"2.0","method":"notifications/initialized"}`, sessionID, "2025-11-25", "", "")
	initialized.Body.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL, nil)
	req.Header.Set("Mcp-Session-Id", sessionID)
	req.Header.Set("MCP-Protocol-Version", "2025-11-25")
	req.Header.Set("Accept", "text/event-stream")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("GET stream status %d", resp.StatusCode)
	}
	done := make(chan struct{})
	go func() { _, _ = io.Copy(io.Discard, resp.Body); close(done) }()
	if err := h.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("GET stream survived shutdown")
	}
	res := rpc(t, ts.URL, `{`, "", "", "", "")
	res.Body.Close()
	if res.StatusCode != 503 {
		t.Fatalf("shutdown accepts requests: %d", res.StatusCode)
	}
}

func TestProtocolMethodErrors(t *testing.T) {
	_, ts := testServer(t, Options{})
	s := clientSession(t, ts.URL)
	for _, tc := range []struct {
		body string
		code int
	}{

		{`{"jsonrpc":"2.0","id":43,"method":"tools/call","params":{"name":7}}`, -32602},
	} {
		res := rpc(t, ts.URL, tc.body, s.ID(), "2025-11-25", "", "")
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if !strings.Contains(string(body), fmt.Sprintf(`"code":%d`, tc.code)) {
			t.Fatalf("protocol error: %s", body)
		}
	}
	req, _ := http.NewRequest(http.MethodPost, ts.URL, io.NopCloser(strings.NewReader(strings.Repeat("x", int(MaxRequestBytes)+1))))
	req.ContentLength = -1
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 413 {
		t.Fatalf("chunked body status %d", res.StatusCode)
	}
}
