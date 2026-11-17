import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getPiCacheHitReport } from "./server/cache-hit.js";
import { readPiCacheHit } from "./shared/cache-hit.js";

export default function contribute(server: PluginServerContext) {
  server.handle(readPiCacheHit, getPiCacheHitReport);
  return () => {};
}
