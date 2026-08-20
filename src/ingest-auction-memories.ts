import { Client } from "@elastic/elasticsearch";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AUCTION_MEMORY_INDEX } from "./arena/memory";
import type { AuctionOptimizationMemory } from "./arena/types";
import "dotenv/config";

const es = new Client({ node: process.env.ELASTICSEARCH_URL!, auth: { apiKey: process.env.ELASTICSEARCH_API_KEY! } });

async function ensureIndex() {
  if (await es.indices.exists({ index: AUCTION_MEMORY_INDEX })) return;
  const searchText = process.env.INFERENCE_ID ? { type: "semantic_text" as const, inference_id: process.env.INFERENCE_ID } : { type: "semantic_text" as const };
  await es.indices.create({ index: AUCTION_MEMORY_INDEX, mappings: { properties: {
    memory_id: { type: "keyword" }, recorded_at: { type: "date" }, scenario_type: { type: "keyword" },
    traffic_pattern: { type: "keyword" }, outcome: { type: "keyword" }, confidence: { type: "float" },
    tags: { type: "keyword" }, supersedes_memory_id: { type: "keyword" }, search_text: searchText,
    action: { properties: { summary: { type: "text" }, bid_multiplier: { type: "float" }, pacing_multiplier: { type: "float" }, exchanges: { type: "keyword" } } },
    metrics_before: { type: "object", enabled: false }, metrics_after: { type: "object", enabled: false }, rationale: { type: "text" },
  } } });
}

async function main() {
  await ensureIndex();
  const path = fileURLToPath(new URL("../data/auction-optimization-memories.jsonl", import.meta.url));
  const memories = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as AuctionOptimizationMemory);
  const operations = memories.flatMap(memory => [{ index: { _index: AUCTION_MEMORY_INDEX, _id: memory.memory_id } }, memory]);
  const result = await es.bulk({ operations, refresh: true });
  if (result.errors) throw new Error("One or more auction memories failed to ingest");
  const count = await es.count({ index: AUCTION_MEMORY_INDEX });
  console.log(`Upserted ${memories.length} auction memories; index contains ${count.count} documents.`);
}
main().catch(error => { console.error(error); process.exit(1); });
