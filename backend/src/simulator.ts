import { randomInt } from "node:crypto";
import type { Server } from "socket.io";
import { Alert, Command, Drone, Flight, Mission, Telemetry } from "./models.js";
import {
  bearingDegrees,
  haversineMeters,
  insideGeofence,
  interpolatePath,
} from "./geometry.js";
import { createRoute, demoCenter, type Coordinate } from "./route-engine.js";
import { buildMissionPath, inspectMission } from "./mission-service.js";
import type {
  AnomalyType,
  FlightPhase,
  RoutePattern,
  Scenario,
  TelemetryPayload,
} from "./types.js";
import {
  getAlertRuleMap,
  type AlertRuleKey,
  type RuntimeAlertRule,
} from "./alert-rules.js";
import {
  assessDroneReadiness,
  assessFleetReadiness,
  assertDroneReady,
  missionBatteryRequirement,
} from "./readiness.js";

type Assignment = { droneId: string; routePattern: RoutePattern };
type NavigationPoint = Coordinate & {
  altitude?: number;
  speed?: number;
  waypointIndex?: number;
};
type AlertCondition = {
  type: string;
  message: string;
  severity: "WARNING" | "CRITICAL";
  autoAction: "NONE" | "RETURN_HOME" | "LAND";
};
type Runner = {
  flightId: string;
  droneId: string;
  missionId?: string;
  scenario: Scenario;
  routePattern: RoutePattern;
  anomalies: Set<AnomalyType>;
  path: NavigationPoint[];
  waypointCount?: number;
  routeIndex: number;
  sequence: number;
  previous: NavigationPoint;
  home: Coordinate;
  heading: number;
  batteryStart: number;
  altitude: number;
  phase: FlightPhase;
  resumePhase: FlightPhase;
  loop: boolean;
  geofence?: any;
  alerted: Set<string>;
  active: boolean;
  alertRules: Record<AlertRuleKey, RuntimeAlertRule>;
  automaticActionTaken: boolean;
  pendingAutomaticAction?: "RETURN_HOME" | "LAND";
  pendingAlerts: Map<
    string,
    { payload: TelemetryPayload; condition: AlertCondition }
  >;
};

const runners = new Map<string, Runner>();
const launchLocks = new Set<string>();
const commandLocks = new Set<string>();
let scheduler: NodeJS.Timeout | undefined;
let ticking = false;
const makeCode = (prefix: string) =>
  `${prefix}-${Date.now().toString().slice(-7)}-${randomInt(100, 999)}`;

function acquireLaunchLocks(droneIds: string[]) {
  if (droneIds.some((id) => launchLocks.has(id)))
    throw new Error(
      "A launch is already being prepared for one or more aircraft",
    );
  droneIds.forEach((id) => launchLocks.add(id));
  return () => droneIds.forEach((id) => launchLocks.delete(id));
}

function acquireCommandLock(flightId: string) {
  if (commandLocks.has(flightId))
    throw new Error("A command is already executing for this flight");
  commandLocks.add(flightId);
  return () => commandLocks.delete(flightId);
}

function setReturnHome(runner: Runner) {
  runner.phase = "RETURN_HOME";
  runner.path = interpolatePath([runner.previous, runner.home], 12).map(
    (point) => ({ ...point, waypointIndex: 0 }),
  );
  runner.routeIndex = 0;
}

type PendingAlert = {
  runner: Runner;
  payload: TelemetryPayload;
  condition: AlertCondition;
};

async function persistPendingAlerts(pending: PendingAlert[]): Promise<any[]> {
  if (!pending.length) return [];
  const keys = pending.map(({ runner, condition }) => ({
    flightId: runner.flightId,
    type: condition.type,
  }));
  const existing: any[] = await (Alert.find({ $or: keys } as any)
    .select("flightId type")
    .lean() as any);
  const existingKeys = new Set(
    existing.map((item: any) => `${String(item.flightId)}:${item.type}`),
  );
  const alerts: any[] = await Promise.all(
    pending.map(
      ({ runner, payload, condition }) =>
        Alert.findOneAndUpdate(
          { flightId: runner.flightId, type: condition.type } as any,
          {
            $setOnInsert: {
              flightId: runner.flightId,
              droneId: runner.droneId,
              type: condition.type,
              severity: condition.severity,
              message: condition.message,
              latitude: payload.latitude,
              longitude: payload.longitude,
            },
          } as any,
          { upsert: true, returnDocument: "after" } as any,
        ) as any,
    ),
  );
  return alerts.filter(
    (alert: any, index) =>
      Boolean(alert) &&
      !existingKeys.has(
        `${pending[index].runner.flightId}:${pending[index].condition.type}`,
      ),
  );
}

