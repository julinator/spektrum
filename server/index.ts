/**
 * HTTP-Server: liefert die Oberfläche aus und stellt die Themen als JSON bereit.
 *
 *   GET  /              Oberfläche
 *   GET  /api/topics    aktueller Stand (Themen, Quellen, Fehler)
 *   GET  /api/status    Aktualisierungsstatus
 *   POST /api/refresh   Aktualisierung anstoßen
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AI_ENABLED, loadSnapshot, runPipeline } from "./pipeline.ts";
import type { Snapshot } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(here, "..", "public");
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST; // z. B. 127.0.0.1 hinter einem Reverse-Proxy; leer = alle Schnittstellen
const PUBLIC_URL = process.env.PUBLIC_URL; // öffentliche Adresse, falls vorhanden
const MIN_MANUAL_REFRESH_MS = 3 * 60_000; // manuelles Aktualisieren höchstens alle 3 Minuten
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES ?? (AI_ENABLED ? 90 : 30));

/** Adressen, unter denen Handy und andere Geräte die App erreichen. */
function lanUrls(): string[] {
  if (PUBLIC_URL) return [PUBLIC_URL];
  if (HOST === "127.0.0.1" || HOST === "localhost") return [];
  const urls: string[] = [];
  if (process.platform === "darwin") {
    try {
      const name = execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim();
      if (name) urls.push(`http://${name.toLowerCase()}.local:${PORT}`);
    } catch {
      // kein Bonjour-Name verfügbar
    }
  }
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === "IPv4" && !iface.internal) urls.push(`http://${iface.address}:${PORT}`);
    }
  }
  return urls;
}
const LAN_URLS = lanUrls();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

let snapshot: Snapshot = await loadSnapshot();
let refreshing = false;
let lastManualRefresh = 0;
let progress = "";
let lastRefreshError: string | null = null;
let nextRefreshAt: string | null = null;

async function refresh(trigger: string): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  lastRefreshError = null;
  console.log(`[${new Date().toLocaleTimeString("de-DE")}] Aktualisierung gestartet (${trigger})`);
  try {
    snapshot = await runPipeline((msg) => {
      progress = msg;
      console.log(`[${new Date().toLocaleTimeString("de-DE")}] ${msg}`);
    });
  } catch (err) {
    lastRefreshError = err instanceof Error ? err.message : String(err);
    console.error("Aktualisierung fehlgeschlagen:", err);
  } finally {
    refreshing = false;
    progress = "";
    nextRefreshAt = new Date(Date.now() + REFRESH_MINUTES * 60_000).toISOString();
  }
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname === "/api/topics" || url.pathname === "/api/topics.json") return json(res, 200, snapshot);
    if (url.pathname === "/api/status" || url.pathname === "/api/status.json") {
      return json(res, 200, {
        static: false,
        generatedAt: snapshot.generatedAt,
        mode: snapshot.mode,
        ai: AI_ENABLED,
        model: snapshot.model ?? null,
        lanUrls: LAN_URLS,
        topics: snapshot.topics.length,
        refreshing,
        progress,
        lastRefreshError,
        nextRefreshAt,
        refreshMinutes: REFRESH_MINUTES,
      });
    }
    if (url.pathname === "/api/refresh" && req.method === "POST") {
      const age = snapshot.generatedAt ? Date.now() - new Date(snapshot.generatedAt).getTime() : Infinity;
      const tooSoon = Date.now() - lastManualRefresh < MIN_MANUAL_REFRESH_MS || age < MIN_MANUAL_REFRESH_MS;
      if (refreshing || tooSoon) return json(res, 202, { started: false, refreshing, upToDate: !refreshing });
      lastManualRefresh = Date.now();
      void refresh("manuell");
      return json(res, 202, { started: true, refreshing: true });
    }
    if (url.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end("User-agent: *\nDisallow: /\n");
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Methode nicht erlaubt" });

    let filePath = path.normalize(path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname));
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: "Zugriff verweigert" });
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) filePath = path.join(filePath, "index.html");
    } catch {
      return json(res, 404, { error: "Nicht gefunden" });
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    });
    res.end(body);
  } catch (err) {
    console.error(err);
    json(res, 500, { error: "Interner Fehler" });
  }
});

const onListen = () => {
  console.log(`Spektrum läuft auf http://${HOST ?? "localhost"}:${PORT}`);
  for (const u of LAN_URLS) console.log(`  im WLAN erreichbar unter ${u}`);
  console.log(`  KI-Zusammenfassungen: ${AI_ENABLED ? "an" : "aus"}, Aktualisierung alle ${REFRESH_MINUTES} Minuten`);
  const age = snapshot.generatedAt ? Date.now() - new Date(snapshot.generatedAt).getTime() : Infinity;
  if (age > REFRESH_MINUTES * 60_000) {
    void refresh("Start");
  } else {
    nextRefreshAt = new Date(new Date(snapshot.generatedAt!).getTime() + REFRESH_MINUTES * 60_000).toISOString();
    const wait = Math.max(5_000, new Date(nextRefreshAt).getTime() - Date.now());
    setTimeout(() => void refresh("geplant"), wait);
  }
  setInterval(() => void refresh("geplant"), REFRESH_MINUTES * 60_000);
};
if (HOST) server.listen(PORT, HOST, onListen);
else server.listen(PORT, onListen);
