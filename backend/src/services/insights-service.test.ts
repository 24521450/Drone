import { describe, expect, it } from "vitest";
import { buildOperationalInsights } from "./insights-service.js";

const now = new Date("2026-09-13T10:00:10.000Z");
const flight = {
  id: "flight-1",
  droneId: "drone-1",
  droneCode: "DR-01",
  flightPhase: "MISSION",
};

describe("operational insights", () => {
  it("returns a low-risk all-clear for a healthy active flight", () => {
    const result = buildOperationalInsights({
      flights: [flight],
      telemetry: [
        {
          flightId: flight.id,
          sequence: 10,
          timestamp: new Date(now.getTime() - 1_000),
          battery: 82,
          signal: 94,
          gpsSatellites: 14,
        },
      ],
      alerts: [],
      overdueMaintenance: [],
      now,
    });

    expect(result.risk).toEqual({ score: 0, level: "LOW" });
    expect(result.summary).toMatchObject({
      activeFlights: 1,
      healthyFlights: 1,
      staleTelemetry: 0,
    });
    expect(result.insights[0]).toMatchObject({
      severity: "INFO",
      title: "Fleet conditions are nominal",
    });
  });

  it("raises critical risk when telemetry and an alert show immediate danger", () => {
    const result = buildOperationalInsights({
      flights: [flight],
      telemetry: [
        {
          flightId: flight.id,
          sequence: 10,
          timestamp: new Date(now.getTime() - 8_000),
          battery: 14,
          signal: 22,
          gpsSatellites: 4,
        },
      ],
      alerts: [
        {
          flightId: flight.id,
          droneId: flight.droneId,
          type: "BATTERY_LOW",
          severity: "CRITICAL",
          message: "Battery level is below 20%",
        },
      ],
      overdueMaintenance: [],
      now,
    });

    expect(result.risk.level).toBe("CRITICAL");
    expect(result.risk.score).toBe(100);
    expect(result.summary).toMatchObject({
      activeAlerts: 1,
      criticalAlerts: 1,
      staleTelemetry: 1,
      healthyFlights: 0,
    });
    expect(result.insights[0].severity).toBe("CRITICAL");
  });

  it("surfaces overdue maintenance even when flight telemetry is healthy", () => {
    const result = buildOperationalInsights({
      flights: [flight],
      telemetry: [
        {
          flightId: flight.id,
          sequence: 10,
          timestamp: new Date(now.getTime() - 500),
          battery: 82,
          signal: 94,
          gpsSatellites: 14,
        },
      ],
      alerts: [],
      overdueMaintenance: [{ droneId: flight.droneId, type: "INSPECTION" }],
      now,
    });

    expect(result.risk).toEqual({ score: 10, level: "WATCH" });
    expect(result.summary.overdueMaintenance).toBe(1);
    expect(result.insights).toContainEqual(
      expect.objectContaining({ key: "maintenance-overdue-drone-1" }),
    );
  });

  it("does not invent a risk when the fleet is idle", () => {
    const result = buildOperationalInsights({
      flights: [],
      telemetry: [],
      alerts: [],
      overdueMaintenance: [],
      now,
    });

    expect(result.risk).toEqual({ score: 0, level: "LOW" });
    expect(result.insights[0]).toMatchObject({
      severity: "INFO",
      title: "No active flights",
    });
  });
});
