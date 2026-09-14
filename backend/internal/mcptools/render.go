package mcptools

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/risqyy/visualise-ai/backend/internal/render"
)

type Renderer interface {
	Render(context.Context, render.Request) (render.Result, error)
}
type Options struct{ Renderer Renderer }

var renderDefinition = definition{"visualise_view_render", "Render a saved architecture view at exact model AND view revisions using the native frontend, without a user browser. Read model/view first; stale revisions fail. Returns one PNG and metadata with actually painted IDs, missing references and clipping. Native readable camera may clip large graphs. Maximum 30 seconds, two concurrent requests, 4 MiB PNG; reduce scope or viewport when bounded output fails. Rendering reports no work and changes no model, view or user camera.", true}

func (s *Service) availableDefinitions() []definition {
	result := append([]definition{}, definitions...)
	if s.renderer != nil {
		result = append(result, renderDefinition)
	}
	return result
}
func (s *Service) Names() []string {
	result := []string{}
	for _, def := range s.availableDefinitions() {
		result = append(result, def.Name)
	}
	return result
}
func (s *Service) callRender(ctx context.Context, raw json.RawMessage) *mcp.CallToolResult {
	var args map[string]any
	input := json.NewDecoder(bytes.NewReader(raw))
	input.UseNumber()
	if err := input.Decode(&args); err != nil {
		return errorResult(err)
	}
	viewport := args["viewport"].(map[string]any)
	request := render.Request{ProjectID: args["projectId"].(string), ViewID: args["viewId"].(string), ExpectedModelRevision: integer(args["expectedModelRevision"]), ExpectedViewRevision: integer(args["expectedViewRevision"]), DetailLevel: args["detailLevel"].(string), Viewport: render.Viewport{Width: integer(viewport["width"]), Height: integer(viewport["height"]), PixelRatio: integer(viewport["pixelRatio"])}}
	result, err := s.renderer.Render(ctx, request)
	if err != nil {
		return errorResult(err)
	}
	encoded, err := json.Marshal(result.Metadata)
	if err != nil {
		return errorResult(err)
	}
	if len(encoded) > MaxResponseBytes || len(result.PNG) > render.MaxImageBytes {
		return errorResult(domain("response_too_large", "", "Rendered response exceeds its size limit."))
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	if err = decoder.Decode(&value); err != nil {
		return errorResult(err)
	}
	if err = s.outputs[renderDefinition.Name].Validate(value); err != nil {
		return errorResult(domain("internal_error", "", "Render metadata does not match the published contract."))
	}
	return &mcp.CallToolResult{StructuredContent: json.RawMessage(encoded), Content: []mcp.Content{
		&mcp.TextContent{Text: string(encoded)}, &mcp.ImageContent{MIMEType: "image/png", Data: result.PNG},
	}}
}