async function createAutomaticSafetyCommand(
  io: Server,
  runner: Runner,
  type: "RETURN_HOME" | "LAND",
) {
  const command = await Command.create({
    commandCode: makeCode("CMD"),
    flightId: runner.flightId,
    droneId: runner.droneId,
    type,
    source: "SYSTEM",
    status: "COMPLETED",
    completedAt: new Date(),
  });
  if (type === "RETURN_HOME") setReturnHome(runner);
  else runner.phase = "LANDING";
  await Flight.findByIdAndUpdate(runner.flightId, {
    flightPhase: runner.phase,
  });
  io.emit("command:status", command.toJSON());
}

async function tickFleet(io: Server) {
  if (ticking) return;
  const active = [...runners.values()].filter((runner) => runner.active);
  if (!active.length) return;
  ticking = true;
  const completeAfter: Runner[] = [];
  try {
    const computed = active.map((runner) => {
      runner.sequence += 1;
      const previousPosition = runner.previous;
      let position = runner.previous;
      let segment = 0;
      let speed = 0;
      if (runner.phase === "TAKEOFF") {
        const takeoffAltitude = runner.path[0].altitude ?? 32;
        runner.altitude = Math.min(takeoffAltitude, runner.altitude + 8);
        if (runner.altitude >= takeoffAltitude) runner.phase = "MISSION";
      } else if (runner.phase === "LANDING") {
        runner.altitude = Math.max(0, runner.altitude - 10);
        if (runner.altitude === 0) completeAfter.push(runner);
      } else if (runner.phase !== "PAUSED") {
        if (runner.routeIndex < runner.path.length - 1) runner.routeIndex += 1;
        else if (runner.loop) runner.routeIndex = 0;
        else if (runner.phase === "MISSION") setReturnHome(runner);
        else if (runner.phase === "RETURN_HOME") runner.phase = "LANDING";
        position = runner.path[runner.routeIndex];
        segment = haversineMeters(runner.previous, position);
        speed = position.speed ?? Math.max(2, Math.min(18, segment));
        if (segment > 0)
          runner.heading = bearingDegrees(previousPosition, position);
        runner.previous = position;
        if (runner.phase === "MISSION")
          runner.altitude =
            position.altitude ?? 32 + Math.sin(runner.sequence / 16) * 8;
      }

      if (
        runner.anomalies.has("WIND_DRIFT") &&
        runner.sequence > 5 &&
        !["PAUSED", "LANDING"].includes(runner.phase)
      ) {
        const drift = Math.min(0.00035, (runner.sequence - 5) * 0.000012);
        position = {
          ...position,
          latitude: position.latitude + Math.sin(runner.sequence) * drift,
          longitude: position.longitude + Math.cos(runner.sequence) * drift,
        };
        runner.previous = position;
      }
      const battery = Math.max(
        5,
        runner.batteryStart -
          runner.sequence * (runner.anomalies.has("LOW_BATTERY") ? 0.7 : 0.08),
      );
      const gpsSatellites =
        runner.anomalies.has("GPS_WEAK") && runner.sequence > 5
          ? 4
          : 14 + Math.round(Math.sin(runner.sequence / 8));
      const signal =
        runner.anomalies.has("SIGNAL_LOSS") && runner.sequence > 5
          ? Math.max(0, 96 - (runner.sequence - 5) * 14)
          : Math.max(24, 96 - runner.sequence * 0.12);
      const conditions: AlertCondition[] = [];
      const batteryRule = runner.alertRules.BATTERY_LOW;
      const gpsRule = runner.alertRules.GPS_WEAK;
      const signalRule = runner.alertRules.SIGNAL_LOW;
      const geofenceRule = runner.alertRules.GEOFENCE_BREACH;
      if (batteryRule.enabled && battery < (batteryRule.threshold ?? 30))
        conditions.push({
          type: "BATTERY_LOW",
          message: `Battery level is below ${batteryRule.threshold ?? 30}%`,
          severity: batteryRule.severity,
          autoAction: batteryRule.autoAction,
        });
      if (gpsRule.enabled && gpsSatellites < (gpsRule.threshold ?? 6))
        conditions.push({
          type: "GPS_WEAK",
          message: `GPS satellite count is below ${gpsRule.threshold ?? 6}`,
          severity: gpsRule.severity,
          autoAction: gpsRule.autoAction,
        });
      if (signalRule.enabled && signal < (signalRule.threshold ?? 30))
        conditions.push({
          type: runner.anomalies.has("SIGNAL_LOSS")
            ? "SIGNAL_LOSS"
            : "SIGNAL_LOW",
          message: `Communication signal is below ${signalRule.threshold ?? 30}%`,
          severity: signalRule.severity,
          autoAction: signalRule.autoAction,
        });
      if (runner.anomalies.has("WIND_DRIFT") && runner.sequence > 5)
        conditions.push({
          type: "WIND_DRIFT",
          message: "Strong wind is displacing the aircraft",
          severity: "WARNING",
          autoAction: "NONE",
        });
      if (runner.anomalies.has("GPS_DRIFT") && runner.sequence > 5)
        conditions.push({
          type: "GPS_DRIFT",
          message: "Reported GPS position is drifting",
          severity: "WARNING",
          autoAction: "NONE",
        });
      if (
        runner.anomalies.has("EMERGENCY_LANDING") &&
        runner.sequence >= 12 &&
        !["LANDING", "RETURN_HOME"].includes(runner.phase)
      ) {
        runner.phase = "LANDING";
        conditions.push({
          type: "EMERGENCY_LANDING",
          message: "Aircraft initiated an emergency landing",
          severity: "CRITICAL",
          autoAction: "NONE",
        });
      }
      if (
        geofenceRule.enabled &&
        runner.phase === "MISSION" &&
        !insideGeofence(position, runner.geofence) &&
        !runner.alerted.has("GEOFENCE_BREACH")
      )
        conditions.push({
          type: "GEOFENCE_BREACH",
          message: "Drone crossed the assigned geofence",
          severity: geofenceRule.severity,
          autoAction: geofenceRule.autoAction,
        });
      const reportedPosition =
        runner.anomalies.has("GPS_DRIFT") && runner.sequence > 5
          ? {
              latitude: position.latitude + (runner.sequence - 5) * 0.000018,
              longitude: position.longitude - (runner.sequence - 5) * 0.000012,
            }
          : position;
      const payload: TelemetryPayload = {
        flightId: runner.flightId,
        droneId: runner.droneId,
        timestamp: new Date().toISOString(),
        sequence: runner.sequence,
        battery: Math.round(battery * 10) / 10,
        latitude: reportedPosition.latitude,
        longitude: reportedPosition.longitude,
        altitude: Math.round(runner.altitude * 10) / 10,
        speed: Math.round(speed * 10) / 10,
        gpsSatellites,
        signal: Math.round(signal),
        flightMode: "AUTO",
        routePattern: runner.routePattern,
        flightPhase: runner.phase,
        heading: Math.round(runner.heading * 10) / 10,
        waypointIndex: position.waypointIndex,
        waypointCount: runner.waypointCount,
      };
      return { runner, payload, segment, conditions };
    });

    await Promise.all([
      Telemetry.insertMany(
        computed.map(({ payload }) => payload),
        { ordered: false },
      ),
      Flight.bulkWrite(
        computed.map(({ runner, payload, segment }) => ({
          updateOne: {
            filter: { _id: runner.flightId, status: "ACTIVE" },
            update: {
              $set: { flightPhase: runner.phase },
              $inc: { distanceMeters: segment },
              $max: { maxAltitude: payload.altitude, maxSpeed: payload.speed },
            },
          },
        })),
        { ordered: false },
      ),
      Drone.bulkWrite(
        computed.map(({ runner, payload, conditions }) => ({
          updateOne: {
            filter: { _id: runner.droneId, activeFlightId: runner.flightId },
            update: {
              $set: {
                battery: payload.battery,
                lastSeen: new Date(payload.timestamp),
                status: conditions.length ? "WARNING" : "IN_FLIGHT",
              },
            },
          },
        })),
        { ordered: false },
      ),
    ]);

    for (const { runner, conditions } of computed)
      for (const condition of conditions) {
        if (condition.autoAction === "NONE" || runner.automaticActionTaken)
          continue;
        const action = condition.autoAction as "RETURN_HOME" | "LAND";
        if (!runner.pendingAutomaticAction || action === "LAND")
          runner.pendingAutomaticAction = action;
      }
    for (const { runner, payload, conditions } of computed)
      for (const condition of conditions) {
        if (!runner.alerted.has(condition.type))
          runner.pendingAlerts.set(condition.type, { payload, condition });
      }
    const pending = active.flatMap((runner) =>
      [...runner.pendingAlerts.values()].map(({ payload, condition }) => ({
        runner,
        payload,
        condition,
      })),
    );
    const alerts = await persistPendingAlerts(pending);
    for (const item of pending) {
      item.runner.alerted.add(item.condition.type);
      item.runner.pendingAlerts.delete(item.condition.type);
    }
    const activeAlertFlightIds = alerts.length
      ? new Set(
          (
            await Flight.find({
              _id: { $in: alerts.map((alert) => alert.flightId) },
              status: "ACTIVE",
            })
              .select("_id")
              .lean()
          ).map((flight: any) => String(flight._id)),
        )
      : new Set<string>();
    const staleAlerts = alerts.filter(
      (alert) => !activeAlertFlightIds.has(String(alert.flightId)),
    );
    if (staleAlerts.length)
      await Alert.updateMany(
        { _id: { $in: staleAlerts.map((alert) => alert._id) } },
        {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolutionNote: "Automatically resolved after flight completion",
        },
      );
    const automatic = new Map<
      string,
      { runner: Runner; action: "RETURN_HOME" | "LAND" }
    >();
    for (const runner of active)
      if (runner.pendingAutomaticAction && !runner.automaticActionTaken)
        automatic.set(runner.flightId, {
          runner,
          action: runner.pendingAutomaticAction,
        });
    for (const { runner, action } of automatic.values())
      if (!runner.automaticActionTaken) {
        let release: (() => void) | undefined;
        try {
          release = acquireCommandLock(runner.flightId);
        } catch {
          continue;
        }
        runner.automaticActionTaken = true;
        try {
          if (runner.missionId)
            await Mission.findByIdAndUpdate(runner.missionId, {
              status: "FAILED",
            });
          await createAutomaticSafetyCommand(io, runner, action);
          runner.pendingAutomaticAction = undefined;
        } catch (error) {
          runner.automaticActionTaken = false;
          console.error("Automatic safety action failed", error);
        } finally {
          release();
        }
      }
    for (const { runner, payload } of computed)
      io.to(`drone:${runner.droneId}`)
        .to("fleet")
        .emit("telemetry:update", payload);
    for (const alert of alerts.filter((item) =>
      activeAlertFlightIds.has(String(item.flightId)),
    ))
      io.to(`drone:${String(alert.droneId)}`)
        .to("fleet")
        .emit("alert:created", alert.toJSON());
    for (const runner of completeAfter)
      await stopSimulation(io, runner.flightId);
  } catch (error) {
    console.error("Fleet simulator tick failed", error);
  } finally {
    ticking = false;
  }
}

