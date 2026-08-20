/**
 * ingest-markdown.ts - ingest a local folder of dated markdown as memories.
 *
 * Works for ADR folders, cloned PEPs, changelog collections - anything
 * markdown with a discoverable date. Date resolution order:
 *   1. Frontmatter `date:` / `created:` / `Created:` field
 *   2. First `Date: ...` line in the body (PEP headers)
 *   3. File mtime (last resort - warns, since mtime is usually clone time)
 *
 * Good corpora to clone first:
 *   git clone https://github.com/joelparkerhenderson/architecture-decision-record
 *   git clone https://github.com/python/peps   (use --dir peps/peps)
 *
 * Run: npx tsx src/ingest-markdown.ts --dir ./architecture-decision-record --tag adr
 */
import { Client } from "@elastic/elasticsearch";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
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
  console.error(`Missing --${name}. Usage: npx tsx src/ingest-markdown.ts --dir ./corpus [--tag adr] [--max 300]`);
  process.exit(1);
}

const dir = arg("dir");
const tag = arg("tag", "markdown");
const max = Number(arg("max", "300"));

async function* walk(d: string): AsyncGenerator<string> {
  for (const entry of await readdir(d, { withFileTypes: true })) {
    const p = join(d, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") yield* walk(p);
    else if (entry.isFile() && /\.(md|rst|txt)$/i.test(entry.name)) yield p;
  }
}

function extractDate(text: string): string | null {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const m = fm[1].match(/^(?:date|created|Created)\s*:\s*["']?(\d{4}-\d{2}-\d{2})/im);
    if (m) return new Date(m[1]).toISOString();
  }
  const header = text.slice(0, 2000).match(/^Date\s*:\s*(\d{1,2}[- ][A-Za-z]{3}[- ]\d{4}|\d{4}-\d{2}-\d{2})/im);
  if (header) {
    const d = new Date(header[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function extractTitle(text: string, path: string): string {
  const h1 = text.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const fm = text.match(/^---\n[\s\S]*?^title\s*:\s*["']?(.+?)["']?$/im);
  if (fm) return fm[1].trim();
  return basename(path).replace(/\.(md|rst|txt)$/i, "");
}

async function main() {
  const files: string[] = [];
  for await (const f of walk(dir)) {
    files.push(f);
    if (files.length >= max) break;
  }
  console.log(`Found ${files.length} files under ${dir}. Indexing...`);

  let mtimeFallbacks = 0;
  const operations: object[] = [];
  for (const [i, path] of files.entries()) {
    const text = await readFile(path, "utf8");
    let created = extractDate(text);
    if (!created) {
      created = (await stat(path)).mtime.toISOString();
      mtimeFallbacks++;
    }
    const title = extractTitle(text, path).slice(0, 300);
    const content = text.slice(0, 6000);
    const id = `${AGENT_ID}-md-${String(i).padStart(4, "0")}-${basename(path).slice(0, 60)}`;
    operations.push(
      { index: { _index: INDEX, _id: id } },
      {
        memory_id: id,
        agent: AGENT_ID,
        type: "decision",
        title,
        title_semantic: title,
        content,
        content_semantic: content,
        tags: [tag],
        source: `file:${path}`,
        created_at: created,
        updated_at: created,
        access_scope: "shared",
      }
    );
  }

  const BATCH = 50;
  for (let i = 0; i < operations.length; i += BATCH * 2) {
    const slice = operations.slice(i, i + BATCH * 2);
    const result = await es.bulk({ operations: slice, refresh: i + BATCH * 2 >= operations.length });
    if (result.errors) console.error("Some documents failed in batch", i / 2);
    console.log(`Indexed ${Math.min((i + BATCH * 2) / 2, files.length)}/${files.length}`);
  }

  if (mtimeFallbacks > 0) {
    console.warn(
      `WARNING: ${mtimeFallbacks} files had no parseable date and used file mtime - ` +
        `if you just cloned the repo, those timestamps are all "today" and decay will be flat for them.`
    );
  }
  console.log("Done. Reminder: identify your REVERSAL (a superseded decision) before you demo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
