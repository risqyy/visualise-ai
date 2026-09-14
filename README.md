# Visualise AI — Agent Project Cockpit

Beobachtungs-Cockpit für Agentenarbeit an einem Softwareprojekt. Es zeigt die
gesamte Anwendungsarchitektur, die laufenden Agents und Subagents, deren
gemeldete Arbeitsschritte, komponentenbezogenes KI-Feedback und Unified Diffs.

Das Cockpit **beobachtet**; es steuert den Agenten nie. Nutzer können aus der
Anwendung heraus nicht prompten, und das System bewertet nie, ob die Arbeit des
Agenten richtig ist.

> **Vertrauensgrenze:** v0 ist für einen lokalen Rechner oder ein privates
> Netzwerk gedacht. Es gibt keine Authentifizierung, keine Autorisierung und
> keine Multi-Tenancy. **Nicht ins öffentliche Internet stellen.**
> Details und die vollständigen Produktgrenzen:
> [`docs/security-and-boundaries.md`](docs/security-and-boundaries.md).

## Dokumentation

| Dokument | Inhalt |
| --- | --- |
| [`docs/operations.md`](docs/operations.md) | Voraussetzungen, Compose-Start, alle Umgebungsvariablen, Healthchecks, Datenpersistenz, Simulator, End-to-End-Test |
| [`docs/mcp-domain-tools.md`](docs/mcp-domain-tools.md) | Geprüfter SDK-Client: lesen, atomar ändern, View speichern, natives PNG prüfen |
| [`docs/epic-75-acceptance.md`](docs/epic-75-acceptance.md) | Lokale Abnahmen, Messbedingungen und verbleibende Grenzen |
| [`docs/agent-integration.md`](docs/agent-integration.md) | Eventvertrag in der Praxis: Lifecycle, Idempotenz, Fehlercodes, SSE-Reconnect, eine minimale gültige Sequenz |
| [`docs/security-and-boundaries.md`](docs/security-and-boundaries.md) | Vertrauensgrenze, Angriffsfläche, v0-Ausschlüsse, `RepositoryProvider`-Grenze |
| [`api/README.md`](api/README.md) | Der Vertrag selbst: Schemata, Beispiele, Ablehnungs-Fixtures |
| [`api/openapi.yaml`](api/openapi.yaml) | OpenAPI 3.1 — die maßgebliche Quelle für alle Feldnamen und Formate |
| [`simulator/README.md`](simulator/README.md) | Flags und Szenarien des Simulators |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records (englisch) |

## Quick Start

