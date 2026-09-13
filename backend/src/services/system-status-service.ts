export type SystemServiceStatus =
  | "ONLINE"
  | "DEGRADED"
  | "OFFLINE"
  | "SIMULATED"
  | "NOT_CONFIGURED";

export type SystemService = {
  key: string;
  label: string;
  status: SystemServiceStatus;
  detail: string;
  latencyMs?: number | null;
};

export type SystemStatus = {
  generatedAt: string;
  source: "RUNTIME";
  sourceLabel: string;
  overallStatus: "ONLINE" | "DEGRADED";
  services: SystemService[];
  connection: {
    websocketClients: number;
    uptimeSeconds: number;
    nodeVersion: string;
    memoryRssMb: number;
  };
};

export function buildSystemStatus(input: {
  now?: Date;
  databaseConnected: boolean;
  databaseLatencyMs?: number | null;
  websocketClients?: number;
  uptimeSeconds?: number;
  nodeVersion?: string;
  memoryRssMb?: number;
}): SystemStatus {
  const now = input.now ?? new Date();
  const databaseStatus: SystemServiceStatus = input.databaseConnected
    ? "ONLINE"
    : "OFFLINE";
  const databaseDetail = input.databaseConnected
    ? "MongoDB connection is responding to health checks"
    : "MongoDB connection is unavailable";
  const websocketClients = Math.max(0, Math.round(input.websocketClients ?? 0));
  const uptimeSeconds = Math.max(0, Math.floor(input.uptimeSeconds ?? 0));
  const memoryRssMb = Math.max(0, Math.round(input.memoryRssMb ?? 0));
  return {
    generatedAt: now.toISOString(),
    source: "RUNTIME",
    sourceLabel: "Runtime service checks",
    overallStatus: input.databaseConnected ? "ONLINE" : "DEGRADED",
    services: [
      {
        key: "frontend",
        label: "Frontend",
        status: "ONLINE",
        detail: "Dashboard bundle is serving from the active client",
      },
      {
        key: "backend",
        label: "Backend API",
        status: "ONLINE",
        detail: `Node.js ${input.nodeVersion ?? "runtime"} is handling requests`,
      },
      {
        key: "database",
        label: "MongoDB",
        status: databaseStatus,
        detail: databaseDetail,
        latencyMs: input.databaseLatencyMs ?? null,
      },
      {
        key: "websocket",
        label: "WebSocket",
        status: "ONLINE",
        detail: `Socket.IO listener ready · ${websocketClients} connected client${websocketClients === 1 ? "" : "s"}`,
      },
      {
        key: "drone-link",
        label: "Drone link",
        status: "SIMULATED",
        detail: "Telemetry simulator adapter is active for demo flights",
      },
      {
        key: "ai-service",
        label: "AI / ML",
        status: "SIMULATED",
        detail: "Rule-based insights and deterministic field analysis",
      },
      {
        key: "storage",
        label: "Media storage",
        status: "SIMULATED",
        detail: "Media catalog uses metadata placeholders; no files are uploaded",
      },
      {
        key: "mqtt",
        label: "MQTT bridge",
        status: "NOT_CONFIGURED",
        detail: "No external broker configured in this demo environment",
      },
    ],
    connection: {
      websocketClients,
      uptimeSeconds,
      nodeVersion: input.nodeVersion ?? "unknown",
      memoryRssMb,
    },
  };
}
