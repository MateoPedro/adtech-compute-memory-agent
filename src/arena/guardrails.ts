import type { AgentObservation, CampaignPolicy, GuardrailDecision, OptimizationAction } from "./types";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function validateAction(action: OptimizationAction, observation: AgentObservation): GuardrailDecision {
  const reasons: string[] = [];
  if (observation.metrics.requests < 250) reasons.push("Minimum observation volume not reached");
  if (observation.metrics.spend >= observation.constraints.budget) reasons.push("Campaign budget exhausted");
  if (observation.checkpoint > 1 && observation.metrics.invalidTrafficPct > observation.constraints.maxInvalidTrafficPct) reasons.push("Current invalid-traffic rate requires rollback, not expansion");
  const current = observation.policy;
  const proposed: CampaignPolicy = {
    bidMultiplier: clamp(action.bidMultiplier, current.bidMultiplier - .25, current.bidMultiplier + .25),
    pacingMultiplier: clamp(action.pacingMultiplier, .7, 1.5),
    exchanges: [...new Set(action.exchanges)],
  };
  if (proposed.bidMultiplier !== action.bidMultiplier) reasons.push("Bid change clamped to 25% per cycle");
  const rejected = reasons.some(reason => reason.includes("not reached") || reason.includes("exhausted") || reason.includes("requires rollback"));
  return { accepted: !rejected, reasons, appliedPolicy: rejected ? current : proposed };
}
