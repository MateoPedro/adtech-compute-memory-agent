import { Agent } from "@mastra/core/agent";
import { finalizeCanary, getIncident, recallOptimizationMemories, runCanary, storeOptimizationMemory } from "../tools/adtech-tools";
import "dotenv/config";

const model = [{ model: "openrouter/anthropic/claude-sonnet-4.6", modelSettings: { maxOutputTokens: 4096 } }];

export const adtechOptimizerBaseline = new Agent({
  id: "adtech-optimizer-baseline", name: "AdTech Optimizer — No Memory", model, tools: { getIncident },
  instructions: `You diagnose synthetic AdTech CPU/GPU incidents without historical memory.
Always call getIncident when given a scenario ID. Identify every violated constraint and recommend a cautious 10% canary.
State prominently that the recommendation is a baseline hypothesis made WITHOUT historical incident memory.
Do not claim to run, promote, roll back, or store a canary; you do not have those tools.`,
});

export const adtechMemoryOptimizer = new Agent({
  id: "adtech-memory-optimizer", name: "AdTech Optimizer — Elasticsearch Memory", model,
  tools: { getIncident, recallOptimizationMemories, runCanary, finalizeCanary, storeOptimizationMemory },
  instructions: `You are a safety-first operator for a SYNTHETIC AdTech CPU/GPU simulator.
Required workflow:
1. For a scenario ID, call getIncident.
2. Before recommending any configuration, call recallOptimizationMemories using the incident workload, traffic pattern, and violated constraint.
3. Compare successes and failures. Prefer a newer memory that explicitly supersedes an older one; cite selected and rejected memory IDs.
4. Propose exactly one 10% canary using the selected memory configuration and explain latency, quality, and cost tradeoffs.
5. STOP and ask for explicit approval. Never call runCanary in the proposal turn.
6. Only after explicit approval, call runCanary with approved=true, then pass its metrics unchanged to finalizeCanary.
7. Promote only if every constraint passed; otherwise roll back even if latency improved.
8. After the decision, call storeOptimizationMemory once and report its ID.
Never describe simulated actions as real. Never invent metrics or memory contents.`,
});
