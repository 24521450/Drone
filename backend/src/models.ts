import mongoose, { Schema } from "mongoose";
import { ROUTE_PATTERNS } from "./types.js";

const timestamps = { timestamps: true } as const;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["ADMIN", "VIEWER"], default: "VIEWER" },
  isActive: { type: Boolean, default: true },
}, timestamps);
userSchema.index({ createdAt: -1 });
userSchema.index({ role: 1, isActive: 1, createdAt: -1 });

const droneSchema = new Schema({
  droneCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  model: { type: String, required: true, trim: true },
  serialNumber: { type: String, required: true, unique: true, trim: true },
  firmware: { type: String, default: "1.0.0" },
  status: { type: String, enum: ["OFFLINE", "ONLINE", "IN_FLIGHT", "WARNING"], default: "OFFLINE" },
  battery: { type: Number, min: 0, max: 100, default: 100 },
  activeFlightId: { type: Schema.Types.ObjectId, ref: "Flight", default: null, index: true },
  lastSeen: Date,
  isArchived: { type: Boolean, default: false },
  isDemo: { type: Boolean, default: false, index: true },
}, timestamps);

const flightSchema = new Schema({
  flightCode: { type: String, required: true, unique: true },
  droneId: { type: Schema.Types.ObjectId, ref: "Drone", required: true, index: true },
  status: { type: String, enum: ["ACTIVE", "COMPLETED", "FAILED"], default: "ACTIVE" },
  scenario: { type: String, enum: ["NORMAL", "LOW_BATTERY", "GPS_WEAK"], default: "NORMAL" },
  anomalyTypes: { type: [String], enum: ["LOW_BATTERY", "GPS_WEAK", "SIGNAL_LOSS", "WIND_DRIFT", "GPS_DRIFT", "EMERGENCY_LANDING"], default: [] },
  routePattern: { type: String, enum: [...ROUTE_PATTERNS], default: "RANDOM" },
  missionId: { type: Schema.Types.ObjectId, ref: "Mission", default: null, index: true },
  flightPhase: { type: String, enum: ["TAKEOFF", "MISSION", "PAUSED", "RETURN_HOME", "LANDING", "COMPLETED"], default: "MISSION" },
  homePosition: { latitude: Number, longitude: Number },
  startedAt: { type: Date, required: true },
  endedAt: Date,
  durationSeconds: { type: Number, default: 0 },
  distanceMeters: { type: Number, default: 0 },
  maxAltitude: { type: Number, default: 0 },
  maxSpeed: { type: Number, default: 0 },
  batteryStart: Number,
  batteryEnd: Number,
}, timestamps);

flightSchema.index({ startedAt: -1 });
flightSchema.index({ status: 1, startedAt: -1 });
flightSchema.index({ droneId: 1, startedAt: -1 });

const telemetrySchema = new Schema({
  flightId: { type: Schema.Types.ObjectId, ref: "Flight", required: true, index: true },
  droneId: { type: Schema.Types.ObjectId, ref: "Drone", required: true, index: true },
  timestamp: { type: Date, required: true, index: true },
  sequence: { type: Number, required: true },
  battery: Number,
  latitude: Number,
  longitude: Number,
  altitude: Number,
  speed: Number,
  heading: { type: Number, min: 0, max: 360, default: 0 },
  gpsSatellites: Number,
  signal: Number,
  flightMode: { type: String, default: "AUTO" },
  routePattern: { type: String, enum: [...ROUTE_PATTERNS], default: "RANDOM" },
  flightPhase: { type: String, enum: ["TAKEOFF", "MISSION", "PAUSED", "RETURN_HOME", "LANDING", "COMPLETED"], default: "MISSION" },
  waypointIndex: { type: Number, min: 0 },
  waypointCount: { type: Number, min: 1 },
}, timestamps);
telemetrySchema.index({ flightId: 1, sequence: 1 }, { unique: true });

const alertSchema = new Schema({
  flightId: { type: Schema.Types.ObjectId, ref: "Flight", required: true, index: true },
  droneId: { type: Schema.Types.ObjectId, ref: "Drone", required: true, index: true },
  type: { type: String, enum: ["BATTERY_LOW", "GPS_WEAK", "SIGNAL_LOW", "SIGNAL_LOSS", "WIND_DRIFT", "GPS_DRIFT", "EMERGENCY_LANDING", "GEOFENCE_BREACH", "COMMAND_FAILED"], required: true },
  severity: { type: String, enum: ["WARNING", "CRITICAL"], default: "WARNING" },
  message: { type: String, required: true },
  status: { type: String, enum: ["ACTIVE", "ACKNOWLEDGED", "RESOLVED"], default: "ACTIVE" },
  acknowledgedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  acknowledgedAt: Date,
  acknowledgementNote: { type: String, maxlength: 500, default: "" },
  resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  resolvedAt: Date,
  resolutionNote: { type: String, maxlength: 1000, default: "" },
  occurredAt: { type: Date, default: Date.now },
  latitude: Number,
  longitude: Number,
}, timestamps);

alertSchema.index({ occurredAt: -1 });
alertSchema.index({ status: 1, occurredAt: -1 });
alertSchema.index({ droneId: 1, occurredAt: -1 });

