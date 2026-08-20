"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const API = process.env.NEXT_PUBLIC_ARENA_API ?? "http://localhost:4120";
type Metrics = { budgetDeliveryPct: number; projectedDeliveryPct: number; cpa: number; roas: number; winRatePct: number; invalidTrafficPct: number; spend: number; conversions: number; matured: boolean };
type Policy = { bidMultiplier: number; pacingMultiplier: number; exchanges: string[] };
type Decision = { id: string; checkpoint: number; agent: "baseline" | "memory"; proposed: { rationale: string; selectedMemoryIds: string[]; rejectedMemoryIds: string[] }; guardrail: { accepted: boolean; reasons: string[] }; evidence: Array<{ memoryId: string; action: string; supersedesMemoryId?: string; rejectionReason?: string }>; source: string; rolledBack?: boolean };
type Side = { policy: Policy; metrics: Metrics; decisions: Decision[]; score: number; hardConstraintPassed: boolean };
type Run = { id: string; seed: number; status: string; tick: number; durationTicks: number; marketPhase: string; agents: { baseline: Side; memory: Side }; winner?: string; verdict?: string };
type Feed = { sequence: number; type: string; tick: number; payload: any };
const emptyMetrics: Metrics = { budgetDeliveryPct: 0, projectedDeliveryPct: 0, cpa: 0, roas: 0, winRatePct: 0, invalidTrafficPct: 0, spend: 0, conversions: 0, matured: false };

export default function Page() {
  const [run, setRun] = useState<Run>(); const [health, setHealth] = useState<any>(); const [seed, setSeed] = useState(20260819);
  const [feed, setFeed] = useState<Feed[]>([]); const [history, setHistory] = useState<any[]>([]); const source = useRef<EventSource | null>(null);
  useEffect(() => { fetch(`${API}/health`).then(r => r.json()).then(setHealth).catch(() => setHealth({ simulator: false })); return () => source.current?.close(); }, []);
  const refresh = useCallback(async (id: string) => { const value = await fetch(`${API}/api/runs/${id}`).then(r => r.json()); setRun(value); return value as Run; }, []);
  const connect = useCallback((id: string) => {
    source.current?.close(); const events = new EventSource(`${API}/api/runs/${id}/events`); source.current = events;
    events.addEventListener("arena", async raw => {
      const event = JSON.parse((raw as MessageEvent).data) as Feed; setFeed(old => [...old.slice(-34), event]);
      if (event.type === "metrics.updated") setHistory(old => [...old.slice(-69), { tick: event.tick, baseline: event.payload.baseline.projectedDeliveryPct, memory: event.payload.memory.projectedDeliveryPct }]);
      await refresh(id);
    });
  }, [refresh]);
  const start = async () => { setFeed([]); setHistory([]); const value = await fetch(`${API}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed }) }).then(r => r.json()); setRun(value); connect(value.id); };
  const control = async (action: string) => { if (!run) return; const value = await fetch(`${API}/api/runs/${run.id}/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }).then(r => r.json()); if (action === "reset") { setRun(value); setFeed([]); setHistory([]); connect(value.id); } else setRun(value); };
  const evidence = useMemo(() => run?.agents.memory.decisions.flatMap(d => d.evidence) ?? [], [run]);
  return <main>
    <header>
      <div><p className="eyebrow">AUTONOMOUS MEDIA LAB · SYNTHETIC</p><h1>Bidstream <span>Arena</span></h1><p className="subtitle">Same auctions. Two optimizers. One remembers what failed.</p></div>
      <div className="health"><Status ok={health?.simulator} label="SIM"/><Status ok={health?.elasticsearch} label="ES"/><Status ok={health?.model} label="LLM"/><a href="http://localhost:4111" target="_blank">Open traces ↗</a></div>
    </header>
    <section className="command">
      <div className="seed"><label>MARKET SEED</label><input value={seed} onChange={e => setSeed(Number(e.target.value))}/></div>
      {!run || ["completed", "stopped"].includes(run.status) ? <button className="primary" onClick={start}>▶ Launch live market</button> : <><button onClick={() => control(run.status === "paused" ? "resume" : "pause")}>{run.status === "paused" ? "Resume" : "Pause"}</button><button onClick={() => control("stop")}>Stop</button><button onClick={() => control("reset")}>Reset</button></>}
      <div className="phase"><span>{run?.marketPhase ?? "Ready for auction traffic"}</span><strong>{run ? `${run.tick} / ${run.durationTicks}` : "00 / 70"}</strong></div>
      <div className="progress"><i style={{ width: `${run ? run.tick / run.durationTicks * 100 : 0}%` }}/></div>
    </section>
    <section className="arena">
      <AgentCard title="Current-signal optimizer" tag="NO MEMORY" tone="orange" side={run?.agents.baseline} metrics={run?.agents.baseline.metrics ?? emptyMetrics}/>
      <div className="versus"><b>VS</b><small>IDENTICAL<br/>AUCTIONS</small></div>
      <AgentCard title="Evidence-driven optimizer" tag="ES MEMORY" tone="green" side={run?.agents.memory} metrics={run?.agents.memory.metrics ?? emptyMetrics}/>
    </section>
    <section className="lower">
      <div className="panel chart"><PanelTitle eyebrow="LIVE PACING" title="Projected budget delivery" extra={run?.agents.baseline.metrics.matured ? "MATURED" : "PROVISIONAL"}/><div className="chartbox"><ResponsiveContainer width="100%" height="100%"><AreaChart data={history}><defs><linearGradient id="o" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ff7b45" stopOpacity={.25}/><stop offset="95%" stopColor="#ff7b45" stopOpacity={0}/></linearGradient><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8ae05f" stopOpacity={.25}/><stop offset="95%" stopColor="#8ae05f" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#202823" vertical={false}/><XAxis dataKey="tick" stroke="#657269"/><YAxis stroke="#657269" domain={[0, 140]}/><Tooltip contentStyle={{ background: "#111713", border: "1px solid #2b352e" }}/><Area dataKey="baseline" stroke="#ff7b45" fill="url(#o)"/><Area dataKey="memory" stroke="#8ae05f" fill="url(#g)"/></AreaChart></ResponsiveContainer></div></div>
      <div className="panel memories"><PanelTitle eyebrow="MEMORY COURTROOM" title="Competing experiment evidence" extra={`${evidence.length} MATCHES`}/>{evidence.length ? evidence.slice(0, 4).map((e, i) => <div className={`memory ${e.rejectionReason ? "rejected" : "selected"}`} key={`${e.memoryId}-${i}`}><div><strong>{e.memoryId}</strong><span>{e.supersedesMemoryId ? `SUPERSEDES ${e.supersedesMemoryId}` : e.rejectionReason ? "STALE" : "MATCH"}</span></div><p>{e.action}</p>{e.rejectionReason && <small>{e.rejectionReason}</small>}</div>) : <Empty text="Evidence appears when the memory optimizer reaches checkpoint one."/>}</div>
      <div className="panel feed"><PanelTitle eyebrow="EVENT STREAM" title="Market activity" extra="LIVE"/><div className="events">{feed.length ? [...feed].reverse().map(event => <div key={event.sequence}><time>T+{String(event.tick).padStart(2, "0")}</time><span className={event.type.includes("rollback") ? "bad" : event.type.includes("decision") ? "good" : ""}>{friendly(event)}</span></div>) : <Empty text="Launch the market to begin streaming auctions."/>}</div></div>
    </section>
    {run?.status === "completed" && <section className={`verdict ${run.winner}`}><p>FINAL VERDICT</p><h2>{run.winner === "memory" ? "Memory wins the market" : run.winner === "baseline" ? "Baseline wins the market" : "No safe winner"}</h2><span>{run.verdict}</span></section>}
  </main>;
}

