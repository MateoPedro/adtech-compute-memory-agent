import type { CampaignMetrics, RunConstraints } from "./types";

export type Counters = Pick<CampaignMetrics, "requests" | "bids" | "wins" | "impressions" | "clicks" | "conversions" | "invalidImpressions" | "spend" | "revenue">;

export const emptyCounters = (): Counters => ({ requests: 0, bids: 0, wins: 0, impressions: 0, clicks: 0, conversions: 0, invalidImpressions: 0, spend: 0, revenue: 0 });

const pct = (a: number, b: number) => b ? (a / b) * 100 : 0;
const ratio = (a: number, b: number, fallback = 0) => b ? a / b : fallback;

export function calculateMetrics(c: Counters, tick: number, duration: number, constraints: RunConstraints): CampaignMetrics {
  const elapsed = Math.max(1, tick) / duration;
  const delivery = pct(c.spend, constraints.budget);
  const invalid = pct(c.invalidImpressions, c.impressions);
  return {
    ...c,
    budgetDeliveryPct: delivery,
    projectedDeliveryPct: Math.min(180, delivery / elapsed),
    bidRatePct: pct(c.bids, c.requests),
    winRatePct: pct(c.wins, c.bids),
    cpm: ratio(c.spend * 1000, c.impressions),
    ctrPct: pct(c.clicks, c.impressions),
    cvrPct: pct(c.conversions, c.clicks),
    cpa: ratio(c.spend, c.conversions, 999),
    roas: ratio(c.revenue, c.spend),
    invalidTrafficPct: invalid,
    qualityScore: Math.max(0, 1 - invalid / 100),
    matured: tick >= duration - 8,
  };
}

export function scoreMetrics(m: CampaignMetrics, c: RunConstraints) {
  const hard = m.cpa <= c.maxCpa && m.roas >= c.minRoas && m.invalidTrafficPct <= c.maxInvalidTrafficPct;
  if (!hard) return { hard, score: 0 };
  const delivery = Math.max(0, 100 - Math.abs(c.targetDeliveryPct - m.budgetDeliveryPct) * 2);
  const cpa = Math.min(100, (c.maxCpa / Math.max(1, m.cpa)) * 75);
  const roas = Math.min(100, (m.roas / c.minRoas) * 70);
  const quality = Math.max(0, 100 - m.invalidTrafficPct * 20);
  return { hard, score: delivery * .35 + cpa * .25 + roas * .25 + quality * .15 };
}
