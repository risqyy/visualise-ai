package mcptools

import (
	"context"
	"encoding/json"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/risqyy/visualise-ai/backend/internal/render"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"reflect"
	"testing"
	"time"
)

type rendererFunc func(context.Context, render.Request) (render.Result, error)

func (f rendererFunc) Render(ctx context.Context, r render.Request) (render.Result, error) {
	return f(ctx, r)
}

func TestAdvertisedSchemasAcceptStructuredErrorsButSuccessValidationStaysStrict(t *testing.T) {
	s, err := New(nil, nil, Options{Renderer: rendererFunc(func(context.Context, render.Request) (render.Result, error) {
		return render.Result{}, domain("render_failed", "", "test")
	})})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server := mcp.NewServer(&mcp.Implementation{Name: "schema-regression", Version: "1"}, nil)
	if err = s.Register(server); err != nil {
		t.Fatal(err)
	}
	a, b := mcp.NewInMemoryTransports()
	serving, err := server.Connect(ctx, a, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer serving.Close()
	client := mcp.NewClient(&mcp.Implementation{Name: "schema-client", Version: "1"}, nil)
	session, err := client.Connect(ctx, b, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	catalogue, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range catalogue.Tools {
		compiler := jsonschema.NewCompiler()
		const uri = "https://visualise.invalid/advertised"
		if err = compiler.AddResource(uri, tool.OutputSchema); err != nil {
			t.Fatal(err)
		}
		output, err := compiler.Compile(uri)
		if err != nil {
			t.Fatal(err)
		}
		failure := map[string]any{"code": "revision_conflict", "message": "Read current revisions.", "fields": []any{}, "currentModelRevision": 2, "currentViewRevision": 1}
		if err = output.Validate(failure); err != nil {
			t.Fatalf("%s hides valid errors: %v", tool.Name, err)
		}
		if s.outputs[tool.Name].Validate(failure) == nil {
			t.Fatalf("%s internal success validation weakened", tool.Name)
		}
		if output.Validate(map[string]any{"code": "invented_error", "message": "wrong", "fields": []any{}}) == nil {
			t.Fatalf("%s error schema widened", tool.Name)
		}
	}
}
func TestOptionalRenderDiscoveryAndImageContent(t *testing.T) {
	absent, err := New(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range absent.Names() {
		if name == "visualise_view_render" {
			t.Fatal("advertised missing renderer")
		}
	}
	called := 0
	renderer := rendererFunc(func(_ context.Context, r render.Request) (render.Result, error) {
		called++
		if r.ProjectID != "project-aa" || r.ViewID != "view-aa" || r.ExpectedModelRevision != 0 || r.ExpectedViewRevision != 1 || r.Viewport.Width != 320 || r.Viewport.PixelRatio != 2 {
			t.Fatal(r)
		}
		png := []byte{137, 80, 78, 71}
		return render.Result{PNG: png, Metadata: render.Metadata{ProjectID: r.ProjectID, ViewID: r.ViewID, ModelRevision: 0, ProjectPosition: 2, ViewRevision: 1, RenderedAt: "2026-09-14T00:00:00Z", Viewport: r.Viewport, DetailLevel: r.DetailLevel, MimeType: "image/png", ByteLength: len(png), Painting: render.Painting{MissingReferences: render.IDs{ComponentIDs: []string{}, RelationshipIDs: []string{}}, BoundaryRelationshipIDs: []string{}, VisibleIDs: render.IDs{ComponentIDs: []string{}, RelationshipIDs: []string{}}}}}, nil
	})
	s, err := New(nil, nil, Options{Renderer: renderer})
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Names()) != len(absent.Names())+1 {
		t.Fatal(s.Names())
	}
	discovered := s.call(context.Background(), "visualise_discover", json.RawMessage(`{}`))
	if discovered.IsError {
		t.Fatal(discovered)
	}
	var discovery struct{ Tools []string }
	raw, _ := json.Marshal(discovered.StructuredContent)
	if err = json.Unmarshal(raw, &discovery); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(discovery.Tools, s.Names()) {
		t.Fatal(discovery)
	}
	// Schema accepts mathematically integral JSON spellings; adapters must too.
	result := s.call(context.Background(), "visualise_view_render", json.RawMessage(`{"contractVersion":"2.0.0","projectId":"project-aa","viewId":"view-aa","expectedModelRevision":0e0,"expectedViewRevision":1.0,"viewport":{"width":320.0,"height":240,"pixelRatio":2e0},"detailLevel":"full"}`))
	if result.IsError || called != 1 {
		t.Fatal(result, called)
	}
	images := 0
	for _, item := range result.Content {
		if image, ok := item.(*mcp.ImageContent); ok {
			images++
			if image.MIMEType != "image/png" || len(image.Data) != 4 {
				t.Fatal(image)
			}
		}
	}
	if images != 1 {
		t.Fatal(result.Content)
	}
	invalid := s.call(context.Background(), "visualise_view_render", json.RawMessage(`{"contractVersion":"2.0.0","projectId":"project-aa","viewId":"view-aa","expectedModelRevision":0,"expectedViewRevision":1,"viewport":{"width":319,"height":240,"pixelRatio":1},"detailLevel":"full"}`))
	if !invalid.IsError || called != 1 {
		t.Fatal("invalid input reached renderer")
	}
}
