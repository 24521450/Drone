import { describe, expect, it } from "vitest";
import { bearingDegrees, haversineMeters, insideGeofence, pointInPolygon } from "./geometry.js";

describe("flight safety geometry", () => {
  const square = [
    { latitude: 10.761, longitude: 106.659 },
    { latitude: 10.764, longitude: 106.659 },
    { latitude: 10.764, longitude: 106.662 },
    { latitude: 10.761, longitude: 106.662 },
  ];

  it("detects points inside and outside a polygon", () => {
    expect(pointInPolygon({ latitude: 10.762, longitude: 106.66 }, square)).toBe(true);
    expect(pointInPolygon({ latitude: 10.77, longitude: 106.66 }, square)).toBe(false);
  });

  it("enforces a circular fence radius", () => {
    const fence = { type: "CIRCLE", center: { latitude: 10.762622, longitude: 106.660172 }, radiusMeters: 100, isActive: true };
    expect(insideGeofence({ latitude: 10.7627, longitude: 106.6602 }, fence)).toBe(true);
    expect(insideGeofence({ latitude: 10.765, longitude: 106.6602 }, fence)).toBe(false);
  });

  it("calculates realistic distances", () => {
    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 })).toBeGreaterThan(110);
    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 })).toBeLessThan(112);
  });

  it("calculates a compass bearing for aircraft orientation", () => {
    expect(bearingDegrees({ latitude: 10, longitude: 106 }, { latitude: 11, longitude: 106 })).toBeCloseTo(0, 5);
    expect(bearingDegrees({ latitude: 10, longitude: 106 }, { latitude: 10, longitude: 107 })).toBeCloseTo(89.91, 1);
    expect(bearingDegrees({ latitude: 10, longitude: 106 }, { latitude: 10, longitude: 106 })).toBe(0);
  });
});
