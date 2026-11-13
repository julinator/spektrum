/**
 * Themen-Bündelung ohne KI: Artikel verschiedener Quellen werden über gemeinsame
 * Eigennamen und Stichwörter zusammengefasst.
 */

const STOP = new Set(
  `aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes anderm andern anderr anders auch auf aus bei bin bis bist da damit dann der den des dem die das dass daß derselbe derselben denselben desselben demselben dieselbe dieselben dasselbe dazu dein deine deinem deinen deiner deines denn derer dessen dich dir du dies diese diesem diesen dieser dieses doch dort durch ein eine einem einen einer eines einig einige einigem einigen einiger einiges einmal er ihn ihm es etwas euer eure eurem euren eurer eures für gegen gewesen hab habe haben hat hatte hatten hier hin hinter ich mich mir ihr ihre ihrem ihren ihrer ihres euch im in indem ins ist jede jedem jeden jeder jedes jene jenem jenen jener jenes jetzt kann kein keine keinem keinen keiner keines können könnte machen man manche manchem manchen mancher manches mein meine meinem meinen meiner meines mit muss musste nach nicht nichts noch nun nur ob oder ohne sehr sein seine seinem seinen seiner seines selbst sich sie ihnen sind so solche solchem solchen solcher solches soll sollte sondern sonst über um und uns unse unsem unsen unser unses unter viel vom von vor während war waren warst was weg weil weiter welche welchem welchen welcher welches wenn werde werden wie wieder will wir wird wirst wo wollen wollte würde würden zu zum zur zwar zwischen neue neuen neuer neues mehr immer schon sagt sagte heute gestern morgen jahr jahre jahren prozent euro millionen milliarden deutschland deutsche deutschen deutscher berlin news nachrichten liveblog live ticker update kommentar analyse interview video podcast newsletter`.split(/\s+/),
);

function tokens(text) {
  return text
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.replace(/(ungen|ung|heit|keit|schaft|ern|en|er|es|e|s|n)$/u, ""))
    .filter((w) => w.length >= 4);
}

function entities(text) {
  // Großgeschriebene Wörter, die nicht am Satzanfang stehen, als Näherung für Eigennamen
  const out = new Set();
  for (const m of text.matchAll(/(?<![.!?:]\s|^)(?<!\p{L})([A-ZÄÖÜ][a-zäöüß]{3,}(?:-[A-ZÄÖÜ][a-zäöüß]+)?)(?!\p{L})/gu)) {
    const w = m[1].toLowerCase();
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}

function similarity(a, b) {
  let sharedEnts = 0;
  for (const e of a.ents) if (b.ents.has(e)) sharedEnts++;
  let inter = 0;
  for (const t of a.tokens) if (b.tokens.has(t)) inter++;
  const union = a.tokens.size + b.tokens.size - inter;
  const jaccard = union ? inter / union : 0;
  return jaccard + sharedEnts * 0.12;
}

/** "Kicker: Schlagzeile" auf die Schlagzeile kürzen, Quellennamen am Ende entfernen. */
export function cleanTitle(title) {
  let t = title.trim();
  const m = t.match(/^[^:]{3,40}:\s+(.{25,})$/);
  if (m) t = m[1];
  t = t.replace(/\s*[-–|]\s*(Der Spiegel|SPIEGEL|ZEIT ONLINE|WELT|FAZ|taz\.de|taz|n-tv\.de|BILD|NZZ|tagesschau\.de|ZDFheute|NIUS)\s*$/i, "");
  return t.trim();
}

/**
 * Bündelt Artikel zu Themen. Ein Thema braucht Artikel aus mindestens `minSources`
 * verschiedenen Quellen. Titel kommen bevorzugt aus `preferredSources` (neutrale Medien).
 */
/** Liveticker und Sammelartikel streifen viele Themen und verfälschen die Bündelung. */
const ROUNDUP = /^(live|erklärt|newsblog|liveblog|ticker|eilmeldung|news|podcast)\b|podcast|\+\+\+|liveblog|newsblog|live-ticker|im überblick|die wichtigsten (nachrichten|news|meldungen)|was heute wichtig ist|der tag im überblick|morgenbriefing|newsletter|heute journal|tagesthemen|\bvom \d{1,2}\. (januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/i;

export function isRoundup(article) {
  return ROUNDUP.test(article.title);
}

export function clusterArticles(articles, maxTopics, minSources = 3, preferredSources = new Set(), { minMax = 0.35, minAvg = 0.16 } = {}) {
  const sigs = articles.filter((a) => !isRoundup(a)).map((article) => {
    const base = `${article.title}. ${article.description}`;
    return { article, tokens: new Set(tokens(base)), ents: entities(base) };
  });
  const clusters = [];
  for (const sig of sigs) {
    let best = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      let max = 0;
      let sum = 0;
      for (const member of cluster) {
        const sim = similarity(sig, member);
        sum += sim;
        if (sim > max) max = sim;
      }
      // Muss zu einem Artikel klar passen und zum Thema insgesamt nicht völlig fremd sein
      const avg = sum / cluster.length;
      if (max >= minMax && (cluster.length < 3 || avg >= minAvg) && max > bestScore) {
        bestScore = max;
        best = cluster;
      }
    }
    if (best) best.push(sig);
    else clusters.push([sig]);
  }
  return clusters
    .map((cluster) => {
      const sources = new Set(cluster.map((s) => s.article.sourceId));
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
