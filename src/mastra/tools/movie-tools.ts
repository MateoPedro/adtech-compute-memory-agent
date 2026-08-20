/**
 * movie-tools.ts - the two tools behind the three-stage movie demo.
 *
 *   search_catalog     - long-term knowledge: hybrid (BM25 + semantic) search
 *                        over movie-catalog via ES|QL FORK → FUSE, with
 *                        optional genre boosting and title exclusions.
 *
 *   get_taste_profile  - episodic memory: a DECAY-weighted taste formula over
 *                        watch-history. Recent, highly-rated watches dominate;
 *                        stale phases fade. Also returns recently watched
 *                        titles so the agent can exclude them.
 *
 * The taste formula (the "ES|QL builds the weighting" idea):
 *   weight = DECAY(watched_at, NOW(), TASTE_DECAY_DAYS in hours) * rating
 *   taste per genre = SUM(weight)
 *
 * TUNING KNOBS:
 *   TASTE_DECAY_DAYS   - 180 recalls "stale you"; 21 catches the recent kick.
 *   FUSION_STRATEGY / FUSION_BM25_WEIGHT - shared with memory-tools.ts.
 */
import { createTool } from "@mastra/core/tools";
import { Client } from "@elastic/elasticsearch";
import { z } from "zod";
import "dotenv/config";

const es = new Client({
  node: process.env.ELASTICSEARCH_URL!,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY! },
});

const CATALOG = "movie-catalog";
const HISTORY = "watch-history";
const TASTE_DECAY_DAYS = Number(process.env.TASTE_DECAY_DAYS ?? 21);
const RECENT_WINDOW_DAYS = Number(process.env.RECENT_WINDOW_DAYS ?? 45);
const FUSION_STRATEGY = (process.env.FUSION_STRATEGY ?? "rrf") as "rrf" | "linear";
const BM25_WEIGHT = Number(process.env.FUSION_BM25_WEIGHT ?? 0.3);

function esqlEscape(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 500);
}

function esqlStringList(items: string[]): string {
  return items.map((s) => `"${esqlEscape(s)}"`).join(", ");
}

function fuseClause(): string {
  if (FUSION_STRATEGY === "linear") {
    return `| FUSE LINEAR WITH { "weights": { "fork1": ${BM25_WEIGHT}, "fork2": ${1 - BM25_WEIGHT} }, "normalizer": "minmax" }`;
  }
  return "| FUSE";
}

function rows(result: { columns: { name: string }[]; values: unknown[][] }) {
  const cols = result.columns.map((c) => c.name);
  return result.values.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

// ---------------------------------------------------------------------------
// search_catalog - Stage 1: long-term knowledge (hybrid RAG over the catalog)
// ---------------------------------------------------------------------------
export const searchCatalog = createTool({
  id: "search_catalog",
  description:
    "Search the available movie catalog with hybrid (keyword + semantic) search. " +
    "Use for any recommendation - only movies in the catalog can be recommended. " +
    "Optionally boost preferred genres and exclude already-watched titles.",
  inputSchema: z.object({
    query: z.string().describe("What the user is in the mood for, e.g. 'tense sci-fi that makes you think'"),
    boostGenres: z.array(z.string()).default([]).describe("Genres to boost, e.g. from the taste profile"),
    excludeTitles: z.array(z.string()).default([]).describe("Titles to exclude, e.g. recently watched"),
    limit: z.number().min(1).max(15).default(6),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        title: z.string(),
        year: z.number(),
        genre: z.string(),
        director: z.string(),
        description: z.string(),
        score: z.number(),
      })
    ),
  }),
  execute: async (input) => {
    const q = esqlEscape(input.query);
    const exclude =
      input.excludeTitles.length > 0
        ? `| WHERE NOT title IN (${esqlStringList(input.excludeTitles)})`
        : "";
    const boost =
      input.boostGenres.length > 0
        ? `| EVAL final_score = _score * CASE(genre IN (${esqlStringList(input.boostGenres)}), 1.5, 1.0)`
        : `| EVAL final_score = _score`;

    const query = `
FROM ${CATALOG} METADATA _id, _score, _index
| FORK (
    WHERE title:"${q}" OR description:"${q}" OR genre:"${q}" OR actors:"${q}" OR director:"${q}"
    | SORT _score DESC | LIMIT 50
) (
    WHERE description_semantic:"${q}"
    | SORT _score DESC | LIMIT 50
)
${fuseClause()}
${exclude}
${boost}
| SORT final_score DESC | LIMIT ${input.limit}
| KEEP title, year, genre, director, description, final_score
`.trim();

    const result = await es.esql.query({ query, format: "json" });
    const results = rows(result as any).map((r: any) => ({
      title: String(r.title),
      year: Number(r.year),
      genre: String(r.genre),
      director: String(r.director),
      description: String(r.description),
      score: Number(r.final_score),
    }));
    return { results };
  },
});

// ---------------------------------------------------------------------------
// get_taste_profile - Stage 2: episodic memory (decay-weighted taste formula)
// ---------------------------------------------------------------------------
export const getTasteProfile = createTool({
  id: "get_taste_profile",
  description:
    "Get the user's current taste profile from their watch history: genres ranked by a " +
    "recency-decayed, rating-weighted score, plus recently watched titles that should be " +
    "EXCLUDED from recommendations. Call this BEFORE searching the catalog when personalizing.",
  inputSchema: z.object({
    user: z.string().default("demo"),
  }),
  outputSchema: z.object({
    decayWindowDays: z.number(),
    tasteByGenre: z.array(z.object({ genre: z.string(), score: z.number() })),
    recentlyWatched: z.array(z.object({ title: z.string(), watched_at: z.string() })),
  }),
  execute: async (input) => {
    const user = esqlEscape(input.user);

    // The formula: recent + loved dominates; old phases fade with DECAY.
    const tasteQuery = `
FROM ${HISTORY}
| WHERE user == "${user}"
| EVAL w = DECAY(watched_at, NOW(), ${TASTE_DECAY_DAYS * 24} hours) * rating
| STATS taste = SUM(w) BY genre
| SORT taste DESC
| LIMIT 10
`.trim();
    // Fallback if DECAY errors on your deployment:
    // | EVAL w = rating / (1 + DATE_DIFF("day", watched_at, NOW()) / ${TASTE_DECAY_DAYS}.0)

    const recentQuery = `
FROM ${HISTORY}
| WHERE user == "${user}" AND watched_at > NOW() - ${RECENT_WINDOW_DAYS} days
| SORT watched_at DESC
| KEEP title, watched_at
| LIMIT 25
`.trim();

    const [tasteResult, recentResult] = await Promise.all([
      es.esql.query({ query: tasteQuery, format: "json" }),
      es.esql.query({ query: recentQuery, format: "json" }),
    ]);

    const tasteByGenre = rows(tasteResult as any).map((r: any) => ({
      genre: String(r.genre),
      score: Math.round(Number(r.taste) * 100) / 100,
    }));
    const recentlyWatched = rows(recentResult as any).map((r: any) => ({
      title: String(r.title),
      watched_at: String(r.watched_at),
    }));

    return { decayWindowDays: TASTE_DECAY_DAYS, tasteByGenre, recentlyWatched };
  },
});
