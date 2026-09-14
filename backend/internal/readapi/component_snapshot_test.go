package readapi_test

import (
	"context"
	"reflect"
	"testing"

	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/store"
	"gorm.io/gorm"
)

// A writer commits after the inspector has read the project head but before it
// reads the selected run, component or evidence. The callback is synchronous:
// no sleeps or scheduler timing are needed to exercise the read boundary.
func TestComponentInspectorUsesOneReadOnlySnapshot(t *testing.T) {
	for _, test := range []struct {
		name   string
		runID  string
		remove bool
	}{
		{name: "implicit current run"},
		{name: "current alias", runID: "current"},
		{name: "explicit run", runID: "run-one"},
		{name: "concurrent removal", runID: "run-one", remove: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			h := newHarness(t)
			run := h.run("snapshot-project", "run-one")
			run.startRoot("root", "Inspect a consistent state")
			run.emit("root", nil, store.TypeArchitectureSnapshotPublished,
				`{"snapshotId":"initial","components":[{"componentId":"component","name":"Before","kind":"module","parentComponentId":null}],"relationships":[]}`)
			run.emit("root", nil, store.TypeWorkStepStarted,
				`{"workStepId":"work","title":"Initial work","componentIds":["component"]}`)
			run.emit("root", nil, store.TypeFeedbackPublished, feedbackPayload("feedback-before", "component", "Before"))
			run.emit("root", nil, store.TypeDiffReported, diffPayload("diff-first", "component", "first.go"))
			run.emit("root", nil, store.TypeDiffReported, diffPayload("diff-before", "component", "before.go"))
			run.emit("root", nil, store.TypeRiskReported,
				`{"riskId":"risk-before","componentIds":["component"],"title":"Before","severity":"medium"}`)
			run.emit("root", nil, store.TypeProblemReported,
				`{"problemId":"problem-before","componentIds":["component"],"title":"Before"}`)
			run.emit("root", nil, store.TypeComponentChangePlanned,
				`{"changeId":"change-before","operation":"modify","component":{"componentId":"component","name":"Planned","kind":"module","parentComponentId":null}}`)

			query := readapi.ComponentQuery{RunID: test.runID, DiffLimit: "1"}
			before, err := h.service.Component(context.Background(), run.projectID, "component", query)
			if err != nil {
				t.Fatal(err)
			}
			if before.NextDiffCursor == nil {
				t.Fatal("fixture must exercise diff pagination")
			}

			type inspectorRead struct{}
			ctx := context.WithValue(context.Background(), inspectorRead{}, true)
			interleaved := false
			const callback = "test:commit_after_inspector_head"
			err = h.db.Callback().Query().After("gorm:query").Register(callback, func(tx *gorm.DB) {
				if tx.Error != nil || tx.Statement.Table != "projects" || tx.Statement.Context.Value(inspectorRead{}) != true || interleaved {
					return
				}
				interleaved = true
				var settings struct{ Isolation, ReadOnly string }
				if err := tx.Session(&gorm.Session{NewDB: true}).Raw("SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only").Scan(&settings).Error; err != nil {
					t.Fatal(err)
				}
				if settings.Isolation != "repeatable read" || settings.ReadOnly != "on" {
					t.Errorf("inspector transaction = %+v; want repeatable read, read-only", settings)
				}

				// These appends use the pool, not the inspector's transaction.
				// Returning from emit proves each new projection is committed.
				if test.remove {
					run.emit("root", nil, store.TypeArchitectureSnapshotPublished,
						`{"snapshotId":"removed","components":[],"relationships":[]}`)
				} else {
					run.emit("root", nil, store.TypeArchitectureSnapshotPublished,
						`{"snapshotId":"changed","components":[{"componentId":"component","name":"After","kind":"module","parentComponentId":null}],"relationships":[]}`)
				}
				run.emit("root", nil, store.TypeWorkStepCompleted, `{"workStepId":"work","summary":"Finished"}`)
				run.emit("root", nil, store.TypeAgentStatusReported, `{"status":"idle","note":"After"}`)
				run.emit("root", nil, store.TypeFeedbackPublished, feedbackPayload("feedback-after", "component", "After"))
				run.emit("root", nil, store.TypeDiffReported, diffPayload("diff-after", "component", "after.go"))
				run.emit("root", nil, store.TypeRiskReported,
					`{"riskId":"risk-after","componentIds":["component"],"title":"After","severity":"high"}`)
				run.emit("root", nil, store.TypeProblemReported,
					`{"problemId":"problem-after","componentIds":["component"],"title":"After"}`)
				run.emit("root", nil, store.TypeComponentChangePlanned,
					`{"changeId":"change-after","operation":"modify","component":{"componentId":"component","name":"After","kind":"module","parentComponentId":null}}`)
				h.run(run.projectID, "run-two").startRoot("new-root", "Now current")
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = h.db.Callback().Query().Remove(callback) })

			during, err := h.service.Component(ctx, run.projectID, "component", query)
			if err != nil {
				t.Fatal(err)
			}
			if !interleaved || h.lastPosition(run.projectID) <= before.ProjectPosition {
				t.Fatal("writer did not commit between the head and remaining inspector reads")
			}
			if !reflect.DeepEqual(during, before) {
				t.Fatalf("inspector mixed committed states:\nbefore: %+v\nduring: %+v", before, during)
			}
			after, err := h.service.Component(context.Background(), run.projectID, "component", readapi.ComponentQuery{RunID: "run-one", DiffLimit: "1"})
			if err != nil {
				t.Fatal(err)
			}
			if after.ProjectPosition <= before.ProjectPosition || after.CurrentWorkStep == nil || after.CurrentWorkStep.CompletedAt == nil || len(after.Feedback) != 2 || len(after.Diffs) != 1 || after.Diffs[0].DiffID != "diff-after" {
				t.Fatalf("a subsequent inspector did not see the committed state: %+v", after)
			}
			if test.remove {
				if after.Component != nil {
					t.Fatal("removed component must remain inspectable through its evidence")
				}
			} else if after.Component == nil || after.Component.Name != "After" {
				t.Fatalf("subsequent inspector component = %+v", after.Component)
			}
		})
	}
}
