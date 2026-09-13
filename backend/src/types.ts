import type { Request } from "express";

export type AuthUser = { id: string; email: string; role: "ADMIN" | "VIEWER" };
export type AuthRequest = Request & { user?: AuthUser };

export type Scenario = "NORMAL" | "LOW_BATTERY" | "GPS_WEAK";
export type AnomalyType = "LOW_BATTERY" | "GPS_WEAK" | "SIGNAL_LOSS" | "WIND_DRIFT" | "GPS_DRIFT" | "EMERGENCY_LANDING";
export const ROUTE_PATTERNS = ["RANDOM", "STAR", "SQUARE", "CIRCLE", "GRID", "TRIANGLE", "SPIRAL", "FIGURE_EIGHT", "ZIGZAG"] as const;
export type RoutePattern = typeof ROUTE_PATTERNS[number];
export type FlightPhase = "TAKEOFF" | "MISSION" | "PAUSED" | "RETURN_HOME" | "LANDING" | "COMPLETED";

export type TelemetryPayload = {
  flightId: string;
  droneId: string;
  timestamp: string;
  sequence: number;
  battery: number;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  heading: number;
  gpsSatellites: number;
  signal: number;
  flightMode: string;
  routePattern: RoutePattern;
  flightPhase: FlightPhase;
  /** 0 represents home/takeoff; mission waypoints are 1-based. */
  waypointIndex?: number;
  /** Total number of waypoints for mission flights. */
  waypointCount?: number;
};