function ensureScheduler(io: Server) {
  if (!scheduler) scheduler = setInterval(() => void tickFleet(io), 1000);
}
function stopSchedulerIfIdle() {
  if (!runners.size && scheduler) {
    clearInterval(scheduler);
    scheduler = undefined;
  }
}
export function stopSimulatorScheduler() {
  if (scheduler) clearInterval(scheduler);
  scheduler = undefined;
  for (const runner of runners.values()) runner.active = false;
  runners.clear();
  launchLocks.clear();
  commandLocks.clear();
}

async function createRunner(
  io: Server,
  drone: any,
  scenario: Scenario,
  routePattern: RoutePattern,
  options?: {
    path?: NavigationPoint[];
    home?: Coordinate;
    missionId?: string;
    geofence?: any;
    loop?: boolean;
    anomalies?: AnomalyType[];
  },
) {
  const droneId = String(drone._id);
  const flightCode = makeCode("FL");
  const anomalies = new Set<AnomalyType>(
    options?.anomalies ?? (scenario === "NORMAL" ? [] : [scenario]),
  );
  const batteryStart = anomalies.has("LOW_BATTERY")
    ? Math.min(34, drone.battery)
    : drone.battery;
  const home = options?.home ?? demoCenter(drone.droneCode);
  const path: NavigationPoint[] =
    options?.path ?? createRoute(routePattern, home, flightCode);
  const waypointCount = options?.missionId
    ? Math.max(0, ...path.map((point) => point.waypointIndex ?? 0))
    : undefined;
  const alertRules = await getAlertRuleMap();
  const phase: FlightPhase = options?.missionId ? "TAKEOFF" : "MISSION";
  const flight = await Flight.create({
    flightCode,
    droneId,
    missionId: options?.missionId,
    status: "ACTIVE",
    scenario,
    anomalyTypes: [...anomalies],
    routePattern,
    flightPhase: phase,
    homePosition: home,
    startedAt: new Date(),
    batteryStart,
  });
  let claimed = false;
  try {
    const claimedDrone = await Drone.findOneAndUpdate(
      { _id: droneId, activeFlightId: null },
      {
        $set: {
          status: "IN_FLIGHT",
          battery: batteryStart,
          lastSeen: new Date(),
          activeFlightId: flight._id,
        },
      },
      { returnDocument: "after" },
    );
    if (!claimedDrone)
      throw new Error("This drone already has an active flight owner");
    claimed = true;
    runners.set(droneId, {
      flightId: String(flight._id),
      droneId,
      missionId: options?.missionId,
      scenario,
      anomalies,
      routePattern,
      path,
      waypointCount,
      routeIndex: 0,
      sequence: 0,
      previous: path[0],
      home,
      heading: path.length > 1 ? bearingDegrees(path[0], path[1]) : 0,
      batteryStart,
      altitude: phase === "TAKEOFF" ? 0 : 32,
      phase,
      resumePhase: "MISSION",
      loop: options?.loop ?? true,
      geofence: options?.geofence,
      alerted: new Set(),
      active: true,
      alertRules,
      automaticActionTaken: false,
      pendingAutomaticAction: undefined,
      pendingAlerts: new Map(),
    });
    io.emit("flight:status", {
      flightId: String(flight._id),
      droneId,
      status: "ACTIVE",
      flightPhase: phase,
      routePattern,
      scenario,
    });
    ensureScheduler(io);
    return flight;
  } catch (error) {
    const runner = runners.get(droneId);
    if (runner?.flightId === String(flight._id)) {
      runner.active = false;
      runners.delete(droneId);
    }
    if (claimed) {
      try {
        await Drone.findOneAndUpdate(
          { _id: droneId, activeFlightId: flight._id },
          {
            $set: {
              status: "ONLINE",
              battery: batteryStart,
              lastSeen: new Date(),
            },
            $unset: { activeFlightId: 1 },
          },
        );
      } catch (releaseError) {
        console.error(
          "Unable to release drone after launch failure",
          releaseError,
        );
      }
    }
    try {
      await Flight.findByIdAndUpdate(flight._id, {
        status: "FAILED",
        flightPhase: "COMPLETED",
        endedAt: new Date(),
      });
    } catch (flightError) {
      console.error("Unable to mark failed launch", flightError);
    }
    stopSchedulerIfIdle();
    throw error;
  }
}

