import { describe, expect, it, vi } from "vitest";
import {
  applyAlertUpdate,
  downloadCsv,
  errorMessage,
  formatDuration,
  isCanceledRequest,
  missionProgress,
  missionProgressLabel,
  telemetryAgeMs,
  telemetryState,
  toCsv,
} from "./lib";

describe("alert updates", () => {
  const alerts = [
    { _id: "a1", status: "ACTIVE", message: "Battery low" },
    { _id: "a2", status: "ACTIVE", message: "GPS weak" },
  ];
  it("removes single and bulk-resolved alerts from live collections", () => {
    expect(applyAlertUpdate(alerts, { _id: "a1", status: "RESOLVED" })).toEqual(
      [alerts[1]],
    );
    expect(
      applyAlertUpdate(alerts, {
        alertIds: ["a1", "a2"],
        status: "ACKNOWLEDGED",
      }),
    ).toEqual([]);
  });
  it("merges a full active alert update without duplicating it", () => {
    expect(
      applyAlertUpdate(alerts, {
        _id: "a2",
        status: "ACTIVE",
        message: "Updated",
      }),
    ).toEqual([alerts[0], { ...alerts[1], message: "Updated" }]);
  });
});

describe("formatDuration", () => {
  it("formats seconds as minutes and seconds", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(125)).toBe("02:05");
  });
});
describe("toCsv", () => {
  it("escapes commas and quotes safely", () => {
    expect(toCsv([{ name: "Drone, One", note: 'said "ready"' }])).toBe(
      '"name","note"\r\n"Drone, One","said ""ready"""',
    );
  });
  it("neutralizes spreadsheet formulas from string fields", () => {
    expect(
      toCsv([
        {
          formula: '=HYPERLINK("https://example.com")',
          command: "+RUN",
          expression: "-2+3",
          mention: "@operator",
          numeric: -42,
        },
      ]),
    ).toBe(
      '"formula","command","expression","mention","numeric"\r\n' +
        '"\'=HYPERLINK(""https://example.com"")","\'+RUN","\'-2+3","\'@operator","-42"',
    );
  });
});

describe("downloadCsv", () => {
  it("starts a UTF-8 download and revokes the object URL after the click", async () => {
    const link = {
      href: "",
      download: "",
      style: {},
      click: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => link),
      body: { appendChild },
    });
    vi.stubGlobal("window", { setTimeout });
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);

    downloadCsv("fleet.csv", [{ drone: "DR-01" }]);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect((createObjectURL.mock.calls[0][0] as Blob).size).toBeGreaterThan(0);
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.download).toBe("fleet.csv");
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    vi.unstubAllGlobals();
  });
});
describe("errorMessage", () => {
  it("turns network failures into actionable messages", () => {
    expect(errorMessage({ code: "ECONNABORTED" })).toContain("timed out");
    expect(errorMessage({ message: "Network Error" })).toContain(
      "backend is running",
    );
  });
  it("explains when a rate-limited request can be retried", () => {
    expect(
      errorMessage({
        response: { status: 429, headers: { "retry-after": "7" } },
      }),
    ).toBe("Too many requests. Try again in 7 seconds.");
    expect(errorMessage({ response: { status: 429, headers: {} } })).toContain(
      "Please try again shortly",
    );
  });
});
describe("request cancellation", () => {
  it("recognizes axios and browser abort errors", () => {
    expect(isCanceledRequest({ code: "ERR_CANCELED" })).toBe(true);
    expect(isCanceledRequest({ name: "CanceledError" })).toBe(true);
    expect(isCanceledRequest({ name: "AbortError" })).toBe(true);
    expect(isCanceledRequest({ message: "Network Error" })).toBe(false);
  });
});
describe("telemetry freshness", () => {
  const now = Date.parse("2026-09-13T10:00:10.000Z");
  it("classifies missing, fresh and stale packets", () => {
    expect(telemetryState(undefined, now)).toBe("WAITING");
    expect(telemetryState("2026-09-13T10:00:08.000Z", now)).toBe("LIVE");
    expect(telemetryState("2026-09-13T10:00:00.000Z", now)).toBe("STALE");
    expect(telemetryState("not-a-date", now)).toBe("STALE");
    expect(telemetryAgeMs("not-a-date", now)).toBe(Infinity);
  });
});
describe("mission progress", () => {
  it("clamps waypoint progress and formats a compact operator label", () => {
    expect(missionProgress(2, 5, "MISSION")).toMatchObject({
      current: 2,
      total: 5,
      percent: 40,
    });
    expect(missionProgressLabel(2, 5, "MISSION")).toBe("WP 2 · 40%");
    expect(missionProgress(99, 5, "MISSION")?.current).toBe(5);
  });
  it("marks a mission complete while returning or landing", () => {
    expect(missionProgressLabel(0, 5, "RETURN_HOME")).toBe(
      "RETURN HOME · 100%",
    );
    expect(missionProgressLabel(0, 5, "LANDING")).toBe("RETURN HOME · 100%");
    expect(missionProgressLabel(0, 5, "COMPLETED")).toBe("COMPLETE · 100%");
  });
  it("falls back to a waypoint label for free-flight telemetry", () => {
    expect(missionProgressLabel(0)).toBe("HOME");
    expect(missionProgressLabel(3)).toBe("WP 3");
    expect(missionProgressLabel()).toBe("—");
  });
});
