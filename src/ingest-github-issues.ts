/**
 * ingest-github-issues.ts - ingest a repo's closed issues as memories.
 *
 * Closed issues are dated decisions ("closing, we went with approach B")
 * full of exact identifiers, so this dataset exercises BOTH the decay
 * scoring and the BM25 branch of hybrid recall.
 *
 * Also your BYO-dataset template: swap fetchIssues() for any source,
 * keep the mapping to the agent-memory schema.
 *
 * Run: npx tsx src/ingest-github-issues.ts --repo vercel/next.js --max 150
 * Optional: set GITHUB_TOKEN in .env for higher rate limits.
 */
import { Client } from "@elastic/elasticsearch";
import "dotenv/config";

const es = new Client({
  node: process.env.ELASTICSEARCH_URL!,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY! },
});

const AGENT_ID = process.env.AGENT_ID ?? "mastra-agent";
const INDEX = "agent-memory";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing --${name}. Usage: npx tsx src/ingest-github-issues.ts --repo owner/name [--max 150]`);
  process.exit(1);
}

const repo = arg("repo");
const max = Number(arg("max", "150"));

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
  created_at: string;
  closed_at: string | null;
  pull_request?: unknown;
  html_url: string;
}

async function fetchIssues(): Promise<GhIssue[]> {
  const issues: GhIssue[] = [];
  let page = 1;
  while (issues.length < max) {
    const url = `https://api.github.com/repos/${repo}/issues?state=closed&per_page=100&page=${page}&sort=created&direction=desc`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = (await res.json()) as GhIssue[];
    if (batch.length === 0) break;
    // Skip PRs - the issues endpoint includes them.
    issues.push(...batch.filter((i) => !i.pull_request));
    page++;
  }
  return issues.slice(0, max);
}

async function main() {
  console.log(`Fetching up to ${max} closed issues from ${repo}...`);
  const issues = await fetchIssues();
  console.log(`Got ${issues.length} issues. Indexing...`);

  const operations = issues.flatMap((issue) => {
    const created = issue.closed_at ?? issue.created_at; // use resolution date - that's when the "decision" happened
    const content = [
      `Issue #${issue.number} in ${repo}: ${issue.title}`,
      (issue.body ?? "").slice(0, 4000),
      `URL: ${issue.html_url}`,
    ].join("\n\n");
    const id = `${AGENT_ID}-gh-${repo.replace("/", "-")}-${issue.number}`;
    return [
      { index: { _index: INDEX, _id: id } },
      {
        memory_id: id,
        agent: AGENT_ID,
        type: "context",
        title: `#${issue.number}: ${issue.title}`.slice(0, 300),
        title_semantic: issue.title.slice(0, 300),
        content,
        content_semantic: content,
        tags: issue.labels.map((l) => l.name).slice(0, 10),
        source: `github:${repo}`,
        created_at: created,
        updated_at: created,
        access_scope: "shared",
      },
    ];
  });

  // Batch bulk requests - semantic_text inference makes large bulks slow.
  const BATCH = 50; // docs per bulk request
  for (let i = 0; i < operations.length; i += BATCH * 2) {
    const slice = operations.slice(i, i + BATCH * 2);
    const result = await es.bulk({ operations: slice, refresh: i + BATCH * 2 >= operations.length });
    if (result.errors) {
      console.error("Some documents failed in batch", i / 2, JSON.stringify(result.items.filter((x: any) => x.index?.error).slice(0, 3), null, 2));
    }
    console.log(`Indexed ${Math.min((i + BATCH * 2) / 2, issues.length)}/${issues.length}`);
  }

  console.log(`Done. Timestamps span ${issues.at(-1)?.closed_at ?? "?"} → ${issues[0]?.closed_at ?? "?"}.`);
  console.log("Reminder: find your REVERSAL - an issue whose resolution superseded an earlier one - before you demo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
