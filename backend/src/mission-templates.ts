import type { Coordinate } from "./route-engine.js";

export const MISSION_TEMPLATE_TYPES = ["GRID_SURVEY", "PERIMETER_PATROL", "POINT_INSPECTION", "DELIVERY_ROUTE", "SPIRAL_SEARCH"] as const;
export type MissionTemplateType = typeof MISSION_TEMPLATE_TYPES[number];
type GeneratedWaypoint = Coordinate & { order: number; altitude: number; speed: number };

export const missionTemplates = [
  { type: "GRID_SURVEY", name: "Grid survey", description: "A six-leg lawnmower pattern for mapping and inspection." },
  { type: "PERIMETER_PATROL", name: "Perimeter patrol", description: "A closed rectangular patrol around an operating area." },
  { type: "POINT_INSPECTION", name: "Point inspection", description: "Orbit a point of interest from four directions." },
  { type: "DELIVERY_ROUTE", name: "Delivery route", description: "Fly to a delivery point and return along a second leg." },
  { type: "SPIRAL_SEARCH", name: "Spiral search", description: "Expand outward from home for search-and-rescue coverage." },
] as const;

function offset(center: Coordinate, northMeters: number, eastMeters: number): Coordinate {
  return { latitude: center.latitude + northMeters / 111_320, longitude: center.longitude + eastMeters / (111_320 * Math.cos(center.latitude * Math.PI / 180)) };
}

export function generateMissionTemplate(type: MissionTemplateType, center: Coordinate, sizeMeters: number, altitude: number, speed: number): GeneratedWaypoint[] {
  const half = sizeMeters / 2; let points: Coordinate[];
  if (type === "GRID_SURVEY") points = [offset(center, -half, -half), offset(center, -half, half), offset(center, 0, half), offset(center, 0, -half), offset(center, half, -half), offset(center, half, half)];
  else if (type === "PERIMETER_PATROL") points = [offset(center, -half, -half), offset(center, -half, half), offset(center, half, half), offset(center, half, -half), offset(center, -half, -half)];
  else if (type === "POINT_INSPECTION") points = [offset(center, 0, half), offset(center, half, 0), offset(center, 0, -half), offset(center, -half, 0), offset(center, 0, half)];
  else if (type === "DELIVERY_ROUTE") points = [offset(center, sizeMeters, sizeMeters * .25), offset(center, sizeMeters * .85, -sizeMeters * .25)];
  else points = Array.from({ length: 10 }, (_, index) => { const radius = sizeMeters * (index + 1) / 20; const angle = index * Math.PI * .7; return offset(center, Math.cos(angle) * radius, Math.sin(angle) * radius); });
  return points.map((point, order) => ({ ...point, order, altitude, speed }));
}
