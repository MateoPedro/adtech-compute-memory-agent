/**
 * seed-memories.ts - the "Nimbus" synthetic decision log.
 *
 * Seeds ~12 months of a fictional project's memories with PLANTED REVERSALS,
 * backdated relative to *today* so the decay demo works whenever you run it.
 *
 * Planted reversals (superseded → current):
 *   1. Datastore:  Postgres (~10 months ago, rationale-rich)  → DynamoDB (~3 weeks ago)
 *   2. Embeddings: OpenAI ada-002 (~9 months ago)             → Jina v5 (~2 months ago)
 *   3. Deploys:    Heroku (~11 months ago)                    → Fly.io (~6 weeks ago)
 *
 * The old decisions are deliberately LONGER and more detailed than the
 * reversals - that's what makes pure semantic recall rank them higher,
 * which is the failure the kickoff demo shows.
 *
 * Run: npx tsx src/seed-memories.ts
 */
import { Client } from "@elastic/elasticsearch";
import "dotenv/config";

const es = new Client({
  node: process.env.ELASTICSEARCH_URL!,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY! },
});

const AGENT_ID = process.env.AGENT_ID ?? "mastra-agent";
const INDEX = "agent-memory";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

type Mem = {
  type: "decision" | "pattern" | "context" | "feedback";
  title: string;
  content: string;
  tags: string[];
  ageDays: number;
};

