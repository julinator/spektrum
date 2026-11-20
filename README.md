# Spektrum

Ein Thema, viele Blickwinkel. Spektrum liest deutschsprachige Nachrichtenquellen
von links bis rechts, bündelt die aktuellen Meldungen zu Themen und zeigt dir für
jedes Thema, wie die einzelnen Quellen darüber berichten.

- **Hoch und runter wischen**: von Thema zu Thema, egal wo der Finger startet.
- **Seitlich wischen**: dieselbe Nachricht bei der nächsten Quelle, sortiert von
  politisch links nach rechts. Das geht auf der Karte, der Überschrift und der Leiste.
  Jede Karte passt genau auf den Bildschirm (Bild, Überschrift, Anriss) und scrollt
  nie selbst. Weitere Artikel derselben Quelle öffnen sich über den Knopf unten.
  Tippen auf einen Punkt der Leiste springt dorthin, Tippen auf das Etikett erklärt
  die Einordnung. Greift eine Seite ein Thema kaum oder gar nicht auf, steht das als
  Hinweis über der Überschrift.
- **Nach unten ziehen**: sofort aktualisieren.
- **Merken und Teilen**: Lesezeichen und Teilen-Symbol neben jedem Thema.
  Gemerkte Themen stehen oben in der Themenliste.
- **Neu und gelesen**: Neue Themen sind markiert, gelesene erscheinen blasser.
- **Linker Knopf oben**: Themenliste und Merkliste. **Rechter Knopf oben**: Quellen ein- und ausschalten.
- Die Schrift folgt der Textgröße, die am iPhone eingestellt ist.

## So funktioniert es

Spektrum läuft kostenlos auf **Cloudflare Workers**, ohne eigenen Server und ohne
dass dein Mac laufen muss.

- Cloudflare liefert die App aus und holt die RSS-Feeds ab (`/feed/<quelle>`).
  Abgerufen werden nur Feeds aus der festen Liste in
  [public/js/sources.js](public/js/sources.js).
- Gelesen werden die Politik-Feeds der Medien, damit es um Themen geht, bei denen
  sich die Blickwinkel unterscheiden. Liveticker und Sammelartikel bleiben beim
  Bündeln außen vor.
- Dein iPhone bündelt die Meldungen selbst zu Themen, sobald du die App öffnest.
  Ist der letzte Stand älter als 10 Minuten, lädt sie neue Themen. Bis dahin zeigt
  sie sofort den gespeicherten Stand, auch ohne Netz.

## Als App auf dem iPhone

1. In **Safari** die Spektrum-Adresse öffnen (`https://spektrum.spektrum.workers.dev`).
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
