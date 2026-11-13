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

const MRSS = "http://search.yahoo.com/mrss/";

/** Erstes Kind-Element mit einem der Namen (ohne Media-RSS-Elemente). */
function child(el, ...names) {
  for (const name of names) {
    for (const c of el.children) if (c.localName === name && c.namespaceURI !== MRSS) return c;
  }
  return null;
}

function cleanImageUrl(url) {
  if (!url) return "";
  const u = url.trim().replace(/^http:\/\//, "https://");
  if (!/^https:\/\//.test(u)) return "";
  if (/(\b|_)(1x1|pixel|spacer|tracking)(\b|_)/i.test(u)) return "";
  return u;
}

/** Vorschaubild aus Anhang, Media-RSS oder dem ersten <img> im Anrisstext. */
function imageOf(item, rawDescription) {
  for (const c of item.children) {
    if (c.localName === "enclosure") {
      const type = c.getAttribute("type") ?? "";
      const url = c.getAttribute("url") ?? "";
      if (type.startsWith("image") || (!type && /\.(jpe?g|png|webp)(\?|$)/i.test(url))) return cleanImageUrl(url);
    }
  }
  const media = [...item.getElementsByTagNameNS(MRSS, "*")].filter((m) => (m.localName === "content" || m.localName === "thumbnail") && m.getAttribute("url"));
  if (media.length) {
    const images = media.filter((m) => !m.getAttribute("medium") || m.getAttribute("medium") === "image");
    const pool = images.length ? images : media;
    // eine mittlere Größe bevorzugen (schont das Datenvolumen)
    const sized = pool.map((m) => ({ m, w: Number(m.getAttribute("width")) || 0 }));
    const good = sized.filter((x) => x.w >= 400 && x.w <= 1200).sort((a, b) => a.w - b.w)[0] ?? sized.sort((a, b) => b.w - a.w)[0];
    const url = cleanImageUrl(good?.m.getAttribute("url"));
    if (url) return url;
  }
  const img = /<img[^>]+src=["']([^"']+)["']/i.exec(rawDescription ?? "");
  return cleanImageUrl(img?.[1]?.replace(/&amp;/g, "&"));
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
    const rawContent = child(item, "encoded", "content")?.textContent ?? "";
    const dateText = child(item, "pubDate", "date", "published", "updated")?.textContent;
    const date = dateText ? new Date(dateText.trim()) : new Date();
    articles.push({
      id,
      sourceId: source.id,
      title,
      link,
      description: stripHtml(rawDesc).slice(0, 600),
      image: imageOf(item, rawDesc + rawContent),
      publishedAt: (isNaN(date.getTime()) ? new Date() : date).toISOString(),
    });
  }
  return articles;
}

async function fetchOne(source, index) {
  const res = await fetch(`feed/${source.id}/${index}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = decode(await res.arrayBuffer(), res.headers.get("content-type"));
  return parseFeed(xml, source);
}

/** Alle Feeds einer Quelle laden und zusammenführen. Fehler nur, wenn alle scheitern. */
export async function fetchFeed(source) {
  const results = await Promise.allSettled(source.feeds.map((_, i) => fetchOne(source, i)));
  const ok = results.filter((r) => r.status === "fulfilled");
  if (!ok.length) throw results[0].reason;
  const seen = new Set();
  const merged = [];
  for (const r of ok) {
    for (const a of r.value) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      merged.push(a);
    }
  }
  return merged;
}
