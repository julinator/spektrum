/**
 * Die Pipeline: Feeds lesen → Themen bilden → je Quelle zusammenfassen → speichern.
 * Unveränderte Themen werden aus dem letzten Lauf übernommen, um API-Kosten zu sparen.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeUnavailable, MODEL, clusterWithClaude, hasCredentials, summarizeTopic } from "./claude.ts";
import { fetchAllFeeds, fillArticleTexts } from "./feeds.ts";
import { clusterHeuristically, type Cluster } from "./heuristic.ts";
import { activeSources, leanFor, sourceById } from "./sources.ts";
import type { Article, Perspective, Snapshot, SourceStat, Topic } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(here, "..", "data");
const SNAPSHOT_FILE = path.join(DATA_DIR, "topics.json");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");

/** KI-Zusammenfassungen: nur mit Key und wenn KI nicht ausdrücklich ausgeschaltet ist (KI=aus). */
export const AI_ENABLED = hasCredentials() && !/^(aus|off|0|false|nein|no)$/i.test((process.env.KI ?? "").trim());

export const CONFIG = {
  hoursBack: Number(process.env.HOURS_BACK ?? 36),
  maxTopics: Number(process.env.MAX_TOPICS ?? 12),
  maxArticlesPerSource: Number(process.env.MAX_ARTICLES_PER_SOURCE ?? 25),
  maxArticlesPerSourceInTopic: AI_ENABLED ? 2 : 3,
  reuseHours: Number(process.env.REUSE_HOURS ?? 6),
  keepArticleDays: 3,
};

function log(msg: string): void {
  console.log(`[${new Date().toLocaleTimeString("de-DE")}] ${msg}`);
}

export function emptySnapshot(): Snapshot {
  return { generatedAt: null, mode: AI_ENABLED ? "claude" : "feeds", ai: AI_ENABLED, model: AI_ENABLED ? MODEL : undefined, topics: [], sources: [], errors: [] };
}

export async function loadSnapshot(): Promise<Snapshot> {
  try {
    return JSON.parse(await readFile(SNAPSHOT_FILE, "utf8")) as Snapshot;
  } catch {
    return emptySnapshot();
  }
}

async function loadArticleStore(): Promise<Map<string, Article>> {
  try {
    const list = JSON.parse(await readFile(ARTICLES_FILE, "utf8")) as Article[];
    return new Map(list.map((a) => [a.id, a]));
  } catch {
    return new Map();
  }
}

async function saveJson(file: string, data: unknown): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, file);
}

function topicHash(ids: string[]): string {
  return createHash("sha1").update([...ids].sort().join("|")).digest("hex").slice(0, 12);
}

function pickTopicArticles(cluster: Cluster, store: Map<string, Article>): Map<string, Article[]> {
  const bySource = new Map<string, Article[]>();
  for (const id of cluster.articleIds) {
    const a = store.get(id);
    if (!a) continue;
    if (!bySource.has(a.sourceId)) bySource.set(a.sourceId, []);
    bySource.get(a.sourceId)!.push(a);
  }
  for (const [k, list] of bySource) {
    list.sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));
    bySource.set(k, list.slice(0, CONFIG.maxArticlesPerSourceInTopic));
  }
  return bySource;
}

function buildPerspectives(
  bySource: Map<string, Article[]>,
  summaries: Map<string, { summary: string; emphasis: string[]; tone: string }> | null,
): Perspective[] {
  const out: Perspective[] = [];
  for (const [sourceId, list] of bySource) {
    const src = sourceById(sourceId);
    if (!src) continue;
    const s = summaries?.get(sourceId);
    out.push({
      sourceId,
      sourceName: src.name,
      position: src.position,
      lean: leanFor(src.position),
      summary: s?.summary ?? "",
      emphasis: s?.emphasis ?? [],
      tone: s?.tone ?? "",
      articles: list.map((a) => ({ title: a.title, link: a.link, publishedAt: a.publishedAt, teaser: a.description })),
    });
  }
  return out.sort((a, b) => a.position - b.position);
}

/** Findet ein Thema aus dem letzten Lauf, das (nahezu) dieselben Artikel enthält. */
function findReusable(cluster: Cluster, previous: Topic[]): Topic | undefined {
  const ids = new Set(cluster.articleIds);
  const cutoff = Date.now() - CONFIG.reuseHours * 3600_000;
  for (const t of previous) {
    if (new Date(t.updatedAt).getTime() < cutoff) continue;
    if (t.id === topicHash(cluster.articleIds)) return t;
    const overlap = t.articleIds.filter((id) => ids.has(id)).length;
    if (overlap >= 3 && overlap / Math.max(ids.size, t.articleIds.length) >= 0.8) return t;
  }
  return undefined;
}

