import { describe, expect, it } from "vitest";
import { calculateDroneHealth } from "./maintenance-service.js";

const now = new Date("2026-09-12T12:00:00Z");
const base = { battery: 95, lastSeen: now, flights: 10, failedFlights: 0, criticalAlerts: 0, warningAlerts: 0, overdueMaintenance: 0, openMaintenance: 0 };

describe("drone health scoring", () => {
  it("marks a reliable active drone as healthy", () => expect(calculateDroneHealth(base, now)).toMatchObject({ score: 100, status: "HEALTHY" }));
  it("makes overdue maintenance service due", () => { const result = calculateDroneHealth({ ...base, overdueMaintenance: 1 }, now); expect(result.status).toBe("SERVICE_DUE"); expect(result.reasons.join(" ")).toContain("overdue"); });
  it("combines flight, alert and stale telemetry risk", () => { const result = calculateDroneHealth({ ...base, battery: 20, lastSeen: "2026-08-01", failedFlights: 5, criticalAlerts: 2 }, now); expect(result.score).toBeLessThan(60); expect(result.status).toBe("SERVICE_DUE"); });
});
