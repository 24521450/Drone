import { haversineMeters, insideGeofence } from "./geometry.js";
import type { Coordinate } from "./route-engine.js";

export type MissionIssue = { code: string; message: string; waypointIndex?: number };
export type MissionEstimate = { distanceMeters: number; durationSeconds: number; batteryPercent: number };

export function inspectMission(mission: any, geofence?: any, drone?: any): { valid: boolean; issues: MissionIssue[]; estimate: MissionEstimate } {
  const issues: MissionIssue[] = [];
  const waypoints = [...(mission?.waypoints ?? [])].sort((a: any, b: any) => a.order - b.order);
  const home: Coordinate | undefined = mission?.homePosition;
  if (!home) issues.push({ code: "HOME_REQUIRED", message: "Mission home position is required" });
  if (waypoints.length < 2) issues.push({ code: "WAYPOINTS_REQUIRED", message: "At least two waypoints are required" });
  if (!drone) issues.push({ code: "DRONE_MISSING", message: "The assigned drone is unavailable" });
  if (drone?.isArchived) issues.push({ code: "DRONE_ARCHIVED", message: "The assigned drone is archived" });
  if (drone?.status === "IN_FLIGHT") issues.push({ code: "DRONE_BUSY", message: "The assigned drone is already in flight" });
  if (mission?.geofenceId && !geofence) issues.push({ code: "GEOFENCE_MISSING", message: "The assigned geofence is unavailable" });
  if (geofence?.isArchived) issues.push({ code: "GEOFENCE_ARCHIVED", message: "The assigned geofence is archived" });
  else if (geofence && !geofence.isActive) issues.push({ code: "GEOFENCE_INACTIVE", message: "The assigned geofence is inactive" });
  if (geofence && home && !insideGeofence(home, geofence)) issues.push({ code: "HOME_OUTSIDE_GEOFENCE", message: "Home position is outside the assigned geofence" });
  if (geofence) waypoints.forEach((point: Coordinate, waypointIndex: number) => {
    if (!insideGeofence(point, geofence)) issues.push({ code: "WAYPOINT_OUTSIDE_GEOFENCE", message: `Waypoint ${waypointIndex + 1} is outside the assigned geofence`, waypointIndex });
  });

  let distanceMeters = 0;
  if (home) {
    const route = [home, ...waypoints, home];
    for (let index = 1; index < route.length; index += 1) distanceMeters += haversineMeters(route[index - 1], route[index]);
  }
  const travelSeconds = waypoints.reduce((total: number, waypoint: any, index: number) => {
    const from = index === 0 ? home : waypoints[index - 1];
    return total + (from ? haversineMeters(from, waypoint) / Math.max(1, waypoint.speed) : 0);
  }, 0) + (home && waypoints.length ? haversineMeters(waypoints.at(-1), home) / 8 : 0);
  const maxAltitude = Math.max(0, ...waypoints.map((point: any) => Number(point.altitude) || 0));
  const durationSeconds = Math.ceil(4 + travelSeconds + maxAltitude / 10);
  return { valid: issues.length === 0, issues, estimate: { distanceMeters: Math.round(distanceMeters), durationSeconds, batteryPercent: Math.min(100, Math.round(durationSeconds * .08 * 10) / 10) } };
}

export function buildMissionPath(home: Coordinate, waypoints: any[]) {
  const ordered = [...waypoints].sort((a, b) => a.order - b.order);
  const takeoffAltitude = Number(ordered[0]?.altitude) || 32;
  const homePoint = { latitude: Number(home.latitude), longitude: Number(home.longitude), altitude: takeoffAltitude, speed: 0, waypointIndex: 0 };
  const path: Array<Coordinate & { altitude?: number; speed?: number; waypointIndex?: number }> = [homePoint];
  let previous: any = homePoint;
  for (const [index, waypoint] of ordered.entries()) {
    const speed = Math.max(1, Number(waypoint.speed) || 1);
    const steps = Math.max(1, Math.ceil(haversineMeters(previous, waypoint) / speed));
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      path.push({
        latitude: previous.latitude + (waypoint.latitude - previous.latitude) * progress,
        longitude: previous.longitude + (waypoint.longitude - previous.longitude) * progress,
        altitude: (previous.altitude || 0) + (waypoint.altitude - (previous.altitude || 0)) * progress,
        speed,
        waypointIndex: index + 1,
      });
    }
    previous = waypoint;
  }
  return path;
}
