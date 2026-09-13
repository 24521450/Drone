import { describe, expect, it } from "vitest";
import { createRoute, ROUTE_PATTERNS } from "./route-engine.js";

describe("route engine", () => {
  it.each(ROUTE_PATTERNS)("creates a closed, bounded %s path", (pattern) => {
    const center = { latitude: 10.762622, longitude: 106.660172 };
    const route = createRoute(pattern, center, "fixed-seed");
    expect(route.length).toBeGreaterThan(30);
    expect(route.at(-1)).toEqual(route[0]);
    expect(route.every((point) => Math.abs(point.latitude - center.latitude) < 0.001 && Math.abs(point.longitude - center.longitude) < 0.001)).toBe(true);
  });

  it("keeps the spiral anchored at home and deterministic", () => {
    const center = { latitude: 10.762622, longitude: 106.660172 };
    const first = createRoute("SPIRAL", center, "flight-1");
    expect(first[0]).toEqual(center);
    expect(first.at(-1)).toEqual(center);
    expect(first).toEqual(createRoute("SPIRAL", center, "flight-2"));
    expect(new Set(first.map((point) => `${point.latitude},${point.longitude}`)).size).toBeGreaterThan(30);
  });

  it("creates a figure-eight with two lobes around home", () => {
    const center = { latitude: 10.762622, longitude: 106.660172 };
    const route = createRoute("FIGURE_EIGHT", center, "fixed-seed");
    const left = route.some((point) => point.longitude < center.longitude - 0.0006);
    const right = route.some((point) => point.longitude > center.longitude + 0.0006);
    expect(left).toBe(true);
    expect(right).toBe(true);
    expect(route.at(-1)).toEqual(route[0]);
  });

  it("creates a multi-pass zigzag survey", () => {
    const center = { latitude: 10.762622, longitude: 106.660172 };
    const route = createRoute("ZIGZAG", center, "fixed-seed");
    const crossings = route.filter((point) => Math.abs(point.longitude - center.longitude) < 0.00035);
    expect(crossings.length).toBeGreaterThan(2);
    expect(route.at(-1)).toEqual(route[0]);
  });

  it("repeats the same random path for the same seed", () => {
    const center = { latitude: 10.762622, longitude: 106.660172 };
    expect(createRoute("RANDOM", center, "flight-1")).toEqual(createRoute("RANDOM", center, "flight-1"));
    expect(createRoute("RANDOM", center, "flight-1")).not.toEqual(createRoute("RANDOM", center, "flight-2"));
  });
});
