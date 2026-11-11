/**
 * Feeds über den eigenen Vermittler (/feed/<id>) laden und in Artikel umwandeln.
 * Läuft im Browser: XML wird mit dem eingebauten DOMParser gelesen.
 */

/** Kurzer, stabiler Hash (cyrb53) für Artikel-IDs. */
export function hash(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

const parser = new DOMParser();

function stripHtml(text) {
  if (!text) return "";
  if (!/[<&]/.test(text)) return text.replace(/\s+/g, " ").trim();
  const doc = parser.parseFromString(text, "text/html");
  doc.querySelectorAll("script, style").forEach((n) => n.remove());
  return (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Text in der richtigen Zeichenkodierung lesen (manche Feeds sind nicht UTF-8). */
function decode(buffer, contentType) {
  let charset = /charset=([^;]+)/i.exec(contentType ?? "")?.[1]?.trim();
  if (!charset) {
    const head = new TextDecoder("utf-8").decode(buffer.slice(0, 300));
    charset = /encoding=["']([^"']+)["']/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function child(el, ...names) {
  for (const name of names) {
    for (const c of el.children) if (c.localName === name) return c;
  }
  return null;
}

function linkOf(item, atom) {
  if (atom) {
    const links = [...item.children].filter((c) => c.localName === "link");
    const alt = links.find((l) => !l.getAttribute("rel") || l.getAttribute("rel") === "alternate") ?? links[0];
    return alt?.getAttribute("href")?.trim() ?? "";
  }
  return (child(item, "link")?.textContent ?? child(item, "guid")?.textContent ?? "").trim();
}

export function parseFeed(xml, source) {
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Feed nicht lesbar");
  let items = [...doc.getElementsByTagNameNS("*", "item")];
  const atom = items.length === 0;
  if (atom) items = [...doc.getElementsByTagNameNS("*", "entry")];
  const seen = new Set();
  const articles = [];
  for (const item of items.slice(0, source.maxItems ?? 50)) {
    const link = linkOf(item, atom);
    const title = stripHtml(child(item, "title")?.textContent);
    if (!link || !title) continue;
    const id = hash(link);
    if (seen.has(id)) continue;
    seen.add(id);
    const rawDesc = child(item, "description", "summary", "encoded", "content")?.textContent ?? "";
    const dateText = child(item, "pubDate", "date", "published", "updated")?.textContent;
    const date = dateText ? new Date(dateText.trim()) : new Date();
    articles.push({
      id,
      sourceId: source.id,
      title,
      link,
      description: stripHtml(rawDesc).slice(0, 600),
      publishedAt: (isNaN(date.getTime()) ? new Date() : date).toISOString(),
    });
  }
  return articles;
}

export async function fetchFeed(source) {
  const res = await fetch(`feed/${source.id}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = decode(await res.arrayBuffer(), res.headers.get("content-type"));
  return parseFeed(xml, source);
}
