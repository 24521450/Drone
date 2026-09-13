import { describe, expect, it } from "vitest";
import { generateMissionTemplate, MISSION_TEMPLATE_TYPES } from "./mission-templates.js";

describe("mission templates", () => {
  const home = { latitude: 10.762622, longitude: 106.660172 };
  it.each(MISSION_TEMPLATE_TYPES)("generates an ordered %s route", (type) => { const route = generateMissionTemplate(type, home, 100, 40, 7); expect(route.length).toBeGreaterThanOrEqual(2); expect(route.map((point) => point.order)).toEqual(route.map((_, index) => index)); expect(route.every((point) => point.altitude === 40 && point.speed === 7)).toBe(true); });
  it("scales grid dimensions", () => { const small = generateMissionTemplate("GRID_SURVEY", home, 50, 30, 5); const large = generateMissionTemplate("GRID_SURVEY", home, 200, 30, 5); expect(Math.abs(large[0].latitude - home.latitude)).toBeGreaterThan(Math.abs(small[0].latitude - home.latitude)); });
});