export async function startSimulation(
  io: Server,
  droneId: string,
  scenario: Scenario,
  routePattern: RoutePattern = "RANDOM",
  anomalies?: AnomalyType[],
) {
  const release = acquireLaunchLocks([droneId]);
  try {
    const drone = await Drone.findOne({ _id: droneId, isArchived: false });
    if (!drone) throw new Error("Drone not found");
    const readiness = await assessDroneReadiness(drone);
    if (runners.has(droneId))
      readiness.blockers.push("Aircraft already has an active simulator");
    readiness.ready = readiness.blockers.length === 0;
    assertDroneReady(readiness, drone.droneCode);
    return await createRunner(io, drone, scenario, routePattern, { anomalies });
  } finally {
    release();
  }
}

export async function startMission(io: Server, missionId: string) {
  const mission: any = await Mission.findOne({
    _id: missionId,
    isArchived: false,
  })
    .populate("droneId")
    .populate("geofenceId");
  if (!mission) throw new Error("Mission not found");
  if (!mission.droneId) throw new Error("The assigned drone is unavailable");
  const droneId = String(mission.droneId._id);
  const release = acquireLaunchLocks([droneId]);
  let flight: any;
  try {
    if (!["READY", "DRAFT", "COMPLETED", "FAILED"].includes(mission.status))
      throw new Error("Mission cannot be started in its current status");
    const inspection = inspectMission(
      mission,
      mission.geofenceId,
      mission.droneId,
    );
    if (!inspection.valid)
      throw new Error(
        inspection.issues.map((issue) => issue.message).join("; "),
      );
    const readiness = await assessDroneReadiness(
      mission.droneId,
      missionBatteryRequirement(inspection.estimate.batteryPercent),
    );
    if (runners.has(droneId))
      readiness.blockers.push("Aircraft already has an active simulator");
    readiness.ready = readiness.blockers.length === 0;
    assertDroneReady(readiness, mission.droneId.droneCode);
    flight = await createRunner(io, mission.droneId, "NORMAL", "RANDOM", {
      path: buildMissionPath(mission.homePosition, mission.waypoints),
      home: mission.homePosition,
      missionId: String(mission._id),
      geofence: mission.geofenceId,
      loop: false,
    });
    mission.status = "RUNNING";
    if (["SCHEDULED", "PROCESSING"].includes(mission.scheduleStatus)) {
      mission.scheduleStatus = "STARTED";
      mission.scheduleError = undefined;
    }
    await mission.save();
    io.emit("mission:status", {
      missionId,
      status: "RUNNING",
      flightId: String(flight._id),
    });
    return flight;
  } catch (error) {
    if (flight) {
      try {
        // A mission write can fail after the flight has claimed the drone. Stop
        // that runner so a retry cannot inherit an orphaned active flight.
        await stopSimulation(io, String(flight._id), "FAILED");
      } catch (rollbackError: any) {
        // The runner is still unsafe to leave alive even if persistence is
        // unavailable. Remove it from the in-memory scheduler as a fallback;
        // recovery on the next server start will reconcile the database state.
        if (rollbackError?.message !== "Active flight not found")
          console.error("Mission launch rollback failed", rollbackError);
        const runner = runners.get(droneId);
        if (runner?.flightId === String(flight._id)) {
          runner.active = false;
          runners.delete(droneId);
          stopSchedulerIfIdle();
        }
      }
    }
    throw error;
  } finally {
    release();
  }
}

