# Vertrauensgrenze und Produktgrenzen

Was dieses System schützt, was es ausdrücklich nicht schützt, und wo v0 endet.
Lies diesen Text, bevor du das Cockpit jemand anderem zugänglich machst.

## Nur lokal oder im privaten Netzwerk

**v0 hat keine Authentifizierung, keine Autorisierung und keine Multi-Tenancy.**
Der OpenAPI-Vertrag sagt das explizit: `security: []` — keine Operation
verlangt Credentials. Das ist kein Versäumnis, sondern eine bewusste
v0-Entscheidung.

Daraus folgt unmittelbar:

- **Nicht ins öffentliche Internet stellen.** Kein Port-Forwarding, kein
  öffentlicher Reverse Proxy, kein Tunnel.
- Wer den veröffentlichten Port erreicht, hat vollen Lese- **und** Schreibzugriff.
- Ein privates Netzwerk ist die äußere Grenze. Innerhalb davon gibt es keine
  weitere.

### Es gibt keine Mandantentrennung

„Projekt" ist eine Gliederung, keine Grenze. `projectId` ist ein vom Agenten
frei gewähltes Kürzel, und die Ingestion prüft nur seine Form, nicht seine
Herkunft. **Wer den Ingestion-Endpunkt erreicht, kann in jedes Projekt
schreiben** — auch in ein bereits bestehendes, dessen ID er kennt oder errät.
Genauso kann jeder, der die Oberfläche erreicht, jedes Projekt lesen.

Read Models sind zwar strikt projektbezogen — keine Antwort enthält je eine
Zeile eines anderen Projekts, selbst wenn zwei Projekte dieselbe Run-, Agent-
oder Komponenten-ID benutzen. Das ist Korrektheit der Auslieferung, keine
Zugriffskontrolle.

## Nginx ist der einzige Einstiegspunkt

Von den drei Compose-Services veröffentlicht nur `frontend` einen Host-Port.
`backend` und `postgres` haben bewusst keinen `ports:`-Eintrag und sind
ausschließlich aus dem Compose-Netzwerk erreichbar.

Das hat zwei Konsequenzen, die zusammengehören:

- Die gesamte Angriffsfläche des Systems ist ein einziger Port. Was Nginx nicht
  weiterreicht, existiert von außen nicht.
- PostgreSQL für ein Debugging zugänglich zu machen, verlangt eine ausdrückliche
  Änderung an `docker-compose.yml`. Das ist Absicht: es soll nicht versehentlich
  passieren.

