/**
 * Der Ablauf im Browser: Feeds lesen, Themen bilden, pro Thema die Quellen
 * von links nach rechts ordnen.
 */
import { activeSources, leanFor, sourceById } from "./sources.js";
import { clusterArticles, cleanTitle } from "./cluster.js";
import { fetchFeed, hash } from "./feeds.js";

export const CONFIG = {
  hoursBack: 36,
  maxTopics: 12,
  maxArticlesPerSource: 25,
  maxArticlesPerSourceInTopic: 3,
};

/**
 * Feeds lesen und Themen bilden.
 * `onPartial` bekommt einen vorläufigen Stand, sobald fast alle Quellen da sind
 * (langsame Feeds sollen den ersten Blick nicht aufhalten).
 */
export async function buildSnapshot(previous, onProgress = () => {}, { onPartial, partialAfterMs = 3500 } = {}) {
  const sources = activeSources();
  const results = new Map();
  let partialSent = false;
  const sendPartial = () => {
    if (partialSent || !onPartial || results.size === sources.length || results.size < Math.ceil(sources.length / 2)) return;
    partialSent = true;
    onPartial(assemble(sources, results, null));
  };
  const timer = onPartial ? setTimeout(sendPartial, partialAfterMs) : null;
  onProgress(0, sources.length);
  await Promise.all(
    sources.map(async (source) => {
      try {
        results.set(source.id, { source, articles: await fetchFeed(source) });
      } catch (err) {
        const reason = err?.name === "TimeoutError" ? "Zeitüberschreitung" : err?.message || String(err);
        results.set(source.id, { source, articles: [], error: reason });
      } finally {
        onProgress(results.size, sources.length);
        if (results.size >= sources.length - 2) sendPartial();
      }
    }),
  );
  clearTimeout(timer);
  return assemble(sources, results, previous);
}

/** Aus den geladenen Feeds einen Stand bauen. Noch fehlende Quellen gelten als „lädt noch“, nicht als Fehler. */
function assemble(sources, results, previous) {
  const cutoff = Date.now() - CONFIG.hoursBack * 3600_000;
  const stats = [];
  const fresh = [];
  const errors = [];
  for (const source of sources) {
    const r = results.get(source.id);
    if (!r) {
      stats.push({ id: source.id, name: source.name, position: source.position, lean: leanFor(source.position), articles: 0, pending: true });
      continue;
    }
    const recent = r.articles
      .filter((a) => new Date(a.publishedAt).getTime() >= cutoff)
      .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt))
      .slice(0, CONFIG.maxArticlesPerSource);
    fresh.push(...recent);
    stats.push({ id: source.id, name: source.name, position: source.position, lean: leanFor(source.position), articles: recent.length, error: r.error });
    if (r.error) errors.push(`${source.name}: Feed nicht lesbar (${r.error})`);
  }

  // Netzausfall: den letzten Stand behalten statt ihn zu leeren
  const failed = stats.filter((s) => s.error).length;
  if (previous?.topics?.length && (fresh.length === 0 || failed >= Math.ceil(stats.length * 0.75))) {
    return { ...previous, errors: [`Die Quellen sind gerade nicht erreichbar (${failed} von ${stats.length}). Angezeigt wird der letzte Stand.`] };
  }

  const neutral = new Set(sources.filter((s) => s.position >= 45 && s.position <= 55).map((s) => s.id));
  const clusters = clusterArticles(fresh, CONFIG.maxTopics, 3, neutral);
  const byId = new Map(fresh.map((a) => [a.id, a]));

  const topics = [];
  for (const cluster of clusters) {
    const bySource = new Map();
    for (const id of cluster.articleIds) {
      const a = byId.get(id);
      if (!a) continue;
      if (!bySource.has(a.sourceId)) bySource.set(a.sourceId, []);
      bySource.get(a.sourceId).push(a);
    }
    if (bySource.size < 2) continue;
    const perspectives = [];
    for (const [sourceId, list] of bySource) {
      const src = sourceById(sourceId);
      if (!src) continue;
      list.sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));
      perspectives.push({
        sourceId,
        sourceName: src.name,
        position: src.position,
        lean: leanFor(src.position),
        summary: "",
        emphasis: [],
        tone: "",
        articles: list.slice(0, CONFIG.maxArticlesPerSourceInTopic).map((a) => ({ id: a.id, title: a.title, link: a.link, publishedAt: a.publishedAt, teaser: a.description, image: a.image })),
      });
    }
    perspectives.sort((a, b) => a.position - b.position);
    topics.push({ id: hash(cluster.articleIds.slice().sort().join("|")), title: cleanTitle(cluster.title), neutralSummary: "", perspectives });
  }

  return { generatedAt: new Date().toISOString(), mode: "feeds", ai: false, topics, sources: stats, errors };
}
