# End-to-End-Abnahme

Der verpflichtende Abnahmetest des v0-Epics (#14). Er startet das echte
Compose-System aus einer leeren PostgreSQL-Datenbank, fährt den vollständigen
v0-Nutzerpfad in **Chromium bei 1920 × 1080** ausschließlich über Nginx ab und
räumt danach wieder auf.

**Ein Fehlschlag blockiert die v0-Freigabe.**

Warum der Test so gebaut ist — nur ein Browser, gegen das echte System statt
gegen Mocks, Live-Zustände live beobachtet, Vakuum-Guards im Replay-Test —
steht in
[`docs/decisions/0013-mandatory-end-to-end-acceptance.md`](../docs/decisions/0013-mandatory-end-to-end-acceptance.md).

## Ausführen

Aus einem leeren Checkout, mit laufendem Docker:

```bash
cd e2e
npm install
npx playwright install chromium
npm test
```

Mehr braucht es nicht. Der Test erledigt selbst:

1. `docker compose -p vai-e2e down -v` — Start aus leerer Datenbank,
2. `docker compose -p vai-e2e up --build -d`,
3. Warten auf `/readyz` **über Nginx**,
4. die Abnahme,
5. `docker compose -p vai-e2e down -v`.

Fehlen die Abhängigkeiten des Simulators, installiert der Test sie vorher
(`npm ci` in `simulator/`) — ohne den Simulator gibt es keine Sequenz, die
abgenommen werden könnte.

Der HTML-Report liegt danach in `playwright-report/`:

```bash
npm run report
```

## Konfiguration

| Variable | Default | Bedeutung |
| --- | --- | --- |
| `FRONTEND_HTTP_PORT` | `8100` | Host-Port des Nginx-Frontends |
| `E2E_COMPOSE_PROJECT` | `vai-e2e` | Compose-Projektname des Abnahme-Stacks |
| `E2E_BASE_URL` | `http://localhost:<port>` | Einstiegspunkt, falls nicht localhost |
| `E2E_SKIP_COMPOSE` | aus | Nutzt einen bereits laufenden Stack |
| `E2E_KEEP_STACK` | aus | Lässt den Stack nach dem Lauf stehen |

Der Default-Port ist bewusst **8100** und nicht 8080: 8080–8083 sind auf
Entwicklungsrechnern häufig belegt, und ein Freigabe-Gate, das an einer fremden
Portbelegung scheitert, wird ignoriert. CI setzt `FRONTEND_HTTP_PORT=8080` und
hält damit auch den dokumentierten Standardport unter Test.

Der eigene Compose-Projektname ist wichtiger als der Port: ohne ihn würde
`down -v` Container, Netzwerk und Volume eines aus derselben
`docker-compose.yml` gestarteten Entwicklungs-Stacks löschen.

`E2E_SKIP_COMPOSE` und `E2E_KEEP_STACK` sind reine Debug-Hilfen. Sie werden in
CI nie gesetzt und scheitern sicher: die Simulator-Szenarien erwarten `201
created`, gegen eine gefüllte Datenbank bricht der Lauf also laut ab.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `playwright.config.ts` | Ein Projekt: Chromium, 1920 × 1080, ein Worker, `retries: 0` |
| `src/config.ts` | Ports, Compose-Projektname, Projekt- und Run-Ids |
| `src/compose.ts` | Lebenszyklus des Systems unter Test |
| `src/globalSetup.ts` / `src/globalTeardown.ts` | `down -v` → `up --build` → `/readyz`, und zurück |
| `src/simulator.ts` | Startet den Simulator und liest dessen `--json`-Zusammenfassung |
| `src/sse.ts` | Roher SSE-Leser — er besitzt den Socket, damit der Abbruch erzwungen werden kann |
| `src/liveObserver.ts` | Wird vor dem App-Start injiziert und zeichnet die Live-Zustände auf |
| `src/controls.ts` | Sichtbarkeit und Überdeckung über `elementFromPoint` |
| `src/layout.ts` | Seitenüberlauf und abgeschnittener Text — als Funktion der Fensterbreite |
| `src/pseudoLocale.ts` | Verlängert im Browser jeden Text, der dem Cockpit gehört, um 35 % |
| `tests/` | Die zehn Prüfdateien, in Ausführungsreihenfolge nummeriert |

## Die zehn Prüfdateien

| Datei | Prüfung |
| --- | --- |
| `01-ingestion.spec.ts` | Eventvalidierung, Idempotenz und beobachtbare Projektionen |
| `02-live-updates.spec.ts` | Live-SSE-Aktualisierungen für geplant, aktiv, angewandt und entfernt |
| `03-architecture.spec.ts` | Vollständiger Architekturcanvas mit Hierarchie und typisierten Beziehungen |
| `04-run-agents.spec.ts` | Run-/Agentbaum mit parallelen Subagents und getrennten Fortschrittsformen |
| `05-inspector.spec.ts` | Komponentenklick: Agent, Aufgabe, Markdown-Feedback, gruppierte Diffs |
| `06-run-history-focus.spec.ts` | Trennung von aktuellem Run und Historie, Deep-Focus-Grundverhalten |
| `07-sse-replay.spec.ts` | Erzwungener SSE-Abbruch und lückenloser, geordneter Replay |
| `08-viewport.spec.ts` | Keine horizontale Seitenscrollbar, keine verdeckte Primärsteuerung |
| `09-i18n-layout.spec.ts` | Layout in Deutsch, Englisch und Pseudo-Locale bei 1920, 1440 und 1280 |
| `10-architecture-focus.spec.ts` | Architektur-Fokus, exakte Pane-Wiederherstellung und Overlay-Geometrie in Deutsch und Englisch |

`01`–`08` sind die verbindlichen Prüfungen des v0-Epics (#14) und bleiben
unverändert: dieselben Assertions, dieselben 1920 × 1080, dieselbe Sprache.
`09` kommt aus dem i18n-Epic (#37), läuft danach und fügt drei Achsen hinzu —
zwei weitere Breiten, die zweite Sprache und eine künstlich um 35 % verlängerte
dritte. Alle Selektoren in `09` sind sprachunabhängig; eine Prüfliste mit
deutschen `aria-label`s findet im englischen Lauf nichts und meldet dann
„nichts abgeschnitten" über einen Bildschirm, den sie nie angesehen hat.

### Screenshots sind Belege, keine Baseline

`09` hängt neun Screenshots an den Report (drei Breiten × Deutsch, Englisch,
Pseudo-Locale). Verglichen wird **nichts** gegen ein eingechecktes Bild.
`toHaveScreenshot()` vergleicht gerenderte Pixel, und die hängen an
Schriftrendering und Subpixel-Positionierung: eine im Linux-Container
aufgenommene Baseline widerspricht demselben Build auf einem Windows-Rechner
über Text, der völlig korrekt ist. Was das Issue tatsächlich verlangt — keine
abgeschnittenen Pane-Titel, Buttons, Legenden oder Statuswerte — wird stattdessen
gemessen: `scrollWidth` gegen `clientWidth` bei einem `overflow`, das den Rest
verbirgt. Die Begründung steht in
[ADR 0022](../docs/decisions/0022-translation-test-suite-pseudo-locale-and-a-suite-that-can-be-believed.md).

`02-live-updates.spec.ts` sendet die repräsentative Sequenz und ist die einzige
Datei, die das darf: das Szenario `full` erwartet ein leeres Projekt. Die
Dateien danach lesen den Zustand, den es hinterlassen hat — deshalb ein Worker,
keine Parallelität und nummerierte Dateinamen.

## Determinismus

`retries: 0`. Ein Gate, das im zweiten Anlauf grün wird, meldet „flaky" als
„bestanden".

Es gibt keine festen Wartezeiten als Synchronisationsmittel. Gewartet wird mit
Playwright-Erwartungen, `expect.poll` oder auf einen Wert, den das System selbst
veröffentlicht: die `--json`-Zusammenfassung des Simulators, ein
`data-*`-Attribut, das Verbindungs-Badge. Der Simulator ist geseedet, deshalb
nennen die Assertions exakte Zahlen — 17 Komponenten, 11 Beziehungen, drei
Beziehungen auf `orders.order.created`, drei Dateien unter einer `changeId`.

## CI

`.github/workflows/e2e.yml` fährt denselben Lauf auf einem Ubuntu-Runner mit
`FRONTEND_HTTP_PORT=8080` und lädt den Playwright-Report als Artefakt hoch. Die
schnellen Suiten laufen getrennt in `.github/workflows/ci.yml`.
