// Package mcptransport adapts the official MCP SDK to the internal HTTP server.
// It owns protocol sessions only; domain lifecycle and tools belong to adapters.
package mcptransport

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const MaxRequestBytes int64 = 1 << 20

// Options configures the transport. Register adds only implemented tools before
// serving starts. Tool schemas must come from the shared contract catalogue.
type Options struct {
	Version        string
	AllowedHosts   []string
	AllowedOrigins []string
	RequestTimeout time.Duration
	SessionTimeout time.Duration
	Register       func(*mcp.Server) error
}

type Handler struct {
	server         *mcp.Server
	transport      *mcp.StreamableHTTPHandler
	hosts, origins map[string]bool
	ctx            context.Context
	cancel         context.CancelFunc
	mu             sync.Mutex
	closed         bool
	active         sync.WaitGroup
}

func New(opts Options) (*Handler, error) {
	if opts.RequestTimeout <= 0 {
		opts.RequestTimeout = 45 * time.Second
	}
	if opts.SessionTimeout <= 0 {
		opts.SessionTimeout = 5 * time.Minute
	}
	h := &Handler{hosts: map[string]bool{}, origins: map[string]bool{}}
	for _, host := range opts.AllowedHosts {
		u, err := url.Parse("http://" + host)
		if err != nil || u.Host != host || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(host, "* ,\\\t\r\n") {
			return nil, fmt.Errorf("invalid MCP allowed host %q", host)
		}
		h.hosts[strings.ToLower(host)] = true
	}
	if len(h.hosts) == 0 {
		return nil, errors.New("MCP requires at least one allowed host")
	}
	for _, origin := range opts.AllowedOrigins {
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(origin, "* ,\\\t\r\n") {
			return nil, fmt.Errorf("invalid MCP allowed origin %q", origin)
		}
		h.origins[origin] = true
	}
	h.ctx, h.cancel = context.WithCancel(context.Background())
	h.server = mcp.NewServer(&mcp.Implementation{Name: "visualise-ai", Version: opts.Version}, &mcp.ServerOptions{Capabilities: &mcp.ServerCapabilities{}, PageSize: 200})
	if opts.Register != nil {
		if err := opts.Register(h.server); err != nil {
			h.cancel()
			return nil, err
		}
	}
	h.server.AddReceivingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			ctx, cancel := context.WithTimeout(ctx, opts.RequestTimeout)
			defer cancel()
			stop := context.AfterFunc(h.ctx, cancel)
			defer stop()
			return next(ctx, method, req)
		}
	})
	h.transport = mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return h.server }, &mcp.StreamableHTTPOptions{SessionTimeout: opts.SessionTimeout, MaxRequestBodyBytes: MaxRequestBytes})
	return h, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Validate the original Host forwarded by Nginx, including its port. Forwarded
	// headers are deliberately not an authority for either allowlist.
	if !h.hosts[strings.ToLower(r.Host)] {
		http.Error(w, "forbidden MCP host", http.StatusForbidden)
		return
	}
	origins := r.Header.Values("Origin")
	if len(origins) > 1 || (len(origins) == 1 && !h.origins[origins[0]]) {
		http.Error(w, "forbidden MCP origin", http.StatusForbidden)
		return
	}
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		http.Error(w, "MCP shutting down", http.StatusServiceUnavailable)
		return
	}
	h.active.Add(1)
	h.mu.Unlock()
	defer h.active.Done()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stop := context.AfterFunc(h.ctx, cancel)
	defer stop()
	// Bound slow request body reads without imposing a write timeout on SSE.
	if r.Method == http.MethodPost {
		controller := http.NewResponseController(w)
		_ = controller.SetReadDeadline(time.Now().Add(10 * time.Second))
		defer controller.SetReadDeadline(time.Time{})
	}
	h.transport.ServeHTTP(w, r.WithContext(ctx))
}

// Shutdown rejects new calls, cancels handlers/streams, and waits up to ctx's
// deadline. It never starts, finishes, or reports a domain run.
func (h *Handler) Shutdown(ctx context.Context) error {
	h.mu.Lock()
	h.closed = true
	h.cancel()
	h.mu.Unlock()
	done := make(chan struct{})
	go func() {
		for session := range h.server.Sessions() {
			_ = session.Close()
		}
		h.active.Wait()
		// A request admitted just before shutdown can create a session after
		// the first snapshot. Close that final set after all HTTP calls drain.
		for session := range h.server.Sessions() {
			_ = session.Close()
		}
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (h *Handler) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return h.Shutdown(ctx)
}
