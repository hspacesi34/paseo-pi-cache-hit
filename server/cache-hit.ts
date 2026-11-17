import { Buffer } from "node:buffer";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { readPiCacheHit, type PiCacheHitReport } from "../shared/cache-hit.js";

type SessionUsage = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  percent: number;
  timestamp: string | null;
};

type SessionAccumulator = {
  size: number;
  mtimeMs: number;
  dev: number;
  ino: number;
  offset: number;
  pending: string;
  latestAssistant: SessionUsage | null;
  totalCacheRead: number;
  totalCacheWrite: number;
};

const sessionCache = new Map<string, SessionAccumulator>();

function emptyReport(): PiCacheHitReport {
  return {
    available: false,
    percent: null,
    inputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    assistantMessageAt: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function addCacheTotals(state: SessionAccumulator, usageValue: unknown) {
  const usage = asRecord(usageValue);
  if (!usage) return;
  state.totalCacheRead += nonNegativeNumber(usage.cacheRead) ?? 0;
  state.totalCacheWrite += nonNegativeNumber(usage.cacheWrite) ?? 0;
}

function processEntry(line: string, state: SessionAccumulator) {
  if (!line) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }

  const entry = asRecord(parsed);
  if (!entry) return;

  if (entry.type === "usage") {
    addCacheTotals(state, entry.usage);
    return;
  }

  if (entry.type === "message") {
    const message = asRecord(entry.message);
    if (!message) return;

    if (message.role === "assistant") {
      const usage = asRecord(message.usage);
      addCacheTotals(state, usage);
      const input = nonNegativeNumber(usage?.input);
      const cacheRead = nonNegativeNumber(usage?.cacheRead);
      const cacheWrite = nonNegativeNumber(usage?.cacheWrite);
      if (input === null || cacheRead === null || cacheWrite === null) {
        state.latestAssistant = null;
        return;
      }

      const totalPromptTokens = input + cacheRead + cacheWrite;
      const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : null;
      state.latestAssistant =
        totalPromptTokens > 0
          ? {
              input,
              cacheRead,
              cacheWrite,
              percent: (cacheRead / totalPromptTokens) * 100,
              timestamp,
            }
          : null;
      return;
    }

    if (message.role === "toolResult") addCacheTotals(state, message.usage);
    return;
  }

  if (entry.type === "branch_summary" || entry.type === "compaction") {
    addCacheTotals(state, entry.usage);
  }
}

function newAccumulator(): SessionAccumulator {
  return {
    size: 0,
    mtimeMs: 0,
    dev: 0,
    ino: 0,
    offset: 0,
    pending: "",
    latestAssistant: null,
    totalCacheRead: 0,
    totalCacheWrite: 0,
  };
}

async function scanSessionFile(filePath: string): Promise<PiCacheHitReport> {
  const fileInfo = await stat(filePath);
  if (!fileInfo.isFile()) return emptyReport();

  const cached = sessionCache.get(filePath);
  if (
    cached &&
    cached.dev === fileInfo.dev &&
    cached.ino === fileInfo.ino &&
    cached.size === fileInfo.size &&
    cached.mtimeMs === fileInfo.mtimeMs
  ) {
    return reportFromAccumulator(cached);
  }

  const canContinueAppend =
    cached !== undefined &&
    cached.dev === fileInfo.dev &&
    cached.ino === fileInfo.ino &&
    fileInfo.size > cached.size;
  const state = canContinueAppend ? cached : newAccumulator();
  const startOffset = state.offset;

  if (fileInfo.size > startOffset) {
    // Re-read any unfinished final line from its byte offset so UTF-8 fragments are not duplicated.
    state.pending = "";
    const stream = createReadStream(filePath, {
      start: startOffset,
      end: fileInfo.size - 1,
      encoding: "utf8",
    });
    for await (const chunk of stream) {
      const text = state.pending + String(chunk);
      const lines = text.split("\n");
      state.pending = lines.pop() ?? "";
      for (const line of lines) processEntry(line, state);
      if (lines.length > 0) {
        state.offset += Buffer.byteLength(`${lines.join("\n")}\n`, "utf8");
      }
    }
  }

  state.size = fileInfo.size;
  state.mtimeMs = fileInfo.mtimeMs;
  state.dev = fileInfo.dev;
  state.ino = fileInfo.ino;
  sessionCache.set(filePath, state);
  return reportFromAccumulator(state);
}

function reportFromAccumulator(state: SessionAccumulator): PiCacheHitReport {
  const latest = state.latestAssistant;
  const hasCacheUsage = state.totalCacheRead > 0 || state.totalCacheWrite > 0;
  if (!latest) return emptyReport();

  return {
    available: hasCacheUsage,
    percent: hasCacheUsage ? latest.percent : null,
    inputTokens: latest.input,
    cacheReadTokens: latest.cacheRead,
    cacheWriteTokens: latest.cacheWrite,
    assistantMessageAt: latest.timestamp,
  };
}

export async function getPiCacheHitReport(
  { agentId }: RpcInput<typeof readPiCacheHit>,
  { paseo }: PluginHandlerContext,
): Promise<PiCacheHitReport> {
  const snapshot = await paseo.agents.ref(agentId).refresh();
  const agent = snapshot?.agent;
  if (!agent || agent.provider !== "pi") return emptyReport();

  const sessionFile = agent.persistence?.nativeHandle;
  if (
    typeof sessionFile !== "string" ||
    !isAbsolute(sessionFile) ||
    !sessionFile.toLowerCase().endsWith(".jsonl")
  ) {
    return emptyReport();
  }

  try {
    return await scanSessionFile(sessionFile);
  } catch {
    return emptyReport();
  }
}
