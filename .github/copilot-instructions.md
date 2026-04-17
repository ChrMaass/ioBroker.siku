# Copilot Instructions für `ioBroker.siku`

## Arbeitsweise
- Arbeite in kleinen, thematisch klaren Schritten.
- In diesem Projekt ist **autonomes Arbeiten ausdrücklich gewünscht**.
- Warte **nicht** auf zusätzliche Freigaben für Commits, Pushes, PRs, Merges oder Copilot-Reviews.
- Teste vor jedem Push lokal.

## GitHub-Workflow
- Nutze kleine PRs mit klar abgegrenztem Scope.
- Verwende für GitHub-Texte (PRs, Issues, Kommentare) **deutsche Sprache** und **Markdown**.
- Stoße nach substanziellen Pushes ein Copilot-Review mit `gh copilot-review` an.
- Prüfe danach bis zu 15 Minuten lang im Minutenabstand, ob das Copilot-Review abgeschlossen ist.
- Bewerte Kommentare fachlich, setze sinnvolle Hinweise um und beantworte/schließe die Threads anschließend.

## Produktspezifische Regeln
- Adaptername/Paketname: `iobroker.siku`
- GitHub-Repo: `ChrMaass/ioBroker.siku`
- Eine Adapter-Instanz verwaltet mehrere Lüfter.
- Discovery per UDP-Broadcast ist Kernbestandteil.
- Zeitdaten nicht im Standard-Polling lesen.
- Zeitcheck nur alle 24 Stunden; Zeitsync nur bei Drift > 10 Sekunden.

## Live-Test-Regeln
- Lesen im Netzwerk ist jederzeit erlaubt.
- Keine schreibenden Tests auf dem Schlafzimmer-Gerät.
- Wenn an anderen Geräten Einstellungen testweise geändert werden, danach den Ursprungszustand wiederherstellen (Uhrzeit ausgenommen).
- Wenn die Zuordnung Schlafzimmer/Nicht-Schlafzimmer unklar ist, nur lesende Netzwerktests durchführen.
