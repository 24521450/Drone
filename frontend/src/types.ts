export type User = { id: string; name: string; email: string; role: "ADMIN" | "VIEWER"; isActive: boolean; createdAt?: string };
export const ROUTE_PATTERNS = ["RANDOM", "STAR", "SQUARE", "CIRCLE", "GRID", "TRIANGLE", "SPIRAL", "FIGURE_EIGHT", "ZIGZAG"] as const;
export type RoutePattern = typeof ROUTE_PATTERNS[number];
export const ROUTE_PATTERN_META: Record<RoutePattern, { label: string; description: string }> = {
  RANDOM: { label: "Random walk", description: "Seeded organic path" },
  STAR: { label: "Star loop", description: "Five-point inspection loop" },
  SQUARE: { label: "Square loop", description: "Four-sided perimeter" },
  CIRCLE: { label: "Circle patrol", description: "Smooth circular orbit" },
  GRID: { label: "Grid survey", description: "Lawnmower coverage" },
  TRIANGLE: { label: "Triangle loop", description: "Three-sided perimeter" },
  SPIRAL: { label: "Spiral search", description: "Expanding search from home" },
  FIGURE_EIGHT: { label: "Figure-eight", description: "Crossing calibration loop" },
  ZIGZAG: { label: "Zigzag sweep", description: "Alternating survey passes" },
};
export const routePatternLabel = (pattern?: string | null) => pattern && Object.prototype.hasOwnProperty.call(ROUTE_PATTERN_META, pattern) ? ROUTE_PATTERN_META[pattern as RoutePattern].label : pattern?.replaceAll("_", " ") || ROUTE_PATTERN_META.RANDOM.label;
export type AnomalyType = "LOW_BATTERY" | "GPS_WEAK" | "SIGNAL_LOSS" | "WIND_DRIFT" | "GPS_DRIFT" | "EMERGENCY_LANDING";
export type FlightPhase = "TAKEOFF" | "MISSION" | "PAUSED" | "RETURN_HOME" | "LANDING" | "COMPLETED";
export type Coordinate = { latitude: number; longitude: number };
export type Waypoint = Coordinate & { order: number; altitude: number; speed: number };
export type Drone = { _id: string; droneCode: string; name: string; model: string; serialNumber: string; firmware: string; status: "OFFLINE" | "ONLINE" | "IN_FLIGHT" | "WARNING"; battery: number; activeFlightId?: string | null; lastSeen?: string; isDemo?: boolean };
export type ReadinessCheck = { key: "ARCHIVED" | "ACTIVE_FLIGHT" | "MAINTENANCE" | "BATTERY" | "CONNECTION"; label: string; status: "PASS" | "WARN" | "BLOCK"; message: string };
export type DroneReadiness = { droneId: string; ready: boolean; requiredBatteryPercent: number; checks: ReadinessCheck[]; blockers: string[] };
export type Geofence = { _id: string; name: string; type: "POLYGON" | "CIRCLE"; polygon?: Coordinate[]; center?: Coordinate; radiusMeters?: number; homePosition: Coordinate; isActive: boolean };
export type Mission = { _id: string; name: string; droneId: Drone | string; geofenceId?: Geofence | string | null; homePosition: Coordinate; waypoints: Waypoint[]; status: "DRAFT" | "READY" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED"; scheduledFor?: string; priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL"; scheduleStatus?: "NONE" | "SCHEDULED" | "PROCESSING" | "STARTED" | "FAILED" | "CANCELLED"; scheduleError?: string; scheduledBy?: { name: string; email: string } | string; createdAt?: string };
export type Flight = { _id: string; flightCode: string; droneId: Drone | string; missionId?: Mission | string; status: "ACTIVE" | "COMPLETED" | "FAILED"; flightPhase?: FlightPhase; homePosition?: Coordinate; scenario: string; anomalyTypes?: AnomalyType[]; routePattern: RoutePattern; startedAt: string; endedAt?: string; durationSeconds: number; distanceMeters: number; maxAltitude: number; maxSpeed: number; batteryStart: number; batteryEnd?: number };
export type Telemetry = { flightId: string; droneId: string; timestamp: string; sequence: number; battery: number; latitude: number; longitude: number; altitude: number; speed: number; heading?: number; gpsSatellites: number; signal: number; flightMode: string; flightPhase?: FlightPhase; routePattern: RoutePattern; /** 0 is home/takeoff; mission waypoints are 1-based. */ waypointIndex?: number; /** Total number of waypoints for mission flights. */ waypointCount?: number };
export type AlertActor = { _id: string; name: string; email: string } | string;
export type Alert = { _id: string; flightId: string; droneId: Drone | string; type: string; severity: "WARNING" | "CRITICAL"; message: string; status: "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED"; occurredAt: string; latitude?: number; longitude?: number; acknowledgedBy?: AlertActor; acknowledgedAt?: string; acknowledgementNote?: string; resolvedBy?: AlertActor; resolvedAt?: string; resolutionNote?: string };
export type Command = { _id: string; commandCode: string; flightId: string; droneId: Drone | string; type: "PAUSE" | "RESUME" | "RETURN_HOME" | "LAND"; source: "OPERATOR" | "SYSTEM"; status: "REQUESTED" | "ACKNOWLEDGED" | "EXECUTING" | "COMPLETED" | "FAILED"; requestedAt: string; completedAt?: string; failureReason?: string; retryOf?: string | null };
export type MissionInspection = { valid: boolean; issues: Array<{ code: string; message: string; waypointIndex?: number }>; estimate: { distanceMeters: number; durationSeconds: number; batteryPercent: number }; readiness?: DroneReadiness | null };
export type MissionTemplateType = "GRID_SURVEY" | "PERIMETER_PATROL" | "POINT_INSPECTION" | "DELIVERY_ROUTE" | "SPIRAL_SEARCH";
export type MissionTemplate = { type: MissionTemplateType; name: string; description: string };
export type AuditEvent = { _id: string; actorId: { _id: string; name: string; email: string; role: "ADMIN" | "VIEWER" } | string; action: string; resourceType: string; resourceId?: string; method: string; route: string; statusCode: number; ipAddress?: string; occurredAt: string };
export type MaintenanceType = "INSPECTION" | "BATTERY" | "PROPELLER" | "FIRMWARE" | "REPAIR";
export type MaintenanceStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type MaintenanceTask = { _id: string; droneId: Drone | string; type: MaintenanceType; status: MaintenanceStatus; scheduledFor: string; completedAt?: string; notes: string; createdBy: { name: string; email: string } | string; createdAt: string };
export type DroneHealth = { drone: Pick<Drone, "_id" | "droneCode" | "name" | "model" | "battery" | "status" | "lastSeen">; score: number; status: "HEALTHY" | "WATCH" | "SERVICE_DUE"; reasons: string[]; metrics: { flights: number; failedFlights: number; durationSeconds: number; distanceMeters: number; criticalAlerts: number; warningAlerts: number; openMaintenance: number; overdueMaintenance: number; nextScheduledFor?: string } };
export type AlertRule = { _id: string; key: "BATTERY_LOW" | "GPS_WEAK" | "SIGNAL_LOW" | "GEOFENCE_BREACH"; label: string; metric: "BATTERY_PERCENT" | "GPS_SATELLITES" | "SIGNAL_PERCENT" | "GEOFENCE"; unit: string; enabled: boolean; threshold: number | null; severity: "WARNING" | "CRITICAL"; autoAction: "NONE" | "RETURN_HOME" | "LAND"; updatedAt: string };
export type OperationalInsight = { key: string; category: "ANOMALY" | "PREDICTION" | "RECOMMENDATION"; severity: "INFO" | "WARNING" | "CRITICAL"; title: string; evidence: string; confidence: number; recommendation: string; droneId?: string; droneCode?: string };
export type OperationalInsights = { generatedAt: string; risk: { score: number; level: "LOW" | "WATCH" | "HIGH" | "CRITICAL" }; summary: { activeFlights: number; activeAlerts: number; criticalAlerts: number; staleTelemetry: number; overdueMaintenance: number; healthyFlights: number }; insights: OperationalInsight[] };
export type EnvironmentRainStatus = "NONE" | "LIGHT" | "MODERATE" | "HEAVY";
export type EnvironmentVisibilityStatus = "GOOD" | "REDUCED" | "POOR";
export type EnvironmentRiskLevel = "LOW" | "WATCH" | "HIGH" | "CRITICAL";
export type EnvironmentRiskFactor = { key: string; severity: "INFO" | "WARNING" | "CRITICAL"; label: string; message: string; score: number };
export type EnvironmentSnapshot = {
  generatedAt: string;
  source: "SIMULATED";
  sourceLabel: string;
  refreshIntervalSeconds: number;
  station: { name: string; latitude: number; longitude: number };
  conditions: {
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
  flightRisk: { score: number; level: EnvironmentRiskLevel; factors: EnvironmentRiskFactor[] };
  fleet: { activeFlights: number; atRiskFlights: number; telemetryCoveragePercent: number };
};
export type FieldPlotStatus = "NORMAL" | "WATER_STRESS" | "POSSIBLE_DISEASE" | "NUTRIENT_STRESS";
export type FieldPlot = { id: string; name: string; areaHectares: number; virtual: boolean; status: FieldPlotStatus; healthScore: number; diseaseRiskPercent: number; waterStressPercent: number; nutrientStressPercent: number; latestScanAt: string };
export type FieldIntelligence = {
  generatedAt: string;
  source: "SIMULATED_ANALYSIS";
  sourceLabel: string;
  field: { name: string; areaHectares: number; plotsCount: number };
  summary: { averageHealthScore: number; normal: number; waterStress: number; possibleDisease: number; nutrientStress: number; lastScanAt: string | null };
  plots: FieldPlot[];
};
export type MediaType = "PHOTO" | "VIDEO";
export type MediaSensorType = "RGB" | "THERMAL" | "MULTISPECTRAL";
export type MediaAsset = { mediaId: string; mediaType: MediaType; sensorType: MediaSensorType; capturedAt: string; droneId: string; droneCode: string; flightId: string; missionId?: string; latitude: number; longitude: number; altitude: number; durationSeconds?: number; fileLocation: string; status: "AVAILABLE"; virtual: boolean };
export type MediaLibrarySummary = { total: number; photos: number; videos: number; rgb: number; thermal: number; multispectral: number; latestCapture: string | null };
export type MediaLibraryResponse = { generatedAt?: string; source: "SIMULATED_CAPTURE"; sourceLabel: string; summary: MediaLibrarySummary; items: MediaAsset[] };
export type SystemServiceStatus = "ONLINE" | "DEGRADED" | "OFFLINE" | "SIMULATED" | "NOT_CONFIGURED";
export type SystemService = { key: string; label: string; status: SystemServiceStatus; detail: string; latencyMs?: number | null };
export type SystemStatus = { generatedAt: string; source: "RUNTIME"; sourceLabel: string; overallStatus: "ONLINE" | "DEGRADED"; services: SystemService[]; connection: { websocketClients: number; uptimeSeconds: number; nodeVersion: string; memoryRssMb: number } };
