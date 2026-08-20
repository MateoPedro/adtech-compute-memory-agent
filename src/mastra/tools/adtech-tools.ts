import { Client } from "@elastic/elasticsearch";
import { createTool } from "@mastra/core/tools";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Metrics, OptimizationMemory, Scenario } from "../adtech-types";
import "dotenv/config";

const INDEX = "adtech-optimization-memory";
// The bundled fixed-date dataset spans Jan-Jun 2026. A 180-day scale keeps
// scores inspectable in the August demo while still favoring newer evidence.
const DECAY_DAYS = Number(process.env.ADTECH_MEMORY_DECAY_DAYS ?? 180);
const BM25_WEIGHT = Number(process.env.ADTECH_BM25_WEIGHT ?? 0.65);
const SEMANTIC_WEIGHT = 1 - BM25_WEIGHT;
const es = new Client({
  node: process.env.ELASTICSEARCH_URL!,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY! },
});

const scenariosPath = fileURLToPath(new URL("../../../data/demo-scenarios.json", import.meta.url));
const memoriesPath = fileURLToPath(new URL("../../../data/optimization-memories.jsonl", import.meta.url));

async function loadScenarios(): Promise<Scenario[]> {
  return JSON.parse(await readFile(scenariosPath, "utf8")) as Scenario[];
}

async function loadMemories(): Promise<OptimizationMemory[]> {
  return (await readFile(memoriesPath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OptimizationMemory);
}

function violated(metrics: Metrics, constraints: Scenario["constraints"]): string[] {
  const failures: string[] = [];
  if (metrics.p99_latency_ms > constraints.max_p99_latency_ms) failures.push("p99_latency_ms");
  if (metrics.error_rate_pct > constraints.max_error_rate_pct) failures.push("error_rate_pct");
  if (metrics.quality_score < constraints.min_quality_score) failures.push("quality_score");
  if (metrics.hourly_cost_usd > constraints.max_hourly_cost_usd) failures.push("hourly_cost_usd");
  return failures;
}

function escape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 200);
}

export const getIncident = createTool({
  id: "get-incident",
  description: "Load one synthetic AdTech incident and identify its currently violated constraints.",
  inputSchema: z.object({ scenarioId: z.string() }),
  execute: async ({ scenarioId }) => {
    const scenario = (await loadScenarios()).find((item) => item.scenario_id === scenarioId);
    if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
    const observed = scenario.current_metrics ?? scenario.canary_metrics;
    return { scenario, violatedConstraints: observed ? violated(observed, scenario.constraints) : [] };
  },
});

export const recallOptimizationMemories = createTool({
  id: "recall-optimization-memories",
  description: "Retrieve detailed prior optimization outcomes with keyword-heavy hybrid search and time decay.",
  inputSchema: z.object({
    workloadType: z.string(),
    trafficPattern: z.string(),
    query: z.string(),
    limit: z.number().min(2).max(10).default(5),
  }),
  execute: async ({ workloadType, trafficPattern, query: inputQuery, limit }) => {
    const q = escape(inputQuery);
    const workload = escape(workloadType);
    const pattern = escape(trafficPattern);
    const query = `
FROM ${INDEX} METADATA _id, _index, _score
| FORK (
    WHERE workload_type == "${workload}" AND traffic_pattern == "${pattern}"
      AND search_text:"${q}"
    | SORT _score DESC | LIMIT 50
) (
    WHERE workload_type == "${workload}" AND traffic_pattern == "${pattern}" AND search_text:"${q}"
    | SORT _score DESC | LIMIT 50
)
| FUSE LINEAR WITH { "weights": { "fork1": ${BM25_WEIGHT}, "fork2": ${SEMANTIC_WEIGHT} }, "normalizer": "minmax" }
| EVAL final_score = _score * DECAY(recorded_at, NOW(), ${DECAY_DAYS * 24} hours)
| SORT final_score DESC
| LIMIT ${limit}
| KEEP memory_id, recorded_at, supersedes_memory_id, final_score
`.trim();
    const result = await es.esql.query({ query, format: "json" });
    const names = result.columns.map((column: { name: string }) => column.name);
    const at = (name: string) => names.indexOf(name);
    const rows = result.values as unknown[][];
    const ids = rows.map((row) => String(row[at("memory_id")]));
    const documents = await es.mget<{ memory: OptimizationMemory }>({ index: INDEX, ids });
    const byId = new Map(documents.docs.flatMap((document) =>
      "found" in document && document.found && document._source?.memory
        ? [[String(document._id), document._source.memory] as const]
        : []
    ));
    const memories = rows.map((row, index) => {
      const id = String(row[at("memory_id")]);
      const memory = byId.get(id);
      if (!memory) throw new Error(`Memory source missing for ${id}`);
      return {
        memory_id: id,
        recorded_at: String(row[at("recorded_at")]),
        supersedes_memory_id: row[at("supersedes_memory_id")] ? String(row[at("supersedes_memory_id")]) : undefined,
        score: Number(row[at("final_score")]),
        rank: index + 1,
        workload_match: memory.workload,
        action: memory.action,
        canary_result: memory.canary_result,
        outcome: memory.outcome,
        rationale: memory.rationale,
      };
    });
    return { tuning: { decayDays: DECAY_DAYS, bm25Weight: BM25_WEIGHT, semanticWeight: SEMANTIC_WEIGHT }, memories };
  },
});