const memories: Mem[] = [
  // ---- REVERSAL 1: datastore (the kickoff demo pair) ----
  {
    type: "decision",
    title: "Postgres as the primary datastore",
    content:
      "After evaluating Postgres, MySQL, and MongoDB for the Nimbus platform, we chose PostgreSQL " +
      "as our primary datastore. Rationale: strong relational integrity for the billing and accounts " +
      "domain, mature migration tooling (we standardized on sqitch), rich indexing including GIN for " +
      "our JSONB columns, and the team's deep operational experience running Postgres in production. " +
      "We benchmarked the order-history workload at 4x our projected peak with p99 under 12ms. All new " +
      "services should provision a Postgres schema via the platform Terraform module. Connection pooling " +
      "through pgbouncer is mandatory for anything above 20 connections.",
    tags: ["database", "postgres", "architecture"],
    ageDays: 305,
  },
  {
    type: "decision",
    title: "Migrate primary datastore to DynamoDB - Postgres decision superseded",
    content:
      "The multi-region expansion made single-writer Postgres a bottleneck. We are migrating the primary " +
      "datastore to DynamoDB. The March Postgres decision is superseded. New services must use DynamoDB " +
      "via the platform data layer; remaining Postgres schemas are migration-frozen.",
    tags: ["database", "dynamodb", "architecture", "supersedes"],
    ageDays: 22,
  },

  // ---- REVERSAL 2: embeddings ----
  {
    type: "decision",
    title: "OpenAI text-embedding-ada-002 for all embedding inference",
    content:
      "For semantic search across Nimbus docs and tickets we selected OpenAI's text-embedding-ada-002. " +
      "Rationale: best price/quality at evaluation time, simple API, 1536 dimensions fits our index " +
      "budget, and latency from us-east-1 averaged 80ms. We wrote a batching wrapper (lib/embed.ts) " +
      "that all services must use - do not call the embeddings API directly. Recall@10 on our internal " +
      "eval set was 0.83, beating the sentence-transformers baseline by 9 points.",
    tags: ["embeddings", "ml", "search", "openai"],
    ageDays: 270,
  },
  {
    type: "decision",
    title: "Switch embeddings to Jina v5 via Elastic Inference Service - ada-002 superseded",
    content:
      "Moving to Elasticsearch Serverless gives us Jina v5 embeddings server-side through semantic_text, " +
      "removing the client-side embedding pipeline entirely. The ada-002 decision is superseded; " +
      "lib/embed.ts is deprecated and will be deleted next quarter.",
    tags: ["embeddings", "ml", "search", "jina", "supersedes"],
    ageDays: 60,
  },

  // ---- REVERSAL 3: deploy platform ----
  {
    type: "decision",
    title: "Heroku as the deployment platform",
    content:
      "We chose Heroku for all Nimbus service deployments. Rationale: the team is three engineers, we " +
      "cannot afford Kubernetes operational overhead, review apps give us per-PR environments for free, " +
      "and the buildpack workflow matches our Node monorepo. Pipelines are configured staging→production " +
      "with manual promotion. Every service ships a Procfile and an app.json. Estimated cost at current " +
      "scale is $340/month, well under the infra budget.",
    tags: ["deploy", "infrastructure", "heroku"],
    ageDays: 330,
  },
  {
    type: "decision",
    title: "Move deployments to Fly.io - Heroku decision superseded",
    content:
      "Heroku costs crossed $2k/month at scale and we need edge regions for latency. Deployments move to " +
      "Fly.io with per-PR machines replacing review apps. The Heroku decision is superseded; migrate " +
      "services as they next release.",
    tags: ["deploy", "infrastructure", "fly", "supersedes"],
    ageDays: 42,
  },

  // ---- Non-reversed decisions, patterns, context, blockers (temporal filler with real spread) ----
  {
    type: "decision",
    title: "TypeScript strict mode required in all packages",
    content:
      "All packages in the monorepo must enable strict:true. Existing violations are grandfathered " +
      "behind ts-expect-error with a linked ticket. No new suppressions without review.",
    tags: ["typescript", "standards"],
    ageDays: 290,
  },
  {
    type: "pattern",
    title: "Retry with jitter for all external API calls",
    content:
      "Standard pattern: exponential backoff with full jitter, max 5 attempts, budget-capped at 30s " +
      "total. Implemented in lib/retry.ts. Applies to payment provider, email, and geocoding calls.",
    tags: ["reliability", "pattern"],
    ageDays: 240,
  },
  {
    type: "context",
    title: "Task nimbus-task-20250913-billing-blocker: billing migration blocked",
    content:
      "Billing ledger migration is blocked on the payments provider's sandbox outage. Tracking as " +
      "nimbus-task-20250913-billing-blocker. Owner: Dana. Revisit after provider status is green for 7 days.",
    tags: ["blocker", "billing"],
    ageDays: 200,
  },
  {
    type: "feedback",
    title: "Weekly summary agents too verbose",
    content:
      "Team feedback: the Friday summary agent output is too long. Keep summaries under 10 bullets " +
      "and lead with decisions made, not activity logs.",
    tags: ["agents", "feedback"],
    ageDays: 150,
  },
  {
    type: "decision",
    title: "Feature flags via config service, not env vars",
    content:
      "All feature gating goes through the config service with 60s TTL caching. Env-var flags are " +
      "banned outside local development because they require redeploys to change.",
    tags: ["standards", "config"],
    ageDays: 120,
  },
  {
    type: "pattern",
    title: "Idempotency keys on every mutating endpoint",
    content:
      "Every POST/PUT that creates or mutates billing state requires an Idempotency-Key header, " +
      "stored 24h in the dedupe table. Pattern implemented in middleware/idempotency.ts.",
    tags: ["reliability", "billing", "pattern"],
    ageDays: 95,
  },
  {
    type: "context",
    title: "Task nimbus-task-20260610-search-quality: search relevance review",
    content:
      "Quarterly search relevance review scheduled. Known issue: exact SKU lookups underperforming " +
      "semantic matches. Tracking as nimbus-task-20260610-search-quality. Owner: Priya.",
    tags: ["search", "quality"],
    ageDays: 68,
  },
  {
    type: "decision",
    title: "On-call rotation moves to weekly with Thursday handoff",
    content:
      "On-call shifts change from biweekly to weekly, handoff Thursdays 10am with a written handoff " +
      "note generated from the incident log.",
    tags: ["oncall", "process"],
    ageDays: 35,
  },
  {
    type: "context",
    title: "DynamoDB migration wave 1 complete",
    content:
      "Accounts and sessions services are now on DynamoDB. Wave 2 (billing ledger) starts next sprint, " +
      "pending resolution of nimbus-task-20250913-billing-blocker.",
    tags: ["database", "dynamodb", "migration"],
    ageDays: 9,
  },
  {
    type: "feedback",
    title: "Fly.io per-PR machines praised in retro",
    content:
      "Retro feedback: per-PR machines on Fly.io cut review turnaround roughly in half versus the old " +
      "Heroku review apps. Keep the pattern for all new services.",
    tags: ["deploy", "fly", "feedback"],
    ageDays: 5,
  },
];

async function main() {
  const now = new Date().toISOString();
  const operations = memories.flatMap((m, i) => {
    const created = daysAgo(m.ageDays);
    const id = `${AGENT_ID}-seed-${String(i).padStart(3, "0")}`;
    return [
      { index: { _index: INDEX, _id: id } },
      {
        memory_id: id,
        agent: AGENT_ID,
        type: m.type,
        title: m.title,
        title_semantic: m.title,
        content: m.content,
        content_semantic: m.content,
        tags: m.tags,
        source: "seed",
        created_at: created,
        updated_at: created,
        access_scope: "shared",
      },
    ];
  });

  const result = await es.bulk({ operations, refresh: true });
  if (result.errors) {
    console.error("Some documents failed:", JSON.stringify(result.items.filter((i: any) => i.index?.error), null, 2));
    process.exit(1);
  }
  console.log(`Seeded ${memories.length} Nimbus memories (backdated up to 330 days, as of ${now}).`);
  console.log("Planted reversals: datastore (Postgres→DynamoDB), embeddings (ada-002→Jina v5), deploys (Heroku→Fly.io).");
  console.log('Try: recall("what did we decide about our primary datastore")');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
