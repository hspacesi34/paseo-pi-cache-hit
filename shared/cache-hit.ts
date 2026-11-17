import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const piCacheHitReportSchema = z
  .object({
    available: z.boolean(),
    percent: z.number().min(0).max(100).nullable(),
    inputTokens: z.number().nonnegative().nullable(),
    cacheReadTokens: z.number().nonnegative().nullable(),
    cacheWriteTokens: z.number().nonnegative().nullable(),
    assistantMessageAt: z.string().nullable(),
  })
  .strict();

export type PiCacheHitReport = z.infer<typeof piCacheHitReportSchema>;

export const readPiCacheHit = defineRpc({
  name: "pi-cache-hit.read-latest",
  input: z.object({ agentId: z.string().min(1) }).strict(),
  output: piCacheHitReportSchema,
});
