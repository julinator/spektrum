# Spektrum

Ein Thema, viele Blickwinkel. Spektrum liest deutschsprachige Nachrichtenquellen
von links bis rechts, bündelt die aktuellen Meldungen zu Themen und zeigt dir für
jedes Thema, wie die einzelnen Quellen darüber berichten.

- **Hoch und runter wischen**: von Thema zu Thema.
- **Seitlich wischen**: dieselbe Nachricht bei der nächsten Quelle, sortiert von
  politisch links nach rechts. Die Leiste über dem Text zeigt, wo die Quelle steht.
  Tippen auf einen Punkt springt direkt dorthin.
- **„1 von 12“** oben öffnet die Themenliste, **„Quellen“** blendet Quellen aus oder ein.
- Jede Quelle zeigt Schlagzeile, Anreißer, Uhrzeit und „Artikel lesen“ zum Original.

## Starten

Voraussetzung: Node.js 22.18 oder neuer (auf diesem Mac: Node 24).

```bash
cd "spektrum"
npm install
npm start
```

Dann im Browser `http://localhost:8787` öffnen. Der lokale Server liest die Feeds
beim Start und danach alle 30 Minuten neu.

## Online über GitHub Pages

Spektrum läuft ohne eigenen Server: GitHub liest alle 30 Minuten die Feeds,
bildet die Themen und veröffentlicht die fertige Seite kostenlos auf GitHub Pages.
Das erledigt der Workflow [.github/workflows/pages.yml](.github/workflows/pages.yml).
Dein Mac muss dafür nicht laufen.

- Adresse: `https://<dein-github-name>.github.io/spektrum/`
- Neu veröffentlichen nach Änderungen: einfach `git push`.
- Sofort aktualisieren: auf GitHub unter **Actions → Spektrum aktualisieren → Run workflow**.
- GitHub schaltet Zeitpläne in Repos ohne Aktivität nach 60 Tagen ab. Ein wöchentlicher
  Schritt im Workflow aktiviert ihn deshalb neu. Falls GitHub trotzdem eine E-Mail schickt,
  dass der Workflow pausiert ist: dort auf **Enable workflow** klicken.

Lokal bauen, ohne zu veröffentlichen: `npm run build` (Ergebnis in `site/`).

## Als App auf dem iPhone

1. Auf dem iPhone **Safari** öffnen und `https://<dein-github-name>.github.io/spektrum/` aufrufen.
2. Unten auf **Teilen** tippen, dann **Zum Home-Bildschirm**, dann **Hinzufügen**.

Spektrum liegt dann mit eigenem Icon auf dem Home-Bildschirm und öffnet sich ohne
Safari-Leisten wie eine normale App. Ohne Netz zeigt sie den zuletzt geladenen Stand.

Zum Testen auf dem Mac geht weiterhin `npm start` (Adresse `http://localhost:8787`);
im selben WLAN ist die App dann auch unter der im Terminal angezeigten Adresse erreichbar.

## KI-Zusammenfassungen (optional)

Standardmäßig ist `KI=aus` gesetzt: Themen werden über gemeinsame Namen und
Stichwörter gebildet, angezeigt werden die Originaltexte der Feeds. Das kostet nichts.

Mit `KI=an` und einem Anthropic API-Key in der `.env` bündelt Claude die Themen und
beschreibt pro Quelle, wie sie berichtet: Zusammenfassung, was im Vordergrund steht,
Tonfall. Grobe Kosten pro Aktualisierung:

| Modell | pro Aktualisierung |
|---|---|
| `claude-opus-5-5` | ca. 1,00 bis 1,80 $ |
| `claude-sonnet-5-5` | ca. 0,50 bis 0,90 $ |
| `claude-haiku-5-5` | ca. 0,03 bis 0,05 $ |

## Quellen und Verortung

Die Quellen stehen in [server/sources.ts](server/sources.ts). Jede hat eine
`position` von 0 (links) bis 100 (rechts). Das ist eine grobe, redaktionelle
Näherung an gängige Einschätzungen der deutschen Medienlandschaft, keine
wissenschaftliche Messung. Passe die Werte gern an, schalte Quellen mit
`enabled: false` ab oder füge eigene RSS-Feeds hinzu.

Standardmäßig aktiv (von links nach rechts): nd, taz, Frankfurter Rundschau,
Der Spiegel, Süddeutsche Zeitung, Die Zeit, tagesschau.de, ZDFheute, n-tv,
Handelsblatt, FAZ, NZZ, Welt, Bild, Tichys Einblick, NIUS, Junge Freiheit.
Vorbereitet, aber abgeschaltet: Jacobin, der Freitag, Stern, RND, Deutsche Welle,
t-online, Focus, Cicero, Apollo News.

## Konfiguration (.env)

| Variable | Standard | Bedeutung |
|---|---|---|
| `KI` | `aus` | `an` schaltet Claude-Zusammenfassungen ein |
| `ANTHROPIC_API_KEY` | – | nur mit `KI=an` nötig |
| `REFRESH_MINUTES` | `30` (mit KI `90`) | Abstand der automatischen Aktualisierung |
| `PORT` | `8787` | Port des Servers |
| `HOURS_BACK` | `36` | nur Artikel aus diesem Zeitraum |
| `MAX_TOPICS` | `12` | Höchstzahl der Themen |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Modell bei `KI=an` |

## Aufbau

```
server/sources.ts    Quellen und Verortung
server/feeds.ts      RSS lesen, Artikeltexte laden
server/heuristic.ts  Themenbildung ohne KI
server/claude.ts     Themen bündeln und zusammenfassen (nur mit KI=an)
server/pipeline.ts   Ablauf, Zwischenspeicher in data/
server/index.ts      lokaler HTTP-Server zum Testen
server/build.ts      statische Seite für GitHub Pages bauen
public/              Oberfläche, App-Manifest, Icons, Service Worker
.github/workflows/   automatische Aktualisierung und Veröffentlichung
```

Typen prüfen: `npm run check`. Einmalig aktualisieren ohne Server: `npm run refresh`.
