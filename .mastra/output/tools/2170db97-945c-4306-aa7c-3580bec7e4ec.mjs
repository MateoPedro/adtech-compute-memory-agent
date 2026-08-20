import { createTool } from '@mastra/core/tools';
import { Client } from '@elastic/elasticsearch';
import { z } from 'zod';

const es = new Client({
  node: process.env.ELASTICSEARCH_URL,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY }
});
const AGENT_ID = process.env.AGENT_ID ?? "mastra-agent";
const MEMORY_INDEX = "agent-memory";
const DECAY_WINDOW_DAYS = Number(process.env.BRIDGE_MEMORY_DECAY_WINDOW ?? 45);
const FUSION_STRATEGY = process.env.FUSION_STRATEGY ?? "rrf";
const BM25_WEIGHT = Number(process.env.FUSION_BM25_WEIGHT ?? 0.3);
const SEMANTIC_WEIGHT = 1 - BM25_WEIGHT;
function fuseClause() {
  if (FUSION_STRATEGY === "linear") {
    return `| FUSE LINEAR WITH { "weights": { "fork1": ${BM25_WEIGHT}, "fork2": ${SEMANTIC_WEIGHT} }, "normalizer": "minmax" }`;
  }
  return "| FUSE";
}
function esqlEscape(input) {
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
    await es.index({
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
    const q = esqlEscape(input.query);
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
${fuseClause()}
| EVAL final_score = _score * DECAY(created_at, NOW(), ${DECAY_WINDOW_DAYS * 24} hours)
| EVAL display = COALESCE(title, SUBSTRING(content, 1, 80))
| SORT final_score DESC | LIMIT ${input.limit}
| KEEP memory_id, type, display, agent, created_at, final_score
`.trim();
    const result = await es.esql.query({ query, format: "json" });
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

export { recall, remember };
