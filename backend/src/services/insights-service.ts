export type InsightSeverity = "INFO" | "WARNING" | "CRITICAL";
export type InsightCategory = "ANOMALY" | "PREDICTION" | "RECOMMENDATION";
export type RiskLevel = "LOW" | "WATCH" | "HIGH" | "CRITICAL";

export type OperationalInsight = {
  key: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  evidence: string;
  confidence: number;
  recommendation: string;
  droneId?: string;
  droneCode?: string;
};

export type OperationalInsights = {
  generatedAt: string;
  risk: { score: number; level: RiskLevel };
  summary: {
    activeFlights: number;
    activeAlerts: number;
    criticalAlerts: number;
    staleTelemetry: number;
    overdueMaintenance: number;
    healthyFlights: number;
  };
  insights: OperationalInsight[];
};

type FlightInput = {
  id: string;
  droneId: string;
  droneCode?: string;
  flightPhase?: string;
};
type TelemetryInput = {
  flightId: string;
  sequence?: number;
  timestamp?: Date | string;
  battery?: number;
  signal?: number;
  gpsSatellites?: number;
};
type AlertInput = {
  flightId: string;
  droneId?: string;
  type: string;
  severity: string;
  message: string;
};
type MaintenanceInput = { droneId: string; type?: string };

const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const idValue = (value: unknown) => String(value ?? "");
const severityRank: Record<InsightSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

