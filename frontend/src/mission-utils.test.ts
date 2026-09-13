import { describe, expect, it } from "vitest";
import { estimateMission, insideFence } from "./mission-utils";

describe("mission planner calculations", () => {
  const home = { latitude: 10.762622, longitude: 106.660172 };
  const fence = { _id: "f", name: "Safe", type: "CIRCLE" as const, center: home, radiusMeters: 100, homePosition: home, isActive: true };
  it("marks points beyond a circle as invalid", () => { expect(insideFence(home, fence)).toBe(true); expect(insideFence({ latitude: 10.765, longitude: 106.660172 }, fence)).toBe(false); });
  it("reflects waypoint speed in the estimate", () => { const slow = [{ order: 0, latitude: 10.763, longitude: 106.6605, altitude: 30, speed: 2 }, { order: 1, latitude: 10.7628, longitude: 106.6603, altitude: 30, speed: 2 }]; const fast = slow.map((point) => ({ ...point, speed: 10 })); expect(estimateMission(home, slow).durationSeconds).toBeGreaterThan(estimateMission(home, fast).durationSeconds); });
});
