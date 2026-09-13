import { describe, expect, it } from "vitest";
import {
  buildEnvironmentConditions,
  buildEnvironmentSnapshot,
  calculateEnvironmentRisk,
  type EnvironmentConditions,
} from "./environment-service.js";

const now = new Date("2026-09-13T10:00:00.000Z");
const calm: EnvironmentConditions = {
  temperatureC: 31,
  humidityPercent: 72,
  windSpeedMps: 4.2,
  windDirectionDeg: 45,
  windDirection: "NE",
  rainMm: 0,
  rainStatus: "NONE",
  visibilityKm: 12,
  visibilityStatus: "GOOD",
  pressureHpa: 1012,
  uvIndex: 6.4,
};

describe("environment service", () => {
  it("generates stable, bounded demo conditions for a minute", () => {
    const first = buildEnvironmentConditions(now);
    const second = buildEnvironmentConditions(
      new Date(now.getTime() + 20_000),
    );
    expect(first).toEqual(second);
    expect(first.temperatureC).toBeGreaterThan(20);
    expect(first.temperatureC).toBeLessThan(40);
    expect(first.humidityPercent).toBeGreaterThanOrEqual(42);
    expect(first.humidityPercent).toBeLessThanOrEqual(94);
    expect(first.windDirection).toMatch(/^(N|NE|E|SE|S|SW|W|NW)$/);
    expect(first.visibilityKm).toBeGreaterThan(0);
  });

  it("keeps calm weather at low risk", () => {
    const result = calculateEnvironmentRisk(calm);
    expect(result).toEqual({ score: 0, level: "LOW", factors: [] });
  });

  it("combines severe weather and live aircraft indicators", () => {
    const result = calculateEnvironmentRisk(
      {
        ...calm,
        windSpeedMps: 13,
        rainMm: 9,
        rainStatus: "HEAVY",
        visibilityKm: 2.5,
        visibilityStatus: "POOR",
      },
      [
        { battery: 12, signal: 21, altitude: 140 },
        { battery: 78, signal: 92, altitude: 60 },
      ],
    );
    expect(result.level).toBe("CRITICAL");
    expect(result.score).toBe(100);
    expect(result.factors.map((factor) => factor.key)).toEqual(
      expect.arrayContaining([
        "wind-critical",
        "rain-critical",
        "visibility-critical",
        "fleet-battery",
        "fleet-signal",
        "fleet-altitude",
      ]),
    );
  });

  it("reports telemetry coverage and at-risk aircraft", () => {
    const snapshot = buildEnvironmentSnapshot({
      now,
      conditions: calm,
      flights: [
        { droneId: "drone-1", battery: 22, signal: 80 },
        { droneId: "drone-2" },
      ],
    });
    expect(snapshot.source).toBe("SIMULATED");
    expect(snapshot.fleet).toEqual({
      activeFlights: 2,
      atRiskFlights: 1,
      telemetryCoveragePercent: 50,
    });
  });
});
