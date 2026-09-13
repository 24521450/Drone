export type EnvironmentRainStatus = "NONE" | "LIGHT" | "MODERATE" | "HEAVY";
export type EnvironmentVisibilityStatus = "GOOD" | "REDUCED" | "POOR";
export type EnvironmentRiskLevel = "LOW" | "WATCH" | "HIGH" | "CRITICAL";
export type EnvironmentRiskSeverity = "INFO" | "WARNING" | "CRITICAL";

export type EnvironmentConditions = {
  temperatureC: number;
  humidityPercent: number;
  windSpeedMps: number;
  windDirectionDeg: number;
  windDirection: string;
  rainMm: number;
  rainStatus: EnvironmentRainStatus;
  visibilityKm: number;
  visibilityStatus: EnvironmentVisibilityStatus;
  pressureHpa: number;
  uvIndex: number;
};

export type EnvironmentRiskFactor = {
  key: string;
  severity: EnvironmentRiskSeverity;
  label: string;
  message: string;
  score: number;
};

export type EnvironmentFlightInput = {
  droneId?: string;
  droneCode?: string;
  battery?: number;
  signal?: number;
  altitude?: number;
};

export type EnvironmentSnapshot = {
  generatedAt: string;
  source: "SIMULATED";
  sourceLabel: string;
  refreshIntervalSeconds: number;
  station: {
    name: string;
    latitude: number;
    longitude: number;
  };
  conditions: EnvironmentConditions;
  flightRisk: {
    score: number;
    level: EnvironmentRiskLevel;
    factors: EnvironmentRiskFactor[];
  };
  fleet: {
    activeFlights: number;
    atRiskFlights: number;
    telemetryCoveragePercent: number;
  };
};

const round = (value: number, digits = 0) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const finite = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const cardinalDirection = (degrees: number) =>
  ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
    Math.round((((degrees % 360) + 360) % 360) / 45) % 8
  ];

export function buildEnvironmentConditions(now = new Date()): EnvironmentConditions {
  // Keep the demo believable while making the result stable for the current
  // minute. A refresh does not cause the dashboard to flicker every second.
  const minute = Math.floor(now.getTime() / 60_000);
  const dayPhase = ((minute % 1_440) / 1_440) * Math.PI * 2;
  const temperatureC = round(29.5 + Math.sin(dayPhase - 0.8) * 3.2, 1);
  const humidityPercent = Math.round(
    clamp(70 - Math.sin(dayPhase - 0.8) * 14, 42, 94),
  );
  const windSpeedMps = round(
    3.2 + Math.abs(Math.sin(dayPhase * 1.7 + 0.4)) * 3.4,
    1,
  );
  const windDirectionDeg = Math.round((minute * 7 + 35) % 360);
  const rainPulse = Math.max(0, Math.sin(dayPhase * 2.1 + 1.2));
  const rainMm = round(rainPulse > 0.74 ? (rainPulse - 0.74) * 14 : 0, 1);
  const rainStatus: EnvironmentRainStatus =
    rainMm >= 8 ? "HEAVY" : rainMm >= 3 ? "MODERATE" : rainMm > 0 ? "LIGHT" : "NONE";
  const visibilityKm = round(
    clamp(rainMm >= 8 ? 3.4 : rainMm >= 3 ? 6.8 : rainMm > 0 ? 8.7 : 12, 1, 12),
    1,
  );
  const visibilityStatus: EnvironmentVisibilityStatus =
    visibilityKm < 4 ? "POOR" : visibilityKm < 9 ? "REDUCED" : "GOOD";
  const uvIndex = round(
    clamp(Math.max(0, Math.sin(dayPhase - Math.PI / 2)) * 9.2, 0, 11),
    1,
  );

  return {
    temperatureC,
    humidityPercent,
    windSpeedMps,
    windDirectionDeg,
    windDirection: cardinalDirection(windDirectionDeg),
    rainMm,
    rainStatus,
    visibilityKm,
    visibilityStatus,
    pressureHpa: Math.round(1012 + Math.sin(dayPhase * 0.7) * 5),
    uvIndex,
  };
}