export async function runPipeline(onProgress: (msg: string) => void = log): Promise<Snapshot> {
  const previous = await loadSnapshot();
  const store = await loadArticleStore();
  const errors: string[] = [];
  const sources = activeSources();

  onProgress(`Lese ${sources.length} Feeds …`);
  const results = await fetchAllFeeds(sources);
  const cutoff = Date.now() - CONFIG.hoursBack * 3600_000;
  const sourceStats: SourceStat[] = [];
  const fresh: Article[] = [];
  for (const r of results) {
    const stat: SourceStat = { id: r.source.id, name: r.source.name, position: r.source.position, lean: leanFor(r.source.position), articles: 0 };
    if (r.error) {
      stat.error = r.error;
      errors.push(`${r.source.name}: Feed nicht lesbar (${r.error})`);
    }
    const recent = r.articles
      .filter((a) => new Date(a.publishedAt).getTime() >= cutoff)
      .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt))
      .slice(0, CONFIG.maxArticlesPerSource);
    for (const a of recent) {
      const existing = store.get(a.id);
      if (existing) {
        existing.title = a.title;
        existing.description = a.description || existing.description;
        fresh.push(existing);
      } else {
        store.set(a.id, a);
        fresh.push(a);
      }
    }
    stat.articles = recent.length;
    sourceStats.push(stat);
  }
  onProgress(`${fresh.length} Artikel aus den letzten ${CONFIG.hoursBack} Stunden.`);

  // Netzausfall: Wenn keine Quelle erreichbar war, den letzten Stand behalten statt ihn zu leeren.
  const failed = sourceStats.filter((st) => st.error).length;
  if (previous.topics.length && (fresh.length === 0 || failed >= Math.ceil(sourceStats.length * 0.75))) {
    const note = `Die Quellen sind gerade nicht erreichbar (${failed} von ${sourceStats.length}). Angezeigt wird der letzte Stand.`;
    onProgress(note);
    return { ...previous, errors: [note] };
  }

  // Alte Artikel aus dem Speicher entfernen
  const keepCutoff = Date.now() - CONFIG.keepArticleDays * 86400_000;
  for (const [id, a] of store) if (new Date(a.publishedAt).getTime() < keepCutoff) store.delete(id);

  let mode: Snapshot["mode"] = AI_ENABLED ? "claude" : "feeds";
  let clusters: Cluster[] = [];
  if (fresh.length === 0) {
    errors.push("Keine aktuellen Artikel gefunden.");
  } else if (!AI_ENABLED) {
    if (!hasCredentials() && !process.env.KI) {
      errors.push("KI-Zusammenfassungen sind aus, weil kein ANTHROPIC_API_KEY gesetzt ist.");
    }
  } else {
    try {
      onProgress(`Bündele Themen mit ${MODEL} …`);
      clusters = await clusterWithClaude(fresh, CONFIG.maxTopics);
    } catch (err) {
      mode = "feeds";
      errors.push(err instanceof ClaudeUnavailable ? err.message : `Themenbündelung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (mode === "feeds") {
    const neutral = new Set(sources.filter((s) => s.position >= 45 && s.position <= 55).map((s) => s.id));
    clusters = clusterHeuristically(fresh, CONFIG.maxTopics, 3, neutral);
  }
  onProgress(`${clusters.length} Themen gefunden.`);

  const topics: Topic[] = [];
  for (const [i, cluster] of clusters.entries()) {
    const reusable = mode === "claude" ? findReusable(cluster, previous.topics) : undefined;
    if (reusable) {
      onProgress(`Thema ${i + 1}/${clusters.length} unverändert: ${reusable.title}`);
      topics.push(reusable);
      continue;
    }
    const bySource = pickTopicArticles(cluster, store);
    if (bySource.size < 2) continue;
    const articles = [...bySource.values()].flat();
    let summaries: Map<string, { summary: string; emphasis: string[]; tone: string }> | null = null;
    let title = cluster.title;
    let neutralSummary = "";
    if (mode === "claude") {
      onProgress(`Thema ${i + 1}/${clusters.length}: Artikeltexte laden (${articles.length}) …`);
      await fillArticleTexts(articles);
      onProgress(`Thema ${i + 1}/${clusters.length}: Zusammenfassen „${cluster.title}“ …`);
      try {
        const s = await summarizeTopic(cluster.title, bySource);
        title = s.title;
        neutralSummary = s.neutralSummary;
        summaries = new Map(s.perspectives.map((p) => [p.sourceId, { summary: p.summary, emphasis: p.emphasis, tone: p.tone }]));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        if (err instanceof ClaudeUnavailable && /401|403|404|429|Guthaben/.test(err.message)) {
          // Keine weiteren Versuche: Rest als Rohtext anzeigen
          mode = "feeds";
        }
      }
    }
    topics.push({
      id: topicHash(cluster.articleIds),
      title,
      neutralSummary,
      updatedAt: new Date().toISOString(),
      articleIds: cluster.articleIds,
      perspectives: buildPerspectives(bySource, summaries),
    });
  }

  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    mode,
    ai: AI_ENABLED,
    model: mode === "claude" ? MODEL : undefined,
    topics,
    sources: sourceStats,
    errors,
  };
  await saveJson(ARTICLES_FILE, [...store.values()]);
  await saveJson(SNAPSHOT_FILE, snapshot);
  onProgress(`Fertig: ${topics.length} Themen gespeichert (${mode}).`);
  return snapshot;
}
