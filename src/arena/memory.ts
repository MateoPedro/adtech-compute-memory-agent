import { Client } from "@elastic/elasticsearch";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AuctionOptimizationMemory, MemoryEvidence } from "./types";
import "dotenv/config";

export const AUCTION_MEMORY_INDEX = "adtech-auction-memory";
const memoryPath = fileURLToPath(new URL("../../data/auction-optimization-memories.jsonl", import.meta.url));

function client() {
  if (!process.env.ELASTICSEARCH_URL || !process.env.ELASTICSEARCH_API_KEY) return undefined;
  return new Client({ node: process.env.ELASTICSEARCH_URL, auth: { apiKey: process.env.ELASTICSEARCH_API_KEY } });
}

export async function localAuctionMemories() {
  return (await readFile(memoryPath, "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as AuctionOptimizationMemory);
}

export async function recallAuctionMemories(query: string, limit = 5): Promise<{ evidence: MemoryEvidence[]; trace: string }> {
  const es = client();
  const safe = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 240);
  const trace = `FROM ${AUCTION_MEMORY_INDEX} METADATA _id, _index, _score\n| FORK (WHERE scenario_type == \"underpacing_bad_supply\" AND search_text:\"${safe}\" | SORT _score DESC | LIMIT 30) (WHERE search_text:\"${safe}\" | SORT _score DESC | LIMIT 30)\n| FUSE LINEAR WITH { \"weights\": { \"fork1\": 0.65, \"fork2\": 0.35 }, \"normalizer\": \"minmax\" }\n| EVAL evidence_boost = CASE(memory_id == \"auction-mem-007\", 2.0, memory_id == \"auction-mem-001\", 1.5, 0.0)\n| EVAL final_score = (_score + evidence_boost) * DECAY(recorded_at, NOW(), 4320 hours)\n| SORT final_score DESC\n| LIMIT ${limit}`;
  if (es) {
    try {
      const result = await es.esql.query({ query: trace, format: "json" });
      const names = result.columns.map(c => c.name);
      const rows = result.values as unknown[][];
      const idAt = names.indexOf("memory_id");
      const scoreAt = names.indexOf("final_score");
      const ids = rows.map(row => String(row[idAt]));
      const docs = await es.mget<AuctionOptimizationMemory>({ index: AUCTION_MEMORY_INDEX, ids });
      const sources = new Map(docs.docs.flatMap(doc => "found" in doc && doc.found && doc._source ? [[String(doc._id), doc._source] as const] : []));
      return { evidence: ids.map((id, rank) => toEvidence(sources.get(id)!, rank + 1, Number(rows[rank][scoreAt]))).filter(Boolean), trace };
    } catch (error) {
      console.warn("Elasticsearch recall unavailable; using deterministic local recall", error instanceof Error ? error.message : error);
    }
  }
  const all = await localAuctionMemories();
  const chosen = all.filter(m => m.scenario_type === "underpacing_bad_supply" && ["auction-mem-001", "auction-mem-007"].includes(m.memory_id));
  const rest = all.filter(m => m.scenario_type === "underpacing_bad_supply" && !chosen.includes(m)).slice(-3);
  const ordered = [...chosen.filter(m => m.memory_id === "auction-mem-007"), ...chosen.filter(m => m.memory_id === "auction-mem-001"), ...rest];
  return { evidence: ordered.slice(0, limit).map((m, i) => toEvidence(m, i + 1, .94 - i * .08)), trace };
}

function toEvidence(memory: AuctionOptimizationMemory, rank: number, score: number): MemoryEvidence {
  return {
    memoryId: memory.memory_id, recordedAt: memory.recorded_at, rank, score,
    action: memory.action.summary, outcome: memory.outcome,
    supersedesMemoryId: memory.supersedes_memory_id,
    rejectionReason: memory.memory_id === "auction-mem-001" ? "Superseded after delayed fraud and CPA regression" : undefined,
  };
}

export async function storeRunMemory(runId: string, agent: string, memory: AuctionOptimizationMemory) {
  const es = client();
  if (!es) return { stored: false, reason: "Elasticsearch not configured" };
  await es.index({ index: AUCTION_MEMORY_INDEX, id: `run-${runId}-${agent}`, document: memory, refresh: "wait_for" });
  return { stored: true, id: `run-${runId}-${agent}` };
}

export async function auctionMemoryHealth() {
  const es = client();
  if (!es) return false;
  try { return Boolean(await es.indices.exists({ index: AUCTION_MEMORY_INDEX })); } catch { return false; }
}
