import { describe, expect, it } from "vitest";
import { buildSystemStatus } from "./system-status-service.js";

describe("system status service", () => {
  it("describes runtime and explicitly simulated adapters", () => {
    const result = buildSystemStatus({
      now: new Date("2026-09-13T10:00:00.000Z"),
      databaseConnected: true,
      databaseLatencyMs: 7,
      websocketClients: 2,
      uptimeSeconds: 125.9,
      nodeVersion: "v26.2.0",
      memoryRssMb: 91.4,
    });
    expect(result).toMatchObject({
      source: "RUNTIME",
      overallStatus: "ONLINE",
      generatedAt: "2026-09-13T10:00:00.000Z",
      connection: {
        websocketClients: 2,
        uptimeSeconds: 125,
        nodeVersion: "v26.2.0",
        memoryRssMb: 91,
      },
    });
    expect(result.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "database", status: "ONLINE", latencyMs: 7 }),
        expect.objectContaining({ key: "drone-link", status: "SIMULATED" }),
        expect.objectContaining({ key: "ai-service", status: "SIMULATED" }),
        expect.objectContaining({ key: "storage", status: "SIMULATED" }),
        expect.objectContaining({ key: "mqtt", status: "NOT_CONFIGURED" }),
      ]),
    );
  });

  it("degrades the overall status when the database is offline", () => {
    const result = buildSystemStatus({
      databaseConnected: false,
      databaseLatencyMs: null,
    });
    expect(result.overallStatus).toBe("DEGRADED");
    expect(result.services.find((service) => service.key === "database")).toMatchObject({
      status: "OFFLINE",
      latencyMs: null,
    });
  });
});
