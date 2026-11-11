/**
 * Themen-Gruppierung ohne KI: Artikel verschiedener Quellen werden über
 * gemeinsame Eigennamen und Stichwörter zusammengefasst. Dient als Rückfall,
 * wenn kein API-Key vorhanden ist oder die API nicht erreichbar war.
 */
import type { Article } from "./types.ts";

const STOP = new Set(
  `aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes anderm andern anderr anders auch auf aus bei bin bis bist da damit dann der den des dem die das dass daß derselbe derselben denselben desselben demselben dieselbe dieselben dasselbe dazu dein deine deinem deinen deiner deines denn derer dessen dich dir du dies diese diesem diesen dieser dieses doch dort durch ein eine einem einen einer eines einig einige einigem einigen einiger einiges einmal er ihn ihm es etwas euer eure eurem euren eurer eures für gegen gewesen hab habe haben hat hatte hatten hier hin hinter ich mich mir ihr ihre ihrem ihren ihrer ihres euch im in indem ins ist jede jedem jeden jeder jedes jene jenem jenen jener jenes jetzt kann kein keine keinem keinen keiner keines können könnte machen man manche manchem manchen mancher manches mein meine meinem meinen meiner meines mit muss musste nach nicht nichts noch nun nur ob oder ohne sehr sein seine seinem seinen seiner seines selbst sich sie ihnen sind so solche solchem solchen solcher solches soll sollte sondern sonst über um und uns unse unsem unsen unser unses unter viel vom von vor während war waren warst was weg weil weiter welche welchem welchen welcher welches wenn werde werden wie wieder will wir wird wirst wo wollen wollte würde würden zu zum zur zwar zwischen neue neuen neuer neues mehr immer schon sagt sagte heute gestern morgen jahr jahre jahren prozent euro millionen milliarden deutschland deutsche deutschen deutscher berlin news nachrichten liveblog live ticker update kommentar analyse interview video podcast newsletter`.split(/\s+/),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.replace(/(ungen|ung|heit|keit|schaft|ern|en|er|es|e|s|n)$/u, ""))
    .filter((w) => w.length >= 4);
}

function entities(text: string): string[] {
  // Großgeschriebene Wörter, die nicht am Satzanfang stehen, als Eigennamen-Näherung
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![.!?:]\s|^)(?<!\p{L})([A-ZÄÖÜ][a-zäöüß]{3,}(?:-[A-ZÄÖÜ][a-zäöüß]+)?)(?!\p{L})/gu)) {
    const w = m[1].toLowerCase();
    if (!STOP.has(w)) out.add(w);
  }
  return [...out];
}

interface Sig {
  article: Article;
  tokens: Set<string>;
  ents: Set<string>;
}

function similarity(a: Sig, b: Sig): number {
  let sharedEnts = 0;
  for (const e of a.ents) if (b.ents.has(e)) sharedEnts++;
  let inter = 0;
  for (const t of a.tokens) if (b.tokens.has(t)) inter++;
  const union = a.tokens.size + b.tokens.size - inter;
  const jaccard = union ? inter / union : 0;
  return jaccard + sharedEnts * 0.12;
}

export interface Cluster {
  title: string;
  articleIds: string[];
}

/** "Kicker: Schlagzeile" auf die Schlagzeile kürzen, Quellennamen am Ende entfernen. */
export function cleanTitle(title: string): string {
  let t = title.trim();
  const m = t.match(/^[^:]{3,40}:\s+(.{25,})$/);
  if (m) t = m[1];
  t = t.replace(/\s*[-–|]\s*(Der Spiegel|SPIEGEL|ZEIT ONLINE|WELT|FAZ|taz\.de|taz|n-tv\.de|BILD|NZZ|tagesschau\.de|ZDFheute|NIUS)\s*$/i, "");
  return t.trim();
}

export function clusterHeuristically(articles: Article[], maxTopics: number, minSources = 3, preferredSources: Set<string> = new Set()): Cluster[] {
  const sigs: Sig[] = articles.map((article) => {
    const base = `${article.title}. ${article.description}`;
    return { article, tokens: new Set(tokens(base)), ents: new Set(entities(base)) };
  });
  const clusters: Sig[][] = [];
  for (const sig of sigs) {
    let best: Sig[] | null = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      let score = 0;
      for (const member of cluster) score = Math.max(score, similarity(sig, member));
      if (score > bestScore) {
        bestScore = score;
        best = cluster;
      }
    }
    if (best && bestScore >= 0.3) best.push(sig);
    else clusters.push([sig]);
  }
  return clusters
    .map((cluster) => {
      const sources = new Set(cluster.map((s) => s.article.sourceId));
      // Titel: bevorzugt aus einer neutralen Quelle, sonst der Artikel mit der
      // höchsten Ähnlichkeit zu allen anderen
      const preferred = cluster.filter((s) => preferredSources.has(s.article.sourceId));
      const candidates = preferred.length ? preferred : cluster;
      let title = candidates[0].article.title;
      let bestAvg = -1;
      for (const s of candidates) {
        const avg = cluster.reduce((sum, o) => sum + (o === s ? 0 : similarity(s, o)), 0) / Math.max(1, cluster.length - 1);
        if (avg > bestAvg) {
          bestAvg = avg;
          title = s.article.title;
        }
      }
      return { title: cleanTitle(title), articleIds: cluster.map((s) => s.article.id), sourceCount: sources.size };
    })
    .filter((c) => c.sourceCount >= minSources)
    .sort((a, b) => b.sourceCount - a.sourceCount || b.articleIds.length - a.articleIds.length)
    .slice(0, maxTopics)
    .map(({ title, articleIds }) => ({ title, articleIds }));
}
