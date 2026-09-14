package ingest

import (
	"encoding/json"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// roleOrchestrator is the role a root agent reports. Only the agent that opened
// a run with it may close the run again.
const roleOrchestrator = "orchestrator"

// LifecycleError reports an event that is well formed and schema valid but
// contradicts the state the project is in. It is answered with 422.
type LifecycleError struct {
	Code   string
	Detail string
}

// Error implements error.
func (e *LifecycleError) Error() string {
	return fmt.Sprintf("ingest: %s: %s", e.Code, e.Detail)
}

// reject is shorthand for building a LifecycleError.
func reject(code, format string, args ...any) *LifecycleError {
	return &LifecycleError{Code: code, Detail: fmt.Sprintf(format, args...)}
}

// isWorkEvent reports whether an event is refused by a finished run.
//
// Everything is a work event except corrections and retractions. A run that
// reported run.finished stops accepting reports of new work, but it must stay
// correctable: an agent that notices afterwards that it reported something
// wrongly has no other way to put the record straight, and the log is
// append-only, so a correction cannot be applied retroactively either. Locking
// a finished run completely would make its last state permanently wrong.
func isWorkEvent(eventType string) bool {
	return eventType != store.TypeCorrectionIssued && eventType != store.TypeRetractionIssued
}

// opensRun reports whether the event is the root agent.started that opens a
// run: an orchestrator without a parent agent.
func opensRun(env store.Envelope, role string) bool {
	return env.Type == store.TypeAgentStarted &&
		role == roleOrchestrator &&
		env.ParentAgentID == nil
}

// checkLifecycle enforces the project lifecycle rules for one new event.
//
// It runs inside the append transaction with the project row locked, so every
// lookup below sees exactly the events committed before this one and nothing
// half written. Returning an error rolls the append back untouched.
func checkLifecycle(tx *gorm.DB, ev acceptedEvent) error {
	env := ev.envelope

	run, runFound, err := loadRun(tx, env.ProjectID, env.RunID)
	if err != nil {
		return err
	}
	// A run exists for the cockpit only once a root orchestrator opened it.
	// Every other event of the run is rejected until then, so a run row without
	// a root agent cannot come into being through the ingestion endpoint.
	runOpened := runFound && run.RootAgentID != ""

	if opensRun(env, ev.role) {
		if runOpened {
			return reject(CodeRunAlreadyStarted,
				"run %q was already opened by agent %q; a run has exactly one root orchestrator",
				env.RunID, run.RootAgentID)
		}
		return nil
	}

	if !runOpened {
		return reject(CodeRunNotStarted,
			"run %q was never opened; the first event of a run must be an agent.started of its root orchestrator",
			env.RunID)
	}

	if !run.IsOpen && isWorkEvent(env.Type) {
		return reject(CodeRunAlreadyFinished,
			"run %q reported run.finished; work events are rejected, only correction.issued and retraction.issued remain accepted",
			env.RunID)
	}

	if env.Type == store.TypeAgentStarted {
		_, found, err := loadAgent(tx, env.ProjectID, env.RunID, env.AgentID)
		if err != nil {
			return err
		}
		if found {
			return reject("agent_already_started", "agent %q is already registered in run %q", env.AgentID, env.RunID)
		}
		if env.ParentAgentID == nil {
			return reject(CodeParentAgentUnknown, "a non-root agent must have a registered parent")
		}
	}
	// An agent.started introduces its own agent, so it is the one event that
	// does not require the reporting agent to be known already.
	if env.Type != store.TypeAgentStarted {
		agent, found, err := loadAgent(tx, env.ProjectID, env.RunID, env.AgentID)
		if err != nil {
			return err
		}
		if !found {
			return reject(CodeUnknownAgent,
				"agent %q never reported agent.started in run %q", env.AgentID, env.RunID)
		}

		if !sameParent(agent.ParentAgentID, env.ParentAgentID) {
			return reject(CodeParentAgentUnknown, "reported parent does not match the immutable parent of agent %q", env.AgentID)
		}
		if env.Type == store.TypeRunFinished && !isRunOrchestrator(run, agent) {
			return reject(CodeTerminalEventNotAllowed,
				"run.finished may only be reported by the orchestrator of run %q, which is agent %q, not %q",
				env.RunID, run.RootAgentID, env.AgentID)
		}
	}

	if env.ParentAgentID != nil {
		_, found, err := loadAgent(tx, env.ProjectID, env.RunID, *env.ParentAgentID)
		if err != nil {
			return err
		}
		if !found {
			return reject(CodeParentAgentUnknown,
				"parent agent %q never reported agent.started in run %q", *env.ParentAgentID, env.RunID)
		}
	}

	if ev.correctionTarget != "" {
		found, err := eventExists(tx, env.ProjectID, ev.correctionTarget)
		if err != nil {
			return err
		}
		if !found {
			return reject(CodeCorrectionTargetUnknown,
				"no event with clientEventId %q exists in project %q", ev.correctionTarget, env.ProjectID)
		}
	}

	if env.Type == store.TypeCorrectionIssued {
		return checkEffectiveCorrection(tx, ev)
	}
	return nil
}

// isRunOrchestrator reports whether the agent is the root orchestrator of the
// run. Both halves are checked: the run points at its root agent, and that
// agent reported the orchestrator role when it started.
func isRunOrchestrator(run store.Run, agent store.Agent) bool {
	return run.RootAgentID == agent.AgentID && agent.Role == roleOrchestrator
}

func loadRun(tx *gorm.DB, projectID, runID string) (store.Run, bool, error) {
	var run store.Run
	err := tx.Where("project_id = ? AND run_id = ?", projectID, runID).Take(&run).Error
	switch {
	case err == nil:
		return run, true, nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		return store.Run{}, false, nil
	default:
		return store.Run{}, false, err
	}
}

func loadAgent(tx *gorm.DB, projectID, runID, agentID string) (store.Agent, bool, error) {
	var agent store.Agent
	err := tx.Where("project_id = ? AND run_id = ? AND agent_id = ?", projectID, runID, agentID).
		Take(&agent).Error
	switch {
	case err == nil:
		return agent, true, nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		return store.Agent{}, false, nil
	default:
		return store.Agent{}, false, err
	}
}

// eventExists reports whether a clientEventId was already accepted for the
// project. Correction targets are project scoped, not run scoped: a later run
// may well correct something an earlier one reported.
func eventExists(tx *gorm.DB, projectID, clientEventID string) (bool, error) {
	var count int64
	err := tx.Model(&store.Event{}).
		Where("project_id = ? AND client_event_id = ?", projectID, clientEventID).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func sameParent(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// Corrections use the correcting envelope's reporter/run in the existing
// projector; validate that exact effective event without reopening closed runs.
func checkEffectiveCorrection(tx *gorm.DB, ev acceptedEvent) error {
	var p struct {
		Type    string          `json:"correctedType"`
		Payload json.RawMessage `json:"correctedPayload"`
	}
	if err := json.Unmarshal(ev.envelope.Payload, &p); err != nil {
		return err
	}
	if p.Type == store.TypeCorrectionIssued || p.Type == store.TypeRetractionIssued {
		return nil
	}
	env := ev.envelope
	env.Type = p.Type
	env.Payload = p.Payload
	run, _, err := loadRun(tx, env.ProjectID, env.RunID)
	if err != nil {
		return err
	}
	agent, found, err := loadAgent(tx, env.ProjectID, env.RunID, env.AgentID)
	if err != nil {
		return err
	}
	if !found {
		return reject(CodeUnknownAgent, "unknown correction reporter")
	}
	if p.Type == store.TypeAgentStarted {
		var start struct {
			Role string `json:"role"`
		}
		if err := json.Unmarshal(p.Payload, &start); err != nil {
			return err
		}
		if !sameParent(agent.ParentAgentID, env.ParentAgentID) || agent.Role != start.Role {
			return reject("agent_already_started", "a correction cannot change agent parentage or role")
		}
		if env.ParentAgentID == nil && (run.RootAgentID != env.AgentID || start.Role != roleOrchestrator) {
			return reject(CodeRunAlreadyStarted, "a correction cannot replace the run root")
		}
	}
	if p.Type == store.TypeRunFinished && !isRunOrchestrator(run, agent) {
		return reject(CodeTerminalEventNotAllowed, "only the run root can correct run.finished")
	}
	return nil
}
