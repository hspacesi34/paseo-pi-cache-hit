import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { readPiCacheHit, type PiCacheHitReport } from "../shared/cache-hit.js";

const tokenFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export function formatTokenCount(value: number): string {
  return tokenFormatter.format(value);
}

export function cachePillLabel(report: PiCacheHitReport | null): string {
  return report?.available && report.percent !== null ? `CH${report.percent.toFixed(1)}%` : "CH—";
}

export function cachePillTitle(report: PiCacheHitReport | null): string {
  if (!report?.available || report.percent === null) {
    return "Cache hit Pi indisponible : attente d’un message assistant avec des compteurs de cache.";
  }

  return `CH${report.percent.toFixed(1)}% sur le dernier message assistant (Cache Read ${formatTokenCount(report.cacheReadTokens ?? 0)} / Input ${formatTokenCount(report.inputTokens ?? 0)} + Cache Read ${formatTokenCount(report.cacheReadTokens ?? 0)} + Cache Write ${formatTokenCount(report.cacheWriteTokens ?? 0)}).`;
}

export function CacheDetails(props: PluginButtonContentProps) {
  const readReport = useRpc(readPiCacheHit);
  const agentId = "agentId" in props ? props.agentId : null;
  const { theme } = props;
  const [report, setReport] = useState<PiCacheHitReport | null>(null);

  useEffect(() => {
    if (!agentId) {
      setReport(null);
      return;
    }

    let active = true;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await readReport({ agentId });
        if (active) setReport(result);
      } catch {
        if (active) setReport(null);
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 2_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [agentId, readReport]);

  return (
    <View style={{ gap: 8, minWidth: 240 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "600" }}>
        {report?.available && report.percent !== null
          ? `CH${report.percent.toFixed(1)}%`
          : "En attente des statistiques Pi"}
      </Text>
      {report?.available ? (
        <>
          <Text style={{ color: theme.colors.foregroundMuted }}>
            Cache Read : {formatTokenCount(report.cacheReadTokens ?? 0)} tokens
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted }}>
            Input : {formatTokenCount(report.inputTokens ?? 0)} tokens
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted }}>
            Cache Write : {formatTokenCount(report.cacheWriteTokens ?? 0)} tokens
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted }}>
            Comme dans le footer Pi : Cache Read ÷ (Input + Cache Read + Cache Write), pour le dernier
            message assistant.
          </Text>
        </>
      ) : (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          Pi n’a pas encore fourni de réponse avec des compteurs de cache pour cette session.
        </Text>
      )}
    </View>
  );
}
