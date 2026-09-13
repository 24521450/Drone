import { Flight, Maintenance } from "./models.js";

export type ReadinessCheck = {
  key: "ARCHIVED" | "ACTIVE_FLIGHT" | "MAINTENANCE" | "BATTERY" | "CONNECTION";
  label: string;
  status: "PASS" | "WARN" | "BLOCK";
  message: string;
};

export type DroneReadiness = {
  droneId: string;
  ready: boolean;
  requiredBatteryPercent: number;
  checks: ReadinessCheck[];
  blockers: string[];
};

export function evaluateDroneReadiness(drone: any, context: { activeFlight?: boolean; maintenanceInProgress?: boolean; requiredBatteryPercent?: number } = {}): DroneReadiness {
  const requiredBatteryPercent = Math.max(5, Math.min(95, Math.ceil(context.requiredBatteryPercent ?? 20)));
  const battery = Number(drone?.battery ?? 0);
  const checks: ReadinessCheck[] = [
    { key: "ARCHIVED", label: "Aircraft record", status: drone?.isArchived ? "BLOCK" : "PASS", message: drone?.isArchived ? "Aircraft is archived" : "Aircraft is available" },
    { key: "ACTIVE_FLIGHT", label: "Flight availability", status: context.activeFlight ? "BLOCK" : "PASS", message: context.activeFlight ? "Aircraft already has an active flight" : "No active flight" },
    { key: "MAINTENANCE", label: "Maintenance", status: context.maintenanceInProgress ? "BLOCK" : "PASS", message: context.maintenanceInProgress ? "Maintenance is currently in progress" : "No maintenance in progress" },
    { key: "BATTERY", label: "Battery reserve", status: battery < requiredBatteryPercent ? "BLOCK" : "PASS", message: battery < requiredBatteryPercent ? `Battery is ${battery}% but ${requiredBatteryPercent}% is required` : `${battery}% available · ${requiredBatteryPercent}% required` },
    { key: "CONNECTION", label: "Connection", status: ["OFFLINE", "WARNING"].includes(drone?.status) ? "WARN" : "PASS", message: drone?.status === "OFFLINE" ? "Aircraft was offline and will reconnect in simulation" : drone?.status === "WARNING" ? "Previous warning state will be rechecked on launch" : "Aircraft is online" },
  ];
  const blockers = checks.filter((check) => check.status === "BLOCK").map((check) => check.message);
  return { droneId: String(drone?._id ?? ""), ready: blockers.length === 0, requiredBatteryPercent, checks, blockers };
}

export async function assessDroneReadiness(drone: any, requiredBatteryPercent = 20) {
  const droneId = String(drone._id);
  const [activeFlight, maintenanceInProgress] = await Promise.all([
    Flight.exists({ droneId, status: "ACTIVE" }),
    Maintenance.exists({ droneId, status: "IN_PROGRESS" }),
  ]);
  return evaluateDroneReadiness(drone, { activeFlight: Boolean(activeFlight), maintenanceInProgress: Boolean(maintenanceInProgress), requiredBatteryPercent });
}

export async function assessFleetReadiness(drones: any[], requiredBatteryPercent = 20) {
  const ids = drones.map((drone) => drone._id);
  const [activeFlights, maintenance] = await Promise.all([
    Flight.find({ droneId: { $in: ids }, status: "ACTIVE" }).select("droneId").lean(),
    Maintenance.find({ droneId: { $in: ids }, status: "IN_PROGRESS" }).select("droneId").lean(),
  ]);
  const activeIds = new Set(activeFlights.map((item: any) => String(item.droneId)));
  const maintenanceIds = new Set(maintenance.map((item: any) => String(item.droneId)));
  return drones.map((drone) => evaluateDroneReadiness(drone, { activeFlight: activeIds.has(String(drone._id)), maintenanceInProgress: maintenanceIds.has(String(drone._id)), requiredBatteryPercent }));
}

export function assertDroneReady(readiness: DroneReadiness, droneCode = "Aircraft") {
  if (!readiness.ready) throw new Error(`${droneCode} cannot launch: ${readiness.blockers.join("; ")}`);
}

export function missionBatteryRequirement(estimatedBatteryPercent: number, reservePercent = 15) {
  return Math.min(95, Math.max(20, Math.ceil(estimatedBatteryPercent + reservePercent)));
}
