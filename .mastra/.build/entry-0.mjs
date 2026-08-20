import { Mastra } from '@mastra/core';
import { Observability, MastraStorageExporter } from '@mastra/observability';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { Client } from '@elastic/elasticsearch';
import { z } from 'zod';
import 'dotenv/config';

"use strict";
const es$1 = new Client({
  node: process.env.ELASTICSEARCH_URL,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY }
});
const AGENT_ID = process.env.AGENT_ID ?? "mastra-agent";
const MEMORY_INDEX = "agent-memory";
const DECAY_WINDOW_DAYS = Number(process.env.BRIDGE_MEMORY_DECAY_WINDOW ?? 45);
const FUSION_STRATEGY$1 = process.env.FUSION_STRATEGY ?? "rrf";
const BM25_WEIGHT$1 = Number(process.env.FUSION_BM25_WEIGHT ?? 0.3);
const SEMANTIC_WEIGHT = 1 - BM25_WEIGHT$1;
function fuseClause$1() {
  if (FUSION_STRATEGY$1 === "linear") {
    return `| FUSE LINEAR WITH { "weights": { "fork1": ${BM25_WEIGHT$1}, "fork2": ${SEMANTIC_WEIGHT} }, "normalizer": "minmax" }`;
  }
  return "| FUSE";
}
function esqlEscape$1(input) {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 500);
}
const remember = createTool({
  id: "remember",
  description: "Store a decision, pattern, piece of context, or feedback so it can be recalled in future sessions. Use whenever the user makes a decision, states a durable preference, or flags a blocker worth remembering.",
  inputSchema: z.object({
    type: z.enum(["decision", "pattern", "context", "feedback"]),
    title: z.string().describe("Short human-readable title"),
    content: z.string().describe("The full memory content, including rationale"),
    tags: z.array(z.string()).default([]),
    scope: z.enum(["shared", "private"]).default("shared")
  }),
  outputSchema: z.object({ memoryId: z.string() }),
  execute: async (input) => {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const memoryId = `${AGENT_ID}-${input.type}-${Date.now()}`;
    await es$1.index({
      index: MEMORY_INDEX,
      id: memoryId,
      document: {
        memory_id: memoryId,
        agent: AGENT_ID,
        type: input.type,
        title: input.title,
        title_semantic: input.title,
        // embedded server-side
        content: input.content,
        content_semantic: input.content,
        // embedded server-side
        tags: input.tags,
        source: "mastra",
        created_at: now,
        updated_at: now,
        access_scope: input.scope === "shared" ? "shared" : `${AGENT_ID}-only`
      },
      refresh: "wait_for"
      // hacknight-friendly: recallable immediately
    });
    return { memoryId };
  }
});
const recall = createTool({
  id: "recall",
  description: "Recall memories from previous sessions using hybrid search (exact keyword + semantic similarity, recency-weighted). Use at the start of a task to check for prior decisions, patterns, or blockers.",
  inputSchema: z.object({
    query: z.string().describe("What to recall, e.g. 'embedding model decisions'"),
    limit: z.number().min(1).max(20).default(5)
  }),
  outputSchema: z.object({
    memories: z.array(
      z.object({
        memory_id: z.string(),
        type: z.string(),
        display: z.string(),
        agent: z.string(),
        created_at: z.string(),
        score: z.number()
      })
    )
  }),
  execute: async (input) => {
    const q = esqlEscape$1(input.query);
    const scopeFilter = `(access_scope == "shared" OR access_scope == "${AGENT_ID}-only" OR agent == "${AGENT_ID}")`;
    const query = `
FROM ${MEMORY_INDEX} METADATA _id, _score, _index
| FORK (
    WHERE ${scopeFilter}
      AND (content:"${q}" OR title:"${q}" OR tags:"${q}")
    | SORT _score DESC | LIMIT 50
) (
    WHERE ${scopeFilter}
      AND content_semantic:"${q}"
    | SORT _score DESC | LIMIT 50
)
${fuseClause$1()}
| EVAL final_score = _score * DECAY(created_at, NOW(), ${DECAY_WINDOW_DAYS * 24} hours)
| EVAL display = COALESCE(title, SUBSTRING(content, 1, 80))
| SORT final_score DESC | LIMIT ${input.limit}
| KEEP memory_id, type, display, agent, created_at, final_score
`.trim();
    const result = await es$1.esql.query({ query, format: "json" });
    const cols = result.columns.map((c) => c.name);
    const idx = (name) => cols.indexOf(name);
    const memories = result.values.map((row) => ({
      memory_id: String(row[idx("memory_id")]),
      type: String(row[idx("type")]),
      display: String(row[idx("display")]),
      agent: String(row[idx("agent")]),
      created_at: String(row[idx("created_at")]),
      score: Number(row[idx("final_score")])
    }));
    return { memories };
  }
});

