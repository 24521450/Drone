import type { Coordinate } from "./route-engine.js";

export function haversineMeters(a: Coordinate, b: Coordinate) {
  const radius = 6371000;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLng = (b.longitude - a.longitude) * Math.PI / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

/** Returns the initial compass bearing from `a` to `b` in degrees clockwise from north. */
export function bearingDegrees(a: Coordinate, b: Coordinate) {
  const latitude1 = a.latitude * Math.PI / 180;
  const latitude2 = b.latitude * Math.PI / 180;
  const deltaLongitude = (b.longitude - a.longitude) * Math.PI / 180;
  const y = Math.sin(deltaLongitude) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2)
    - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(deltaLongitude);
  if (Math.abs(x) < Number.EPSILON && Math.abs(y) < Number.EPSILON) return 0;
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function pointInPolygon(point: Coordinate, polygon: Coordinate[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const intersects = (a.latitude > point.latitude) !== (b.latitude > point.latitude)
      && point.longitude < (b.longitude - a.longitude) * (point.latitude - a.latitude) / ((b.latitude - a.latitude) || Number.EPSILON) + a.longitude;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function insideGeofence(point: Coordinate, geofence?: any) {
  if (!geofence || !geofence.isActive) return true;
  if (geofence.type === "CIRCLE") return haversineMeters(point, geofence.center) <= geofence.radiusMeters;
  return Array.isArray(geofence.polygon) && pointInPolygon(point, geofence.polygon);
}

export function interpolatePath(points: Coordinate[], samplesPerEdge = 8) {
  const result: Coordinate[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    for (let step = 0; step < samplesPerEdge; step += 1) {
      const progress = step / samplesPerEdge;
      result.push({ latitude: start.latitude + (end.latitude - start.latitude) * progress, longitude: start.longitude + (end.longitude - start.longitude) * progress });
    }
  }
  result.push(points.at(-1)!);
  return result;
}
