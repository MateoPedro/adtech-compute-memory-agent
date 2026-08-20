import { EventEmitter } from "node:events";
import { decide } from "./agents";
import { validateAction } from "./guardrails";
import { calculateMetrics, emptyCounters, scoreMetrics, type Counters } from "./metrics";
import { seededRandom } from "./random";
import { storeRunMemory } from "./memory";
import type { AgentKind, ArenaEvent, AuctionOpportunity, CampaignPolicy, DelayedOutcome, DecisionEvent, Exchange, SimulationRun } from "./types";

const checkpoints = [15, 35, 55];
const initialPolicy: CampaignPolicy = { bidMultiplier: 1, pacingMultiplier: .82, exchanges: ["trusted-one", "trusted-two"] };
const constraints = { budget: 5.65, targetDeliveryPct: 95, maxCpa: 1.1, minRoas: 2.5, maxInvalidTrafficPct: 3, maxSpendPerMinute: 7 };
const exchangeProfile: Record<Exchange, { floor: number; click: number; conversion: number; fraud: number; trust: number }> = {
  "trusted-one": { floor: 4.4, click: .11, conversion: .18, fraud: .006, trust: 1 },
  "trusted-two": { floor: 3.8, click: .095, conversion: .16, fraud: .01, trust: .96 },
  "open-market": { floor: 2.6, click: .08, conversion: .07, fraud: .11, trust: .66 },
  "bargain-net": { floor: 1.5, click: .065, conversion: .025, fraud: .24, trust: .42 },
};

type Internal = { run: SimulationRun; random: () => number; counters: Record<AgentKind, Counters>; pending: DelayedOutcome[]; timer?: NodeJS.Timeout; subscribers: Set<(event: ArenaEvent) => void>; checkpointBusy: boolean };

export class ArenaManager extends EventEmitter {
  private runs = new Map<string, Internal>();

  create(seed = 20260819) {
    const id = `arena-${seed}-${Date.now().toString(36)}`;
    const metrics = calculateMetrics(emptyCounters(), 1, 70, constraints);
    const run: SimulationRun = {
      id, seed, status: "running", tick: 0, durationTicks: 70, marketPhase: "Opening: campaign underpacing", constraints,
      agents: {
        baseline: { kind: "baseline", policy: structuredClone(initialPolicy), metrics, decisions: [], score: 0, hardConstraintPassed: true },
        memory: { kind: "memory", policy: structuredClone(initialPolicy), metrics, decisions: [], score: 0, hardConstraintPassed: true },
      }, events: [],
    };
    const state: Internal = { run, random: seededRandom(seed), counters: { baseline: emptyCounters(), memory: emptyCounters() }, pending: [], subscribers: new Set(), checkpointBusy: false };
    this.runs.set(id, state);
    this.emitEvent(state, "run.started", { seed });
    this.schedule(state);
    return this.snapshot(id)!;
  }

  snapshot(id: string) { const state = this.runs.get(id); return state ? structuredClone(state.run) : undefined; }
  list() { return [...this.runs.values()].map(s => structuredClone(s.run)); }
  subscribe(id: string, fn: (event: ArenaEvent) => void, after = 0) {
    const state = this.runs.get(id); if (!state) return undefined;
    state.run.events.filter(e => e.sequence > after).forEach(fn); state.subscribers.add(fn);
    return () => state.subscribers.delete(fn);
  }

  control(id: string, action: "pause" | "resume" | "stop" | "reset") {
    const state = this.runs.get(id); if (!state) return undefined;
    if (action === "reset") return this.create(state.run.seed);
    state.run.status = action === "pause" ? "paused" : action === "resume" ? "running" : "stopped";
    this.emitEvent(state, `run.${state.run.status}`, {});
    if (action === "resume") this.schedule(state);
    return this.snapshot(id);
  }

  private schedule(state: Internal) {
    if (state.timer || state.run.status !== "running") return;
    state.timer = setTimeout(async () => {
      state.timer = undefined;
      await this.tick(state);
      this.schedule(state);
    }, 700);
  }

