/**
 * Feeds abrufen, Artikel normalisieren und (für Themen-Artikel) den Volltext laden.
 */
import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { activeSources, type Source } from "./sources.ts";
import type { Article } from "./types.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const parser = new Parser({
  customFields: { item: ["description", "content:encoded", "dc:date"] },
});

function hashId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", euro: "€",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in ENTITIES ? ENTITIES[name] : m));
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string, timeoutMs: number, accept: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept, "accept-language": "de-DE,de;q=0.9" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

export interface FeedResult {
  source: Source;
  articles: Article[];
  error?: string;
}

export async function fetchFeed(source: Source): Promise<FeedResult> {
  try {
    const xml = await fetchText(source.feed, 20_000, "application/rss+xml, application/atom+xml, application/xml, text/xml, */*");
    const feed = await parser.parseString(xml);
    const items = feed.items.slice(0, source.maxItems ?? 50);
    const articles: Article[] = [];
    for (const item of items) {
      const link = (item.link ?? item.guid ?? "").trim();
      const title = stripHtml(item.title ?? "");
      if (!link || !title) continue;
      const rawDesc = (item as any)["content:encoded"] ?? item.content ?? (item as any).description ?? item.contentSnippet ?? "";
      const description = stripHtml(String(rawDesc)).slice(0, 600);
      const dateStr = item.isoDate ?? item.pubDate ?? (item as any)["dc:date"];
      const date = dateStr ? new Date(dateStr) : new Date();
      articles.push({
        id: hashId(link),
        sourceId: source.id,
        title,
        link,
        description,
        publishedAt: (isNaN(date.getTime()) ? new Date() : date).toISOString(),
      });
    }
    return { source, articles };
  } catch (err) {
    return { source, articles: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchAllFeeds(sources: Source[] = activeSources()): Promise<FeedResult[]> {
  return Promise.all(sources.map((s) => fetchFeed(s)));
}

/** Absätze aus einer Artikelseite ziehen (best effort, ohne DOM-Bibliothek). */
export function extractArticleText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(header|footer|nav|aside|figure|form)[\s\S]*?<\/\1>/gi, " ");
  const articleMatch = cleaned.match(/<article[\s\S]*?<\/article>/i);
  const scope = articleMatch ? articleMatch[0] : cleaned;
  const paragraphs: string[] = [];
  for (const m of scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const p = stripHtml(m[1]);
    if (p.length >= 60 && !/cookie|newsletter|abonn|anmelden|registrieren|datenschutz/i.test(p.slice(0, 80))) {
      paragraphs.push(p);
    }
  }
  return paragraphs.join("\n\n").slice(0, 3500);
}

export async function fetchArticleText(article: Article): Promise<string | undefined> {
  try {
    const html = await fetchText(article.link, 12_000, "text/html,application/xhtml+xml,*/*;q=0.8");
    const text = extractArticleText(html);
    return text.length >= 300 ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Mehrere Artikel parallel mit begrenzter Gleichzeitigkeit laden. */
export async function fillArticleTexts(articles: Article[], concurrency = 6): Promise<void> {
  const queue = articles.filter((a) => a.text === undefined);
  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const a = queue[i++];
      const text = await fetchArticleText(a);
      a.text = text ?? ""; // "" = versucht, nichts Brauchbares gefunden
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}
