import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recallAuctionMemories } from "../../arena/memory";

export const recallAuctionExperiments = createTool({
  id: "recall-auction-experiments",
  description: "Retrieve prior bidding experiments, including superseded advice and delayed attribution outcomes.",
  inputSchema: z.object({ query: z.string(), limit: z.number().min(2).max(8).default(5) }),
  execute: async ({ query, limit }) => recallAuctionMemories(query, limit),
});
