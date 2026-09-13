import { describe, expect, it } from "vitest";
import { healthIsUsable } from "./realtime";

describe("shared health status", () => {
  it("requires both an online API and a reachable database", () => {
    expect(healthIsUsable({ status: "online", database: "connected" })).toBe(
      true,
    );
    expect(healthIsUsable({ status: "degraded", database: "connected" })).toBe(
      false,
    );
    expect(healthIsUsable({ status: "online", database: "disconnected" })).toBe(
      false,
    );
  });
});
