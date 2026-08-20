import { createServer } from "node:http";
import { URL } from "node:url";
import { ArenaManager } from "./simulator";
import { auctionMemoryHealth } from "./memory";
import "dotenv/config";

const manager = new ArenaManager();
const port = Number(process.env.ARENA_PORT ?? 4120);
const mastraUrl = process.env.MASTRA_URL ?? "http://localhost:4111";
const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,last-event-id", "access-control-allow-methods": "GET,POST,OPTIONS" };
const json = (res: any, status: number, value: unknown) => { res.writeHead(status, { ...headers, "content-type": "application/json" }); res.end(JSON.stringify(value)); };
const body = async (req: any) => { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; };

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`); const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (url.pathname === "/health") {
      let mastra = false; try { mastra = (await fetch(`${mastraUrl}/api/agents`, { signal: AbortSignal.timeout(1500) })).ok; } catch {}
      return json(res, 200, { simulator: true, mastra, elasticsearch: await auctionMemoryHealth(), model: Boolean(process.env.OPENROUTER_API_KEY) });
    }
    if (req.method === "POST" && url.pathname === "/api/runs") { const input = await body(req); return json(res, 201, manager.create(Number(input.seed ?? 20260819))); }
    if (req.method === "GET" && url.pathname === "/api/runs") return json(res, 200, manager.list());
    if (parts[0] === "api" && parts[1] === "runs" && parts[2]) {
      const id = parts[2];
      if (req.method === "GET" && parts.length === 3) { const run = manager.snapshot(id); return run ? json(res, 200, run) : json(res, 404, { error: "Run not found" }); }
      if (req.method === "POST" && parts[3] === "control") { const input = await body(req); const run = manager.control(id, input.action); return run ? json(res, 200, run) : json(res, 404, { error: "Run not found" }); }
      if (req.method === "GET" && parts[3] === "events") {
        res.writeHead(200, { ...headers, "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        const after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
        const unsubscribe = manager.subscribe(id, event => res.write(`id: ${event.sequence}\nevent: arena\ndata: ${JSON.stringify(event)}\n\n`), after);
        if (!unsubscribe) return res.end(); const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
        req.on("close", () => { clearInterval(heartbeat); unsubscribe(); }); return;
      }
    }
    json(res, 404, { error: "Not found" });
  } catch (error) { json(res, 500, { error: error instanceof Error ? error.message : String(error) }); }
}).listen(port, () => console.log(`Auction arena API listening on http://localhost:${port}`));
