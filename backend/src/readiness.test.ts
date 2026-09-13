import { describe, expect, it } from "vitest";
import { evaluateDroneReadiness, missionBatteryRequirement } from "./readiness.js";

describe("flight readiness", () => {
  const drone = { _id: "drone-1", battery: 84, status: "ONLINE", isArchived: false };

  it("passes an available aircraft with sufficient battery", () => {
    const result = evaluateDroneReadiness(drone);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("blocks active maintenance and insufficient battery", () => {
    const result = evaluateDroneReadiness({ ...drone, battery: 12 }, { maintenanceInProgress: true, requiredBatteryPercent: 30 });
    expect(result.ready).toBe(false);
    expect(result.checks.filter((check) => check.status === "BLOCK").map((check) => check.key)).toEqual(["MAINTENANCE", "BATTERY"]);
  });

  it("adds a reserve to mission consumption without exceeding the safe cap", () => {
    expect(missionBatteryRequirement(28.2)).toBe(44);
    expect(missionBatteryRequirement(99)).toBe(95);
  });
});