function AgentCard({ title, tag, tone, side, metrics }: { title: string; tag: string; tone: string; side?: Side; metrics: Metrics }) { return <article className={`agent ${tone}`}><div className="agenthead"><div><p>{tag}</p><h2>{title}</h2></div><span className="score">{side?.score ? side.score.toFixed(0) : "—"}<small>SCORE</small></span></div><div className="metricgrid"><Metric label="Projected delivery" value={`${metrics.projectedDeliveryPct.toFixed(0)}%`} target="target 95%"/><Metric label="CPA" value={metrics.cpa > 100 ? "—" : `$${metrics.cpa.toFixed(2)}`} target="max $1.10"/><Metric label="ROAS" value={`${metrics.roas.toFixed(2)}×`} target="min 2.50×"/><Metric label="Invalid traffic" value={`${metrics.invalidTrafficPct.toFixed(1)}%`} target="max 3.0%"/></div><div className="policy"><label>ACTIVE POLICY</label><b>{side ? `${side.policy.bidMultiplier.toFixed(2)}× bid · ${side.policy.pacingMultiplier.toFixed(2)}× pace` : "Awaiting launch"}</b><span>{side?.policy.exchanges.join(" · ") ?? "No traffic"}</span></div><div className="decisions">{side?.decisions.length ? side.decisions.map(d => <div key={d.id}><i className={d.rolledBack ? "rollback" : d.guardrail.accepted ? "accepted" : "rejected"}/><p><b>Checkpoint {d.checkpoint}</b>{d.proposed.rationale}</p><em>{d.rolledBack ? "ROLLED BACK" : d.source.toUpperCase()}</em></div>) : <p className="quiet">Autonomous decisions will appear at checkpoints 15, 35, and 55.</p>}</div></article> }
function Metric({ label, value, target }: { label: string; value: string; target: string }) { return <div><label>{label}</label><strong>{value}</strong><small>{target}</small></div> }
function Status({ ok, label }: { ok?: boolean; label: string }) { return <span className={ok ? "online" : "offline"}><i/>{label}</span> }
function PanelTitle({ eyebrow, title, extra }: { eyebrow: string; title: string; extra: string }) { return <div className="paneltitle"><div><p>{eyebrow}</p><h3>{title}</h3></div><span>{extra}</span></div> }
function Empty({ text }: { text: string }) { return <p className="empty">{text}</p> }
function friendly(event: Feed) { if (event.type === "auction.sample") return `Bid request · ${event.payload.exchange} · $${event.payload.floorPrice.toFixed(2)} CPM`; if (event.type === "metrics.updated") return "Campaign metrics recalculated"; if (event.type === "checkpoint.started") return `Decision checkpoint ${event.payload.checkpoint} opened`; if (event.type === "decision.completed") return `${event.payload.agent} applied a policy decision`; if (event.type === "policy.rolled_back") return `${event.payload.agent} rollback · ${event.payload.reason}`; if (event.type === "run.completed") return `Run complete · ${event.payload.winner} wins`; return event.type.replaceAll(".", " "); }
