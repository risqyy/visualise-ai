// Package readapi serves the UI oriented read models of one project.
//
// Every query reads the normalised projections the store advances inside the
// append transaction. The event log itself is touched in exactly one place —
// the component history — and even there through the `event_components` join
// table rather than a JSONB scan over `events`.
//
// Two properties are structural rather than conventional here:
//
//   - Every statement filters on `project_id`, so a response can never carry a
//     row of another project, not even when two projects reuse the same run,
//     agent or component identifiers.
//   - Component scoped evidence is loaded through the join tables
//     (`feedback_components`, `diff_components`, `risk_components`,
//     `problem_components`, `work_step_components`) with one statement per
//     collection. No handler runs a query per row.
//
// Composing an HTTP response, mapping the errors below onto status codes and
// serving RFC 9457 problems are not this package's concern; the httpapi layer
// owns them.
package readapi

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// CurrentRunAlias is the literal that `runs/{runId}` accepts in place of a run
// identifier. It resolves to `projects.current_run_id`, which the store sets
// when a root orchestrator opens a run.
//
// The alias wins over a run that happens to carry the same identifier: the
// cockpit's default view must not depend on how an agent named its run.
const CurrentRunAlias = "current"

// The read API rejects a request for something that does not exist rather than
// inventing an empty answer, so a stale deep link is visible instead of silent.
var (
	// ErrProjectNotFound reports an unknown projectId.
	ErrProjectNotFound = errors.New("readapi: project not found")
	// ErrRunNotFound reports a run that does not exist in this project.
	ErrRunNotFound = errors.New("readapi: run not found")
	// ErrCurrentRunNotFound reports that the project has never had a run opened
	// by a root orchestrator. It is deliberately distinct from ErrRunNotFound so
	// the UI can tell "no run yet" from "this run id is wrong".
	ErrCurrentRunNotFound = errors.New("readapi: project has no current run")
	// ErrComponentNotFound reports a component the project has never reported,
	// neither in the applied model nor in its history.
	ErrComponentNotFound = errors.New("readapi: component not found")
)

// FieldError is one violated query parameter.
type FieldError struct {
	// Field is a JSON Pointer style reference to the rejected parameter, for
	// example `/limit`. The read endpoints have no request body, so the pointer
	// names the query parameter.
	Field string
	// Code is the stable, machine-readable violation code.
	Code string
	// Message explains this single violation.
	Message string
}

// ValidationError collects every rejected query parameter of one request. The
// httpapi layer turns it into a `400` ValidationProblem.
type ValidationError struct {
	Errors []FieldError
}

// Error implements error.
func (e *ValidationError) Error() string {
	if len(e.Errors) == 0 {
		return "readapi: invalid request"
	}
	return "readapi: invalid request: " + e.Errors[0].Field + " " + e.Errors[0].Message
}

// Service answers the read endpoints of the cockpit.
type Service struct {
	db *gorm.DB
}

// New returns a Service reading through db.
func New(db *gorm.DB) *Service { return &Service{db: db} }

// project loads the head row of one project.
//
// It is the first statement of every project scoped endpoint: it establishes
// that the project exists and yields `last_position`, which every response
// repeats as `projectPosition` so an HTTP snapshot and the SSE stream can be
// reconciled deterministically.
func (s *Service) project(ctx context.Context, projectID string) (store.Project, error) {
	var project store.Project
	err := s.db.WithContext(ctx).Where("project_id = ?", projectID).Take(&project).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return store.Project{}, ErrProjectNotFound
	case err != nil:
		return store.Project{}, err
	default:
		return project, nil
	}
}

// resolveRun turns a requested run identifier into a run of this project.
//
// The literal CurrentRunAlias resolves to the project's current run; every
// other value must name a run the project actually has.
func (s *Service) resolveRun(ctx context.Context, project store.Project, runID string) (store.Run, error) {
	wanted := runID
	if wanted == CurrentRunAlias {
		if project.CurrentRunID == "" {
			return store.Run{}, ErrCurrentRunNotFound
		}
		wanted = project.CurrentRunID
	}

	var run store.Run
	err := s.db.WithContext(ctx).
		Where("project_id = ? AND run_id = ?", project.ProjectID, wanted).
		Take(&run).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		if runID == CurrentRunAlias {
			// projects.current_run_id points at a run that no longer exists.
			// Reporting the alias failure is the honest answer.
			return store.Run{}, ErrCurrentRunNotFound
		}
		return store.Run{}, ErrRunNotFound
	case err != nil:
		return store.Run{}, err
	default:
		return run, nil
	}
}
