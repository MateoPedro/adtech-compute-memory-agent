import { Agent } from "@mastra/core/agent";
import { recallAuctionExperiments } from "../tools/auction-tools";
import "dotenv/config";

const model = [{ model: "openrouter/anthropic/claude-sonnet-4.6", modelSettings: { maxOutputTokens: 1400 } }];
const actions = `Return one bounded campaign policy decision. Allowed exchanges are trusted-one, trusted-two, open-market, bargain-net. Never invent metrics. Prefer hold when evidence is insufficient. The deterministic runtime—not you—applies guardrails.`;

export const auctionBaselineOptimizer = new Agent({
  id: "auction-baseline-optimizer", name: "Live Auction Optimizer — No Memory", model,
  instructions: `${actions} You receive only current auction and campaign metrics. You have no historical tools or evidence. When underpacing, prioritize faster delivery using the available policy controls. Clearly identify the decision as current-signal-only.`,
});

export const auctionMemoryOptimizer = new Agent({
  id: "auction-memory-optimizer", name: "Live Auction Optimizer — Elasticsearch Memory", model,
  tools: { recallAuctionExperiments },
  instructions: `${actions} Before every recommendation, call recallAuctionExperiments. Compare selected and rejected IDs, honor explicit supersession, and account for delayed CPA and invalid-traffic outcomes. For underpacing with uncertain supply, prefer a moderate bid/pacing increase limited to trusted exchanges.`,
});
