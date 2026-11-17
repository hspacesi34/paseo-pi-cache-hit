import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import {
  CacheDetails,
  cachePillLabel,
  cachePillTitle,
} from "./client/cache-hit.js";
import { readPiCacheHit, type PiCacheHitReport } from "./shared/cache-hit.js";

type AgentEntry = {
  id: string;
  provider: string;
  workspaceId?: string | null;
  status?: string;
};

type PillEntry = {
  workspaceId: string;
  registration: PluginButtonRegistration;
  label: string;
  title: string;
  running: boolean;
};

export default function contribute(client: PluginClientContext) {
  const pills = new Map<string, PillEntry>();
  const inFlight = new Set<string>();
  const loggedFailures = new Set<string>();
  const lifetime = new AbortController();
  let directorySubscription: Awaited<ReturnType<typeof client.paseo.agents.list>>["subscription"];
  let stopUpdates: (() => void) | undefined;

  function removePill(agentId: string) {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  }

  function removeAllPills() {
    for (const entry of pills.values()) entry.registration.remove();
    pills.clear();
  }

  function publishReport(agentId: string, report: PiCacheHitReport) {
    const entry = pills.get(agentId);
    if (!entry) return;
    const label = cachePillLabel(report);
    const title = cachePillTitle(report);
    if (entry.label === label && entry.title === title) return;
    entry.registration.update({ label, title });
    entry.label = label;
    entry.title = title;
  }

  async function refreshMetric(agentId: string) {
    const entry = pills.get(agentId);
    if (!entry || inFlight.has(agentId) || lifetime.signal.aborted) return;
    inFlight.add(agentId);
    try {
      const report = await client.rpc(readPiCacheHit, { agentId });
      if (pills.get(agentId) !== entry || lifetime.signal.aborted) return;
      loggedFailures.delete(agentId);
      publishReport(agentId, report);
    } catch (error) {
      if (!lifetime.signal.aborted && !loggedFailures.has(agentId)) {
        console.error("Pi cache-hit read failed", error);
        loggedFailures.add(agentId);
      }
    } finally {
      inFlight.delete(agentId);
    }
  }

  function syncAgent(agent: AgentEntry) {
    const workspaceId = agent.workspaceId;
    if (agent.provider !== "pi" || !workspaceId) {
      removePill(agent.id);
      return;
    }

    const isRunning = agent.status === "running";
    const existing = pills.get(agent.id);
    if (existing?.workspaceId === workspaceId) {
      const wasRunning = existing.running;
      existing.running = isRunning;
      if (wasRunning !== isRunning) void refreshMetric(agent.id);
      return;
    }

    removePill(agent.id);
    const label = "CH—";
    const title = "Lecture du taux de cache hit Pi…";
    const registration = client.addComposerPill({
      id: "cache-hit",
      workspaceId,
      agentId: agent.id,
      button: {
        icon: "Database",
        label,
        title,
        behavior: { kind: "popover", Content: CacheDetails },
      },
    });
    pills.set(agent.id, { workspaceId, registration, label, title, running: isRunning });
    void refreshMetric(agent.id);
  }

  const pollTimer = setInterval(() => {
    for (const [agentId, entry] of pills) {
      if (entry.running) void refreshMetric(agentId);
    }
  }, 2_000);

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      directorySubscription = subscription;
      if (lifetime.signal.aborted) {
        void subscription.release();
        return;
      }

      stopUpdates = subscription.subscribe({
        snapshot({ entries }) {
          removeAllPills();
          for (const { agent } of entries) syncAgent(agent);
        },
        update(message) {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") syncAgent(update.agent);
          else removePill(update.agentId);
        },
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("Pi cache-hit observation failed", error);
    });

  return () => {
    lifetime.abort();
    clearInterval(pollTimer);
    stopUpdates?.();
    if (directorySubscription) void directorySubscription.release();
    removeAllPills();
  };
}
