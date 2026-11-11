# Spektrum

Ein Thema, viele Blickwinkel. Spektrum liest deutschsprachige Nachrichtenquellen
von links bis rechts, bündelt die aktuellen Meldungen zu Themen und zeigt dir für
jedes Thema, wie die einzelnen Quellen darüber berichten.

- **Hoch und runter wischen**: von Thema zu Thema.
- **Seitlich wischen**: dieselbe Nachricht bei der nächsten Quelle, sortiert von
  politisch links nach rechts. Die Leiste über dem Text zeigt, wo die Quelle steht.
  Tippen auf einen Punkt springt direkt dorthin.
- **Linker Knopf oben**: alle Themen als Liste, dazu „Jetzt aktualisieren“.
- **Rechter Knopf oben**: Quellen ein- und ausschalten.

## So funktioniert es

Spektrum läuft kostenlos auf **Cloudflare Workers**, ohne eigenen Server und ohne
dass dein Mac laufen muss.

- Cloudflare liefert die App aus und holt die RSS-Feeds ab (`/feed/<quelle>`).
  Abgerufen werden nur Feeds aus der festen Liste in
  [public/js/sources.js](public/js/sources.js).
- Dein iPhone bündelt die Meldungen selbst zu Themen, sobald du die App öffnest.
  Ist der letzte Stand älter als 10 Minuten, lädt sie neue Themen. Bis dahin zeigt
  sie sofort den gespeicherten Stand, auch ohne Netz.

## Als App auf dem iPhone

1. In **Safari** die Spektrum-Adresse öffnen (`https://spektrum.<dein-name>.workers.dev`).
2. Unten auf **Teilen** tippen, dann **Zum Home-Bildschirm**, dann **Hinzufügen**.

Spektrum liegt dann mit eigenem Icon auf dem Home-Bildschirm und öffnet sich ohne
Safari-Leisten wie eine normale App.

## Entwickeln und veröffentlichen

```bash
npm install
npm run dev      # lokal unter http://localhost:8787, verhält sich wie die Live-Version
npm run deploy   # auf Cloudflare veröffentlichen
```

Zum Veröffentlichen einmalig `npx wrangler login` ausführen und im Browser bestätigen.

## Quellen und Verortung

Jede Quelle hat eine `position` von 0 (links) bis 100 (rechts). Das ist eine grobe,
redaktionelle Näherung an gängige Einschätzungen der deutschen Medienlandschaft,
keine wissenschaftliche Messung. Passe die Werte gern an, schalte Quellen mit
`enabled: false` ab oder füge eigene RSS-Feeds hinzu, danach `npm run deploy`.

Standardmäßig aktiv (von links nach rechts): nd, taz, Frankfurter Rundschau,
Der Spiegel, Süddeutsche Zeitung, Die Zeit, tagesschau.de, ZDFheute, n-tv,
Handelsblatt, FAZ, NZZ, Welt, Bild, Tichys Einblick, NIUS, Junge Freiheit.
Vorbereitet, aber abgeschaltet: Jacobin, der Freitag, Stern, RND, Deutsche Welle,
t-online, Focus, Cicero, Apollo News.

## Aufbau

```
public/index.html        Oberfläche (Apple-Optik nach den Human Interface Guidelines)
public/style.css         Gestaltung, hell und dunkel
public/app.js            Bedienung: Wischen, Sheets, Speichern, Aktualisieren
public/js/sources.js     Quellen und Verortung
public/js/feeds.js       Feeds laden und lesen
public/js/cluster.js     Themen bündeln
public/js/pipeline.js    Ablauf: Feeds, Themen, Reihenfolge links bis rechts
worker/index.js          Cloudflare-Worker: App ausliefern, Feeds abholen
wrangler.jsonc           Cloudflare-Einstellungen
```

Die frühere Server-Version mit optionalen KI-Zusammenfassungen liegt im ersten
Commit der Git-Historie.
