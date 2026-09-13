import { describe, expect, it } from "vitest";
import { toCsv } from "./csv.js";

describe("CSV export", () => {
  it("quotes cells and neutralizes spreadsheet formulas", () => {
    expect(
      toCsv([
        {
          command: "CMD-1",
          message: '=HYPERLINK("https://example.test")',
          note: "quoted, value",
        },
      ]),
    ).toBe(
      '"command","message","note"\r\n"CMD-1","\'=HYPERLINK(""https://example.test"")","quoted, value"',
    );
  });
});
