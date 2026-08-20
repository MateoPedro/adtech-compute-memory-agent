# Bidstream Arena

A live, synthetic AdTech market where two autonomous Mastra optimizers receive the same OpenRTB-style auctions. One reacts only to current signals; the other uses time-decayed Elasticsearch experiment memory to avoid repeating a known supply-quality failure.

No real bids are submitted and no advertiser money is spent.

**Demo video:** [Watch the 90-second Bidstream Arena demo](https://drive.google.com/file/d/1o-Hb9HMxcVVBpDlrk1ZqeyAOB_4Iueic/view?usp=sharing)

## What the demo shows

- A seeded stream of bid requests, wins, impressions, clicks, conversions, and delayed fraud labels.
- Two isolated campaign environments receiving identical auction opportunities and latent outcomes.
- Three autonomous policy checkpoints in a 60–90 second run.
- Deterministic guardrails around model-proposed bid, pacing, and exchange changes.
- An older experiment (`auction-mem-001`) recommending aggressive bids and broad supply.
- A newer experiment (`auction-mem-007`) superseding it after delayed CPA and invalid-traffic regression.
- Automatic rollback, constraint scoring, a final winner, and idempotent outcome storage.

The original CPU/GPU incident agents remain available in Mastra Studio as a legacy demo.

## Requirements

- Node.js 20.20 or newer
- Elasticsearch Serverless
- OpenRouter API key

Copy `.env.example` to `.env` and provide:

```env
ELASTICSEARCH_URL=
ELASTICSEARCH_API_KEY=
OPENROUTER_API_KEY=
INFERENCE_ID=
ARENA_PORT=4120
NEXT_PUBLIC_ARENA_API=http://localhost:4120
```

`INFERENCE_ID` is optional when the Elasticsearch deployment supplies a default inference endpoint.

## Setup and start

```bash
npm install
npm run ingest:adtech
npm run ingest:auction
npm run dev:arena
```

Ingestion uses stable document IDs and is safe to run repeatedly. Open:

- Arena dashboard: [http://localhost:3001](http://localhost:3001)
- Mastra Studio and traces: [http://localhost:4111](http://localhost:4111)
- Simulator health: [http://localhost:4120/health](http://localhost:4120/health)

The arena falls back to local memory evidence and safe deterministic decisions if Elasticsearch or OpenRouter is temporarily unavailable. Health indicators make that state visible. Full Elasticsearch traces require the configured services.

## 90-second presentation

1. **Set the stakes (10s):** The campaign is underpacing in its best conversion window. Two optimizers receive the exact same auctions.
2. **Launch the market (10s):** Use seed `20260819` and click **Launch live market**.
3. **First checkpoint (20s):** The baseline raises bids and broadens supply. The memory optimizer retrieves `auction-mem-001` and `auction-mem-007`, rejects the stale experiment, and stays on trusted exchanges.
4. **Watch the reversal (25s):** The baseline initially delivers faster. Delayed conversion and fraud signals then expose poor CPA and invalid traffic, triggering an automatic rollback.
5. **Show the verdict (15s):** The memory strategy wins only if delivery, CPA, ROAS, and invalid-traffic constraints pass.
6. **Show the learning loop (10s):** Open Mastra traces, highlight `FORK`, weighted `FUSE`, and `DECAY`, and explain that both completed outcomes are stored with deterministic IDs.

## Commands

```bash
npm run arena             # simulator API only
npm run dashboard         # dashboard only, port 3001
npm run dev               # legacy Mastra Studio only
npm run dev:arena         # all three services
npm run ingest:auction    # idempotently seed 56 auction memories
npm test                  # simulator and guardrail unit tests
npm run check             # backend TypeScript check
npm run build:dashboard   # production dashboard build
```

## Safety model

The language models propose bounded actions. Deterministic application code owns bid-change limits, observation thresholds, spend constraints, cooldown behavior, rollback, scoring, and persistence. Invalid or timed-out agent output becomes a safe fallback policy rather than blocking the live run.

## Legacy Studio demo

The existing **AdTech Optimizer — No Memory** and **AdTech Optimizer — Elasticsearch Memory** agents still support `scenario-peak-latency` and `scenario-canary-regression`. The new Studio agents are **Live Auction Optimizer — No Memory** and **Live Auction Optimizer — Elasticsearch Memory**.
