/**
 * Cloudflare-Worker für Spektrum.
 *
 * - Liefert die App aus (statische Dateien aus public/, das übernimmt Cloudflare).
 * - /feed/<id> holt den RSS-Feed einer Quelle aus der festen Liste ab. Der Browser
 *   darf fremde Feeds nicht direkt lesen; dieser Vermittler löst das. Andere
 *   Adressen ruft er nie ab, er ist also kein offener Proxy.
 */
import { SOURCES } from "../public/js/sources.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BY_ID = new Map(SOURCES.filter((s) => s.enabled).map((s) => [s.id, s]));

function text(body, status) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

async function proxyFeed(id) {
  const source = BY_ID.get(id);
  if (!source) return text("Unbekannte Quelle", 404);
  try {
    const upstream = await fetch(source.feed, {
      headers: {
        "user-agent": UA,
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "accept-language": "de-DE,de;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!upstream.ok) return text(`Quelle antwortet mit ${upstream.status}`, 502);
    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/xml",
        "cache-control": "public, max-age=300",
        "x-robots-tag": "noindex, nofollow",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return text("Quelle nicht erreichbar", 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/feed\/([a-z0-9-]+)$/);
    if (match) {
      if (request.method !== "GET" && request.method !== "HEAD") return text("Methode nicht erlaubt", 405);
      return proxyFeed(match[1]);
    }
    return env.ASSETS.fetch(request);
  },
};
