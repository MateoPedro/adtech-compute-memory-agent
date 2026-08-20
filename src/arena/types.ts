export type AgentKind = "baseline" | "memory";
export type Exchange = "trusted-one" | "trusted-two" | "open-market" | "bargain-net";
export type RunStatus = "running" | "paused" | "completed" | "stopped";

export type AuctionOpportunity = {
  id: string; tick: number; exchange: Exchange; placement: "display" | "video";
  device: "mobile" | "desktop"; audience: "high-intent" | "prospecting";
  floorPrice: number; predictedValue: number;
  random: { win: number; click: number; conversion: number; fraud: number };
};

export type DelayedOutcome = {
  dueTick: number; agent: AgentKind; auctionId: string;
  type: "click" | "conversion" | "fraud"; value: number;
};

export type CampaignPolicy = {
  bidMultiplier: number; pacingMultiplier: number; exchanges: Exchange[];
};

export type CampaignMetrics = {
  requests: number; bids: number; wins: number; impressions: number; clicks: number;
  conversions: number; invalidImpressions: number; spend: number; revenue: number;
  budgetDeliveryPct: number; projectedDeliveryPct: number; bidRatePct: number;
  winRatePct: number; cpm: number; ctrPct: number; cvrPct: number; cpa: number;
  roas: number; invalidTrafficPct: number; qualityScore: number; matured: boolean;
};

export type AgentObservation = {
  runId: string; checkpoint: number; tick: number; policy: CampaignPolicy;
  metrics: CampaignMetrics; constraints: RunConstraints;
};

export type OptimizationAction = {
  type: "adjust_policy" | "hold";
  bidMultiplier: number; pacingMultiplier: number; exchanges: Exchange[];
  rationale: string; selectedMemoryIds: string[]; rejectedMemoryIds: string[];
};

export type GuardrailDecision = {
  accepted: boolean; reasons: string[]; appliedPolicy: CampaignPolicy;
};

export type MemoryEvidence = {
  memoryId: string; recordedAt: string; rank: number; score: number;
  action: string; outcome: string; supersedesMemoryId?: string; rejectionReason?: string;
};

export type DecisionEvent = {
  id: string; tick: number; checkpoint: number; agent: AgentKind;
  proposed: OptimizationAction; guardrail: GuardrailDecision;
  evidence: MemoryEvidence[]; source: "llm" | "fallback"; rolledBack?: boolean;
};

export type RunConstraints = {
  budget: number; targetDeliveryPct: number; maxCpa: number; minRoas: number;
  maxInvalidTrafficPct: number; maxSpendPerMinute: number;
};

export type AgentState = {
  kind: AgentKind; policy: CampaignPolicy; previousPolicy?: CampaignPolicy;
  metrics: CampaignMetrics; decisions: DecisionEvent[]; score: number;
  hardConstraintPassed: boolean;
};

export type ArenaEvent = { sequence: number; type: string; tick: number; payload: unknown };

export type SimulationRun = {
  id: string; seed: number; status: RunStatus; tick: number; durationTicks: number;
  marketPhase: string; constraints: RunConstraints; agents: Record<AgentKind, AgentState>;
  events: ArenaEvent[]; winner?: AgentKind | "none"; verdict?: string;
};

export type AuctionOptimizationMemory = {
  memory_id: string; recorded_at: string; scenario_type: string; traffic_pattern: string;
  action: { summary: string; bid_multiplier: number; pacing_multiplier: number; exchanges: Exchange[] };
  metrics_before: Partial<CampaignMetrics>; metrics_after: Partial<CampaignMetrics>;
  outcome: "promoted" | "rolled_back"; confidence: number; rationale: string;
  tags: string[]; search_text: string; supersedes_memory_id?: string;
};
