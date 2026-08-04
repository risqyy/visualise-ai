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

Nginx liefert das Produktions-Bundle aus und proxyt vier Arten von Verkehr an
das Backend:

| Route | Zweck |
| --- | --- |
| `POST /api/v1/events` | Agent-Event-Ingestion |
| `GET /api/v1/…` | Read Models für die Oberfläche |
| `GET /api/v1/projects/{id}/stream` | SSE-Livestream, **ungepuffert** geproxyt |
| `GET /healthz`, `GET /readyz` | Backend-Probes |

Weder `backend` noch `postgres` veröffentlichen einen Host-Port. Warum das eine
Sicherheitseigenschaft und keine Bequemlichkeit ist, steht in
[`docs/security-and-boundaries.md`](docs/security-and-boundaries.md#nginx-ist-der-einzige-einstiegspunkt).

## Lokale Entwicklung

Nur nötig, wenn du am Code arbeitest; für den reinen Betrieb genügt Docker.

```bash
# Backend (Go 1.25.7, siehe backend/go.mod)
cd backend
go build ./... && go vet ./... && go test ./...

# Frontend (Node 22, wie im Container-Build)
cd frontend
npm ci
npm run lint && npm run typecheck && npm run test && npm run build

# Simulator (Node 22)
cd simulator
npm ci
npm run lint && npm run typecheck && npm test

# Vertrag
cd api
npm ci
npm test

# End-to-End-Abnahme (braucht Docker; siehe e2e/README.md)
cd e2e
npm install && npx playwright install chromium
npm test
```

`npm run dev` im `frontend/` startet Vite auf Port 5173 und proxyt `/api`,
`/healthz` und `/readyz` an ein Backend auf `localhost:8080`, sodass die Pfade
denen der Compose-Bereitstellung entsprechen.
