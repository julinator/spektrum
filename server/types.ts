import type { Lean } from "./sources.ts";

export interface Article {
  id: string;
  sourceId: string;
  title: string;
  link: string;
  description: string;
  text?: string; // extrahierter Volltext (falls abrufbar)
  publishedAt: string; // ISO
}

export interface ArticleRef {
  title: string;
  link: string;
  publishedAt: string;
  teaser: string;
}

export interface Perspective {
  sourceId: string;
  sourceName: string;
  position: number;
  lean: Lean;
  summary: string;
  emphasis: string[];
  tone: string;
  articles: ArticleRef[];
}

export interface Topic {
  id: string;
  title: string;
  neutralSummary: string;
  updatedAt: string;
  articleIds: string[];
  perspectives: Perspective[]; // sortiert von links nach rechts
}

export interface SourceStat {
  id: string;
  name: string;
  position: number;
  lean: Lean;
  articles: number;
  error?: string;
}

export interface Snapshot {
  generatedAt: string | null;
  mode: "claude" | "feeds"; // feeds = Themen heuristisch, Originaltexte statt KI-Zusammenfassung
  ai: boolean; // KI-Zusammenfassungen eingeschaltet
  model?: string;
  topics: Topic[];
  sources: SourceStat[];
  errors: string[];
}
