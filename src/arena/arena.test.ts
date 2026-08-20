import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "./random";
import { calculateMetrics, scoreMetrics } from "./metrics";
import { validateAction } from "./guardrails";
import type { AgentObservation, OptimizationAction } from "./types";

test("seeded streams are reproducible", () => {
  const a = seededRandom(42), b = seededRandom(42), c = seededRandom(43);
  assert.deepEqual(Array.from({ length: 20 }, a), Array.from({ length: 20 }, b));
  assert.notEqual(c(), seededRandom(42)());
});

test("campaign metrics and hard-constraint score are calculated", () => {
  const constraints = { budget: 10, targetDeliveryPct: 95, maxCpa: 2, minRoas: 2.5, maxInvalidTrafficPct: 3, maxSpendPerMinute: 12 };
  const metrics = calculateMetrics({ requests: 1000, bids: 500, wins: 200, impressions: 200, clicks: 20, conversions: 5, invalidImpressions: 2, spend: 8, revenue: 24 }, 70, 70, constraints);
  assert.equal(metrics.budgetDeliveryPct, 80); assert.equal(metrics.cpa, 1.6); assert.equal(metrics.roas, 3); assert.equal(metrics.invalidTrafficPct, 1);
  assert.equal(scoreMetrics(metrics, constraints).hard, true);
});

test("guardrails clamp large changes and reject unsafe expansion", () => {
  const constraints = { budget: 10, targetDeliveryPct: 95, maxCpa: 2, minRoas: 2.5, maxInvalidTrafficPct: 3, maxSpendPerMinute: 12 };
  const observation: AgentObservation = { runId: "r", checkpoint: 2, tick: 35, policy: { bidMultiplier: 1, pacingMultiplier: 1, exchanges: ["trusted-one"] }, metrics: { requests: 1000, bids: 400, wins: 100, impressions: 100, clicks: 5, conversions: 1, invalidImpressions: 5, spend: 1, revenue: 3, budgetDeliveryPct: 10, projectedDeliveryPct: 20, bidRatePct: 40, winRatePct: 25, cpm: 10, ctrPct: 5, cvrPct: 20, cpa: 1, roas: 3, invalidTrafficPct: 5, qualityScore: .95, matured: false }, constraints };
  const action: OptimizationAction = { type: "adjust_policy", bidMultiplier: 2, pacingMultiplier: 2, exchanges: ["bargain-net"], rationale: "expand", selectedMemoryIds: [], rejectedMemoryIds: [] };
  const decision = validateAction(action, observation);
  assert.equal(decision.accepted, false); assert.equal(decision.appliedPolicy.bidMultiplier, 1);
});