Die Routen, die Nginx weiterreicht, stehen im
[README](../README.md#netzwerktopologie).

## Agent-Feedback ist nicht vertrauenswürdiger Input

`feedback.published` trägt Markdown, das ein Agent geschrieben hat. Dessen
eigene Eingaben sind Webseiten, Werkzeugausgaben und Dateien — allesamt
außerhalb der Vertrauensgrenze dieses Systems. Der Vertrag sagt das in
denselben Worten und verlagert die Verantwortung ausdrücklich zum Client:
`FeedbackEntry.body` ist „untrusted markdown … handed through verbatim —
sanitising it before rendering is the client's job".

Das Cockpit rendert diesen Text in denselben Origin, der auch mit der Read API
spricht. Es sanitisiert ihn deshalb vor dem Rendern mit `rehype-sanitize` gegen
eine **Allow-List**: Was nicht aufgeführt ist, wird entfernt. Ein nicht
vorhergesehener Vektor scheitert damit standardmäßig, statt daran zu scheitern,
dass jemand ihn vorhergesehen hat.

> **`frontend/src/components/workspace/inspector/sanitizeSchema.ts` ist eine
> Sicherheitskontrolle, keine Formatierungsoption.** Ein zusätzlicher Eintrag in
> `tagNames` oder in `protocols` erweitert unmittelbar, was ein Agent in den
> Origin des Cockpits rendern darf. Eine Änderung an dieser Datei verlangt
> dieselbe Sorgfalt wie eine Änderung an einer Authentifizierungsregel.

Die Begründung der Pipeline im Detail — warum sanitisiert wird und nicht auf
das Parsen von HTML verzichtet — steht in
[ADR 0012](./decisions/0012-component-inspector-and-markdown-safety.md).

## Was v0 ausdrücklich nicht kann

Diese Punkte sind keine offenen Aufgaben, sondern gezogene Grenzen. Wenn ein
Nutzer eines davon erwartet, ist die Erwartung falsch, nicht das System.

| Nicht in v0 | Bedeutung |
| --- | --- |
| **Repository-Zugriff** | Das System liest kein Repository. Jeder Diff, jeder Dateipfad und jede Architektur ist das, was ein Agent gemeldet hat — nicht das, was in einem Repository steht. Nichts wird verifiziert. |
| **GitHub-, GitLab- oder Gitea-Anbindung** | Keine Integration, keine Commits, keine Pull Requests, keine Webhooks. Siehe [`RepositoryProvider`-Grenze](#repositoryprovider-grenze). |
| **Authentifizierung und Autorisierung** | Siehe oben. |
| **Multi-Tenancy** | Siehe oben. |
| **Programmablauf-Visualisierung** | Das Cockpit zeigt die Architektur und die gemeldete Arbeit daran, keine Aufruf- oder Kontrollflüsse. |
| **Steuerung des Agenten** | Read-only und beobachtend. Es gibt keinen Rückkanal zum Agenten: kein Stoppen, kein Umlenken, kein Genehmigen. |
| **Prompting aus der Anwendung heraus** | Es gibt kein Eingabefeld, das beim Agenten landet. |
| **Bewertung, ob die Arbeit richtig ist** | Das System führt keine Qualitäts- oder Driftbewertung durch. `risk.reported` und `problem.reported` sind Aussagen des Agenten über sich selbst. Der Mensch urteilt. |

Ebenfalls nicht abgeleitet, sondern nur gemeldet: der Status. Es gibt keine
Stall-Erkennung, keine Timeouts und keine Heuristik. Ein Run ohne Terminalevent
bleibt offen und zeigt seinen letzten gemeldeten Stand. Details im
[Lifecycle-Abschnitt](./agent-integration.md#lifecycle).

Zwei technische Grenzen desselben Zuschnitts: es gibt genau **eine**
Backend-Instanz — der SSE-Broker läuft im Prozess, eine zweite Instanz würde die
Live-Hälfte der Streams brechen — und das Cockpit ist Desktop-only mit
verbindlicher Abnahme bei 1920 × 1080 in Chromium.

<a id="repositoryprovider-grenze"></a>

## Die `RepositoryProvider`-Grenze

v0 enthält **keinen** Repository-Zugriff und **keine** `RepositoryProvider`-
Schnittstelle. Es gibt nichts zu implementieren und nichts zu konfigurieren;
dieser Abschnitt beschreibt ausschließlich, *wo* eine spätere Anbindung an
GitHub, GitLab oder Gitea andocken würde und welche Annahmen heute schon so
getroffen wurden, dass sie das nicht verbauen.

**Die Stelle.** Alles, was das Cockpit über den Code weiß, kommt heute als
gemeldeter Inhalt in einem Event: `diff.reported` trägt den Unified Diff und den
Dateipfad, `architecture.snapshot_published` trägt das Modell. Eine
Repository-Anbindung würde genau hier ansetzen — als **Auflöser einer
Meldung gegen ein Repository**, nicht als zweite Datenquelle neben dem Event
Log. Der Event Log bliebe die Wahrheit darüber, *was der Agent behauptet hat*;
ein Provider könnte danebenstellen, *was im Repository tatsächlich steht*.

**Die Annahmen, die das offenhalten:**

- **Diffs sind repository-relativ und unified.** `filePath` ist per Schema
  repository-relativ; absolute Pfade und `..`-Segmente werden abgelehnt. Ein
  gemeldeter Pfad ist damit ohne Umrechnung gegen einen Repository-Baum
  auflösbar. Der Diff selbst ist unified — dasselbe Format, das jeder Forge
  ausliefert.
- **Ein Diff-Event trägt genau eine Datei.** Es gibt keine gebündelten
  Mehrdateien-Diffs, die erst zerlegt werden müssten. Die logische Änderung
  wird über `changeId` zusammengehalten.
- **Komponenten tragen keine Repository-Identität.** Eine `componentId` ist ein
  vom Agenten vergebenes, stabiles Kürzel; das Modell kennt weder Repository-URL
  noch Branch noch Commit. Die Architektur ist damit nicht an ein Repository
  gebunden und muss auch nicht daraus abgeleitet werden. Eine spätere Zuordnung
  wäre eine zusätzliche Beziehung, keine Änderung am Modell.
- **Der Event Log ist die Audit-Quelle.** Er ist append-only und im Code
  erzwungen; Korrekturen und Rücknahmen sind neue Events mit Verweis auf das
  Original, nie Bearbeitungen. Ein späterer Provider kann also nichts
  überschreiben — er kann nur ergänzen. Das ist die Eigenschaft, die eine
  Anbindung ungefährlich macht.

Was bewusst **nicht** festgelegt ist: die Signatur einer solchen Schnittstelle,
ihr Ort im Code, ihr Transport und ihre Authentifizierung gegenüber der Forge.
Diese Entscheidungen gehören in das Issue, das die Anbindung tatsächlich baut,
und werden hier nicht vorweggenommen.
