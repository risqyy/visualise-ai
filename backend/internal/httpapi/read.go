package httpapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"

	"github.com/risqyy/visualise-ai/backend/internal/readapi"
)

// problemBaseURI prefixes the `type` of every problem document this API serves.
const problemBaseURI = "https://visualise-ai.local/problems/"

// problemContentType is the media type RFC 9457 prescribes.
const problemContentType = "application/problem+json"

// registerRead mounts the project scoped read endpoints.
//
// It is the single entry point of this work package into the router, so the
// read models can be wired without touching any other registration.
func registerRead(engine *gin.Engine, service *readapi.Service, logger zerolog.Logger) {
	if service == nil {
		// A router built without the read models — the probe tests do that —
		// simply does not offer them, instead of panicking on a nil service.
		return
	}

	group := engine.Group(APIPrefix)
	group.GET("/projects", listProjectsHandler(service, logger))
	group.GET("/projects/:projectId", getProjectHandler(service, logger))
	group.GET("/projects/:projectId/architecture", getArchitectureHandler(service, logger))
	group.GET("/projects/:projectId/runs", listRunsHandler(service, logger))
	group.GET("/projects/:projectId/runs/:runId", getRunHandler(service, logger))
	group.GET("/projects/:projectId/runs/:runId/agents", listAgentsHandler(service, logger))
	group.GET("/projects/:projectId/runs/:runId/plans", listPlansHandler(service, logger))
	group.GET("/projects/:projectId/components/:componentId", getComponentHandler(service, logger))
	group.GET("/projects/:projectId/components/:componentId/history", getComponentHistoryHandler(service, logger))
}

func listProjectsHandler(service *readapi.Service, logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		response, err := service.Projects(c.Request.Context())
		if err != nil {
			failRead(c, logger, err)
			return
		}
		c.JSON(http.StatusOK, response)
	}
}

func getProjectHandler(service *readapi.Service, logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		response, err := service.Project(c.Request.Context(), c.Param("projectId"))
		if err != nil {
			failRead(c, logger, err)
			return
		}
		c.JSON(http.StatusOK, response)
	}
}

func getArchitectureHandler(service *readapi.Service, logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		response, err := service.Architecture(c.Request.Context(), c.Param("projectId"))
		if err != nil {
			failRead(c, logger, err)
			return
		}
		c.JSON(http.StatusOK, response)
	}
}

func listRunsHandler(service *readapi.Service, logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		response, err := service.Runs(
			c.Request.Context(),
			c.Param("projectId"),
			c.Query("limit"),
			c.Query("cursor"),
		)
		if err != nil {
			failRead(c, logger, err)
			return
		}
		c.JSON(http.StatusOK, response)
	}
}

func getRunHandler(service *readapi.Service, logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		response, err := service.Run(c.Request.Context(), c.Param("projectId"), c.Param("runId"))
		if err != nil {
			failRead(c, logger, err)
			return
		}
		c.JSON(http.StatusOK, response)
	}
}

func listAgentsHandler(service *readapi.Service, logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		response, err := service.Agents(c.Request.Context(), c.Param("projectId"), c.Param("runId"))
		if err != nil {
			failRead(c, logger, err)
			return
		}
		c.JSON(http.StatusOK, response)
	}
}

func listPlansHandler(service *readapi.Service, logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		response, err := service.Plans(c.Request.Context(), c.Param("projectId"), c.Param("runId"))
		if err != nil {
			failRead(c, logger, err)
			return
		}
		c.JSON(http.StatusOK, response)
	}
}

func getComponentHandler(service *readapi.Service, logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		response, err := service.Component(
			c.Request.Context(),
			c.Param("projectId"),
			c.Param("componentId"),
			readapi.ComponentQuery{
				RunID:      c.Query("runId"),
				DiffLimit:  c.Query("diffLimit"),
				DiffCursor: c.Query("diffCursor"),
			},
		)
		if err != nil {
			failRead(c, logger, err)
			return
		}
		c.JSON(http.StatusOK, response)
	}
}

func getComponentHistoryHandler(service *readapi.Service, logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		response, err := service.History(
			c.Request.Context(),
			c.Param("projectId"),
			c.Param("componentId"),
			c.Query("limit"),
			c.Query("cursor"),
		)
		if err != nil {
			failRead(c, logger, err)
			return
		}
		c.JSON(http.StatusOK, response)
	}
}

// failRead maps a read error onto the RFC 9457 problem the contract promises.
//
// Everything the read layer can report is a client error with a stable `code`;
// anything else is a defect of this service and is logged rather than leaked to
// the client.
func failRead(c *gin.Context, logger zerolog.Logger, err error) {
	var invalid *readapi.ValidationError
	switch {
	case errors.As(err, &invalid):
		writeValidationProblem(c, invalid)
	case errors.Is(err, readapi.ErrProjectNotFound):
		writeProblem(c, http.StatusNotFound, "project_not_found", "Project not found",
			"No project with id "+quoted(c.Param("projectId"))+" exists.")
	case errors.Is(err, readapi.ErrCurrentRunNotFound):
		writeProblem(c, http.StatusNotFound, "current_run_not_found", "No current run",
			"Project "+quoted(c.Param("projectId"))+" has no current run; no root orchestrator has opened one.")
	case errors.Is(err, readapi.ErrRunNotFound):
		writeProblem(c, http.StatusNotFound, "run_not_found", "Run not found",
			"No run with id "+quoted(c.Param("runId"))+" exists in project "+quoted(c.Param("projectId"))+".")
	case errors.Is(err, readapi.ErrComponentNotFound):
		writeProblem(c, http.StatusNotFound, "component_not_found", "Component not found",
			"Project "+quoted(c.Param("projectId"))+" has never reported component "+quoted(c.Param("componentId"))+".")
	default:
		logger.Error().Err(err).
			Str("path", c.Request.URL.Path).
			Msg("read query failed")
		writeProblem(c, http.StatusInternalServerError, "internal_error", "Internal Server Error",
			"The read model could not be served.")
	}
}

func writeProblem(c *gin.Context, status int, code, title, detail string) {
	c.Abort()
	c.Header("Content-Type", problemContentType)
	c.JSON(status, gin.H{
		"type":   problemBaseURI + problemPath(code),
		"title":  title,
		"status": status,
		"detail": detail,
		"code":   code,
	})
}

func writeValidationProblem(c *gin.Context, invalid *readapi.ValidationError) {
	const code = "invalid_query_parameter"

	errorsOut := make([]gin.H, 0, len(invalid.Errors))
	for _, fieldError := range invalid.Errors {
		errorsOut = append(errorsOut, gin.H{
			"field":   fieldError.Field,
			"code":    fieldError.Code,
			"message": fieldError.Message,
		})
	}

	c.Abort()
	c.Header("Content-Type", problemContentType)
	c.JSON(http.StatusBadRequest, gin.H{
		"type":   problemBaseURI + problemPath(code),
		"title":  "Invalid query parameter",
		"status": http.StatusBadRequest,
		"detail": "One or more query parameters of this request are not acceptable.",
		"code":   code,
		"errors": errorsOut,
	})
}

// problemPath turns a snake_case code into the kebab-case slug used in `type`.
func problemPath(code string) string {
	out := make([]byte, 0, len(code))
	for i := 0; i < len(code); i++ {
		if code[i] == '_' {
			out = append(out, '-')
			continue
		}
		out = append(out, code[i])
	}
	return string(out)
}

// quoted wraps a value so an identifier stays recognisable inside a sentence.
func quoted(value string) string { return `"` + value + `"` }
