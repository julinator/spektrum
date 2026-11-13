/**
 * Nachrichtenquellen und ihre Einordnung im politischen Spektrum.
 *
 * `position` ist eine grobe redaktionelle Verortung von 0 (links) bis 100 (rechts).
 * Sie beruht auf gängigen Einschätzungen der deutschen Medienlandschaft und ist
 * bewusst eine Näherung: Werte anpassen oder Quellen mit `enabled: false` abschalten.
 *
 * Diese Datei nutzen sowohl die App (Browser) als auch der Cloudflare-Worker,
 * der nur Feeds aus dieser Liste abruft. Pro Quelle sind bis zu zwei Feeds möglich
 * (z. B. Inland und Ausland). `note` ist eine kurze, gängige Einordnung des Mediums.
 */

export const LEAN_LABEL = {
  "links": "Links",
  "mitte-links": "Mitte-links",
  "mitte": "Mitte",
  "mitte-rechts": "Mitte-rechts",
  "rechts": "Rechts",
};

export function leanFor(position) {
  if (position < 25) return "links";
  if (position < 45) return "mitte-links";
  if (position <= 55) return "mitte";
  if (position < 75) return "mitte-rechts";
  return "rechts";
}

export const SOURCES = [
  // --- links ---
  { id: "jacobin", name: "Jacobin", site: "https://jacobin.de", feeds: ["https://jacobin.de/rss"], position: 6, enabled: false,
    note: "Sozialistisches Magazin, deutsche Ausgabe des US-Magazins Jacobin." },
  { id: "nd", name: "nd", site: "https://www.nd-aktuell.de", feeds: ["https://www.nd-aktuell.de/rss/politik.xml"], position: 12, enabled: true,
    note: "Überregionale Tageszeitung aus Berlin, hervorgegangen aus dem „Neuen Deutschland“, heute genossenschaftlich getragen. Gilt als links bis sozialistisch." },
  { id: "taz", name: "taz", site: "https://taz.de", feeds: ["https://taz.de/!p4615;rss/"], position: 18, enabled: true,
    note: "Genossenschaftlich getragene Tageszeitung aus Berlin. Gilt als links-alternativ." },
  { id: "freitag", name: "der Freitag", site: "https://www.freitag.de", feeds: ["https://www.freitag.de/@@RSS"], position: 22, enabled: false,
    note: "Wochenzeitung aus Berlin. Gilt als links." },

  // --- mitte-links ---
  { id: "fr", name: "Frankfurter Rundschau", site: "https://www.fr.de", feeds: ["https://www.fr.de/politik/rssfeed.rdf"], position: 32, enabled: true,
    note: "Überregionale Tageszeitung aus Frankfurt am Main. Gilt als linksliberal." },
  { id: "spiegel", name: "Der Spiegel", site: "https://www.spiegel.de", feeds: ["https://www.spiegel.de/politik/index.rss"], position: 36, enabled: true,
    note: "Nachrichtenmagazin aus Hamburg. Gilt als linksliberal." },
  { id: "sz", name: "Süddeutsche Zeitung", site: "https://www.sueddeutsche.de", feeds: ["https://rss.sueddeutsche.de/rss/Politik"], position: 38, enabled: true,
    note: "Überregionale Tageszeitung aus München. Gilt als linksliberal." },
  { id: "stern", name: "Stern", site: "https://www.stern.de", feeds: ["https://www.stern.de/feed/standard/politik/"], position: 40, enabled: false,
    note: "Illustrierte aus Hamburg. Gilt als linksliberal." },
  { id: "zeit", name: "Die Zeit", site: "https://www.zeit.de", feeds: ["https://newsfeed.zeit.de/politik/deutschland/index", "https://newsfeed.zeit.de/politik/ausland/index"], position: 42, enabled: true,
    note: "Wochenzeitung aus Hamburg mit tagesaktuellem Onlineangebot. Gilt als liberal bis linksliberal." },

  // --- mitte ---
  { id: "rnd", name: "RND", site: "https://www.rnd.de", feeds: ["https://www.rnd.de/arc/outboundfeeds/rss/"], position: 46, enabled: false, maxItems: 60,
    note: "RedaktionsNetzwerk Deutschland, beliefert viele Regionalzeitungen." },
  { id: "dw", name: "Deutsche Welle", site: "https://www.dw.com", feeds: ["https://rss.dw.com/rdf/rss-de-all"], position: 47, enabled: false, maxItems: 60,
    note: "Auslandssender der Bundesrepublik, öffentlich-rechtlich." },
  { id: "tagesschau", name: "tagesschau.de", site: "https://www.tagesschau.de", feeds: ["https://www.tagesschau.de/inland/index~rss2.xml", "https://www.tagesschau.de/ausland/index~rss2.xml"], position: 48, enabled: true,
    note: "Nachrichtenangebot der ARD. Öffentlich-rechtlich und gesetzlich zu Ausgewogenheit verpflichtet." },
  { id: "zdf", name: "ZDFheute", site: "https://www.zdfheute.de", feeds: ["https://www.zdfheute.de/rss/zdf/nachrichten/politik"], position: 49, enabled: true, maxItems: 60,
    note: "Nachrichtenangebot des ZDF. Öffentlich-rechtlich und gesetzlich zu Ausgewogenheit verpflichtet." },
  { id: "tonline", name: "t-online", site: "https://www.t-online.de", feeds: ["https://www.t-online.de/nachrichten/feed.rss"], position: 50, enabled: false,
    note: "Nachrichtenportal, gehört zum Medienhaus Ströer." },
  { id: "ntv", name: "n-tv", site: "https://www.n-tv.de", feeds: ["https://www.n-tv.de/politik/rss"], position: 52, enabled: true,
    note: "Privater Nachrichtensender der RTL-Gruppe. Gilt als politisch weitgehend mittig." },

  // --- mitte-rechts ---
  { id: "handelsblatt", name: "Handelsblatt", site: "https://www.handelsblatt.com", feeds: ["https://www.handelsblatt.com/contentexport/feed/politik"], position: 58, enabled: true,
    note: "Wirtschafts- und Finanzzeitung aus Düsseldorf. Gilt als wirtschaftsliberal." },
  { id: "focus", name: "Focus", site: "https://www.focus.de", feeds: ["https://www.focus.de/rss"], position: 60, enabled: false, maxItems: 60,
    note: "Nachrichtenmagazin aus München. Gilt als liberal-konservativ." },
  { id: "faz", name: "FAZ", site: "https://www.faz.net", feeds: ["https://www.faz.net/rss/aktuell/politik"], position: 62, enabled: true,
    note: "Überregionale Tageszeitung aus Frankfurt am Main. Gilt als bürgerlich-konservativ bis liberal." },
  { id: "nzz", name: "NZZ", site: "https://www.nzz.ch", feeds: ["https://www.nzz.ch/deutschland.rss", "https://www.nzz.ch/international.rss"], position: 64, enabled: true,
    note: "Schweizer Tageszeitung aus Zürich mit eigener Deutschland-Berichterstattung. Gilt als liberal-konservativ." },
  { id: "welt", name: "Welt", site: "https://www.welt.de", feeds: ["https://www.welt.de/feeds/section/politik.rss"], position: 68, enabled: true,
    note: "Tageszeitung des Axel-Springer-Verlags. Gilt als konservativ bis liberal-konservativ." },
  { id: "cicero", name: "Cicero", site: "https://www.cicero.de", feeds: ["https://www.cicero.de/rss.xml"], position: 72, enabled: false,
    note: "Monatsmagazin für politische Kultur. Gilt als liberal-konservativ." },
  { id: "bild", name: "Bild", site: "https://www.bild.de", feeds: ["https://www.bild.de/feed/politik.xml"], position: 73, enabled: true, maxItems: 60,
    note: "Boulevardzeitung des Axel-Springer-Verlags. Gilt als konservativ und zuspitzend." },

  // --- rechts ---
  { id: "apollo", name: "Apollo News", site: "https://apollo-news.net", feeds: ["https://apollo-news.net/feed/"], position: 82, enabled: false,
    note: "Onlinemedium. Gilt als konservativ bis rechtskonservativ." },
  { id: "tichy", name: "Tichys Einblick", site: "https://www.tichyseinblick.de", feeds: ["https://www.tichyseinblick.de/feed/"], position: 86, enabled: true,
    note: "Onlinemagazin und Monatszeitschrift von Roland Tichy. Gilt als rechtskonservativ." },
  { id: "nius", name: "NIUS", site: "https://www.nius.de", feeds: ["https://nius.de/rss"], position: 86, enabled: true, maxItems: 60,
    note: "Onlinemedium, 2023 von Julian Reichelt gegründet. Gilt als rechtskonservativ bis rechtspopulistisch." },
  { id: "jf", name: "Junge Freiheit", site: "https://jungefreiheit.de", feeds: ["https://jungefreiheit.de/feed/"], position: 90, enabled: true,
    note: "Wochenzeitung aus Berlin. Gilt als rechtskonservativ und wird häufig der Neuen Rechten zugeordnet." },
];

export function activeSources() {
  return SOURCES.filter((s) => s.enabled).sort((a, b) => a.position - b.position);
}

export function sourceById(id) {
  return SOURCES.find((s) => s.id === id);
}