export const runCanary = createTool({
  id: "run-canary",
  description: "Run an approved, deterministic 10% synthetic canary using a selected historical memory.",
  inputSchema: z.object({ scenarioId: z.string(), memoryId: z.string(), approved: z.literal(true) }),
  execute: async ({ scenarioId, memoryId }) => {
    const scenario = (await loadScenarios()).find((item) => item.scenario_id === scenarioId);
    const memory = (await loadMemories()).find((item) => item.memory_id === memoryId);
    if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
    if (!memory) throw new Error(`Unknown memory: ${memoryId}`);
    if (!scenario.relevant_memory_ids.includes(memoryId)) throw new Error(`${memoryId} is not approved evidence for ${scenarioId}`);
    const configuration = scenario.proposed_canary_configuration ?? memory.action.configuration_after;
    const metrics = scenario.canary_metrics ?? memory.canary_result;
    return { scenarioId, memoryId, trafficPct: 10, configuration, metrics, synthetic: true };
  },
});

export const finalizeCanary = createTool({
  id: "finalize-canary",
  description: "Promote a synthetic canary only if every latency, error, quality, and cost constraint passes; otherwise roll it back.",
  inputSchema: z.object({
    scenarioId: z.string(),
    memoryId: z.string(),
    metrics: z.object({
      p99_latency_ms: z.number(), throughput_qps: z.number(), error_rate_pct: z.number(),
      quality_score: z.number(), hourly_cost_usd: z.number(),
    }),
  }),
  execute: async ({ scenarioId, memoryId, metrics }) => {
    const scenario = (await loadScenarios()).find((item) => item.scenario_id === scenarioId);
    if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
    const failedConstraints = violated(metrics, scenario.constraints);
    return {
      scenarioId, memoryId, decision: failedConstraints.length === 0 ? "promote" : "rollback",
      failedConstraints, allConstraintsPassed: failedConstraints.length === 0,
    };
  },
});

export const storeOptimizationMemory = createTool({
  id: "store-optimization-memory",
  description: "Store a completed synthetic optimization outcome. Never call before promote or rollback is known.",
  inputSchema: z.object({
    scenarioId: z.string(), selectedMemoryId: z.string(), decision: z.enum(["promote", "rollback"]),
    rationale: z.string(), metrics: z.record(z.number()),
  }),
  execute: async ({ scenarioId, selectedMemoryId, decision, rationale, metrics }) => {
    const scenario = (await loadScenarios()).find((item) => item.scenario_id === scenarioId);
    if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
    const memoryId = `demo-${scenarioId}-${Date.now()}`;
    const searchText = `${scenario.title}. Selected ${selectedMemoryId}. ${rationale}. Outcome: ${decision}.`;
    await es.index({
      index: INDEX, id: memoryId, refresh: "wait_for",
      document: {
        memory_id: memoryId, recorded_at: new Date().toISOString(), workload_type: scenario.workload.type,
        traffic_pattern: scenario.workload.traffic_pattern, model_name: scenario.workload.model_name,
        outcome: decision === "promote" ? "promoted" : "rolled_back", tags: [scenario.workload.type, scenario.workload.traffic_pattern, decision, "demo-generated"],
        supersedes_memory_id: selectedMemoryId, search_text: searchText,
        memory: { memory_id: memoryId, recorded_at: new Date().toISOString(), workload: scenario.workload,
          constraints: scenario.constraints, action: { summary: rationale, configuration_after: scenario.current_configuration, approval_required: true, canary_traffic_pct: 10 },
          canary_result: { ...metrics, duration_minutes: 5, decision }, outcome: decision === "promote" ? "promoted" : "rolled_back",
          rationale, search_text: searchText, tags: ["demo-generated"], supersedes_memory_id: selectedMemoryId },
      },
    });
    return { memoryId, stored: true };
  },
});
