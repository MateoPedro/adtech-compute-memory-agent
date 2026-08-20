# AdTech Compute Memory Agent

A Mastra agent that uses time-decayed episodic memory in Elasticsearch to safely optimize synthetic CPU/GPU advertising workloads.

## What the demo proves

The same incident is sent to two agents in Mastra Studio:

- **AdTech Optimizer — No Memory** makes a reasonable but ungrounded hypothesis.
- **AdTech Optimizer — Elasticsearch Memory** retrieves prior experiments with ES|QL `FORK`, `FUSE LINEAR`, and `DECAY`; recognizes that `mem-007` supersedes `mem-001`; proposes a 10% canary; waits for approval; evaluates every constraint; then promotes or rolls back and stores the result.

Everything that changes infrastructure is explicitly synthetic.

## Setup

Requires Node 20.20+, Elasticsearch Serverless, and an OpenRouter key.

```bash
cp .env.example .env
npm install
npm run ingest:adtech
npm run dev
```

Ingestion uses stable Elasticsearch IDs and is safe to run repeatedly.

## Primary demo

Select **AdTech Optimizer — No Memory** and send:

> Investigate `scenario-peak-latency`. Recommend the safest configuration change and explain your evidence.

It identifies the 29 ms p99 breach but discloses that its recommendation has no historical evidence.

Send the identical prompt to **AdTech Optimizer — Elasticsearch Memory**. The trace should show `get-incident`, `recall-optimization-memories`, and a proposal selecting `mem-007` over stale `mem-001`. The agent must stop for approval.

Then send:

> I explicitly approve this synthetic 10% canary. Run it, enforce every constraint, and store the completed outcome.

The trace should show `run-canary`, `finalize-canary`, and `store-optimization-memory`. The chosen 35% GPU, batch-16 configuration reaches 15 ms p99 while preserving quality and budget, so it is promoted.

## Safety backup

Ask the memory agent to investigate `scenario-canary-regression`. After approval, it must roll back: latency improves to 17 ms, but quality falls to 0.91 against the required 0.94 minimum.

## 90-second presentation

1. **Problem (10s):** AdTech loses revenue when bids miss latency deadlines, but blindly adding GPUs wastes money.
2. **Without memory (15s):** Show the baseline agent's unsupported hypothesis.
3. **With memory (30s):** Show the same prompt retrieving `mem-001` and `mem-007`; point out `FORK`, weighted `FUSE`, `DECAY`, and explicit supersession.
4. **Controlled action (25s):** Approve the canary and show constraint evaluation and promotion.
5. **Learning loop (10s):** Show the newly stored memory and explain that the next incident benefits.

## Tuning

- `ADTECH_MEMORY_DECAY_DAYS` controls recency decay (default `180`, tuned for the fixed-date demo dataset).
- `ADTECH_BM25_WEIGHT` controls exact operational matching (default `0.65`).

The original starter examples remain under `src/`, but only the two AdTech agents are registered in Studio.
