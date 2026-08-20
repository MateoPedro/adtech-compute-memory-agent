/**
 * movie-agents.ts - the three-stage kickoff demo, as three agents.
 *
 * Switch between them in Mastra Studio and ask all three the SAME question:
 *   "Recommend me something to watch tonight."
 *
 *   Stage 0  movie-rec-bare      - no tools. Fluent, generic, ungrounded:
 *                                  can't know the catalog, knows nothing
 *                                  about the user.
 *   Stage 1  movie-rec-catalog   - long-term knowledge: hybrid search over
 *                                  the catalog. Grounded, still impersonal.
 *   Stage 2  movie-rec-personal  - + episodic memory: decay-weighted taste
 *                                  profile and exclusions. Personal.
 *
 * The decay flip: set TASTE_DECAY_DAYS=180, restart, ask Stage 2 again -
 * it recommends rom-coms (stale you). Back to 21 → sci-fi kick (current you).
 */
import { Agent } from "@mastra/core/agent";
import { searchCatalog, getTasteProfile } from "../tools/movie-tools";
import "dotenv/config";

// Mastra's built-in model router: routes through OpenRouter using the
// OPENROUTER_API_KEY from .env - no provider SDK needed.
// maxOutputTokens matters: OpenRouter pre-authorizes the full output budget
// against your credit balance, so an uncapped request 402s on small keys.
const model = [
  {
    model: "openrouter/anthropic/claude-sonnet-4.6",
    modelSettings: { maxOutputTokens: 4096 },
  },
];

// Stage 0 - bare LLM
export const movieRecBare = new Agent({
  id: "movie-rec-bare",
  name: "movie-rec-bare",
  instructions:
    "You are a movie recommendation assistant. Recommend 2-3 movies with one line on why. Be warm and concise.",
  model,
});

// Stage 1 - + long-term knowledge (the catalog)
export const movieRecCatalog = new Agent({
  id: "movie-rec-catalog",
  name: "movie-rec-catalog",
  instructions: `You are a movie recommendation assistant for a streaming catalog.

Rules:
- ONLY recommend movies returned by the search_catalog tool - never from general knowledge. If it's not in the catalog, it doesn't exist for you.
- Translate the user's mood into a good search query (themes, tone, genre words).
- Recommend 2-3 titles with one line each on why, citing genre/director/actors from the results.`,
  model,
  tools: { searchCatalog },
});

// Stage 2 - + episodic memory (taste profile + exclusions)
export const movieRecPersonal = new Agent({
  id: "movie-rec-personal",
  name: "movie-rec-personal",
  instructions: `You are a personal movie recommendation assistant for a streaming catalog.

Process - always in this order:
1. Call get_taste_profile FIRST. Read the genre ranking (it is recency-weighted: recent watches count more) and the recently-watched list.
2. Then call search_catalog with: a query matching the user's request and their current taste, boostGenres set to their top 1-2 genres, and excludeTitles set to ALL recently watched titles.
3. Recommend 2-3 titles. Personalize the framing: reference their recent viewing pattern naturally ("you've been on a sci-fi kick lately"), and never recommend something they just watched.

Rules:
- ONLY recommend movies returned by search_catalog.
- If the user's explicit request conflicts with their taste profile, the explicit request wins - taste is a prior, not a cage.`,
  model,
  tools: { searchCatalog, getTasteProfile },
});
