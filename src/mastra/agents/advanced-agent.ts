/**
 * advanced-agent.ts - the ADVANCED tier: episodic, time-aware memory.
 *
 * The tools are already built (src/mastra/tools/memory-tools.ts):
 *   remember - stores typed memories (decision/pattern/context/feedback)
 *   recall   - hybrid retrieval: FORK (BM25 + semantic) → FUSE → DECAY,
 *              so recent memories outrank stale ones.
 *
 * YOUR work is the data (something with a shift or reversal) and the TUNING:
 *   BRIDGE_MEMORY_DECAY_WINDOW      - recency half-life (days)
 *   FUSION_STRATEGY / FUSION_BM25_WEIGHT - keyword vs semantic balance
 *   the ES|QL branches in memory-tools.ts
 *   ...and these instructions (memory discipline is tuning too).
 */
import { Agent } from "@mastra/core/agent";
import { remember, recall } from "../tools/memory-tools";
import "dotenv/config";

export const advancedMemoryAgent = new Agent({
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
      modelSettings: { maxOutputTokens: 4096 },
    },
  ],
  tools: { remember, recall },
});
