/**
 * Claude-Anbindung: Artikel zu Themen bündeln und je Quelle die Berichterstattung
 * zusammenfassen. Strukturierte Ausgaben über Zod-Schemas, Server-seitige
 * Fallbacks sind aktiviert.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { LEAN_LABEL, leanFor, sourceById } from "./sources.ts";
import type { Article } from "./types.ts";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const BETAS = ["server-side-fallback-2026-07-01"];

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
  return client;
}

export function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export class ClaudeUnavailable extends Error {}

const ClusterSchema = z.object({
  topics: z.array(
    z.object({
      title: z.string().describe("Kurzer, neutraler Titel des Themas auf Deutsch, höchstens 70 Zeichen"),
      article_ids: z.array(z.string()).describe("IDs der Artikel, die über dieses konkrete Ereignis berichten"),
    }),
  ),
});

const SummarySchema = z.object({
  title: z.string().describe("Neutraler Titel des Themas auf Deutsch, höchstens 70 Zeichen"),
  neutral_summary: z
    .string()
    .describe("2 bis 3 Sätze: Was ist passiert? Nur Fakten, die quellenübergreifend übereinstimmen."),
  perspectives: z.array(
    z.object({
      source_id: z.string().describe("ID der Quelle, exakt wie angegeben"),
      summary: z
        .string()
        .describe("60 bis 120 Wörter: Wie berichtet diese Quelle? Welche Fakten, Akteure, Zitate und Deutungen stehen im Vordergrund? Absätze mit Leerzeile trennen."),
      emphasis: z.array(z.string()).describe("2 bis 4 Stichpunkte, je höchstens 12 Wörter: Was diese Quelle betont oder auslässt"),
      tone: z.string().describe("Tonalität in 2 bis 5 Wörtern, z. B. 'nüchtern, einordnend' oder 'alarmiert, regierungskritisch'"),
    }),
  ),
});

const CLUSTER_SYSTEM = `Du bist Nachrichtenredakteur bei einem Medienvergleichsdienst. Du bekommst eine Liste aktueller Artikel verschiedener deutschsprachiger Medien und bündelst sie zu Themen.

Regeln:
- Ein Thema ist ein konkretes Ereignis oder eine konkrete Debatte (z. B. "Bundestag beschließt Rentenpaket"), kein Oberbegriff wie "Wirtschaft".
- Jedes Thema braucht Artikel aus mindestens 3 verschiedenen Quellen. Bevorzuge Themen, die quer durch das politische Spektrum aufgegriffen werden.
- Ordne jeden Artikel höchstens einem Thema zu und nur, wenn er eindeutig dazugehört. Artikel ohne passendes Thema lässt du weg.
- Sortiere die Themen nach Relevanz: Breite der Berichterstattung zuerst, dann Aktualität.
- Titel: Deutsch, neutral, sachlich, ohne Wertung, höchstens 70 Zeichen.`;

const SUMMARY_SYSTEM = `Du bist ein neutraler Medienbeobachter. Zu einem Nachrichtenthema bekommst du die Berichterstattung mehrerer deutschsprachiger Medien, die unterschiedlich politisch verortet sind. Deine Aufgabe ist es, fair und präzise zu beschreiben, WIE jede Quelle berichtet, damit Leserinnen und Leser die Unterschiede der Berichterstattung erkennen.

Regeln:
- Stütze dich ausschließlich auf die mitgelieferten Texte. Erfinde keine Fakten, Zitate oder Positionen. Wenn eine Quelle ein Thema nur am Rande streift, sag das.
- Beschreibe pro Quelle: welche Fakten und Akteure im Vordergrund stehen, wer zu Wort kommt, welche Deutung oder Wertung mitschwingt, was im Vergleich zu den anderen Quellen fehlt oder besonders betont wird.
- Gib keine eigene politische Wertung ab und bewerte keine Quelle als besser oder schlechter.
- Deutsch, Präsens, kurze Sätze, sachlich. Keine Floskeln wie "In diesem Artikel".
- Die neutrale Zusammenfassung enthält nur, was quellenübergreifend übereinstimmt.
- Nimm nur Quellen auf, die in der Eingabe vorkommen, mit exakt der angegebenen source_id.`;

export interface ClusterResult {
  title: string;
  articleIds: string[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}. ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function translateError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) {
    throw new ClaudeUnavailable("Der Anthropic API-Key wurde abgelehnt (401). Prüfe ANTHROPIC_API_KEY in der .env-Datei.");
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    throw new ClaudeUnavailable("Der API-Key hat keine Berechtigung für dieses Modell (403).");
  }
  if (err instanceof Anthropic.NotFoundError) {
    throw new ClaudeUnavailable(`Modell "${MODEL}" nicht gefunden (404). CLAUDE_MODEL in der .env-Datei prüfen.`);
  }
  if (err instanceof Anthropic.RateLimitError) {
    throw new ClaudeUnavailable("Anthropic-Ratenlimit erreicht (429). Nächster Versuch beim nächsten Aktualisieren.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) {
      throw new ClaudeUnavailable("Kein Guthaben auf dem Anthropic-Konto. Unter console.anthropic.com → Plans & Billing Guthaben aufladen, dann „Aktualisieren“ drücken.");
    }
    throw new ClaudeUnavailable(`Anthropic hat die Anfrage abgelehnt (400): ${err.message}`);
  }
  if (err instanceof Anthropic.APIError) {
    throw new ClaudeUnavailable(`Anthropic-Fehler ${err.status ?? "?"}: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    throw new ClaudeUnavailable("Keine Verbindung zur Anthropic-API. Internetverbindung prüfen.");
  }
  throw err;
}

export async function clusterWithClaude(articles: Article[], maxTopics: number): Promise<ClusterResult[]> {
  const lines = articles.map((a) => {
    const src = sourceById(a.sourceId);
    const desc = a.description ? ` — ${a.description.slice(0, 220)}` : "";
    return `[${a.id}] ${src?.name ?? a.sourceId} · ${formatDate(a.publishedAt)} · ${a.title}${desc}`;
  });
  const prompt = `Hier sind ${articles.length} aktuelle Artikel. Bilde daraus höchstens ${maxTopics} Themen nach den Regeln.\n\n${lines.join("\n")}`;

  try {
    const res = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 12000,
      betas: BETAS,
      fallbacks: "default",
      system: [{ type: "text", text: CLUSTER_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: EFFORT, format: betaZodOutputFormat(ClusterSchema) },
    });
    if (res.stop_reason === "refusal") throw new ClaudeUnavailable("Claude hat die Themenbündelung abgelehnt.");
    if (res.stop_reason === "max_tokens") throw new ClaudeUnavailable("Themenbündelung wurde abgeschnitten (max_tokens).");
    const parsed = res.parsed_output;
    if (!parsed) throw new ClaudeUnavailable("Themenbündelung lieferte keine gültige Struktur.");
    const known = new Set(articles.map((a) => a.id));
    const used = new Set<string>();
    const out: ClusterResult[] = [];
    for (const t of parsed.topics) {
      const ids = t.article_ids.filter((id) => known.has(id) && !used.has(id));
      ids.forEach((id) => used.add(id));
      if (ids.length) out.push({ title: t.title.trim(), articleIds: ids });
    }
    return out.slice(0, maxTopics);
  } catch (err) {
    if (err instanceof ClaudeUnavailable) throw err;
    translateError(err);
  }
}

export interface SummaryResult {
  title: string;
  neutralSummary: string;
  perspectives: { sourceId: string; summary: string; emphasis: string[]; tone: string }[];
}

export async function summarizeTopic(title: string, articlesBySource: Map<string, Article[]>): Promise<SummaryResult> {
  const sections: string[] = [];
  const order = [...articlesBySource.keys()].sort((a, b) => (sourceById(a)?.position ?? 50) - (sourceById(b)?.position ?? 50));
  for (const sourceId of order) {
    const src = sourceById(sourceId);
    const label = src ? `${src.name} (Verortung: ${LEAN_LABEL[leanFor(src.position)]})` : sourceId;
    const parts = articlesBySource.get(sourceId)!.map((a) => {
      const body = a.text && a.text.length > 0 ? a.text : a.description || "(kein Text verfügbar)";
      return `Artikel: ${a.title}\nVeröffentlicht: ${formatDate(a.publishedAt)}\n${body}`;
    });
    sections.push(`### source_id: ${sourceId} — ${label}\n\n${parts.join("\n\n---\n\n")}`);
  }
  const prompt = `Thema: ${title}\n\nBerichterstattung der Quellen:\n\n${sections.join("\n\n\n")}`;

  try {
    const res = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: "default",
      system: [{ type: "text", text: SUMMARY_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: EFFORT, format: betaZodOutputFormat(SummarySchema) },
    });
    if (res.stop_reason === "refusal") throw new ClaudeUnavailable(`Claude hat die Zusammenfassung zu "${title}" abgelehnt.`);
    if (res.stop_reason === "max_tokens") throw new ClaudeUnavailable(`Zusammenfassung zu "${title}" wurde abgeschnitten.`);
    const parsed = res.parsed_output;
    if (!parsed) throw new ClaudeUnavailable(`Zusammenfassung zu "${title}" lieferte keine gültige Struktur.`);
    return {
      title: parsed.title.trim() || title,
      neutralSummary: parsed.neutral_summary.trim(),
      perspectives: parsed.perspectives
        .filter((p) => articlesBySource.has(p.source_id))
        .map((p) => ({ sourceId: p.source_id, summary: p.summary.trim(), emphasis: p.emphasis.map((e) => e.trim()).filter(Boolean), tone: p.tone.trim() })),
    };
  } catch (err) {
    if (err instanceof ClaudeUnavailable) throw err;
    translateError(err);
  }
}