export async function executeCommand(
  io: Server,
  flightId: string,
  type: "PAUSE" | "RESUME" | "RETURN_HOME" | "LAND",
  requestedBy: string,
  retryOf?: string,
) {
  const flight = await Flight.findOne({ _id: flightId, status: "ACTIVE" });
  if (!flight) throw new Error("Active flight not found");
  const runner = runners.get(String(flight.droneId));
  if (!runner) throw new Error("Flight simulator is unavailable after restart");
  const release = acquireCommandLock(flightId);
  const previousPhase = runner.phase;
  const previousResumePhase = runner.resumePhase;
  const previousPath = runner.path;
  const previousRouteIndex = runner.routeIndex;
  const previousAutomaticActionTaken = runner.automaticActionTaken;
  const previousPendingAutomaticAction = runner.pendingAutomaticAction;
  let command: any;
  try {
    command = await Command.create({
      commandCode: makeCode("CMD"),
      flightId,
      droneId: flight.droneId,
      type,
      source: "OPERATOR",
      status: "REQUESTED",
      requestedBy,
      retryOf: retryOf ?? null,
    });
    command.status = "ACKNOWLEDGED";
    if (type === "PAUSE") {
      if (runner.phase === "PAUSED")
        throw new Error("Flight is already paused");
      if (!["TAKEOFF", "MISSION"].includes(runner.phase))
        throw new Error(
          "Flight cannot be paused during return-home or landing",
        );
      runner.resumePhase = runner.phase;
      runner.phase = "PAUSED";
    } else if (type === "RESUME") {
      if (runner.phase !== "PAUSED") throw new Error("Flight is not paused");
      runner.phase = runner.resumePhase;
    } else if (type === "RETURN_HOME") {
      if (runner.phase === "LANDING")
        throw new Error("Flight is already landing");
      if (runner.phase === "RETURN_HOME")
        throw new Error("Flight is already returning home");
      setReturnHome(runner);
    } else {
      if (runner.phase === "LANDING")
        throw new Error("Flight is already landing");
      runner.phase = "LANDING";
    }
    if (
      type === "LAND" ||
      (type === "RETURN_HOME" &&
        runner.pendingAutomaticAction === "RETURN_HOME")
    ) {
      runner.automaticActionTaken = true;
      runner.pendingAutomaticAction = undefined;
    }
    command.status = "COMPLETED";
    command.completedAt = new Date();
    await command.save();
    await Flight.findByIdAndUpdate(flightId, { flightPhase: runner.phase });
    if (runner.missionId)
      await Mission.findByIdAndUpdate(runner.missionId, {
        status:
          runner.phase === "PAUSED"
            ? "PAUSED"
            : ["RETURN_HOME", "LANDING"].includes(runner.phase)
              ? "CANCELLED"
              : "RUNNING",
      });
    io.emit("command:status", command.toJSON());
    return command;
  } catch (error: any) {
    runner.phase = previousPhase;
    runner.resumePhase = previousResumePhase;
    runner.path = previousPath;
    runner.routeIndex = previousRouteIndex;
    runner.automaticActionTaken = previousAutomaticActionTaken;
    runner.pendingAutomaticAction = previousPendingAutomaticAction;
    try {
      await Flight.findByIdAndUpdate(flightId, { flightPhase: previousPhase });
    } catch (rollbackError) {
      console.error(
        "Unable to restore flight phase after command failure",
        rollbackError,
      );
    }
    if (runner.missionId) {
      const previousMissionStatus =
        previousPhase === "PAUSED"
          ? "PAUSED"
          : ["RETURN_HOME", "LANDING"].includes(previousPhase)
            ? "CANCELLED"
            : "RUNNING";
      try {
        await Mission.findByIdAndUpdate(runner.missionId, {
          status: previousMissionStatus,
        });
      } catch (rollbackError) {
        console.error(
          "Unable to restore mission status after command failure",
          rollbackError,
        );
      }
    }
    if (command) {
      command.status = "FAILED";
      command.failureReason = error.message;
      command.completedAt = new Date();
      try {
        await command.save();
        io.emit("command:status", command.toJSON());
      } catch (persistError) {
        console.error("Unable to persist failed command", persistError);
      }
      try {
        const alert = await Alert.create({
          flightId,
          droneId: flight.droneId,
          type: "COMMAND_FAILED",
          severity: "WARNING",
          message: `${type.replace("_", " ")} command failed: ${error.message}`,
        });
        io.emit("alert:created", alert.toJSON());
      } catch (alertError) {
        console.error("Unable to persist command failure alert", alertError);
      }
    }
    throw error;
  } finally {
    release();
  }
}