"use strict";
const advancedMemoryAgent = new Agent({
  id: "advanced-memory-agent",
  name: "advanced-memory-agent",
  instructions: `You are an assistant with persistent, time-aware memory backed by Elasticsearch.

Memory discipline:
- At the START of a task, call recall to check for prior decisions, patterns, or blockers. Recall is recency-weighted: newer memories outrank stale ones.
- If recalled memories CONFLICT, prefer the most recent and say why ("the earlier decision was superseded").
- When the user makes a decision, states a durable preference, or flags a blocker, call remember with a fitting type (decision, pattern, context, feedback) and useful tags.
- Cite recalled memories naturally ("Three weeks ago you decided...") rather than dumping raw results.
- Do not store trivia; store what a future session would need.`,
  // maxOutputTokens capped so OpenRouter's credit pre-authorization doesn't
  // reject requests on small provisioned keys.
  model: [
    {
      model: "openrouter/anthropic/claude-sonnet-4.6",
      modelSettings: { maxOutputTokens: 4096 }
    }
  ],
  tools: { remember, recall }
});

"use strict";
const es = new Client({
  node: process.env.ELASTICSEARCH_URL,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY }
});
const CATALOG = "movie-catalog";
const HISTORY = "watch-history";
const TASTE_DECAY_DAYS = Number(process.env.TASTE_DECAY_DAYS ?? 21);
const RECENT_WINDOW_DAYS = Number(process.env.RECENT_WINDOW_DAYS ?? 45);
const FUSION_STRATEGY = process.env.FUSION_STRATEGY ?? "rrf";
const BM25_WEIGHT = Number(process.env.FUSION_BM25_WEIGHT ?? 0.3);
function esqlEscape(input) {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 500);
}
function esqlStringList(items) {
  return items.map((s) => `"${esqlEscape(s)}"`).join(", ");
}
function fuseClause() {
  if (FUSION_STRATEGY === "linear") {
    return `| FUSE LINEAR WITH { "weights": { "fork1": ${BM25_WEIGHT}, "fork2": ${1 - BM25_WEIGHT} }, "normalizer": "minmax" }`;
  }
  return "| FUSE";
}
function rows(result) {
  const cols = result.columns.map((c) => c.name);
  return result.values.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}
