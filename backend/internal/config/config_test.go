package config

import (
	"testing"
	"time"
)

func TestLoadRequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected an error when DATABASE_URL is missing")
	}
}

func TestLoadAppliesDocumentedDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@postgres:5432/db?sslmode=disable")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.HTTPAddr != defaultHTTPAddr {
		t.Errorf("HTTPAddr = %q, want %q", cfg.HTTPAddr, defaultHTTPAddr)
	}
	if cfg.LogLevel != defaultLogLevel {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, defaultLogLevel)
	}
	if cfg.MaxEventBytes != defaultMaxEventBytes {
		t.Errorf("MaxEventBytes = %d, want %d", cfg.MaxEventBytes, defaultMaxEventBytes)
	}
	if cfg.ShutdownTimeout != defaultShutdownTimeout {
		t.Errorf("ShutdownTimeout = %s, want %s", cfg.ShutdownTimeout, defaultShutdownTimeout)
	}
}

func TestLoadOverridesFromEnvironment(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@postgres:5432/db?sslmode=disable")
	t.Setenv("HTTP_ADDR", ":9090")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("LOG_FORMAT", "console")
	t.Setenv("MAX_EVENT_BYTES", "4194304")
	t.Setenv("SHUTDOWN_TIMEOUT", "30s")
	t.Setenv("DATABASE_CONNECT_TIMEOUT", "5s")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.HTTPAddr != ":9090" {
		t.Errorf("HTTPAddr = %q", cfg.HTTPAddr)
	}
	if cfg.LogFormat != "console" {
		t.Errorf("LogFormat = %q", cfg.LogFormat)
	}
	if cfg.MaxEventBytes != 4*1024*1024 {
		t.Errorf("MaxEventBytes = %d", cfg.MaxEventBytes)
	}
	if cfg.ShutdownTimeout != 30*time.Second {
		t.Errorf("ShutdownTimeout = %s", cfg.ShutdownTimeout)
	}
	if cfg.DatabaseConnectTimeout != 5*time.Second {
		t.Errorf("DatabaseConnectTimeout = %s", cfg.DatabaseConnectTimeout)
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	cases := map[string]map[string]string{
		"log format":     {"LOG_FORMAT": "xml"},
		"max event size": {"MAX_EVENT_BYTES": "-1"},
		"shutdown":       {"SHUTDOWN_TIMEOUT": "soon"},
	}

	for name, env := range cases {
		t.Run(name, func(t *testing.T) {
			t.Setenv("DATABASE_URL", "postgres://u:p@postgres:5432/db?sslmode=disable")
			for k, v := range env {
				t.Setenv(k, v)
			}
			if _, err := Load(); err == nil {
				t.Fatalf("expected an error for %s", name)
			}
		})
	}
}

func TestMCPTransportConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test")
	t.Setenv("MCP_ALLOWED_HOSTS", "localhost:18178, 127.0.0.1:18178")
	t.Setenv("MCP_ALLOWED_ORIGINS", "http://localhost:18178")
	t.Setenv("MCP_REQUEST_TIMEOUT", "10s")
	t.Setenv("MCP_SESSION_TIMEOUT", "1m")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.MCPAllowedHosts) != 2 || cfg.MCPAllowedHosts[1] != "127.0.0.1:18178" || cfg.MCPAllowedOrigins[0] != "http://localhost:18178" || cfg.MCPRequestTimeout != 10*time.Second || cfg.MCPSessionTimeout != time.Minute {
		t.Fatalf("MCP configuration %+v", cfg)
	}
	t.Setenv("MCP_REQUEST_TIMEOUT", "0s")
	if _, err := Load(); err == nil {
		t.Fatal("accepted zero request deadline")
	}
}