Voraussetzung ist ausschließlich Docker mit Compose v2 (siehe
[`docs/operations.md`](docs/operations.md#voraussetzungen)).

```bash
cp .env.example .env   # optional, die Defaults funktionieren unverändert
docker compose up --build
```

Danach <http://localhost:8080> öffnen. Ist Port 8080 belegt, setze
`FRONTEND_HTTP_PORT` — siehe
[Portkonflikte](docs/operations.md#portkonflikte).

Eine frische Datenbank ist leer, das Cockpit hat also nichts zu zeigen, bis ein
Agent etwas meldet. Der mitgelieferte Simulator füllt sie deterministisch über
die öffentliche Route:

```bash
cd simulator
npm install
npm run simulate
```

Danach zeigt <http://localhost:8080/projects/visualise-ai> den vollständigen
Demo-Run. Details:
[Demo ausführen](docs/operations.md#demo-ausfuehren).

## MCP: Modell lesen, ändern und als Bild prüfen

Der aktuelle Quell-Build stellt unter `http://localhost:8080/mcp` **14 Tools**
bereit. Ein MCP-Client mit Streamable HTTP und Bildunterstützung kann einen
Kontext explizit öffnen, das gemeinsame Projektmodell lesen und atomar ändern,
Ansichten speichern und ein natives PNG bei exakten Modell-/Ansichtsrevisionen
abrufen. Dafür muss kein Nutzerbrowser geöffnet sein. Modelländerungen sind
keine Repository-Codeänderungen; Fortschritt und Arbeit werden separat gemeldet.

Die [MCP-Anleitung](docs/mcp-domain-tools.md) enthält den vollständigen Ablauf
und ein ausführbares SDK-Beispiel. [Betrieb](docs/operations.md) beschreibt
Konfiguration, Migration und Grenzen. Diese Fähigkeiten gehören zum Quell-Build;
ältere veröffentlichte Images enthalten sie nicht automatisch.

## Veröffentlichte Docker-Hub-Images

Der Workflow
[`release-dockerhub.yml`](.github/workflows/release-dockerhub.yml) veröffentlicht
beide Anwendungsimages ausschließlich bei gültigen Release-Tags im Format
`v<major>.<minor>.<patch>`; ein optionaler Prerelease-Suffix ist erlaubt, zum
Beispiel `v1.2.3-rc.1`. Vor dem Push müssen die Vertrags-, Backend-, Frontend-,
Simulator- und E2E-Prüfungen sowie der Compose-Build erfolgreich sein.

In den Repository-Einstellungen werden dafür die Variable
`DOCKERHUB_NAMESPACE` und die Secrets `DOCKERHUB_USERNAME` und
`DOCKERHUB_TOKEN` hinterlegt. Kein Secret wird in einen Build-Arg, ein Image
oder ein Log geschrieben. Die beiden getrennten Docker-Hub-Repositories sind:

- `risqy3d/visualise-ai-backend`
- `risqy3d/visualise-ai-frontend`

Ein stabiles Tag wie `v1.2.3` erzeugt `1.2.3`, `1.2`, `1` und `latest`. Ein
Prerelease wie `v1.2.3-rc.1` erzeugt ausschließlich `1.2.3-rc.1`; stabile Tags
und `latest` bleiben dabei unverändert.

Ein veröffentlichtes Image kann direkt gezogen werden:

```bash
docker pull "risqy3d/visualise-ai-backend:1.2.3"
docker pull "risqy3d/visualise-ai-frontend:1.2.3"
```

Für einen Compose-Start mit den veröffentlichten Images statt mit lokalen
Quell-Builds:

```bash
IMAGE_TAG=1.2.3 \
  docker compose -f docker-compose.yml -f docker-compose.images.yml pull
IMAGE_TAG=1.2.3 \
  docker compose -f docker-compose.yml -f docker-compose.images.yml up -d --no-build
```

Das Release veröffentlicht nur Backend und Frontend. PostgreSQL bleibt der
interne, unveränderte `postgres:17-alpine`-Service aus der Compose-Datei und
wird nicht als Visualise-AI-Image veröffentlicht.

## Repository-Struktur

| Pfad | Inhalt |
| --- | --- |
| `api/` | OpenAPI-Vertrag, Beispiel-Payloads, Ablehnungs-Fixtures |
| `backend/` | Go-Modul: Gin-HTTP-Oberfläche, zerolog, GORM/PostgreSQL |
| `frontend/` | React- und TypeScript-Anwendung, gebaut mit Vite |
| `frontend/nginx/` | Nginx-Site-Konfiguration — der einzige externe Einstiegspunkt |
| `simulator/` | Node/TypeScript-Eventsimulator — der deterministische Demo-Client |
| `e2e/` | Playwright-Abnahmetest gegen das echte Compose-System |
| `docker-compose.yml` | Die Services `frontend`, `backend` und `postgres` |
| `docker-compose.images.yml` | Optionaler Compose-Override für veröffentlichte Images |
| `docs/` | Betriebs- und Integrationsdokumentation, Decision Records |

## Netzwerktopologie

```
Host :8080
     │
     ▼
┌──────────────┐        ┌─────────────┐        ┌──────────────┐
│  frontend    │ ─────▶ │  backend    │ ─────▶ │  postgres    │
│  (nginx)     │        │  (go/gin)   │        │              │
│  published   │        │  intern     │        │  intern      │
└──────────────┘        └─────────────┘        └──────────────┘
```

Nginx liefert das Produktions-Bundle aus und proxyt diese Arten von Verkehr an
das Backend:

| Route | Zweck |
| --- | --- |
| `/mcp` | Streamable HTTP: Modell, Arbeit, Ansichten und PNG-Feedback |
| `POST /api/v1/events` | Kompatible Event- und Command-Ingestion |
| `GET /api/v1/…` | Read Models für die Oberfläche |
| `GET /api/v1/projects/{id}/stream` | SSE-Livestream, **ungepuffert** geproxyt |
| `GET /healthz`, `GET /readyz` | Backend-Probes |

Weder `backend` noch `postgres` veröffentlichen einen Host-Port. Warum das eine
Sicherheitseigenschaft und keine Bequemlichkeit ist, steht in
[`docs/security-and-boundaries.md`](docs/security-and-boundaries.md#nginx-ist-der-einzige-einstiegspunkt).

## Lokale Entwicklung

Nur nötig, wenn du am Code arbeitest; für den reinen Betrieb genügt Docker.

Voraussetzungen: Bash (unter Windows zum Beispiel Git Bash), Go gemäß
[`backend/go.mod`](backend/go.mod) (aktuell 1.25.7), Node 24 mit npm wie in
der [CI](.github/workflows/ci.yml) sowie laufendes Docker mit Compose v2
für Datenbank- und E2E-Tests. Der Frontend-Container baut separat mit Node 22.

**Backend:** Die [Backend-Testanleitung](backend/README.md) führt vom
Repository-Root durch Build, Vet und die vollständige Testsuite mit einer
separaten PostgreSQL-17-Testdatenbank. Ohne `TEST_DATABASE_URL` überspringt
`go test ./...` die Datenbanktests.

Die weiteren Prüfungen ebenfalls im Repository-Root starten. Jede Klammer
öffnet eine Subshell; danach bleibt das Arbeitsverzeichnis der Repository-Root.

```bash
# Frontend
(
  cd frontend &&
  npm ci &&
  npm run lint && npm run typecheck && npm test && npm run build
)

# Simulator
(
  cd simulator &&
  npm ci &&
  npm run lint && npm run typecheck && npm test
)

# Vertrag
(
  cd api &&
  npm ci &&
  npm test
)

# End-to-End-Abnahme (Details: e2e/README.md)
(
  cd e2e &&
  npm ci && npx playwright install --with-deps chromium &&
  npm test
)
```

`npm run dev` im `frontend/` startet Vite auf Port 5173 und proxyt `/api`,
`/healthz` und `/readyz` an ein Backend auf `localhost:8080`, sodass die Pfade
denen der Compose-Bereitstellung entsprechen.

## Lizenz

Visualise AI steht unter der [MIT-Lizenz](LICENSE).
Drittquellen behalten ihre jeweiligen Lizenzen; für das Chromium-Seccomp-Profil
gelten die separaten Lizenz- und Herkunftshinweise in
[`deploy/chromium/`](deploy/chromium/).
