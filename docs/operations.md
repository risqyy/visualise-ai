# Betrieb

Wie das Cockpit lokal oder im privaten Netzwerk betrieben wird: Voraussetzungen,
Start, Konfiguration, Gesundheitsprüfungen, Daten und Demo.

Bevor du das System jemandem zugänglich machst, lies
[`security-and-boundaries.md`](./security-and-boundaries.md). Es gibt keine
Authentifizierung.

## Voraussetzungen

| Werkzeug | Wofür | Anmerkung |
| --- | --- | --- |
| Docker Engine | Betrieb | Zuletzt geprüft mit 29.5 |
| Docker Compose | Betrieb | Als Plugin (`docker compose …`), nicht als altes `docker-compose`. Zuletzt geprüft mit 5.1 |

Mehr ist für den Betrieb **nicht** nötig. Backend, Frontend und Simulator werden
im Container gebaut; Go und Node brauchst du nur, wenn du am Quellcode arbeitest
oder den Simulator direkt vom Host aus startest (siehe
[Demo ausführen](#demo-ausfuehren) und den Abschnitt „Lokale Entwicklung" im
[README](../README.md#lokale-entwicklung)).

Das Cockpit ist Desktop-only. Verbindliche Abnahmeauflösung ist 1920 × 1080 in
Chromium.

## Start aus einem leeren Checkout

```bash
git clone <repository-url> visualise-ai
cd visualise-ai
cp .env.example .env          # optional, die Defaults funktionieren unverändert
docker compose up --build
```

Der erste Build lädt die Basis-Images und kompiliert Go-Backend und
Vite-Bundle; das dauert einige Minuten. Danach starten die Services in fester
Reihenfolge: `postgres` muss gesund sein, bevor `backend` startet, und `backend`
muss gesund sein, bevor `frontend` startet.

Wenn `docker compose up` ohne `-d` läuft, siehst du die Logs aller drei
Services. Für den Hintergrundbetrieb:

```bash
docker compose up --build -d
docker compose ps             # Status aller Services
docker compose logs -f backend
docker compose down           # stoppt alles, Daten bleiben erhalten
```

Sobald `frontend` gesund ist, ist die Oberfläche unter <http://localhost:8080>
erreichbar.

<a id="demo-ausfuehren"></a>

## Demo ausführen

Eine frische Datenbank ist leer. Das Cockpit erfindet nichts, also gibt es
nichts zu sehen, bis ein Agent etwas meldet. Der mitgelieferte Simulator meldet
einen vollständigen, deterministischen Run über dieselbe öffentliche Route, die
auch ein echter Agent benutzt.

Er läuft auf dem Host und braucht dafür Node (der Container-Build verwendet
Node 22):

```bash
cd simulator
npm install
npm run simulate
```

Läuft das Frontend auf einem anderen Port, muss der Simulator die Basis-URL
kennen:

```bash
npm run simulate -- --base http://localhost:8101
```

Danach zeigt <http://localhost:8080/projects/visualise-ai> den Run: die
Architektur auf dem Canvas, die Agenthierarchie links, der Komponenteninspektor
rechts nach einem Klick auf eine Komponente.

### Flags

| Flag | Bedeutung | Default |
| --- | --- | --- |
| `--base <url>` | Öffentlicher Einstiegspunkt, nur Schema und Host | `http://localhost:8080` |
| `--project <id>` | Projekt, unter dem gemeldet wird | Projekt des Szenarios |
| `--run <id>` | Run-ID | Run-ID des Szenarios |
| `--speed <faktor>` | Pausenmultiplikator: `1` normal, `0` keine Pausen, `2` doppelt so langsam | `1` |
| `--scenario <name>` | `full`, `retry` oder `conflict` | `full` |
| `--seed <n>` | Seed der ID-, Pausen- und Uhrenströme | `20260804` |
| `--finish <bool>` | Ob der `full`-Run `run.finished` sendet | `false` |
| `--json` | Maschinenlesbare Zusammenfassung auf stdout, Erzählung auf stderr | aus |

### Szenarien

| Szenario | Projekt | Zeigt |
| --- | --- | --- |
| `full` | `visualise-ai` | Den repräsentativen Run: 62 Events, jeden Eventtyp außer dem optionalen `run.finished` |
| `retry` | `visualise-ai-retry` | `201`, danach eine byte-identische Wiederholung mit `200 duplicate: true` und **derselben** Position |
| `conflict` | `visualise-ai-conflict` | Dieselbe `clientEventId` mit anderem Inhalt: `409 client_event_id_conflict` |

Jedes Szenario schreibt in ein eigenes Projekt mit eigenem Root-Orchestrator, so
dass keines den aktuellen Run eines anderen überschreibt.

**Alle drei Szenarien setzen eine leere Datenbank voraus.** Gegen eine bereits
gefüllte Datenbank ist die erste Zustellung berechtigterweise ein Duplikat — das
ist korrektes Verhalten, aber nicht das, was die Szenarien behaupten. Vor einem
Wiederholungslauf also:

```bash
docker compose down -v && docker compose up --build -d
```

Wiederholte Läufe gegen eine leere Datenbank erzeugen denselben semantischen
Ablauf: dieselben Events, dieselben Positionen und damit dieselben Read Models.
Client-Event-IDs, Pausen und Zeitstempel stammen aus getrennten, geseedeten
Generatoren. Weitere Details in
[`simulator/README.md`](../simulator/README.md).

## Konfiguration

Alle Einstellungen sind Umgebungsvariablen. `docker compose` liest sie
automatisch aus einer Datei `.env` im Projektverzeichnis;
[`.env.example`](../.env.example) ist die kommentierte Vorlage. Jeder Wert ist
optional — die Defaults lassen `docker compose up --build` in einem leeren
Checkout funktionieren.

| Variable | Wofür | Default | Wann ändern |
| --- | --- | --- | --- |
| `FRONTEND_HTTP_PORT` | Der einzige vom Deployment veröffentlichte Host-Port. Nginx lauscht im Container immer auf 8080; diese Variable bestimmt nur, worauf er auf dem Host abgebildet wird. | `8080` | Bei [Portkonflikten](#portkonflikte) oder wenn mehrere Stacks parallel laufen |
| `POSTGRES_USER` | Datenbanknutzer. Geht auch in die vom Compose zusammengesetzte `DATABASE_URL` ein. | `visualise` | Praktisch nie — die Datenbank ist nicht von außen erreichbar |
| `POSTGRES_PASSWORD` | Passwort dieses Nutzers | `visualise` | Praktisch nie, siehe oben |
| `POSTGRES_DB` | Name der Datenbank | `visualise` | Praktisch nie |
| `BACKEND_VERSION` | Build-Argument des Backend-Images. Wird von `/healthz` und `/readyz` als `version` zurückgemeldet. | `dev` | Wenn du ein getaggtes Image baust und im Betrieb erkennen willst, welches läuft |
| `BACKEND_LOG_LEVEL` | zerolog-Level: `trace`, `debug`, `info`, `warn`, `error` | `info` | Zur Fehlersuche auf `debug` |
| `BACKEND_LOG_FORMAT` | `json` (maschinenlesbar) oder `console` (menschenlesbar) | `json` | Beim lokalen Mitlesen der Logs auf `console`. Ein anderer Wert lässt das Backend beim Start scheitern |
| `DATABASE_CONNECT_TIMEOUT` | Wie lange das Backend beim Start auf PostgreSQL wartet, bevor es scheitert. Go-Duration (`60s`, `2m`). | `60s` | Auf langsamen Rechnern erhöhen |
| `MAX_EVENT_BYTES` | Maximale Größe eines einzelnen ingestierten Events in Bytes | `2097152` (2 MiB) | Wenn Agents größere Snapshots oder Diffs melden — siehe die Warnung unten |
| `SHUTDOWN_TIMEOUT` | Kulanzfrist für laufende Requests beim Herunterfahren. Go-Duration. | `15s` | Selten |
| `DATABASE_URL` | Vollständiger PostgreSQL-DSN. Wird von `docker-compose.yml` aus den `POSTGRES_*`-Werten zusammengesetzt. | zusammengesetzt | Nur, wenn das Backend auf eine andere Datenbank zeigen soll |

`HTTP_ADDR` (Listen-Adresse des Backends, `:8080`) wird von
`docker-compose.yml` fest gesetzt und ist bewusst nicht in `.env.example`: der
Container-Port ist Teil der Topologie, nicht der Konfiguration.

> **`MAX_EVENT_BYTES` über 8 MiB anzuheben, genügt allein nicht.** Nginx
> begrenzt den Request-Body auf dieser Route mit `client_max_body_size 8m`. Ein
> größeres Event würde vom Backend akzeptiert, aber schon von Nginx mit `413`
> abgelehnt. Über 8 MiB hinaus muss auch
> `frontend/nginx/default.conf` angepasst werden.

Alle Werte werden beim Start geprüft. Ein nicht parsbarer oder nicht positiver
Wert lässt das Backend scheitern, statt still auf den Default zurückzufallen —
und ein gescheitertes Backend wird nie als bereit geroutet (siehe unten).

### Nach dem ersten Start wirken die `POSTGRES_*`-Werte nicht mehr

Das offizielle PostgreSQL-Image initialisiert Nutzer und Datenbank nur, wenn das
Volume `pgdata` leer ist. Änderst du `POSTGRES_USER`, `POSTGRES_PASSWORD` oder
`POSTGRES_DB` später, ändert sich zwar die vom Compose gebaute `DATABASE_URL`,
nicht aber die Datenbank — das Backend kann sich dann nicht mehr anmelden und
wird nie bereit. Wer diese Werte ändern will, muss das Volume neu anlegen
(`docker compose down -v`) und verliert dabei alle Daten.

## Healthchecks und Readiness

Das Backend trennt zwei verschiedene Fragen:

| Endpunkt | Beantwortet | Antwort |
| --- | --- | --- |
| `GET /healthz` | Läuft der Prozess und antwortet er? PostgreSQL wird **nicht** berührt. | Immer `200 {"status":"ok","version":"…"}`, solange der Prozess bedient |
| `GET /readyz` | Ist die Startarbeit fertig **und** antwortet PostgreSQL gerade? | `200 {"status":"ready","version":"…"}`, sonst `503` |

Zur Startarbeit gehört die Schemamigration (GORM `AutoMigrate`). Sie läuft,
bevor das Bereitschaftsflag gesetzt wird — eine gescheiterte Migration bedeutet
also, dass das Backend nie bereit meldet.

Darauf baut die Compose-Topologie auf:

- Der Healthcheck des `backend`-Containers probt `/readyz`, nicht `/healthz`.
  Er hat ein `start_period` von 60 s, damit das Warten auf PostgreSQL nicht als
  Fehlschlag zählt.
- `frontend` deklariert `depends_on: backend: condition: service_healthy`.
- `backend` deklariert dasselbe für `postgres`, dessen Healthcheck `pg_isready`
  ausführt.

**Ein Backend, das nicht startet, wird deshalb nie als bereit geroutet.** Es
wird nicht gesund, also startet das Frontend gar nicht erst. Der sichtbare
Preis: solange das Backend unten ist, ist die Oberfläche nicht erreichbar,
statt eine Hülle auszuliefern, die bei jedem Request 502 antwortet. Für ein
Beobachtungswerkzeug mit genau einer Instanz ist das die gewünschte Variante —
eine Oberfläche, die nichts weiß, aber so aussieht, als wüsste sie etwas, wäre
schlimmer als keine.

Beide Probes sind auch über Nginx erreichbar, was für ein Skript, das auf das
System wartet, praktisch ist:

```bash
curl -fsS http://localhost:8080/readyz
```

## Datenpersistenz

PostgreSQL legt seine Daten im Named Volume `pgdata` ab (unter dem
Compose-Projektnamen, also standardmäßig `visualise-ai_pgdata`).

| Befehl | Wirkung |
| --- | --- |
| `docker compose down` | Container und Netzwerk werden entfernt. **Das Volume bleibt** — beim nächsten `up` sind alle Events wieder da. |
| `docker compose down -v` | Das Volume wird mit gelöscht. Der nächste Start beginnt mit einer leeren Datenbank. |

Der Event Log ist append-only und die Audit-Quelle; es gibt in v0 kein
Löschen einzelner Events, keinen Export und kein Backup-Kommando. Wer die Daten
sichern will, sichert das Volume mit Docker-Bordmitteln.

`down -v` ist der reguläre Weg, um Simulator und End-to-End-Test wieder auf
einen definierten Anfangszustand zu bringen.

## Portkonflikte

Der Default-Host-Port ist **8080**. Ist er belegt, scheitert `docker compose up`
mit einer Bind-Fehlermeldung. `FRONTEND_HTTP_PORT` überschreibt ihn:

```bash
FRONTEND_HTTP_PORT=8101 docker compose up --build -d
# oder dauerhaft in .env: FRONTEND_HTTP_PORT=8101
```

Innerhalb des Containers lauscht Nginx unverändert auf 8080; nur die Abbildung
auf den Host ändert sich. Alles, was auf die Basis-URL zeigt, muss mitgezogen
werden: der Browser, `--base` des Simulators und die Basis-URL des
End-to-End-Tests.

Sollen mehrere Stacks parallel laufen, braucht jeder zusätzlich einen eigenen
Compose-Projektnamen, damit sich Container und Volumes nicht überschreiben:

```bash
FRONTEND_HTTP_PORT=8101 docker compose -p mein-stack up --build -d
FRONTEND_HTTP_PORT=8101 docker compose -p mein-stack down -v
```

## End-to-End-Abnahme (Playwright)

Der verpflichtende Abnahmetest läuft in Chromium bei 1920 × 1080 gegen das echte
Compose-System aus leerer Datenbank:

```bash
cd e2e
npm install
npx playwright install chromium
npm test
```

Ein Fehlschlag blockiert die v0-Freigabe. Aufbau, Voraussetzungen und
Konfiguration des Tests stehen in [`e2e/README.md`](../e2e/README.md); dieser
Abschnitt beschreibt bewusst nur den Aufruf.

Der Test bringt seinen eigenen Stack hoch und wieder herunter — unter dem
Compose-Projektnamen `vai-e2e` und auf Port `8100`, damit er einen laufenden
Entwicklungs-Stack auf `8080` weder benutzt noch beim Aufräumen löscht.

## Fehlersuche

| Symptom | Wahrscheinliche Ursache |
| --- | --- |
| `docker compose up` scheitert mit „port is already allocated" | Port 8080 belegt — siehe [Portkonflikte](#portkonflikte) |
| `frontend` startet nicht, `backend` bleibt `starting` oder `unhealthy` | Das Backend wird nicht bereit. `docker compose logs backend` zeigt den Grund: ungültige Konfiguration, gescheiterte Migration oder keine Datenbankverbindung |
| Oberfläche lädt, zeigt aber keine Projekte | Die Datenbank ist leer. Das ist der korrekte Zustand — führe die [Demo](#demo-ausfuehren) aus oder lass einen Agenten melden |
| Simulator meldet `200 duplicate: true` statt `201` | Die Datenbank ist nicht leer. `docker compose down -v` und neu starten |
| Ingestion antwortet `422 unknown_agent` | Der meldende Agent hat vorher kein `agent.started` gesendet — siehe [Agent-Integration](./agent-integration.md#lifecycle) |
| SSE-Stream bleibt still, obwohl Events ankommen | Der Stream wurde ohne Cursor geöffnet und beginnt am Live-Ende. Für Historie `lastEventPosition=0` setzen — siehe [SSE](./agent-integration.md#sse-stream-und-reconnect) |
