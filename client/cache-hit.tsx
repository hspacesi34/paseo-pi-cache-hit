import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { readPiCacheHit, type PiCacheHitReport } from "../shared/cache-hit.js";
import { messages } from "./messages.js";

function formatTokenCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

export function cachePillLabel(report: PiCacheHitReport | null) {
  return report?.available && report.percent !== null
    ? messages.message("pillRate", { percent: report.percent.toFixed(1) })
    : messages.message("pillUnavailable");
}

export function cachePillTitle(report: PiCacheHitReport | null, refreshFailed = false) {
  if (refreshFailed) {
    return messages.message(report ? "pillTitleStale" : "pillTitleError");
  }
  if (report === null) return messages.message("pillTitleLoading");
  if (!report.available || report.percent === null) {
    return messages.message("pillTitleUnavailable");
  }
  return messages.message("pillTitleReady", { percent: report.percent.toFixed(1) });
}

export function CacheDetails(props: PluginButtonContentProps) {
  const readReport = useRpc(readPiCacheHit);
  const { t, locale } = useTranslation(messages);
  const agentId = "agentId" in props ? props.agentId : null;
  const { theme, layout } = props;
  const [report, setReport] = useState<PiCacheHitReport | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!agentId) {
      setReport(null);
      setLoadError(false);
      return;
    }

    let active = true;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await readReport({ agentId });
        if (active) {
          setReport(result);
          setLoadError(false);
        }
      } catch {
        if (active) setLoadError(true);
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

  const rate = report?.available && report.percent !== null ? report.percent : null;
  const statusText = loadError
    ? t("readError")
    : report === null
      ? t("loading")
      : t("unavailable");
  return (
    <View
      style={{
        gap: layout.compact ? 8 : 10,
        minWidth: layout.compact ? undefined : 240,
        maxWidth: layout.compact ? undefined : 360,
      }}
    >
      <Text
        accessibilityLanguage={locale}
        style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "600" }}
      >
        {rate !== null
          ? t("pillRate", { percent: rate.toFixed(1) })
          : t("pillUnavailable")}
      </Text>
      {rate !== null && report?.available ? (
        <>
          <Text accessibilityLanguage={locale} style={{ color: theme.colors.foregroundMuted }}>
            {t("cacheRead", { tokens: formatTokenCount(report.cacheReadTokens ?? 0, locale) })}
          </Text>
          <Text accessibilityLanguage={locale} style={{ color: theme.colors.foregroundMuted }}>
            {t("input", { tokens: formatTokenCount(report.inputTokens ?? 0, locale) })}
          </Text>
          <Text accessibilityLanguage={locale} style={{ color: theme.colors.foregroundMuted }}>
            {t("cacheWrite", { tokens: formatTokenCount(report.cacheWriteTokens ?? 0, locale) })}
          </Text>
          <Text accessibilityLanguage={locale} style={{ color: theme.colors.foregroundMuted }}>
            {t("description")}
          </Text>
          <Text
            accessibilityLanguage={locale}
            style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
          >
            {t("rounding")}
          </Text>
          {loadError ? (
            <Text accessibilityLanguage={locale} style={{ color: theme.colors.statusWarning }}>
              {t("readError")}
            </Text>
          ) : null}
        </>
      ) : (
        <Text
          accessibilityLanguage={locale}
          style={{
            color: loadError ? theme.colors.statusWarning : theme.colors.foregroundMuted,
          }}
        >
          {statusText}
        </Text>
      )}
    </View>
  );
}
