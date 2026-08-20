import { Client } from "@elastic/elasticsearch";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { OptimizationMemory } from "./mastra/adtech-types";
import "dotenv/config";

export const OPTIMIZATION_INDEX = "adtech-optimization-memory";

const es = new Client({
  node: process.env.ELASTICSEARCH_URL!,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY! },
});

async function ensureIndex() {
  if (await es.indices.exists({ index: OPTIMIZATION_INDEX })) return;
  const semantic = process.env.INFERENCE_ID
    ? { type: "semantic_text" as const, inference_id: process.env.INFERENCE_ID }
    : { type: "semantic_text" as const };
  await es.indices.create({
    index: OPTIMIZATION_INDEX,
    mappings: {
      properties: {
        memory_id: { type: "keyword" },
        recorded_at: { type: "date" },
        workload_type: { type: "keyword" },
        traffic_pattern: { type: "keyword" },
        model_name: { type: "keyword" },
        outcome: { type: "keyword" },
        tags: { type: "keyword" },
        supersedes_memory_id: { type: "keyword" },
        search_text: semantic,
        memory: { type: "object", enabled: false },
      },
    },
  });
}

async function main() {
  await ensureIndex();
  const path = fileURLToPath(new URL("../data/optimization-memories.jsonl", import.meta.url));
  const memories = (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OptimizationMemory);

  const operations = memories.flatMap((memory) => [
    { index: { _index: OPTIMIZATION_INDEX, _id: memory.memory_id } },
    {
      memory_id: memory.memory_id,
      recorded_at: memory.recorded_at,
      workload_type: memory.workload.type,
      traffic_pattern: memory.workload.traffic_pattern,
      model_name: memory.workload.model_name,
      outcome: memory.outcome,
      tags: memory.tags,
      supersedes_memory_id: memory.supersedes_memory_id,
      search_text: memory.search_text,
      memory,
    },
  ]);
  const result = await es.bulk({ operations, refresh: true });
  if (result.errors) throw new Error("One or more optimization memories failed to ingest");
  const count = await es.count({ index: OPTIMIZATION_INDEX });
  console.log(`Upserted ${memories.length} memories; index contains ${count.count} documents.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