  private async tick(state: Internal) {
    const run = state.run;
    if (run.status !== "running" || state.checkpointBusy) return;
    run.tick += 1;
    run.marketPhase = run.tick < 15 ? "Opening: campaign underpacing" : run.tick < 40 ? "Expansion: cheap supply surges" : run.tick < 62 ? "Attribution: quality signals mature" : "Closing: final reconciliation";
    this.processPending(state);
    for (let i = 0; i < 45; i++) {
      const auction = this.opportunity(state, i);
      for (const kind of ["baseline", "memory"] as const) this.evaluateAuction(state, kind, auction);
      if (i === 0) this.emitEvent(state, "auction.sample", { id: auction.id, exchange: auction.exchange, floorPrice: auction.floorPrice, audience: auction.audience });
    }
    for (const kind of ["baseline", "memory"] as const) {
      run.agents[kind].metrics = calculateMetrics(state.counters[kind], run.tick, run.durationTicks, constraints);
      this.maybeRollback(state, kind);
    }
    this.emitEvent(state, "metrics.updated", { baseline: run.agents.baseline.metrics, memory: run.agents.memory.metrics, phase: run.marketPhase });
    if (checkpoints.includes(run.tick)) await this.runCheckpoint(state, checkpoints.indexOf(run.tick) + 1);
    if (run.tick >= run.durationTicks) await this.complete(state);
  }

  private opportunity(state: Internal, index: number): AuctionOpportunity {
    const r = state.random; const pick = r();
    const exchange: Exchange = pick < .34 ? "trusted-one" : pick < .6 ? "trusted-two" : pick < .83 ? "open-market" : "bargain-net";
    const profile = exchangeProfile[exchange];
    return { id: `${state.run.tick}-${index}`, tick: state.run.tick, exchange, placement: r() < .25 ? "video" : "display", device: r() < .68 ? "mobile" : "desktop", audience: r() < .38 ? "high-intent" : "prospecting", floorPrice: profile.floor * (.8 + r() * .4), predictedValue: profile.trust * (.8 + r() * .4), random: { win: r(), click: r(), conversion: r(), fraud: r() } };
  }

  private evaluateAuction(state: Internal, kind: AgentKind, auction: AuctionOpportunity) {
    const counters = state.counters[kind]; const policy = state.run.agents[kind].policy; counters.requests++;
    if (!policy.exchanges.includes(auction.exchange) || auction.random.win > .68 * policy.pacingMultiplier) return;
    counters.bids++;
    const bid = auction.floorPrice * policy.bidMultiplier;
    if (auction.random.win > Math.min(.92, .22 + bid / 9)) return;
    counters.wins++; counters.impressions++; counters.spend += auction.floorPrice / 1000;
    const profile = exchangeProfile[auction.exchange];
    if (auction.random.click < profile.click) state.pending.push({ dueTick: state.run.tick + 3, agent: kind, auctionId: auction.id, type: "click", value: auction.random.conversion < profile.conversion ? 1 : 0 });
    if (auction.random.fraud < profile.fraud) state.pending.push({ dueTick: state.run.tick + 18, agent: kind, auctionId: auction.id, type: "fraud", value: 1 });
  }

  private processPending(state: Internal) {
    const due = state.pending.filter(item => item.dueTick <= state.run.tick); state.pending = state.pending.filter(item => item.dueTick > state.run.tick);
    for (const item of due) {
      const c = state.counters[item.agent];
      if (item.type === "click") { c.clicks++; if (item.value) state.pending.push({ ...item, dueTick: state.run.tick + 5, type: "conversion", value: 2.8 }); }
      else if (item.type === "conversion") { c.conversions++; c.revenue += item.value; }
      else c.invalidImpressions++;
    }
  }