export function calculateEnvironmentRisk(
  conditions: EnvironmentConditions,
  flights: EnvironmentFlightInput[] = [],
) {
  const factors: EnvironmentRiskFactor[] = [];
  const add = (
    key: string,
    severity: EnvironmentRiskSeverity,
    label: string,
    message: string,
    score: number,
  ) => factors.push({ key, severity, label, message, score });

  if (conditions.windSpeedMps >= 12)
    add(
      "wind-critical",
      "CRITICAL",
      "Wind exceeds operating limit",
      `Wind is ${conditions.windSpeedMps.toFixed(1)} m/s from ${conditions.windDirection}`,
      35,
    );
  else if (conditions.windSpeedMps >= 8)
    add(
      "wind-watch",
      "WARNING",
      "Wind is elevated",
      `Wind is ${conditions.windSpeedMps.toFixed(1)} m/s from ${conditions.windDirection}`,
      18,
    );

  if (conditions.rainMm >= 8)
    add(
      "rain-critical",
      "CRITICAL",
      "Heavy rain detected",
      `${conditions.rainMm.toFixed(1)} mm precipitation is reducing flight margin`,
      35,
    );
  else if (conditions.rainMm >= 2)
    add(
      "rain-watch",
      "WARNING",
      "Rain is present",
      `${conditions.rainMm.toFixed(1)} mm precipitation reported at the field`,
      15,
    );

  if (conditions.visibilityKm < 4)
    add(
      "visibility-critical",
      "CRITICAL",
      "Visibility is poor",
      `Only ${conditions.visibilityKm.toFixed(1)} km visual range is available`,
      35,
    );
  else if (conditions.visibilityKm < 8)
    add(
      "visibility-watch",
      "WARNING",
      "Visibility is reduced",
      `${conditions.visibilityKm.toFixed(1)} km visual range is available`,
      16,
    );

  if (conditions.humidityPercent >= 92)
    add(
      "humidity-watch",
      "WARNING",
      "Humidity is very high",
      `Humidity is ${conditions.humidityPercent}%; inspect condensation risk`,
      6,
    );

  const batteryRisk = flights.filter((flight) => (finite(flight.battery) ?? 100) < 25);
  if (batteryRisk.length)
    add(
      "fleet-battery",
      batteryRisk.some((flight) => (finite(flight.battery) ?? 100) < 15)
        ? "CRITICAL"
        : "WARNING",
      "Aircraft battery reserve is low",
      `${batteryRisk.length} active aircraft report less than 25% battery`,
      Math.min(30, batteryRisk.length * 12),
    );

  const signalRisk = flights.filter((flight) => (finite(flight.signal) ?? 100) < 45);
  if (signalRisk.length)
    add(
      "fleet-signal",
      signalRisk.some((flight) => (finite(flight.signal) ?? 100) < 25)
        ? "CRITICAL"
        : "WARNING",
      "Aircraft link quality is weak",
      `${signalRisk.length} active aircraft report less than 45% signal`,
      Math.min(24, signalRisk.length * 10),
    );

  const altitudeRisk = flights.filter((flight) => (finite(flight.altitude) ?? 0) > 120);
  if (altitudeRisk.length)
    add(
      "fleet-altitude",
      "WARNING",
      "High-altitude exposure",
      `${altitudeRisk.length} active aircraft are above 120 m`,
      Math.min(12, altitudeRisk.length * 4),
    );

  const score = Math.min(100, factors.reduce((total, factor) => total + factor.score, 0));
  const level: EnvironmentRiskLevel =
    score >= 70 ? "CRITICAL" : score >= 45 ? "HIGH" : score > 0 ? "WATCH" : "LOW";
  const severityRank: Record<EnvironmentRiskSeverity, number> = {
    CRITICAL: 0,
    WARNING: 1,
    INFO: 2,
  };
  factors.sort(
    (left, right) =>
      severityRank[left.severity] - severityRank[right.severity] ||
      right.score - left.score,
  );
  return { score, level, factors };
}

export function buildEnvironmentSnapshot(input: {
  now?: Date;
  flights?: EnvironmentFlightInput[];
  conditions?: EnvironmentConditions;
} = {}): EnvironmentSnapshot {
  const now = input.now ?? new Date();
  const flights = input.flights ?? [];
  const conditions = input.conditions ?? buildEnvironmentConditions(now);
  const flightRisk = calculateEnvironmentRisk(conditions, flights);
  const atRiskFlights = flights.filter(
    (flight) =>
      (finite(flight.battery) ?? 100) < 25 ||
      (finite(flight.signal) ?? 100) < 45 ||
      (finite(flight.altitude) ?? 0) > 120,
  ).length;
  const telemetryPackets = flights.filter(
    (flight) =>
      finite(flight.battery) != null ||
      finite(flight.signal) != null ||
      finite(flight.altitude) != null,
  ).length;

  return {
    generatedAt: now.toISOString(),
    source: "SIMULATED",
    sourceLabel: "Demo environment model",
    refreshIntervalSeconds: 60,
    station: {
      name: "Demo operations field",
      latitude: 10.7607,
      longitude: 106.652,
    },
    conditions,
    flightRisk,
    fleet: {
      activeFlights: flights.length,
      atRiskFlights,
      telemetryCoveragePercent: flights.length
        ? Math.round((telemetryPackets / flights.length) * 100)
        : 100,
    },
  };
}