export async function executeFleetCommand(
  io: Server,
  flightIds: string[],
  type: "PAUSE" | "RESUME" | "RETURN_HOME" | "LAND",
  requestedBy: string,
) {
  const unique = [...new Set(flightIds)];
  if (!unique.length || unique.length > 10)
    throw new Error("Provide between 1 and 10 active flight IDs");
  const commands: any[] = [];
  const failures: Array<{ flightId: string; message: string }> = [];
  for (const flightId of unique) {
    try {
      commands.push(await executeCommand(io, flightId, type, requestedBy));
    } catch (error: any) {
      failures.push({
        flightId,
        message:
          typeof error?.message === "string"
            ? error.message
            : "Fleet command failed",
      });
    }
  }
  return {
    requested: unique.length,
    completed: commands.length,
    failed: failures.length,
    commands,
    failures,
  };
}

export async function startFleetSimulation(
  io: Server,
  assignments: Assignment[],
) {
  if (assignments.length !== 10)
    throw new Error("Fleet simulation requires exactly 10 drones");
  const ids = assignments.map(({ droneId }) => droneId);
  if (new Set(ids).size !== ids.length)
    throw new Error("Fleet assignments contain duplicate drones");
  const release = acquireLaunchLocks(ids);
  const flights = [];
  try {
    const drones = await Drone.find({ _id: { $in: ids }, isArchived: false });
    if (drones.length !== 10)
      throw new Error("One or more assigned drones were not found");
    const readiness = await assessFleetReadiness(drones);
    for (const item of readiness)
      if (runners.has(item.droneId)) {
        item.blockers.push("Aircraft already has an active simulator");
        item.ready = false;
      }
    const blocked = readiness.filter((item) => !item.ready);
    if (blocked.length) {
      const codes = new Map(
        drones.map((drone) => [String(drone._id), drone.droneCode]),
      );
      throw new Error(
        `Fleet cannot launch: ${blocked.map((item) => `${codes.get(item.droneId)} (${item.blockers.join(", ")})`).join("; ")}`,
      );
    }
    const first = randomInt(0, 10);
    let second = randomInt(0, 9);
    if (second >= first) second += 1;
    const map = new Map(drones.map((drone) => [String(drone._id), drone]));
    for (let index = 0; index < 10; index += 1)
      flights.push(
        await createRunner(
          io,
          map.get(assignments[index].droneId),
          index === first
            ? "LOW_BATTERY"
            : index === second
              ? "GPS_WEAK"
              : "NORMAL",
          assignments[index].routePattern,
        ),
      );
    return flights;
  } catch (error) {
    for (const flight of flights)
      await stopSimulation(io, String(flight._id), "FAILED");
    throw error;
  } finally {
    release();
  }
}

