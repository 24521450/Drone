import { describe, expect, it } from "vitest";
import { buildMissionPath, inspectMission } from "./mission-service.js";

describe("mission planning", () => {
  const home = { latitude: 10.762622, longitude: 106.660172 };
  const fence = { type: "CIRCLE", center: home, radiusMeters: 300, isActive: true };
  const waypoints = [
    { order: 0, latitude: 10.7629, longitude: 106.6604, altitude: 30, speed: 5 },
    { order: 1, latitude: 10.7631, longitude: 106.6607, altitude: 50, speed: 10 },
  ];

  it("estimates and validates a safe mission", () => {
    const result = inspectMission({ homePosition: home, waypoints, geofenceId: "assigned" }, fence, { status: "ONLINE", isArchived: false });
    expect(result.valid).toBe(true); expect(result.estimate.distanceMeters).toBeGreaterThan(100); expect(result.estimate.durationSeconds).toBeGreaterThan(10);
  });

  it("identifies the exact waypoint outside its fence", () => {
    const result = inspectMission({ homePosition: home, waypoints: [...waypoints, { ...waypoints[0], order: 2, latitude: 10.77 }], geofenceId: "assigned" }, fence, { status: "ONLINE" });
    expect(result.valid).toBe(false); expect(result.issues).toContainEqual(expect.objectContaining({ code: "WAYPOINT_OUTSIDE_GEOFENCE", waypointIndex: 2 }));
  });

  it("reports a missing assigned aircraft instead of failing validation", () => {
    const result = inspectMission({ homePosition: home, waypoints }, undefined, null);
    expect(result.valid).toBe(false); expect(result.issues).toContainEqual(expect.objectContaining({ code: "DRONE_MISSING" }));
  });

  it("rejects an archived geofence even when it remains active in its record", () => {
    const result = inspectMission({ homePosition: home, waypoints, geofenceId: "assigned" }, { ...fence, isArchived: true }, { status: "ONLINE", isArchived: false });
    expect(result.valid).toBe(false); expect(result.issues).toContainEqual(expect.objectContaining({ code: "GEOFENCE_ARCHIVED" }));
  });

  it("turns waypoint speed and altitude into navigation samples", () => {
    const path = buildMissionPath(home, waypoints); expect(path.length).toBeGreaterThan(waypoints.length); expect(path.at(-1)?.altitude).toBe(50); expect(path.at(-1)?.speed).toBe(10); expect(path[0]?.waypointIndex).toBe(0); expect(path.at(-1)?.waypointIndex).toBe(2);
  });

  it("reads coordinates from document-like objects without relying on spread", () => {
    const documentHome: any = {}; Object.defineProperties(documentHome, { latitude: { get: () => home.latitude }, longitude: { get: () => home.longitude } });
    const path = buildMissionPath(documentHome, waypoints); expect(path[0]).toMatchObject(home); expect(Number.isFinite(path[1].latitude)).toBe(true);
  });
});
