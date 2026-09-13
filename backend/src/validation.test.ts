import { describe, expect, it } from "vitest";
import {
  dateRange,
  escapeRegex,
  isoDate,
  mongoTimezoneOffset,
  objectId,
  optionalIsoDate,
  optionalObjectId,
  paginationFields,
  timezoneOffsetField,
} from "./validation.js";
import { z } from "zod";

describe("API query validation", () => {
  it("accepts canonical IDs and rejects malformed IDs", () => {
    expect(objectId.safeParse("507f1f77bcf86cd799439011").success).toBe(true);
    expect(objectId.safeParse("not-an-id").success).toBe(false);
  });
  it("rejects impossible calendar dates", () => {
    expect(isoDate.safeParse("2026-02-28").success).toBe(true);
    expect(isoDate.safeParse("2026-02-31").success).toBe(false);
  });
  it("treats blank optional filters as absent", () => {
    expect(optionalObjectId.parse("")).toBeUndefined();
    expect(optionalIsoDate.parse("")).toBeUndefined();
  });
  it("bounds pagination and creates inclusive UTC days", () => {
    const schema = z.object(paginationFields);
    expect(schema.parse({ page: "2", limit: "50" })).toEqual({
      page: 2,
      limit: 50,
    });
    expect(schema.safeParse({ page: "Infinity" }).success).toBe(false);
    expect(dateRange("2026-09-01", "2026-09-02").$lte?.toISOString()).toBe(
      "2026-09-02T23:59:59.999Z",
    );
  });
  it("shifts date boundaries into the operator timezone", () => {
    expect(
      dateRange("2026-09-01", "2026-09-01", -420).$gte?.toISOString(),
    ).toBe("2026-08-31T17:00:00.000Z");
    expect(
      dateRange("2026-09-01", "2026-09-01", -420).$lte?.toISOString(),
    ).toBe("2026-09-01T16:59:59.999Z");
    expect(mongoTimezoneOffset(-330)).toBe("+05:30");
    expect(mongoTimezoneOffset(300)).toBe("-05:00");
  });
  it("bounds timezone offsets", () => {
    expect(timezoneOffsetField.parse("-420")).toBe(-420);
    expect(timezoneOffsetField.safeParse("900").success).toBe(false);
  });
  it("escapes regex metacharacters for literal search", () => {
    expect(escapeRegex("DRONE.*[01]\\test")).toBe(
      "DRONE\\.\\*\\[01\\]\\\\test",
    );
  });
});
