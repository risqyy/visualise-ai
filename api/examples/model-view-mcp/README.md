# One complete model-command sequence

This is the #76 implementation example, not a claim that the running server
already exposes these tools. The [contract](../../../docs/model-view-mcp-contract.md)
defines the semantics; [cases.json](cases.json) contains schema-validated tool
inputs/results. Revision/position values below form one consistent timeline.

Every write below merges its shown fields into this shared identity object.
Replace `clientEventId` with the full UUID shown for each step. Preserve the
entire merged input, including `occurredAt`, for an exact retry.

```json
{
  "contractVersion": "2.0.0",
  "projectId": "shop-platform",
  "runId": "run-001",
  "agentId": "agent-root",
  "parentAgentId": null,
  "clientEventId": "00000000-0000-4000-8000-000000000001",
  "occurredAt": "2026-09-14T10:00:00Z"
}
```

1. Call `visualise_context_open` with key ending `000001` and these fields.
   This explicitly opens the run and registers its root. The new project has
   `modelRevision: 0`, `projectPosition: 1`.

```json
{"role":"orchestrator","displayName":"Architect","assignedTask":"Refine the order architecture"}
```

2. Call `visualise_model_mutate` with key
   `00000000-0000-4000-8000-000000000002` to create two components and their edge.
   All references are resolved against the complete candidate batch. The receipt
   has `modelRevision: 1`, `projectPosition: 2`, `duplicate: false`, and affected
   IDs `orders-api`, `orders-db`, `stores-orders`.

```json
{
  "expectedModelRevision": 0,
  "operations": [
    {"op":"component.add","component":{"componentId":"orders-api","name":"Orders API","kind":"service","parentComponentId":null}},
    {"op":"component.add","component":{"componentId":"orders-db","name":"Orders DB","kind":"datastore","parentComponentId":null}},
    {"op":"relationship.add","relationship":{"relationshipId":"stores-orders","sourceComponentId":"orders-api","targetComponentId":"orders-db","kind":"data"}}
  ]
}
```

3. Partially rename the service with key
   `00000000-0000-4000-8000-000000000003`. Its ID, kind, parent and relationship
   stay intact. The receipt is revision 2, position 3; only `orders-api` is affected.

```json
{"expectedModelRevision":1,"operations":[{"op":"component.update","componentId":"orders-api","set":{"name":"Order service"}}]}
```

4. Another client of the same registered agent changes the edge label first,
   with key `00000000-0000-4000-8000-000000000004` and expected revision 2.
   This commits revision 3, position 4; affected relationship `stores-orders`.

```json
{"expectedModelRevision":2,"operations":[{"op":"relationship.update","relationshipId":"stores-orders","set":{"label":"Persists orders"}}]}
```

5. The original client still expects revision 2 and submits key
   `00000000-0000-4000-8000-000000000005`:

```json
{"expectedModelRevision":2,"operations":[{"op":"component.update","componentId":"orders-api","set":{"description":"Handles order commands"}}]}
```

The response is a tool error, not a receipt:

```json
{"code":"revision_conflict","message":"Expected model revision 2; current revision is 3.","fields":[{"pointer":"/expectedModelRevision","message":"Read and reconcile against revision 3."}],"currentModelRevision":3}
```

Nothing is written: revision 3 and position 4 remain current. The client calls
`visualise_model_read` with `contractVersion: "2.0.0"`, `projectId:
"shop-platform"`, `expectedModelRevision: 3` and `limit: 50`. It confirms the
new edge label, reconciles its description-only intent, and issues a new command
with key `00000000-0000-4000-8000-000000000006`:

```json
{"expectedModelRevision":3,"operations":[{"op":"component.update","componentId":"orders-api","set":{"description":"Handles order commands"}}]}
```

6. That command commits revision 4, position 5, but its response is lost. The
   client resends the **identical merged input** with key ending `000006`, still
   expecting revision 3. Replay resolution precedes CAS: it returns the original
   server event ID, timestamp, revision 4, position 5 and affected `orders-api`,
   with `duplicate: true`. No new event or revision is created. Changing only
   `expectedModelRevision` to 4 under that key would instead produce
   `client_event_id_conflict`, not apply another edit.

7. Delete the service and its incident edge together using key
   `00000000-0000-4000-8000-000000000007`:

```json
{
  "expectedModelRevision": 4,
  "operations": [
    {"op":"relationship.remove","relationshipId":"stores-orders"},
    {"op":"component.remove","componentId":"orders-api"}
  ]
}
```

The receipt has revision 5, position 6, affected component `orders-api` and
relationship `stores-orders`. `orders-db` remains. Removing only `orders-api`
would fail `reference_invalid` without consuming either counter. There is no
implicit edge deletion. If the node had children, their explicit removals or
reparenting would also be required in this batch. Retrying the earlier key
ending `000006` even now returns its original revision 4/position 5 receipt;
that response is not a fresh read of the head.

An explicit saved view selecting both original components and the edge now
resolves to `orders-db` with missing component `orders-api` and missing edge
`stores-orders`; it cannot recreate them. Neither the mutation nor its receipt
asserts that repository files changed or that any work step finished.
