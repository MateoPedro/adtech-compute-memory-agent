import { z } from "zod";
import { recallAuctionMemories } from "./memory";
import type { AgentKind, AgentObservation, Exchange, MemoryEvidence, OptimizationAction } from "./types";

const exchanges = z.enum(["trusted-one", "trusted-two", "open-market", "bargain-net"]);
const actionSchema = z.object({
  type: z.enum(["adjust_policy", "hold"]),
  bidMultiplier: z.number().min(.5).max(2), pacingMultiplier: z.number().min(.5).max(2),
  exchanges: z.array(exchanges).min(1), rationale: z.string(),
  selectedMemoryIds: z.array(z.string()).default([]), rejectedMemoryIds: z.array(z.string()).default([]),
});
const actionJsonSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["adjust_policy", "hold"] },
    bidMultiplier: { type: "number" }, pacingMultiplier: { type: "number" },
    exchanges: { type: "array", items: { type: "string", enum: ["trusted-one", "trusted-two", "open-market", "bargain-net"] }, minItems: 1 },
    rationale: { type: "string" }, selectedMemoryIds: { type: "array", items: { type: "string" } },
    rejectedMemoryIds: { type: "array", items: { type: "string" } },
  },
  required: ["type", "bidMultiplier", "pacingMultiplier", "exchanges", "rationale", "selectedMemoryIds", "rejectedMemoryIds"],
  additionalProperties: false,
} as const;
const mastraUrl = process.env.MASTRA_URL ?? "http://localhost:4111";

export async function decide(kind: AgentKind, observation: AgentObservation): Promise<{ action: OptimizationAction; evidence: MemoryEvidence[]; source: "llm" | "fallback" }> {
  let evidence: MemoryEvidence[] = [];
  if (kind === "memory") evidence = (await recallAuctionMemories("campaign underpacing bad supply delayed attribution CPA ROAS invalid traffic", 5)).evidence;
  const prompt = `Checkpoint ${observation.checkpoint}. Observation JSON:\n${JSON.stringify(observation)}\n${kind === "memory" ? `Retrieved evidence JSON:\n${JSON.stringify(evidence)}` : "No historical memory is available."}\nChoose the next policy.`;
  try {
    const response = await fetch(`${mastraUrl}/api/agents/auction-${kind}-optimizer/generate`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(13000),
      body: JSON.stringify({ messages: prompt, activeTools: [], structuredOutput: { schema: actionJsonSchema } }),
    });
    if (!response.ok) throw new Error(`Mastra returned ${response.status}`);
    const result = await response.json() as { object?: unknown };
    return { action: actionSchema.parse(result.object) as OptimizationAction, evidence, source: "llm" };
  } catch (error) {
    console.warn(`${kind} agent fallback`, error instanceof Error ? error.message : error);
    return { action: fallback(kind, observation.checkpoint), evidence, source: "fallback" };
  }
}

function fallback(kind: AgentKind, checkpoint: number): OptimizationAction {
  const trusted: Exchange[] = ["trusted-one", "trusted-two"];
  if (kind === "memory") return { type: "adjust_policy", bidMultiplier: checkpoint === 1 ? 1.12 : 1.16, pacingMultiplier: 1.14, exchanges: trusted, rationale: "Newer memory supersedes broad-supply advice; increase moderately on trusted exchanges.", selectedMemoryIds: ["auction-mem-007"], rejectedMemoryIds: ["auction-mem-001"] };
  if (checkpoint === 1) return { type: "adjust_policy", bidMultiplier: 1.25, pacingMultiplier: 1.3, exchanges: [...trusted, "open-market", "bargain-net"], rationale: "Current delivery is behind target, so increase bids and broaden supply.", selectedMemoryIds: [], rejectedMemoryIds: [] };
  return { type: "hold", bidMultiplier: 1.25, pacingMultiplier: 1.3, exchanges: [...trusted, "open-market", "bargain-net"], rationale: "Hold the delivery-oriented policy while current signals mature.", selectedMemoryIds: [], rejectedMemoryIds: [] };
}