  private async runCheckpoint(state: Internal, checkpoint: number) {
    state.checkpointBusy = true; this.emitEvent(state, "checkpoint.started", { checkpoint });
    const results = await Promise.all((["baseline", "memory"] as const).map(async kind => {
      const agent = state.run.agents[kind];
      const observation = { runId: state.run.id, checkpoint, tick: state.run.tick, policy: agent.policy, metrics: agent.metrics, constraints };
      const result = await decide(kind, observation); const guardrail = validateAction(result.action, observation);
      const decision: DecisionEvent = { id: `${state.run.id}-${kind}-${checkpoint}`, tick: state.run.tick, checkpoint, agent: kind, proposed: result.action, guardrail, evidence: result.evidence, source: result.source };
      if (guardrail.accepted) { agent.previousPolicy = agent.policy; agent.policy = guardrail.appliedPolicy; }
      agent.decisions.push(decision); this.emitEvent(state, "decision.completed", decision);
    }));
    await Promise.all(results); state.checkpointBusy = false;
  }

  private maybeRollback(state: Internal, kind: AgentKind) {
    const agent = state.run.agents[kind]; const m = agent.metrics;
    if (!agent.previousPolicy || state.run.tick < 42 || m.invalidTrafficPct <= constraints.maxInvalidTrafficPct) return;
    const last = agent.decisions.at(-1); if (last?.rolledBack) return;
    agent.policy = agent.previousPolicy; agent.previousPolicy = undefined; if (last) last.rolledBack = true;
    this.emitEvent(state, "policy.rolled_back", { agent: kind, reason: `Invalid traffic ${m.invalidTrafficPct.toFixed(1)}% exceeds ${constraints.maxInvalidTrafficPct}%` });
  }

  private async complete(state: Internal) {
    state.run.status = "completed";
    for (const kind of ["baseline", "memory"] as const) {
      const agent = state.run.agents[kind]; const result = scoreMetrics(agent.metrics, constraints); agent.score = result.score; agent.hardConstraintPassed = result.hard;
    }
    const a = state.run.agents;
    state.run.winner = !a.baseline.hardConstraintPassed && !a.memory.hardConstraintPassed ? "none" : a.memory.hardConstraintPassed && (!a.baseline.hardConstraintPassed || a.memory.score >= a.baseline.score) ? "memory" : "baseline";
    state.run.verdict = state.run.winner === "memory" ? "Memory avoided superseded broad-supply guidance and protected CPA, ROAS, and traffic quality." : state.run.winner === "baseline" ? "The baseline finished with the stronger constraint-safe score." : "Neither optimizer satisfied every hard constraint.";
    this.emitEvent(state, "run.completed", { winner: state.run.winner, verdict: state.run.verdict });
    await Promise.all((["baseline", "memory"] as const).map(kind => storeRunMemory(state.run.id, kind, {
      memory_id: `run-${state.run.id}-${kind}`, recorded_at: new Date().toISOString(), scenario_type: "underpacing_bad_supply", traffic_pattern: "live_synthetic",
      action: { summary: state.run.agents[kind].decisions.at(-1)?.proposed.rationale ?? "hold", bid_multiplier: state.run.agents[kind].policy.bidMultiplier, pacing_multiplier: state.run.agents[kind].policy.pacingMultiplier, exchanges: state.run.agents[kind].policy.exchanges },
      metrics_before: {}, metrics_after: state.run.agents[kind].metrics, outcome: state.run.agents[kind].hardConstraintPassed ? "promoted" : "rolled_back", confidence: .9,
      rationale: state.run.verdict ?? "Completed autonomous run", tags: [kind, "live-synthetic", state.run.agents[kind].hardConstraintPassed ? "safe" : "constraint-failure"], search_text: `${kind} live synthetic auction underpacing bad supply ${state.run.verdict}`,
    })));
  }

  private emitEvent(state: Internal, type: string, payload: unknown) {
    const event = { sequence: (state.run.events.at(-1)?.sequence ?? 0) + 1, type, tick: state.run.tick, payload };
    state.run.events.push(event); if (state.run.events.length > 500) state.run.events.shift(); state.subscribers.forEach(fn => fn(event));
  }
}
