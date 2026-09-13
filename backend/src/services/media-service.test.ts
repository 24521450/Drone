import { describe, expect, it } from "vitest";
import { buildMediaLibrary, summarizeMediaItems } from "./media-service.js";

const now = new Date("2026-09-13T10:00:00.000Z");

describe("media service", () => {
  it("creates a deterministic demo catalog with complete metadata", () => {
    const first = buildMediaLibrary({ now });
    const second = buildMediaLibrary({ now });
    expect(first).toEqual(second);
    expect(first.source).toBe("SIMULATED_CAPTURE");
    expect(first.summary).toMatchObject({
      total: 12,
      photos: 8,
      videos: 4,
      rgb: 4,
      thermal: 4,
      multispectral: 4,
    });
    expect(first.items[0]).toMatchObject({
      mediaType: expect.stringMatching(/^(PHOTO|VIDEO)$/),
      sensorType: expect.stringMatching(/^(RGB|THERMAL|MULTISPECTRAL)$/),
      droneCode: expect.stringMatching(/^DRONE-/),
      latitude: expect.any(Number),
      longitude: expect.any(Number),
      altitude: expect.any(Number),
      fileLocation: expect.stringMatching(/^\/demo-media\//),
      virtual: true,
    });
  });

  it("anchors captures to the latest real flight telemetry", () => {
    const result = buildMediaLibrary({
      now,
      flights: [
        {
          id: "flight-1",
          droneId: "drone-1",
          droneCode: "DRONE-101",
          missionId: "mission-1",
          startedAt: "2026-09-13T09:00:00.000Z",
          status: "ACTIVE",
          telemetry: {
            timestamp: "2026-09-13T09:59:00.000Z",
            latitude: 10.761,
            longitude: 106.653,
            altitude: 74,
          },
        },
      ],
    });
    expect(result.items).toHaveLength(3);
    expect(result.items.every((item) => !item.virtual)).toBe(true);
    expect(result.items.every((item) => item.droneCode === "DRONE-101")).toBe(true);
    expect(result.items.every((item) => item.missionId === "mission-1")).toBe(true);
    expect(result.items.every((item) => Math.abs(item.altitude - 74) < 1)).toBe(true);
    expect(result.summary).toMatchObject({ total: 3, photos: 2, videos: 1 });
  });

  it("does not generate capture timestamps in the future", () => {
    const result = buildMediaLibrary({
      now,
      flights: [
        {
          id: "future-flight",
          droneId: "drone-2",
          startedAt: "2026-09-13T12:00:00.000Z",
        },
      ],
    });
    expect(result.items.every((item) => Date.parse(item.capturedAt) <= now.getTime())).toBe(true);
  });

  it("summarizes a filtered collection without relying on the full catalog", () => {
    const catalog = buildMediaLibrary({ now });
    const thermalPhotos = catalog.items.filter(
      (item) => item.mediaType === "PHOTO" && item.sensorType === "THERMAL",
    );
    expect(summarizeMediaItems(thermalPhotos)).toEqual({
      total: 4,
      photos: 4,
      videos: 0,
      rgb: 0,
      thermal: 4,
      multispectral: 0,
      latestCapture: thermalPhotos[0].capturedAt,
    });
  });

  it("finds the latest capture even when input items are not sorted", () => {
    const catalog = buildMediaLibrary({ now });
    const unsorted = [...catalog.items].reverse();
    expect(summarizeMediaItems(unsorted).latestCapture).toBe(catalog.items[0].capturedAt);
  });
});
