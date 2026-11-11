/**
 * Statische Seite bauen: Feeds lesen, Themen bilden und alles nach site/ schreiben.
 * GitHub Actions führt das alle 30 Minuten aus und veröffentlicht site/ auf GitHub Pages.
 *
 *   node server/build.ts
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AI_ENABLED, runPipeline } from "./pipeline.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const SITE = path.join(ROOT, "site");
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES ?? 30);

const snapshot = await runPipeline();

await rm(SITE, { recursive: true, force: true });
await cp(path.join(ROOT, "public"), SITE, { recursive: true });
await mkdir(path.join(SITE, "api"), { recursive: true });
await writeFile(path.join(SITE, "api", "topics.json"), JSON.stringify(snapshot));
await writeFile(
  path.join(SITE, "api", "status.json"),
  JSON.stringify({
    static: true,
    generatedAt: snapshot.generatedAt,
    mode: snapshot.mode,
    ai: AI_ENABLED,
    model: snapshot.model ?? null,
    topics: snapshot.topics.length,
    refreshing: false,
    progress: "",
    lastRefreshError: null,
    refreshMinutes: REFRESH_MINUTES,
    lanUrls: [],
  }),
);
await writeFile(path.join(SITE, ".nojekyll"), "");
await writeFile(path.join(SITE, "robots.txt"), "User-agent: *\nDisallow: /\n");

console.log(`\nStatische Seite in site/ gebaut: ${snapshot.topics.length} Themen, ${snapshot.errors.length} Hinweise.`);