export function buildOperationalInsights(input: {
  flights: FlightInput[];
  telemetry: TelemetryInput[];
  alerts: AlertInput[];
  overdueMaintenance: MaintenanceInput[];
  now?: Date;
  staleAfterMs?: number;
}): OperationalInsights {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? 5_000;
  const flightById = new Map(input.flights.map((flight) => [flight.id, flight]));
  const latestByFlight = new Map<string, TelemetryInput>();
  input.telemetry.forEach((point) => {
    const current = latestByFlight.get(point.flightId);
    if (
      !current ||
      (numberValue(point.sequence) ?? 0) >= (numberValue(current.sequence) ?? 0)
    )
      latestByFlight.set(point.flightId, point);
  });

  const insights: OperationalInsight[] = [];
  let score = 0;
  let staleTelemetry = 0;
  let healthyFlights = 0;
  const add = (insight: OperationalInsight, weight: number) => {
    score += weight;
    insights.push(insight);
  };
  const context = (flight?: FlightInput) => ({
    droneId: flight?.droneId,
    droneCode: flight?.droneCode,
  });

  for (const flight of input.flights) {
    const latest = latestByFlight.get(flight.id);
    const details = context(flight);
    if (!latest) {
      staleTelemetry += 1;
      add(
        {
          key: `telemetry-missing-${flight.id}`,
          category: "ANOMALY",
          severity: "WARNING",
          title: "Telemetry heartbeat missing",
          evidence: `${flight.droneCode ?? "Aircraft"} has no packet for the active flight`,
          confidence: 98,
          recommendation: "Check the drone link before issuing a new command",
          ...details,
        },
        20,
      );
      continue;
    }
    const timestamp = latest.timestamp
      ? new Date(latest.timestamp).getTime()
      : Number.NaN;
    const age = Number.isFinite(timestamp)
      ? Math.max(0, now.getTime() - timestamp)
      : Number.POSITIVE_INFINITY;
    if (age > staleAfterMs) {
      staleTelemetry += 1;
      add(
        {
          key: `telemetry-stale-${flight.id}`,
          category: "ANOMALY",
          severity: "WARNING",
          title: "Telemetry stream is stale",
          evidence: `${flight.droneCode ?? "Aircraft"} last reported ${Math.round(age / 1_000)}s ago`,
          confidence: 95,
          recommendation: "Verify signal quality and keep the aircraft in a safe state",
          ...details,
        },
        18,
      );
    } else healthyFlights += 1;

    const battery = numberValue(latest.battery);
    if (battery != null && battery < 20)
      add(
        {
          key: `battery-critical-${flight.id}`,
          category: "PREDICTION",
          severity: "CRITICAL",
          title: "Battery reserve is critical",
          evidence: `${flight.droneCode ?? "Aircraft"} is reporting ${Math.round(battery)}% battery`,
          confidence: 97,
          recommendation: "Return home or land immediately",
          ...details,
        },
        35,
      );
    else if (battery != null && battery < 30)
      add(
        {
          key: `battery-low-${flight.id}`,
          category: "PREDICTION",
          severity: "WARNING",
          title: "Battery reserve is low",
          evidence: `${flight.droneCode ?? "Aircraft"} is reporting ${Math.round(battery)}% battery`,
          confidence: 96,
          recommendation: "Plan a return-home before the next route segment",
          ...details,
        },
        18,
      );

    const signal = numberValue(latest.signal);
    if (signal != null && signal < 30)
      add(
        {
          key: `signal-critical-${flight.id}`,
          category: "ANOMALY",
          severity: "CRITICAL",
          title: "Communication link is critical",
          evidence: `${flight.droneCode ?? "Aircraft"} signal is ${Math.round(signal)}%`,
          confidence: 94,
          recommendation: "Hold position and prepare a return-home command",
          ...details,
        },
        30,
      );
    else if (signal != null && signal < 50)
      add(
        {
          key: `signal-low-${flight.id}`,
          category: "ANOMALY",
          severity: "WARNING",
          title: "Communication link is weakening",
          evidence: `${flight.droneCode ?? "Aircraft"} signal is ${Math.round(signal)}%`,
          confidence: 91,
          recommendation: "Watch the link and avoid extending the route",
          ...details,
        },
        14,
      );

    const gps = numberValue(latest.gpsSatellites);
    if (gps != null && gps < 6)
      add(
        {
          key: `gps-critical-${flight.id}`,
          category: "ANOMALY",
          severity: "CRITICAL",
          title: "GPS fix is unreliable",
          evidence: `${flight.droneCode ?? "Aircraft"} has ${Math.round(gps)} satellites`,
          confidence: 92,
          recommendation: "Pause the mission and verify the navigation environment",
          ...details,
        },
        20,
      );
    else if (gps != null && gps < 9)
      add(
        {
          key: `gps-low-${flight.id}`,
          category: "ANOMALY",
          severity: "WARNING",
          title: "GPS coverage is reduced",
          evidence: `${flight.droneCode ?? "Aircraft"} has ${Math.round(gps)} satellites`,
          confidence: 88,
          recommendation: "Keep the aircraft inside the planned safety zone",
          ...details,
        },
        10,
      );
  }

  input.alerts.forEach((alert, index) => {
    const flight = flightById.get(alert.flightId);
    const details = context(flight);
    const severity: InsightSeverity =
      alert.severity === "CRITICAL" ? "CRITICAL" : "WARNING";
    add(
      {
        key: `alert-${alert.flightId}-${alert.type}-${index}`,
        category: "RECOMMENDATION",
        severity,
        title: `${alert.type.replaceAll("_", " ")} needs attention`,
        evidence: alert.message,
        confidence: 100,
        recommendation:
          severity === "CRITICAL"
            ? "Acknowledge the alert and follow the failsafe policy"
            : "Acknowledge and monitor the aircraft condition",
        ...details,
        ...(alert.droneId && !details.droneId ? { droneId: alert.droneId } : {}),
      },
      severity === "CRITICAL" ? 30 : 12,
    );
  });

  const overdueByDrone = new Map<string, MaintenanceInput[]>();
  input.overdueMaintenance.forEach((task) => {
    const key = idValue(task.droneId);
    const tasks = overdueByDrone.get(key) ?? [];
    tasks.push(task);
    overdueByDrone.set(key, tasks);
  });
  overdueByDrone.forEach((tasks, droneId) => {
    const flight = input.flights.find((item) => item.droneId === droneId);
    const details = context(flight);
    add(
      {
        key: `maintenance-overdue-${droneId}`,
        category: "PREDICTION",
        severity: "WARNING",
        title: "Maintenance task is overdue",
        evidence: `${details.droneCode ?? "Aircraft"} has ${tasks.length} overdue maintenance task${tasks.length === 1 ? "" : "s"}`,
        confidence: 91,
        recommendation: "Complete the maintenance task before the next launch",
        ...details,
        ...(details.droneId ? {} : { droneId }),
      },
      10,
    );
  });

  if (!insights.length)
    insights.push({
      key: "fleet-all-clear",
      category: "RECOMMENDATION",
      severity: "INFO",
      title: input.flights.length ? "Fleet conditions are nominal" : "No active flights",
      evidence: input.flights.length
        ? "Active telemetry and operational rules show no elevated indicators"
        : "There are no active aircraft requiring an immediate decision",
      confidence: 96,
      recommendation: input.flights.length
        ? "Continue monitoring the live streams"
        : "Run preflight checks before launching a mission",
    });

  insights.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const riskScore = Math.min(100, Math.round(score));
  const level: RiskLevel =
    riskScore >= 70
      ? "CRITICAL"
      : riskScore >= 40
        ? "HIGH"
        : riskScore > 0
          ? "WATCH"
          : "LOW";
  return {
    generatedAt: now.toISOString(),
    risk: { score: riskScore, level },
    summary: {
      activeFlights: input.flights.length,
      activeAlerts: input.alerts.length,
      criticalAlerts: input.alerts.filter((alert) => alert.severity === "CRITICAL")
        .length,
      staleTelemetry,
      overdueMaintenance: input.overdueMaintenance.length,
      healthyFlights,
    },
    insights,
  };
}