const coordinateSchema = new Schema({ latitude: { type: Number, required: true }, longitude: { type: Number, required: true } }, { _id: false });
const waypointSchema = new Schema({
  order: { type: Number, required: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  altitude: { type: Number, min: 10, max: 150, required: true },
  speed: { type: Number, min: 1, max: 20, required: true },
}, { _id: true });

const geofenceSchema = new Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ["POLYGON", "CIRCLE"], required: true },
  polygon: { type: [coordinateSchema], default: undefined },
  center: { type: coordinateSchema, default: undefined },
  radiusMeters: Number,
  homePosition: { type: coordinateSchema, required: true },
  isActive: { type: Boolean, default: true },
  isArchived: { type: Boolean, default: false },
}, timestamps);
geofenceSchema.index({ isArchived: 1, isActive: 1, createdAt: -1 });

const missionSchema = new Schema({
  name: { type: String, required: true, trim: true },
  droneId: { type: Schema.Types.ObjectId, ref: "Drone", required: true, index: true },
  geofenceId: { type: Schema.Types.ObjectId, ref: "Geofence", default: null },
  homePosition: { type: coordinateSchema, required: true },
  waypoints: { type: [waypointSchema], validate: [(value: unknown[]) => value.length >= 2, "At least two waypoints are required"] },
  status: { type: String, enum: ["DRAFT", "READY", "RUNNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"], default: "READY" },
  scheduledFor: Date,
  priority: { type: String, enum: ["LOW", "NORMAL", "HIGH", "CRITICAL"], default: "NORMAL" },
  scheduleStatus: { type: String, enum: ["NONE", "SCHEDULED", "PROCESSING", "STARTED", "FAILED", "CANCELLED"], default: "NONE", index: true },
  scheduleError: String,
  scheduledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  isArchived: { type: Boolean, default: false },
}, timestamps);
missionSchema.index({ scheduleStatus: 1, scheduledFor: 1 });
missionSchema.index({ isArchived: 1, status: 1, updatedAt: -1 });
missionSchema.index({ isArchived: 1, createdAt: -1 });

const commandSchema = new Schema({
  commandCode: { type: String, required: true, unique: true },
  flightId: { type: Schema.Types.ObjectId, ref: "Flight", required: true, index: true },
  droneId: { type: Schema.Types.ObjectId, ref: "Drone", required: true, index: true },
  type: { type: String, enum: ["PAUSE", "RESUME", "RETURN_HOME", "LAND"], required: true },
  source: { type: String, enum: ["OPERATOR", "SYSTEM"], default: "OPERATOR" },
  status: { type: String, enum: ["REQUESTED", "ACKNOWLEDGED", "EXECUTING", "COMPLETED", "FAILED"], default: "REQUESTED" },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  retryOf: { type: Schema.Types.ObjectId, ref: "Command", default: null },
  requestedAt: { type: Date, default: Date.now },
  completedAt: Date,
  failureReason: String,
}, timestamps);
commandSchema.index({ requestedAt: -1 });
commandSchema.index({ flightId: 1, requestedAt: -1 });

const auditEventSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  action: { type: String, required: true, index: true },
  resourceType: { type: String, required: true, index: true },
  resourceId: { type: String, default: null },
  method: { type: String, required: true },
  route: { type: String, required: true },
  statusCode: { type: Number, required: true },
  ipAddress: { type: String, default: null },
  occurredAt: { type: Date, default: Date.now, index: true },
}, { versionKey: false });

const maintenanceSchema = new Schema({
  droneId: { type: Schema.Types.ObjectId, ref: "Drone", required: true, index: true },
  type: { type: String, enum: ["INSPECTION", "BATTERY", "PROPELLER", "FIRMWARE", "REPAIR"], required: true },
  status: { type: String, enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"], default: "SCHEDULED", index: true },
  scheduledFor: { type: Date, required: true, index: true },
  completedAt: Date,
  notes: { type: String, maxlength: 1000, default: "" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, timestamps);

const alertRuleSchema = new Schema({
  key: { type: String, enum: ["BATTERY_LOW", "GPS_WEAK", "SIGNAL_LOW", "GEOFENCE_BREACH"], required: true, unique: true },
  label: { type: String, required: true },
  metric: { type: String, enum: ["BATTERY_PERCENT", "GPS_SATELLITES", "SIGNAL_PERCENT", "GEOFENCE"], required: true },
  unit: { type: String, default: "" },
  enabled: { type: Boolean, default: true },
  threshold: { type: Number, default: null },
  severity: { type: String, enum: ["WARNING", "CRITICAL"], required: true },
  autoAction: { type: String, enum: ["NONE", "RETURN_HOME", "LAND"], default: "NONE" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
}, timestamps);

export const User = mongoose.model("User", userSchema);
export const Drone = mongoose.model("Drone", droneSchema);
export const Flight = mongoose.model("Flight", flightSchema);
export const Telemetry = mongoose.model("Telemetry", telemetrySchema);
export const Alert = mongoose.model("Alert", alertSchema);
export const Geofence = mongoose.model("Geofence", geofenceSchema);
export const Mission = mongoose.model("Mission", missionSchema);
export const Command = mongoose.model("Command", commandSchema);
export const AuditEvent = mongoose.model("AuditEvent", auditEventSchema);
export const Maintenance = mongoose.model("Maintenance", maintenanceSchema);
export const AlertRule = mongoose.model("AlertRule", alertRuleSchema);
