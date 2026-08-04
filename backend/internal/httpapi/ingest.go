package httpapi

import (
	"github.com/gin-gonic/gin"

	"github.com/risqyy/visualise-ai/backend/internal/ingest"
)

// registerIngestRoutes mounts the write path of the event contract.
//
// The handler is optional so a router can be built without a database — the
// probe-only router of the tests does exactly that. A nil handler simply leaves
// POST /api/v1/events unregistered, where the router answers 404 as for any
// other unknown route.
func registerIngestRoutes(engine *gin.Engine, handler *ingest.Handler) {
	if handler == nil {
		return
	}
	engine.POST(APIPrefix+ingest.EventsPath, handler.Ingest)
}
