package httpapi

import (
	"github.com/gin-gonic/gin"

	"github.com/risqyy/visualise-ai/backend/internal/sse"
)

// registerStream mounts the Server-Sent Events endpoint of one project.
//
// The handler is optional so a router can be built without a broker — the
// probe-only and read-only routers of the tests do exactly that. A nil handler
// leaves the route unregistered, where the router answers 404 as for any other
// unknown route.
//
// The route reuses the `:projectId` wildcard of the read models on purpose:
// Gin keeps a single wildcard name per position in its routing tree, so a
// differently named parameter at the same position panics while the engine is
// being built, not when the first request arrives.
func registerStream(engine *gin.Engine, handler *sse.Handler) {
	if handler == nil {
		return
	}
	engine.Group(APIPrefix).GET(sse.Path, handler.Stream)
}
