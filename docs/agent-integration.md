# Agent-Integration

Für Autoren von Agenten, die an das Cockpit melden wollen. Alles, was hier
steht, lässt sich allein mit [`api/openapi.yaml`](../api/openapi.yaml)
umsetzen — dieser Text erklärt die Regeln, die aus dem Schema allein nicht
hervorgehen, und nennt die Fehler, die man sonst der Reihe nach macht.

Ein Agent braucht genau eine URL: `POST <base>/api/v1/events`. Alles andere —
Datenbank, interne Ports, Read Models — geht ihn nichts an.

## Grundregeln in vier Sätzen

1. **Ein Request, ein Event.** Kein Batching.
2. **`Content-Type: application/json`**, sonst `415`.
3. **Der Katalog ist geschlossen.** 20 Eventtypen, keine Erweiterung, kein
   Freiform-Fallback.
4. **Es wird nur gemeldet, nie abgeleitet.** Was der Agent nicht sendet,
   existiert für das Cockpit nicht.

## Der Umschlag

Jedes Event hat denselben Umschlag; nur `payload` hängt vom `type` ab. Unbekannte
Felder sind auf jeder Ebene verboten (`additionalProperties: false`).

| Feld | Pflicht | Bedeutung |
| --- | --- | --- |
| `schemaVersion` | ja | v0 akzeptiert ausschließlich `"1.0"` |
| `clientEventId` | ja | UUID, vom Agenten vergeben. Der Idempotenzschlüssel — siehe [Idempotenz](#idempotenz-und-retries) |
| `projectId` | ja | Projekt-Slug |
| `runId` | ja | Run-Slug |
| `agentId` | ja | Der **meldende** Agent |
| `parentAgentId` | nein | Der delegierende Agent; `null` oder weggelassen beim Root-Orchestrator. Gehört in **jedes** Event des Subagenten, nicht nur in sein `agent.started` |
| `occurredAt` | ja | RFC-3339-Zeitstempel in UTC (`Z`-Suffix), aus Sicht des Agenten. Unabhängig vom serverseitigen `receivedAt` |
| `type` | ja | Einer der 20 Katalogtypen |
| `payload` | ja | Vom `type` bestimmtes Objekt |

### Zwei verschiedene ID-Formate — eine häufige Stolperfalle

`projectId`, `runId`, `agentId` und `componentId` sind **Slugs** mit einem
strengen Muster: Kleinbuchstaben, Ziffern und Bindestriche, mindestens 3
Zeichen, Anfang und Ende alphanumerisch (`componentId` erlaubt zusätzlich `.`
und `_`). `MyAgent`, `agent_1` oder `ab` werden mit `400` abgelehnt.

`feedbackId`, `diffId`, `planId`, `workStepId`, `relationshipId`, `changeId`,
`snapshotId` dagegen sind freie `Identifier`: 1 bis 128 beliebige Zeichen.

## Lifecycle

Die Reihenfolge der Events ist keine Empfehlung. Sie wird beim Schreiben
erzwungen, innerhalb derselben Transaktion, die das Event anhängt — ein
abgelehntes Event hinterlässt keine Spur und verbraucht keine Position.

### Ein Run wird vom Root-Orchestrator eröffnet

Das **erste** Event eines Runs muss ein `agent.started` mit
`payload.role: "orchestrator"` und `parentAgentId: null` sein. Jedes andere
Event davor wird mit `422 run_not_started` abgelehnt. Ein Run hat genau einen
Root-Orchestrator; ein zweites solches Event ergibt
`422 run_already_started`.

### Jeder Agent meldet sich selbst an — der häufigste Anfängerfehler

> **Jeder Agent muss vorher selbst `agent.started` gesendet haben**, bevor er
> irgendetwas anderes meldet. Sonst antwortet der Server mit
> **`422 unknown_agent`**.

Das ist der Fehler, den praktisch jede erste Integration macht: Der
Orchestrator startet, delegiert, und der Subagent meldet direkt seinen ersten
`work.step_started` — abgelehnt, weil dieser Agent für das Cockpit noch nicht
existiert. `agent.started` ist die einzige Ausnahme von der Regel, weil es den
Agenten überhaupt erst einführt.

Dieselbe Prüfung gilt für `parentAgentId`: Der genannte Elternagent muss im
selben Run bereits `agent.started` gesendet haben, sonst
`422 parent_agent_unknown`.

Praktisch heißt das: **Vor dem ersten Event eines Subagenten steht immer dessen
eigenes `agent.started`.**

### Nur der Orchestrator darf den Run schließen

`run.finished` ist optional und darf ausschließlich vom Root-Orchestrator des
Runs kommen; von jedem anderen Agenten ergibt es
`422 terminal_event_not_allowed`.

Nach `run.finished` werden **Work-Events abgelehnt** (`422
run_already_finished`). Genau zwei Typen bleiben erlaubt:
`correction.issued` und `retraction.issued` — ein geschlossener Run muss
korrigierbar bleiben, denn der Log ist append-only und es gibt keinen anderen
Weg, eine falsche Meldung geradezurücken.

`correction.issued` und `retraction.issued` verweisen über
`correctsClientEventId` bzw. `retractsClientEventId` auf ein Event, das im
selben **Projekt** bereits akzeptiert wurde — sonst
`422 correction_target_unknown`. Beide ersetzen nichts: Das Original bleibt im
Log stehen und wird im Cockpit als korrigiert bzw. zurückgezogen markiert.

### Status wird gemeldet, nie abgeleitet

Es gibt **keine Stall-Erkennung**, keine Timeouts, keine Heuristik. Aus Stille
entsteht kein Status: Der zuletzt gemeldete `agent.status_reported` bleibt
gültig, bis der Agent einen neuen sendet. **Ein Run ohne Terminalevent bleibt
offen** und zeigt seinen letzten gemeldeten Stand — das Cockpit erfindet weder
„fertig" noch „abgestürzt".

Auch `risk.reported` und `problem.reported` sind Aussagen des Agenten über sich
selbst. Das System bewertet nichts. Wer den Zustand eines Runs im Cockpit
sichtbar haben will, muss ihn melden.

## Relevante statt rohe Events

Der Katalog umfasst genau diese 20 Typen:

| Gruppe | Typen |
| --- | --- |
| Agent | `agent.started`, `agent.status_reported`, `agent.progress_reported`, `agent.finished` |
| Plan | `plan.published`, `plan.step_updated` |
| Arbeit | `work.step_started`, `work.step_completed` |
| Feedback | `feedback.published` |
| Architektur | `architecture.snapshot_published` |
| Komponenten | `component.change_planned`, `component.change_applied` |
| Beziehungen | `relationship.change_planned`, `relationship.change_applied` |
| Diff | `diff.reported` |
| Risiko / Problem | `risk.reported`, `problem.reported` |
| Korrektur | `correction.issued`, `retraction.issued` |
| Run | `run.finished` |

**Low-Level-Tool-Aufrufe, Terminalkommandos, Datei-Lesevorgänge, Token-Verbrauch
und rohe Modellausgaben sind kein Bestandteil des Vertrags** und werden
strukturell abgelehnt, nicht bloß ignoriert: `type` ist eine Enumeration, jedes
Payload-Schema ist geschlossen, und der Request-Body ist eine diskriminierte
`oneOf`-Union. Es gibt kein Feld, in das sich Terminalausgabe schmuggeln ließe.

Gemeldet wird, was ein menschlicher Reviewer der beobachteten Anwendung braucht:
was gearbeitet wird, woran, mit welchem Ergebnis. Wer 200 Tool-Aufrufe pro
Minute meldet, hat das Werkzeug missverstanden — und bekommt für jeden davon
ein `400 unsupported_event_type`.

### Regeln, die man beim ersten Mal übersieht

- **Ein `diff.reported` trägt genau eine repository-relative Datei** plus ihren
  Unified Diff. Eine Änderung an drei Dateien sind drei Events mit je eigener
  `diffId` und derselben `changeId`; die `changeId` ist das Einzige, was sie
  zusammenhält. Absolute Pfade und `..`-Segmente lehnt schon das Muster von
  `filePath` ab.
- **Jedes NATS-Topic ist eine eigene Beziehung** mit eigener `relationshipId`,
  `kind: nats_topic` und dem Topic-Namen in `channel`. Topics werden nie zu
  einer „Messaging"-Kante zusammengefasst.
- **`architecture.snapshot_published` ersetzt das angewandte Modell
  vollständig.** Was nicht im Snapshot steht, existiert danach nicht mehr. Für
  inkrementelle Änderungen gibt es `component.change_*` und
  `relationship.change_*`.
- **`parentComponentId` ist ein Pflichtfeld**, auch für Wurzelkomponenten. Dort
  steht dann explizit `null`; weglassen ist ein `400`.
- **Geplant ist nicht angewandt.** `*.change_planned` meldet einen Vorschlag und
  ändert das Modell nicht; erst `*.change_applied` tut das. Das Cockpit zeichnet
  Vorschläge neben das Modell, nie hinein.

## Idempotenz und Retries

`clientEventId` ist der Schlüssel. Er ist pro Projekt eindeutig, und ein Retry
muss denselben Wert **und** denselben Inhalt tragen.

| Fall | Antwort |
| --- | --- |
| Erste Zustellung | `201` mit `duplicate: false` und der neu vergebenen `position` |
| Byte-identische Wiederholung | `200` mit `duplicate: true` und **derselben** `position` wie beim ersten Mal |
| Gleiche ID, abweichender Inhalt | `409 client_event_id_conflict` |

„Byte-identisch" heißt inhaltsgleich, nicht zeichengleich: Der Payload wird
kanonisiert (Objektschlüssel rekursiv sortiert, unerhebliche Leerzeichen
entfernt) und gehasht. Eine andere Schlüsselreihenfolge im JSON ist also
unschädlich, ein geänderter Wert nicht.

Praktisch: Bei einem Netzwerkfehler ohne Antwort einfach **dasselbe Event noch
einmal senden**. Es kann nicht doppelt ankommen. Was man nicht tun darf, ist
den Zeitstempel neu zu berechnen oder ein Feld nachzubessern — dann ist es ein
anderes Event unter derselben ID und wird zum `409`.

Beispielantworten:
[`retry-idempotent-response.json`](../api/examples/retry-idempotent-response.json),
[`conflict-response.json`](../api/examples/conflict-response.json).

## Größenlimit

Ein einzelnes Event darf standardmäßig **2 MiB (2097152 Bytes)** groß sein.
Darüber antwortet der Server `413` mit dem Code `event_too_large`. Der Wert ist
serverseitig über die Umgebungsvariable `MAX_EVENT_BYTES` konfigurierbar
(siehe [Betrieb](./operations.md#konfiguration)) — ein Agent kann ihn nicht
verhandeln und sollte ihn nicht ausreizen.

Das Limit trifft in der Praxis zwei Dinge: sehr große
`architecture.snapshot_published` und sehr große `unifiedDiff`. Beides lässt
sich aufteilen — die Architektur über inkrementelle `change_*`-Events, Diffs
ohnehin pro Datei.

Überschreitet die Anfrage zusätzlich das Limit des Einstiegspunkts
(`MAX_REQUEST_BODY_SIZE`, Default `4m`), lehnt bereits Nginx sie ab. Auch diese
Ablehnung kommt als `application/problem+json` mit `code: event_too_large`, ist
für einen Client also nicht von der des Backends zu unterscheiden — genau das
ist beabsichtigt.

## Fehlerformat

Alle Fehler folgen **RFC 9457** (`application/problem+json`) mit den Feldern
`type`, `title`, `status`, `detail`, `code` und `instance`. Der `code` ist das
stabile, maschinenlesbare Feld — auf ihn programmiert man, nicht auf `detail`.

| Status | Wann | Codes |
| --- | --- | --- |
| `400` | Der Body ist gültiges JSON, verletzt aber den Vertrag | `invalid_field`, `unsupported_event_type`, `unsupported_schema_version` |
| `409` | `clientEventId` mit anderem Inhalt wiederverwendet | `client_event_id_conflict` |
| `413` | Event größer als das Limit | `event_too_large` |
| `415` | Falscher `Content-Type` | `unsupported_media_type` |
| `422` | Schema-gültig, aber im Widerspruch zum Projektzustand | siehe die Tabelle unten |

### `400` nennt die Felder einzeln

Ein `400` trägt zusätzlich `errors[]`. Jeder Eintrag hat ein `field` als
**JSON-Pointer** (RFC 6901) in den gesendeten Body, einen `code` und eine
Meldung. Ein Tippfehler im Umschlag erzeugt typischerweise zwei Einträge — das
unbekannte Feld und das fehlende richtige:

```json
{
  "type": "https://visualise-ai.local/problems/invalid-field",
  "title": "Invalid field", "status": 400, "code": "invalid_field",
  "detail": "the agent.progress_reported event violates the contract in 3 place(s).",
  "instance": "/api/v1/events",
  "errors": [
    { "field": "/occuredAt",       "code": "unknown_property", "message": "property \"occuredAt\" is not declared by the contract" },
    { "field": "/occurredAt",      "code": "required",         "message": "required property \"occurredAt\" is missing" },
    { "field": "/payload/percent", "code": "out_of_range",     "message": "maximum: got 140, want 100" }
  ]
}
```

Weil der Server anhand von `type` genau den einen Zweig der Union validiert, den
der Agent gemeint hat, beziehen sich die Pointer immer auf das gesendete Event —
nicht auf 19 andere Eventtypen. Ein weiteres Beispiel:
[`validation-error-response.json`](../api/examples/validation-error-response.json).

### Die `422`-Codes einzeln

| Code | Bedeutung | Behebung |
| --- | --- | --- |
| `run_not_started` | Der Run wurde nie eröffnet | Zuerst `agent.started` des Root-Orchestrators mit `role: orchestrator` und `parentAgentId: null` senden |
| `run_already_started` | Ein zweiter Root-Orchestrator für denselben Run | Pro Run genau einen Root. Für eine neue Sitzung eine neue `runId` |
| `unknown_agent` | Der meldende Agent hat nie `agent.started` gesendet | Das `agent.started` dieses Agenten vorher senden |
| `parent_agent_unknown` | Der in `parentAgentId` genannte Agent ist unbekannt | Den Elternagenten zuerst starten, oder die ID korrigieren |
| `terminal_event_not_allowed` | Ein anderer Agent als der Orchestrator hat `run.finished` gesendet | `run.finished` dem Root-Orchestrator überlassen |
| `run_already_finished` | Work-Event nach `run.finished` | Neuen Run eröffnen. Korrekturen bleiben über `correction.issued`/`retraction.issued` möglich |
| `correction_target_unknown` | Das korrigierte oder zurückgezogene Event existiert im Projekt nicht | Die `clientEventId` des Originals prüfen; sie ist projektweit, nicht runweit |

## Eine minimale gültige Sequenz

Fünf Events, von Hand gebaut, mehr braucht es nicht, damit das Cockpit etwas
Sinnvolles zeigt: ein Root-Orchestrator, ein Subagent, ein Architektur-Snapshot,
ein Feedback, ein Diff.

```bash
BASE=http://localhost:8080

post() { curl -sS -X POST "$BASE/api/v1/events" -H 'Content-Type: application/json' -d "$1"; echo; }

# 1 — Root-Orchestrator eröffnet den Run
post '{
  "schemaVersion": "1.0",
  "clientEventId": "11111111-1111-4111-8111-111111111111",
  "projectId": "docs-proof", "runId": "run-docs-proof-0001",
  "agentId": "orchestrator-root", "parentAgentId": null,
  "occurredAt": "2026-08-04T12:00:00Z",
  "type": "agent.started",
  "payload": { "role": "orchestrator", "displayName": "Root Orchestrator",
               "assignedTask": "Checkout-Service umbauen und die Arbeit delegieren." }
}'

# 2 — Subagent meldet sich selbst an, bevor er irgendetwas anderes meldet
post '{
  "schemaVersion": "1.0",
  "clientEventId": "22222222-2222-4222-8222-222222222222",
  "projectId": "docs-proof", "runId": "run-docs-proof-0001",
  "agentId": "subagent-implementer", "parentAgentId": "orchestrator-root",
  "occurredAt": "2026-08-04T12:00:10Z",
  "type": "agent.started",
  "payload": { "role": "subagent", "displayName": "Implementer",
               "assignedTask": "Preisberechnung aus dem API-Modul herausloesen." }
}'

# 3 — Architektur. Ersetzt das angewandte Modell vollstaendig.
post '{
  "schemaVersion": "1.0",
  "clientEventId": "33333333-3333-4333-8333-333333333333",
  "projectId": "docs-proof", "runId": "run-docs-proof-0001",
  "agentId": "subagent-implementer", "parentAgentId": "orchestrator-root",
  "occurredAt": "2026-08-04T12:01:00Z",
  "type": "architecture.snapshot_published",
  "payload": {
    "snapshotId": "snapshot-0001",
    "components": [
      { "componentId": "checkout",     "name": "Checkout",     "kind": "system",    "parentComponentId": null },
      { "componentId": "checkout.api", "name": "Checkout API", "kind": "service",   "parentComponentId": "checkout" },
      { "componentId": "checkout.db",  "name": "Checkout DB",  "kind": "datastore", "parentComponentId": "checkout" }
    ],
    "relationships": [
      { "relationshipId": "rel-0001", "sourceComponentId": "checkout.api",
        "targetComponentId": "checkout.db", "kind": "data", "protocol": "postgresql" }
    ]
  }
}'

# 4 — Komponentenbezogenes Feedback als Markdown
post '{
  "schemaVersion": "1.0",
  "clientEventId": "44444444-4444-4444-8444-444444444444",
  "projectId": "docs-proof", "runId": "run-docs-proof-0001",
  "agentId": "subagent-implementer", "parentAgentId": "orchestrator-root",
  "occurredAt": "2026-08-04T12:02:00Z",
  "type": "feedback.published",
  "payload": {
    "feedbackId": "feedback-0001", "componentIds": ["checkout.api"],
    "format": "markdown", "title": "Rundungsregel ist nicht festgelegt",
    "body": "Die neue Preisberechnung rundet **pro Position**, die alte rundete pro Bestellung."
  }
}'

# 5 — Unified Diff fuer genau eine Datei
post '{
  "schemaVersion": "1.0",
  "clientEventId": "55555555-5555-4555-8555-555555555555",
  "projectId": "docs-proof", "runId": "run-docs-proof-0001",
  "agentId": "subagent-implementer", "parentAgentId": "orchestrator-root",
  "occurredAt": "2026-08-04T12:03:00Z",
  "type": "diff.reported",
  "payload": {
    "diffId": "diff-0001", "changeId": "change-0001",
    "componentIds": ["checkout.api"],
    "filePath": "internal/checkout/pricing.go",
    "unifiedDiff": "--- a/internal/checkout/pricing.go\n+++ b/internal/checkout/pricing.go\n@@ -10,3 +10,3 @@ func Total(o Order) Amount {\n-\treturn round(sum(o.Lines))\n+\treturn sum(roundEach(o.Lines))\n }\n"
  }
}'
```

Jeder Aufruf antwortet mit `201` und den Positionen 1 bis 5. Danach zeigt
`http://localhost:8080/projects/docs-proof` die drei Komponenten; ein Klick auf
*Checkout API* öffnet den Inspektor mit Feedback und Diff.

`run.finished` fehlt hier bewusst: Es ist optional, und der Run bleibt offen.

## Fertige Beispiel-Payloads

Nicht abtippen — die folgenden Dateien sind die vom Vertrag referenzierten
Beispiele und werden gegen ihn validiert:

| Datei | Zeigt |
| --- | --- |
| [`root-agent-started.json`](../api/examples/root-agent-started.json) | Root-Orchestrator, `parentAgentId: null` |
| [`subagent-started.json`](../api/examples/subagent-started.json) | Subagent mit Elternagent |
| [`architecture-snapshot.json`](../api/examples/architecture-snapshot.json) | Vier Hierarchieebenen und jede Beziehungsart, inklusive getrennter NATS-Topic-Kanten |
| [`component-change-planned.json`](../api/examples/component-change-planned.json) | Geplante Komponentenänderung |
| [`component-change-applied.json`](../api/examples/component-change-applied.json) | Dieselbe Änderung, angewandt |
| [`feedback-published.json`](../api/examples/feedback-published.json) | Komponentenbezogenes Markdown-Feedback |
| [`diff-reported.json`](../api/examples/diff-reported.json) | Unified Diff für genau eine Datei |
| [`correction-issued.json`](../api/examples/correction-issued.json) | Korrektur eines früheren Events |
| [`run-finished.json`](../api/examples/run-finished.json) | Optionales Terminalevent |

Die Beispiele sind **einzelne Illustrationen und keine lauffähige Reihenfolge**:
Wer sie der Reihe nach sendet, läuft in die Lifecycle-Regeln oben. Eine
lauffähige Reihenfolge steht [weiter oben](#eine-minimale-gültige-sequenz) und
im Simulator.

Weitere Beispiele — Read Models, Fehlerantworten und die
Ablehnungs-Fixtures — sind in [`api/README.md`](../api/README.md) katalogisiert.

## SSE: Stream und Reconnect

`GET /api/v1/projects/{projectId}/stream` liefert Server-Sent Events. Jedes
`data:` trägt einen `StreamedEvent`: dasselbe Event, das der Agent gesendet hat,
plus `position`, `serverEventId` und `receivedAt`. Das `event:`-Feld trägt den
`type`, das `id:`-Feld die Position.

**Die SSE-`id` *ist* die serverseitige Projektposition.** Positionen sind pro
Projekt monoton und lückenlos; sie sind der einzige Cursor. Die Event-UUID ist
kein Cursor — sie trägt keine Ordnung.

Wiederaufnahme geht auf zwei Wegen:

| Weg | Wer benutzt ihn | Verhalten bei ungültigem Wert |
| --- | --- | --- |
| Header `Last-Event-ID` | Browser (`EventSource` setzt ihn automatisch) | Wird ignoriert, der Stream startet live |
| Query `?lastEventPosition=` | Clients mit eigenem Cursor: Simulator, Tests, CLI | `400` — ein unbrauchbarer Wert ist ein Client-Defekt |

Sind beide gesetzt, gewinnt `lastEventPosition`. **Der Replay beginnt bei
`position + 1`** und geht danach nahtlos in den Livebetrieb über; es gibt keine
sichtbare Grenze zwischen beidem, der Client sieht nur steigende Positionen.
Jedes committete Event wird dabei genau einmal geliefert, in Positionsordnung,
ohne Lücke und ohne Duplikat.

> **Leicht zu übersehen: Ein Stream *ohne* Cursor startet am Live-Ende und
> replayt nicht.** Er ist danach vollkommen still, bis das nächste Event
> eintrifft — was wie ein kaputter Stream aussieht, aber der dokumentierte
> Anfangszustand ist. **Wer die Historie braucht, muss `lastEventPosition=0`
> setzen**; Positionen beginnen bei 1, also liefert `0` das Projekt von vorn.

Zwei kleinere Punkte, die beim Selbstbau eines Clients auffallen:

- **Keepalives sind SSE-Kommentarzeilen** (`: keepalive`) und tragen nie ein
  `id:`. Sie können den Cursor nicht verschieben; ein Client muss sie ignorieren.
  Die erste Zeile nach dem Verbindungsaufbau ist in der Regel ein Keepalive.
- **Ein Cursor hinter dem Ende des Logs** wird auf das aktuelle Ende gezogen,
  nicht wörtlich genommen. Ein wörtlich befolgter Wert ergäbe einen dauerhaft
  stillen Stream.
- Ein unbekanntes Projekt antwortet `404 project_not_found`.

Ein durchgespieltes Beispiel mit echten Requests und Antworten:
[`api/examples/sse-reconnect.md`](../api/examples/sse-reconnect.md).

## Read API

Agents brauchen sie nicht — sie ist die Lesefläche des Cockpits. Wer sie doch
verwendet (etwa in Tests), sollte zwei Dinge wissen: Jede Antwort trägt
`projectPosition`, mit dem sich ein HTTP-Schnappschuss gegen den SSE-Cursor
abgleichen lässt, und die Alias-Run-ID `current` löst auf den Run auf, den
zuletzt ein Root-Orchestrator eröffnet hat. Der vollständige Überblick steht in
[`api/README.md`](../api/README.md).

## Was der Agent nicht erwarten darf

Das Cockpit ist beobachtend und read-only: Es gibt keinen Rückkanal, keine
Steuerbefehle, keine Freigaben und keine Bewertung der gemeldeten Arbeit. Was
v0 sonst noch ausdrücklich nicht tut — und warum das Feedback eines Agenten als
nicht vertrauenswürdiger Input behandelt wird — steht in
[`security-and-boundaries.md`](./security-and-boundaries.md).
