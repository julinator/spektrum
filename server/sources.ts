/**
 * Nachrichtenquellen und ihre Einordnung im politischen Spektrum.
 *
 * `position` ist eine grobe redaktionelle Verortung von 0 (links) bis 100 (rechts).
 * Sie beruht auf gängigen Einschätzungen der deutschen Medienlandschaft und ist
 * bewusst eine Näherung: Du kannst die Werte hier jederzeit anpassen oder Quellen
 * mit `enabled: false` abschalten.
 */

export type Lean = "links" | "mitte-links" | "mitte" | "mitte-rechts" | "rechts";

export interface Source {
  id: string;
  name: string;
  site: string;
  feed: string;
  position: number; // 0 = links, 100 = rechts
  enabled: boolean;
  maxItems?: number; // Feeds mit sehr vielen Einträgen begrenzen
}

export const LEAN_LABEL: Record<Lean, string> = {
  "links": "Links",
  "mitte-links": "Mitte-links",
  "mitte": "Mitte",
  "mitte-rechts": "Mitte-rechts",
  "rechts": "Rechts",
};

export function leanFor(position: number): Lean {
  if (position < 25) return "links";
  if (position < 45) return "mitte-links";
  if (position <= 55) return "mitte";
  if (position < 75) return "mitte-rechts";
  return "rechts";
}

export const SOURCES: Source[] = [
  // --- links ---
  { id: "jacobin", name: "Jacobin", site: "https://jacobin.de", feed: "https://jacobin.de/rss", position: 6, enabled: false },
  { id: "nd", name: "nd", site: "https://www.nd-aktuell.de", feed: "https://www.nd-aktuell.de/rss/aktuell.php", position: 12, enabled: true },
  { id: "taz", name: "taz", site: "https://taz.de", feed: "https://taz.de/!p4608;rss/", position: 18, enabled: true },
  { id: "freitag", name: "der Freitag", site: "https://www.freitag.de", feed: "https://www.freitag.de/@@RSS", position: 22, enabled: false },

  // --- mitte-links ---
  { id: "fr", name: "Frankfurter Rundschau", site: "https://www.fr.de", feed: "https://www.fr.de/rssfeed.rdf", position: 32, enabled: true },
  { id: "spiegel", name: "Der Spiegel", site: "https://www.spiegel.de", feed: "https://www.spiegel.de/schlagzeilen/index.rss", position: 36, enabled: true },
  { id: "sz", name: "Süddeutsche Zeitung", site: "https://www.sueddeutsche.de", feed: "https://rss.sueddeutsche.de/rss/Topthemen", position: 38, enabled: true },
  { id: "stern", name: "Stern", site: "https://www.stern.de", feed: "https://www.stern.de/feed/standard/politik/", position: 40, enabled: false },
  { id: "zeit", name: "Die Zeit", site: "https://www.zeit.de", feed: "https://newsfeed.zeit.de/index", position: 42, enabled: true },

  // --- mitte ---
  { id: "rnd", name: "RND", site: "https://www.rnd.de", feed: "https://www.rnd.de/arc/outboundfeeds/rss/", position: 46, enabled: false, maxItems: 60 },
  { id: "dw", name: "Deutsche Welle", site: "https://www.dw.com", feed: "https://rss.dw.com/rdf/rss-de-all", position: 47, enabled: false, maxItems: 60 },
  { id: "tagesschau", name: "tagesschau.de", site: "https://www.tagesschau.de", feed: "https://www.tagesschau.de/index~rss2.xml", position: 48, enabled: true, maxItems: 60 },
  { id: "zdf", name: "ZDFheute", site: "https://www.zdf.de", feed: "https://www.zdf.de/rss/zdf/nachrichten", position: 49, enabled: true, maxItems: 60 },
  { id: "tonline", name: "t-online", site: "https://www.t-online.de", feed: "https://www.t-online.de/nachrichten/feed.rss", position: 50, enabled: false },
  { id: "ntv", name: "n-tv", site: "https://www.n-tv.de", feed: "https://www.n-tv.de/rss", position: 52, enabled: true, maxItems: 60 },

  // --- mitte-rechts ---
  { id: "handelsblatt", name: "Handelsblatt", site: "https://www.handelsblatt.com", feed: "https://www.handelsblatt.com/contentexport/feed/schlagzeilen", position: 58, enabled: true },
  { id: "focus", name: "Focus", site: "https://www.focus.de", feed: "https://www.focus.de/rss", position: 60, enabled: false, maxItems: 60 },
  { id: "faz", name: "FAZ", site: "https://www.faz.net", feed: "https://www.faz.net/rss/aktuell", position: 62, enabled: true, maxItems: 80 },
  { id: "nzz", name: "NZZ", site: "https://www.nzz.ch", feed: "https://www.nzz.ch/recent.rss", position: 64, enabled: true },
  { id: "welt", name: "Welt", site: "https://www.welt.de", feed: "https://www.welt.de/feeds/latest.rss", position: 68, enabled: true },
  { id: "cicero", name: "Cicero", site: "https://www.cicero.de", feed: "https://www.cicero.de/rss.xml", position: 72, enabled: false },
  { id: "bild", name: "Bild", site: "https://www.bild.de", feed: "https://www.bild.de/feed/alles.xml", position: 73, enabled: true, maxItems: 60 },

  // --- rechts ---
  { id: "apollo", name: "Apollo News", site: "https://apollo-news.net", feed: "https://apollo-news.net/feed/", position: 82, enabled: false },
  { id: "tichy", name: "Tichys Einblick", site: "https://www.tichyseinblick.de", feed: "https://www.tichyseinblick.de/feed/", position: 86, enabled: true },
  { id: "nius", name: "NIUS", site: "https://www.nius.de", feed: "https://www.nius.de/rss", position: 86, enabled: true, maxItems: 60 },
  { id: "jf", name: "Junge Freiheit", site: "https://jungefreiheit.de", feed: "https://jungefreiheit.de/feed/", position: 90, enabled: true },
];

export function activeSources(): Source[] {
  return SOURCES.filter((s) => s.enabled).sort((a, b) => a.position - b.position);
}

export function sourceById(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id);
}