export async function stopSimulation(
  io: Server,
  flightId: string,
  finalStatus: "COMPLETED" | "FAILED" = "COMPLETED",
) {
  const flight = await Flight.findOne({ _id: flightId, status: "ACTIVE" });
  if (!flight) throw new Error("Active flight not found");
  const droneId = String(flight.droneId);
  const runner = runners.get(droneId);
  if (runner) runner.active = false;
  runners.delete(droneId);
  const latest = await Telemetry.findOne({ flightId }).sort({ sequence: -1 });
  const endedAt = new Date();
  flight.status = finalStatus;
  flight.flightPhase = "COMPLETED";
  flight.endedAt = endedAt;
  flight.durationSeconds = Math.round(
    (endedAt.getTime() - flight.startedAt.getTime()) / 1000,
  );
  flight.batteryEnd = latest?.battery ?? flight.batteryStart;
  await flight.save();
  await Drone.findByIdAndUpdate(droneId, {
    $set: {
      status: finalStatus === "FAILED" ? "OFFLINE" : "ONLINE",
      battery: flight.batteryEnd,
      lastSeen: endedAt,
    },
    $unset: { activeFlightId: 1 },
  });
  await Alert.updateMany(
    { flightId, status: { $in: ["ACTIVE", "ACKNOWLEDGED"] } },
    {
      status: "RESOLVED",
      resolvedAt: endedAt,
      resolutionNote: `Automatically resolved when flight ${finalStatus.toLowerCase()}`,
    },
  );
  if (flight.missionId) {
    const mission = await Mission.findById(flight.missionId);
    const missionStatus =
      mission && ["CANCELLED", "FAILED"].includes(mission.status)
        ? mission.status
        : finalStatus;
    await Mission.findByIdAndUpdate(flight.missionId, {
      status: missionStatus,
    });
    io.emit("mission:status", {
      missionId: String(flight.missionId),
      status: missionStatus,
      flightId,
    });
  }
  io.emit("flight:status", {
    flightId,
    droneId,
    status: finalStatus,
    flightPhase: "COMPLETED",
  });
  stopSchedulerIfIdle();
  return flight;
}

