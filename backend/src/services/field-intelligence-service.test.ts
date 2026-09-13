import { describe, expect, it } from "vitest";
import {
  buildFieldIntelligence,
  estimateBoundaryAreaHectares,
} from "./field-intelligence-service.js";

const now = new Date("2026-09-13T10:00:00.000Z");

describe("field intelligence service", () => {
  it("estimates circle and polygon field areas", () => {
    const circle = estimateBoundaryAreaHectares({
      type: "CIRCLE",
      center: { latitude: 10.76, longitude: 106.65 },
      radiusMeters: 100,
    });
    const polygon = estimateBoundaryAreaHectares({
      type: "POLYGON",
      polygon: [
        { latitude: 10.76, longitude: 106.65 },
        { latitude: 10.76, longitude: 106.651 },
        { latitude: 10.761, longitude: 106.651 },
        { latitude: 10.761, longitude: 106.65 },
      ],
    });
    expect(circle).toBeCloseTo(3.14, 1);
    expect(polygon).toBeGreaterThan(1);
    expect(estimateBoundaryAreaHectares({ type: "POLYGON", polygon: [] })).toBe(0);
  });

  it("returns deterministic plot analysis with explainable metrics", () => {
    const input = {
      now,
      plots: [
        { id: "plot-1", name: "Plot 01", areaHectares: 0.8, virtual: true },
        { id: "plot-2", name: "Plot 02", areaHectares: 0.7, virtual: true },
      ],
    };
    const first = buildFieldIntelligence(input);
    const second = buildFieldIntelligence(input);
    expect(first).toEqual(second);
    expect(first.source).toBe("SIMULATED_ANALYSIS");
    expect(first.field).toMatchObject({
      name: "Demo Field #01",
      areaHectares: 1.5,
      plotsCount: 2,
    });
    expect(first.plots).toHaveLength(2);
    first.plots.forEach((plot) => {
      expect(plot.healthScore).toBeGreaterThanOrEqual(0);
      expect(plot.healthScore).toBeLessThanOrEqual(100);
      expect(plot.status).toMatch(/^(NORMAL|WATER_STRESS|POSSIBLE_DISEASE|NUTRIENT_STRESS)$/);
    });
  });

  it("keeps an empty field safe for a first-time workspace", () => {
    const result = buildFieldIntelligence({ now });
    expect(result.field.plotsCount).toBe(0);
    expect(result.summary).toMatchObject({
      averageHealthScore: 0,
      normal: 0,
      waterStress: 0,
      possibleDisease: 0,
      nutrientStress: 0,
      lastScanAt: null,
    });
  });
});
