import { describe, expect, it } from "vitest";
import { ROUTE_PATTERNS, ROUTE_PATTERN_META, routePatternLabel } from "./types";

describe("route pattern metadata", () => {
  it("keeps every selectable pattern documented", () => {
    expect(ROUTE_PATTERNS).toHaveLength(9);
    expect(ROUTE_PATTERNS.every((pattern) => ROUTE_PATTERN_META[pattern].label && ROUTE_PATTERN_META[pattern].description)).toBe(true);
  });

  it("formats known and legacy route values safely", () => {
    expect(routePatternLabel("SPIRAL")).toBe("Spiral search");
    expect(routePatternLabel("FIGURE_EIGHT")).toBe("Figure-eight");
    expect(routePatternLabel("MISSION")).toBe("MISSION");
    expect(routePatternLabel()).toBe("Random walk");
  });
});