export async function stopFleetSimulation(io: Server, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 10)
    throw new Error("Provide between 1 and 10 active flight IDs");
  const results = [];
  for (const id of unique) {
    try {
      results.push(await stopSimulation(io, id));
    } catch (error: any) {
      // A fleet member may complete automatically between the UI refresh and this batch request.
      // Treat that race as an idempotent stop; propagate every other failure.
      if (error?.message !== "Active flight not found") throw error;
    }
  }
  return results;
}
export async function recoverInterruptedFlights() {
  const active = await Flight.find({ status: "ACTIVE" });
  for (const flight of active) {
    flight.status = "FAILED";
    flight.flightPhase = "COMPLETED";
    flight.endedAt = new Date();
    await flight.save();
    await Drone.findByIdAndUpdate(flight.droneId, {
      $set: { status: "OFFLINE" },
      $unset: { activeFlightId: 1 },
    });
    if (flight.missionId)
      await Mission.findByIdAndUpdate(flight.missionId, { status: "FAILED" });
  }
  // An interrupted claim can leave an activeFlightId without a matching
  // in-memory runner or ACTIVE flight. Clear it and make the aircraft fail
  // safe instead of presenting a permanently IN_FLIGHT status.
  await Drone.updateMany(
    { activeFlightId: { $ne: null } },
    {
      $set: { status: "OFFLINE", lastSeen: new Date() },
      $unset: { activeFlightId: 1 },
    },
  );
  await Mission.updateMany(
    { isArchived: false, status: "READY", scheduleStatus: "PROCESSING" },
    {
      $set: {
        scheduleStatus: "SCHEDULED",
        scheduleError: "Rescheduled after server recovery",
      },
    },
  );
  await Alert.updateMany(
    { status: { $in: ["ACTIVE", "ACKNOWLEDGED"] } },
    {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolutionNote: "Automatically resolved during server recovery",
    },
  );
}