const searchCatalog = createTool({
  id: "search_catalog",
  description: "Search the available movie catalog with hybrid (keyword + semantic) search. Use for any recommendation - only movies in the catalog can be recommended. Optionally boost preferred genres and exclude already-watched titles.",
  inputSchema: z.object({
    query: z.string().describe("What the user is in the mood for, e.g. 'tense sci-fi that makes you think'"),
    boostGenres: z.array(z.string()).default([]).describe("Genres to boost, e.g. from the taste profile"),
    excludeTitles: z.array(z.string()).default([]).describe("Titles to exclude, e.g. recently watched"),
    limit: z.number().min(1).max(15).default(6)
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        title: z.string(),
        year: z.number(),
        genre: z.string(),
        director: z.string(),
        description: z.string(),
        score: z.number()
      })
    )
  }),
  execute: async (input) => {
    const q = esqlEscape(input.query);
    const exclude = input.excludeTitles.length > 0 ? `| WHERE NOT title IN (${esqlStringList(input.excludeTitles)})` : "";
    const boost = input.boostGenres.length > 0 ? `| EVAL final_score = _score * CASE(genre IN (${esqlStringList(input.boostGenres)}), 1.5, 1.0)` : `| EVAL final_score = _score`;
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
    const results = rows(result).map((r) => ({
      title: String(r.title),
      year: Number(r.year),
      genre: String(r.genre),
      director: String(r.director),
      description: String(r.description),
      score: Number(r.final_score)
    }));
    return { results };
  }
});
const getTasteProfile = createTool({
  id: "get_taste_profile",
  description: "Get the user's current taste profile from their watch history: genres ranked by a recency-decayed, rating-weighted score, plus recently watched titles that should be EXCLUDED from recommendations. Call this BEFORE searching the catalog when personalizing.",
  inputSchema: z.object({
    user: z.string().default("demo")
  }),
  outputSchema: z.object({
    decayWindowDays: z.number(),
    tasteByGenre: z.array(z.object({ genre: z.string(), score: z.number() })),
    recentlyWatched: z.array(z.object({ title: z.string(), watched_at: z.string() }))
  }),
  execute: async (input) => {
    const user = esqlEscape(input.user);
    const tasteQuery = `
FROM ${HISTORY}
| WHERE user == "${user}"
| EVAL w = DECAY(watched_at, NOW(), ${TASTE_DECAY_DAYS * 24} hours) * rating
| STATS taste = SUM(w) BY genre
| SORT taste DESC
| LIMIT 10
`.trim();
    const recentQuery = `
FROM ${HISTORY}
| WHERE user == "${user}" AND watched_at > NOW() - ${RECENT_WINDOW_DAYS} days
| SORT watched_at DESC
| KEEP title, watched_at
| LIMIT 25
`.trim();
    const [tasteResult, recentResult] = await Promise.all([
      es.esql.query({ query: tasteQuery, format: "json" }),
      es.esql.query({ query: recentQuery, format: "json" })
    ]);
    const tasteByGenre = rows(tasteResult).map((r) => ({
      genre: String(r.genre),
      score: Math.round(Number(r.taste) * 100) / 100
    }));
    const recentlyWatched = rows(recentResult).map((r) => ({
      title: String(r.title),
      watched_at: String(r.watched_at)
    }));
    return { decayWindowDays: TASTE_DECAY_DAYS, tasteByGenre, recentlyWatched };
  }
});

"use strict";
const model = [
  {
    model: "openrouter/anthropic/claude-sonnet-4.6",
    modelSettings: { maxOutputTokens: 4096 }
  }
];
const movieRecBare = new Agent({
  id: "movie-rec-bare",
  name: "movie-rec-bare",
  instructions: "You are a movie recommendation assistant. Recommend 2-3 movies with one line on why. Be warm and concise.",
  model
});
const movieRecCatalog = new Agent({
  id: "movie-rec-catalog",
  name: "movie-rec-catalog",
  instructions: `You are a movie recommendation assistant for a streaming catalog.

Rules:
- ONLY recommend movies returned by the search_catalog tool - never from general knowledge. If it's not in the catalog, it doesn't exist for you.
- Translate the user's mood into a good search query (themes, tone, genre words).
- Recommend 2-3 titles with one line each on why, citing genre/director/actors from the results.`,
  model,
  tools: { searchCatalog }
});
const movieRecPersonal = new Agent({
  id: "movie-rec-personal",
  name: "movie-rec-personal",
  instructions: `You are a personal movie recommendation assistant for a streaming catalog.

Process - always in this order:
1. Call get_taste_profile FIRST. Read the genre ranking (it is recency-weighted: recent watches count more) and the recently-watched list.
2. Then call search_catalog with: a query matching the user's request and their current taste, boostGenres set to their top 1-2 genres, and excludeTitles set to ALL recently watched titles.
3. Recommend 2-3 titles. Personalize the framing: reference their recent viewing pattern naturally ("you've been on a sci-fi kick lately"), and never recommend something they just watched.

Rules:
- ONLY recommend movies returned by search_catalog.
- If the user's explicit request conflicts with their taste profile, the explicit request wins - taste is a prior, not a cage.`,
  model,
  tools: { searchCatalog, getTasteProfile }
});

"use strict";
const mastra = new Mastra({
  agents: {
    advancedMemoryAgent,
    movieRecBare,
    movieRecCatalog,
    movieRecPersonal
  },
  // Records agent traces (LLM turns, tool calls, ES|QL queries) so they show
  // up in Studio's Traces view - the demo and the judging rubric both use it.
  observability: new Observability({
    configs: {
      default: {
        serviceName: "hacknight-advanced",
        exporters: [new MastraStorageExporter()]
      }
    }
  })
});

export { mastra };
