/**
 * memory-tools.ts - Mastra port of `bridge remember` / `bridge recall`
 * from Elastic's agent-memory project (github.com/jeffvestal/agent-memory).
 *
 * The Claude Code version wires these through a CLI + hooks. In Mastra,
 * they're just tools: the model decides when to call them.
 *
 * Requirements: Elasticsearch Serverless (or 9.3+) for ES|QL FUSE + DECAY.
 */
import { createTool } from "@mastra/core/tools";
import { Client } from "@elastic/elasticsearch";
import { z } from "zod";
import "dotenv/config";

const es = new Client({
  node: process.env.ELASTICSEARCH_URL!,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY! },
});

const AGENT_ID = process.env.AGENT_ID ?? "mastra-agent";
const MEMORY_INDEX = "agent-memory";

// ---- TUNING KNOBS (the hacknight challenge lives here) --------------------
// Recency half-life in days. Incidents might want 2; architecture decisions 90.
const DECAY_WINDOW_DAYS = Number(process.env.BRIDGE_MEMORY_DECAY_WINDOW ?? 45);
// "rrf" = plain FUSE (Reciprocal Rank Fusion, k=60). "linear" = FUSE LINEAR
// with explicit weights - shift toward BM25 for ID-heavy data, toward
// semantic for prose. (The agent-memory blog uses 0.3/0.7 for graph search.)
const FUSION_STRATEGY = (process.env.FUSION_STRATEGY ?? "rrf") as "rrf" | "linear";
const BM25_WEIGHT = Number(process.env.FUSION_BM25_WEIGHT ?? 0.3);
const SEMANTIC_WEIGHT = 1 - BM25_WEIGHT;
// ---------------------------------------------------------------------------

function fuseClause(): string {
  if (FUSION_STRATEGY === "linear") {
    return `| FUSE LINEAR WITH { "weights": { "fork1": ${BM25_WEIGHT}, "fork2": ${SEMANTIC_WEIGHT} }, "normalizer": "minmax" }`;
  }
  return "| FUSE";
}

/** ES|QL has no parameter binding for field-match strings, so sanitize. */
function esqlEscape(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 500);
}

// ---------------------------------------------------------------------------
// remember - store a typed memory. semantic_text computes embeddings
// server-side at index time, so this is a plain index call.
// ---------------------------------------------------------------------------
export const remember = createTool({
  id: "remember",
  description:
    "Store a decision, pattern, piece of context, or feedback so it can be " +
    "recalled in future sessions. Use whenever the user makes a decision, " +
    "states a durable preference, or flags a blocker worth remembering.",
  inputSchema: z.object({
    type: z.enum(["decision", "pattern", "context", "feedback"]),
    title: z.string().describe("Short human-readable title"),
    content: z.string().describe("The full memory content, including rationale"),
    tags: z.array(z.string()).default([]),
    scope: z.enum(["shared", "private"]).default("shared"),
  }),
  outputSchema: z.object({ memoryId: z.string() }),
  execute: async (input) => {
    const now = new Date().toISOString();
    const memoryId = `${AGENT_ID}-${input.type}-${Date.now()}`;

    await es.index({
      index: MEMORY_INDEX,
      id: memoryId,
      document: {
        memory_id: memoryId,
        agent: AGENT_ID,
        type: input.type,
        title: input.title,
        title_semantic: input.title, // embedded server-side
        content: input.content,
        content_semantic: input.content, // embedded server-side
        tags: input.tags,
        source: "mastra",
        created_at: now,
        updated_at: now,
        access_scope: input.scope === "shared" ? "shared" : `${AGENT_ID}-only`,
      },
      refresh: "wait_for", // hacknight-friendly: recallable immediately
    });

    return { memoryId };
  },
});

// ---------------------------------------------------------------------------
// recall - hybrid retrieval, ported directly from lib/memory.sh in the
// agent-memory repo:
//   FORK   → parallel BM25 (title/content/tags) + semantic branches
//   FUSE   → Reciprocal Rank Fusion (k=60 default)
//   DECAY  → recency weighting on created_at
// ---------------------------------------------------------------------------
export const recall = createTool({
  id: "recall",
  description:
    "Recall memories from previous sessions using hybrid search (exact " +
    "keyword + semantic similarity, recency-weighted). Use at the start of " +
    "a task to check for prior decisions, patterns, or blockers.",
  inputSchema: z.object({
    query: z.string().describe("What to recall, e.g. 'embedding model decisions'"),
    limit: z.number().min(1).max(20).default(5),
  }),
  outputSchema: z.object({
    memories: z.array(
      z.object({
        memory_id: z.string(),
        type: z.string(),
        display: z.string(),
        agent: z.string(),
        created_at: z.string(),
        score: z.number(),
      })
    ),
  }),
  execute: async (input) => {
    const q = esqlEscape(input.query);
    const scopeFilter =
      `(access_scope == "shared" OR access_scope == "${AGENT_ID}-only" OR agent == "${AGENT_ID}")`;

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
${fuseClause()}
| EVAL final_score = _score * DECAY(created_at, NOW(), ${DECAY_WINDOW_DAYS * 24} hours)
| EVAL display = COALESCE(title, SUBSTRING(content, 1, 80))
| SORT final_score DESC | LIMIT ${input.limit}
| KEEP memory_id, type, display, agent, created_at, final_score
`.trim();

    // If DECAY throws a type error on your deployment, swap that EVAL for:
    // | EVAL final_score = _score / (1 + DATE_DIFF("day", created_at, NOW()) / ${DECAY_WINDOW_DAYS}.0)

    const result = await es.esql.query({ query, format: "json" });

    const cols = result.columns.map((c: { name: string }) => c.name);
    const idx = (name: string) => cols.indexOf(name);

    const memories = (result.values as unknown[][]).map((row) => ({
      memory_id: String(row[idx("memory_id")]),
      type: String(row[idx("type")]),
      display: String(row[idx("display")]),
      agent: String(row[idx("agent")]),
      created_at: String(row[idx("created_at")]),
      score: Number(row[idx("final_score")]),
    }));

    return { memories };
  },
});
