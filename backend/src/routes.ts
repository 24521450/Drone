import { Router } from "express";
import mongoose, { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Server } from "socket.io";
import { requireAdmin, requireAuth, signToken } from "./auth.js";
import {
  Alert,
  AlertRule,
  AuditEvent,
  Command,
  Drone,
  Flight,
  Geofence,
  Maintenance,
  Mission,
  Telemetry,
  User,
} from "./models.js";
import { prepareDemoFleet, seedDemoFleet } from "./seed.js";
import {
  executeCommand,
  executeFleetCommand,
  startFleetSimulation,
  startMission,
  startSimulation,
  stopFleetSimulation,
  stopSimulation,
} from "./simulator.js";
import { ROUTE_PATTERNS, type AuthRequest } from "./types.js";
import { inspectMission } from "./mission-service.js";
import { insideGeofence } from "./geometry.js";
import {
  generateMissionTemplate,
  MISSION_TEMPLATE_TYPES,
  missionTemplates,
} from "./mission-templates.js";
import { calculateDroneHealth } from "./services/maintenance-service.js";
import { toCsv } from "./csv.js";
import {
  dateFields,
  dateRange,
  escapeRegex,
  mongoTimezoneOffset,
  objectId,
  optionalObjectId,
  paginationFields,
  timezoneOffsetField,
} from "./validation.js";
import {
  ALERT_RULE_KEYS,
  defaultAlertRules,
  ensureAlertRules,
} from "./alert-rules.js";
import {
  assessDroneReadiness,
  assessFleetReadiness,
  missionBatteryRequirement,
} from "./readiness.js";
import { buildOperationalInsights } from "./services/insights-service.js";
import { buildEnvironmentSnapshot } from "./services/environment-service.js";
import {
  buildFieldIntelligence,
  estimateBoundaryAreaHectares,
} from "./services/field-intelligence-service.js";
import { buildMediaLibrary, summarizeMediaItems } from "./services/media-service.js";
import { buildSystemStatus } from "./services/system-status-service.js";

const asyncRoute =
  (fn: (req: any, res: any, next: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    Promise.resolve(fn(req, res, next)).catch(next);
const parse = <T>(schema: z.ZodType<T>, value: unknown): T =>
  schema.parse(value);
const publicUser = (user: any) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  createdAt: user.createdAt,
});
const userFilterSchema = z.object({
  search: z.string().max(100).default(""),
  role: z.enum(["ALL", "ADMIN", "VIEWER"]).default("ALL"),
  status: z.enum(["ALL", "ACTIVE", "DISABLED"]).default("ALL"),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const userExportFilterSchema = userFilterSchema.omit({ page: true, limit: true });
function buildUserQuery(input: z.infer<typeof userFilterSchema>) {
  const query: Record<string, unknown> = {};
  const normalizedSearch = input.search.trim();
  if (normalizedSearch)
    query.$or = ["name", "email"].map((field) => ({
      [field]: { $regex: escapeRegex(normalizedSearch), $options: "i" },
    }));
  if (input.role !== "ALL") query.role = input.role;
  if (input.status !== "ALL") query.isActive = input.status === "ACTIVE";
  return query;
}
const geofenceFilterSchema = z.object({
  search: z.string().max(100).default(""),
  status: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL"),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const geofenceExportFilterSchema = geofenceFilterSchema.omit({
  page: true,
  limit: true,
});
const mediaFilterSchema = z
  .object({
    ...paginationFields,
    ...dateFields,
    timezoneOffsetMinutes: timezoneOffsetField,
    droneId: optionalObjectId,
    type: z.enum(["ALL", "PHOTO", "VIDEO"]).default("ALL"),
    sensorType: z
      .enum(["ALL", "RGB", "THERMAL", "MULTISPECTRAL"])
      .default("ALL"),
  })
  .refine(
    (value) =>
      !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
    {
      message: "Start date must not be after end date",
      path: ["dateFrom"],
    },
  );
const mediaExportFilterSchema = z
  .object({
    ...dateFields,
    timezoneOffsetMinutes: timezoneOffsetField,
    droneId: optionalObjectId,
    type: z.enum(["ALL", "PHOTO", "VIDEO"]).default("ALL"),
    sensorType: z
      .enum(["ALL", "RGB", "THERMAL", "MULTISPECTRAL"])
      .default("ALL"),
  })
  .refine(
    (value) =>
      !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
    {
      message: "Start date must not be after end date",
      path: ["dateFrom"],
    },
  );
function buildGeofenceQuery(input: z.infer<typeof geofenceFilterSchema>) {
  const query: Record<string, unknown> = { isArchived: false };
  const normalizedSearch = input.search.trim();
  if (normalizedSearch)
    query.name = { $regex: escapeRegex(normalizedSearch), $options: "i" };
  if (input.status !== "ALL") query.isActive = input.status === "ACTIVE";
  return query;
}
function recordAudit(io: Server, event: Record<string, unknown>) {
  return AuditEvent.create(event).then((created) => {
    io.to("admins").emit("audit:created", created.toJSON());
    return created;
  });
}
const auditActions: Record<string, string> = {
  "POST /users": "USER_CREATED",
  "PATCH /users/:id": "USER_UPDATED",
  "POST /drones": "DRONE_CREATED",
  "POST /drones/seed-demo": "DEMO_FLEET_SEEDED",
  "POST /drones/prepare-demo": "DEMO_FLEET_PREPARED",
  "PATCH /drones/:id": "DRONE_UPDATED",
  "DELETE /drones/:id": "DRONE_ARCHIVED",
  "POST /geofences": "GEOFENCE_CREATED",
  "PATCH /geofences/:id": "GEOFENCE_UPDATED",
  "DELETE /geofences/:id": "GEOFENCE_ARCHIVED",
  "POST /missions": "MISSION_CREATED",
  "PATCH /missions/:id": "MISSION_UPDATED",
  "DELETE /missions/:id": "MISSION_ARCHIVED",
  "POST /missions/:id/duplicate": "MISSION_DUPLICATED",
  "POST /missions/:id/start": "MISSION_STARTED",
  "POST /missions/:id/schedule": "MISSION_SCHEDULED",
  "DELETE /missions/:id/schedule": "MISSION_SCHEDULE_CANCELLED",
  "POST /commands": "FLIGHT_COMMAND_SENT",
  "POST /commands/:id/retry": "FLIGHT_COMMAND_RETRIED",
  "POST /commands/fleet": "FLEET_COMMAND_SENT",
  "POST /flights/simulate": "SIMULATION_STARTED",
  "POST /flights/simulate-fleet": "FLEET_SIMULATION_STARTED",
  "POST /flights/stop-fleet": "FLEET_SIMULATION_STOPPED",
  "POST /flights/:id/stop": "SIMULATION_STOPPED",
  "PATCH /alerts/:id/acknowledge": "ALERT_ACKNOWLEDGED",
  "POST /alerts/bulk-acknowledge": "ALERTS_BULK_ACKNOWLEDGED",
  "PATCH /alerts/:id/resolve": "ALERT_RESOLVED",
  "PATCH /alert-rules/:key": "ALERT_RULE_UPDATED",
  "POST /alert-rules/reset": "ALERT_RULES_RESET",
  "POST /maintenance": "MAINTENANCE_SCHEDULED",
  "PATCH /maintenance/:id": "MAINTENANCE_UPDATED",
};
const MAX_COMMAND_EXPORT_ROWS = 10_000;
const MAX_TELEMETRY_EXPORT_ROWS = 50_000;
const MAX_SCHEDULE_EXPORT_ROWS = 10_000;
const MAX_AUDIT_EXPORT_ROWS = 10_000;
const MAX_FLIGHT_EXPORT_ROWS = 10_000;
const MAX_ALERT_EXPORT_ROWS = 10_000;
const MAX_MAINTENANCE_EXPORT_ROWS = 10_000;
const MAX_DRONE_EXPORT_ROWS = 10_000;
const MAX_USER_EXPORT_ROWS = 10_000;
const MAX_GEOFENCE_EXPORT_ROWS = 10_000;
const MAX_MEDIA_EXPORT_ROWS = 10_000;

function auditMutations(io: Server) {
  return (req: AuthRequest, res: any, next: any) => {
    if (!req.user || !["POST", "PATCH", "DELETE"].includes(req.method))
      return next();
    let responseBody: any;
    const sendJson = res.json.bind(res);
    res.json = (body: any) => {
      responseBody = body;
      return sendJson(body);
    };
    res.once("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const route = String(req.route?.path ?? req.path);
      const action = auditActions[`${req.method} ${route}`];
      if (!action) return;
      const segment = route.split("/").filter(Boolean)[0] ?? "system";
      const data = responseBody?.data;
      const resourceId =
        req.params.id ?? data?._id ?? data?.id ?? data?.key ?? null;
      void recordAudit(io, {
        actorId: req.user!.id,
        action,
        resourceType: segment.replace(/s$/, "").toUpperCase(),
        resourceId: resourceId ? String(resourceId) : null,
        method: req.method,
        route,
        statusCode: res.statusCode,
        ipAddress: req.ip ?? null,
      }).catch((error) => console.error("Unable to record audit event", error));
    });
    next();
  };
}

export function createApiRouter(io: Server) {
  const router = Router();
  const syncUserSockets = (userId: string, role: string, isActive: boolean) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId !== userId) continue;
      if (!isActive) {
        socket.disconnect(true);
        continue;
      }
      socket.data.role = role;
      if (role === "ADMIN") socket.join("admins");
      else socket.leave("admins");
    }
  };
  router.param("id", (req, res, next, id) =>
    /^[a-f\d]{24}$/i.test(id)
      ? next()
      : res.status(400).json({
          success: false,
          error: { code: "INVALID_ID", message: "Resource ID is invalid" },
        }),
  );

  router.post(
    "/auth/login",
    asyncRoute(async (req, res) => {
      const body = parse(
        z.object({ email: z.string().email(), password: z.string().min(8) }),
        req.body,
      );
      const user = await User.findOne({ email: body.email.toLowerCase() });
      if (
        !user ||
        !user.isActive ||
        !(await bcrypt.compare(body.password, user.passwordHash))
      ) {
        return res.status(401).json({
          success: false,
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Email or password is incorrect",
          },
        });
      }
      const data = publicUser(user);
      void recordAudit(io, {
        actorId: data.id,
        action: "LOGIN",
        resourceType: "AUTH",
        resourceId: data.id,
        method: req.method,
        route: "/auth/login",
        statusCode: 200,
        ipAddress: req.ip ?? null,
      }).catch((error) =>
        console.error("Unable to record login audit event", error),
      );
      return res.json({
        success: true,
        data: {
          user: data,
          token: signToken({ id: data.id, email: data.email, role: data.role }),
        },
      });
    }),
  );

  router.get(
    "/auth/me",
    requireAuth,
    asyncRoute(async (req: AuthRequest, res) => {
      const user = await User.findById(req.user!.id);
      if (!user || !user.isActive)
        return res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "User is unavailable" },
        });
      return res.json({ success: true, data: publicUser(user) });
    }),
  );

  router.post(
    "/auth/logout",
    requireAuth,
    asyncRoute(async (req: AuthRequest, res) => {
      void recordAudit(io, {
        actorId: req.user!.id,
        action: "LOGOUT",
        resourceType: "AUTH",
        resourceId: req.user!.id,
        method: req.method,
        route: "/auth/logout",
        statusCode: 200,
        ipAddress: req.ip ?? null,
      }).catch((error) =>
        console.error("Unable to record logout audit event", error),
      );
      return res.json({ success: true, data: { loggedOut: true } });
    }),
  );

  router.use(requireAuth);
  router.use(auditMutations(io));

  router.get(
    "/users",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const input = parse(userFilterSchema, req.query);
      const query = buildUserQuery(input);
      const wantsPagination =
        req.query.page !== undefined || req.query.limit !== undefined;
      const page = input.page ?? 1;
      const limit = input.limit ?? 25;
      const cursor = User.find(query).sort({ createdAt: -1 });
      if (!wantsPagination)
        return res.json({
          success: true,
          data: (await cursor).map(publicUser),
        });
      const [items, total] = await Promise.all([
        cursor.skip((page - 1) * limit).limit(limit),
        User.countDocuments(query),
      ]);
      res.json({
        success: true,
        data: items.map(publicUser),
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }),
  );
  router.get(
    "/users/export",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const input = parse(userExportFilterSchema, req.query);
      const query = buildUserQuery(input);
      const total = await User.countDocuments(query);
      if (total > MAX_USER_EXPORT_ROWS)
        return res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `Export is limited to ${MAX_USER_EXPORT_ROWS.toLocaleString()} user records. Narrow the filters and try again.`,
          },
        });
      const items = await User.find(query).sort({ createdAt: -1 }).lean();
      const headers = [
        "userId",
        "name",
        "email",
        "role",
        "status",
        "createdAt",
      ];
      const isoTimestamp = (value: unknown) =>
        value instanceof Date ? value.toISOString() : value ?? "";
      const rows = items.map((item: any) => ({
        userId: String(item._id),
        name: item.name,
        email: item.email,
        role: item.role,
        status: item.isActive ? "ACTIVE" : "DISABLED",
        createdAt: isoTimestamp(item.createdAt),
      }));
      const csv = rows.length
        ? toCsv(rows)
        : headers.map((header) => `"${header}"`).join(",");
      const filename = `users-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${csv}`);
    }),
  );
  router.post(
    "/users",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const body = parse(
        z.object({
          name: z.string().min(2),
          email: z.string().email(),
          password: z.string().min(8),
          role: z.enum(["ADMIN", "VIEWER"]).default("VIEWER"),
        }),
        req.body,
      );
      const { password, ...profile } = body;
      const user = await User.create({
        ...profile,
        email: body.email.toLowerCase(),
        passwordHash: await bcrypt.hash(password, 12),
      });
      io.emit("user:updated", publicUser(user));
      res.status(201).json({ success: true, data: publicUser(user) });
    }),
  );
  router.patch(
    "/users/:id",
    requireAdmin,
    asyncRoute(async (req: AuthRequest, res) => {
      const body = parse(
        z.object({
          name: z.string().min(2).optional(),
          role: z.enum(["ADMIN", "VIEWER"]).optional(),
          isActive: z.boolean().optional(),
        }),
        req.body,
      );
      if (req.params.id === req.user!.id && body.isActive === false)
        return res.status(400).json({
          success: false,
          error: {
            code: "SELF_DEACTIVATION",
            message: "You cannot deactivate your own account",
          },
        });
      const user = await User.findByIdAndUpdate(req.params.id, body, {
        returnDocument: "after",
        runValidators: true,
      });
      if (!user)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "User not found" },
        });
      syncUserSockets(String(user._id), user.role, user.isActive);
      io.emit("user:updated", publicUser(user));
      res.json({ success: true, data: publicUser(user) });
    }),
  );

  const droneBody = z.object({
    droneCode: z.string().min(3),
    name: z.string().min(2),
    model: z.string().min(1),
    serialNumber: z.string().min(3),
    firmware: z.string().default("1.0.0"),
  });
  router.get(
    "/drones",
    asyncRoute(async (req, res) => {
      const input = parse(
        z.object({
          search: z.string().max(100).default(""),
          status: z
            .enum(["ALL", "OFFLINE", "ONLINE", "IN_FLIGHT", "WARNING"])
            .default("ALL"),
          demo: z.enum(["true", "false"]).optional(),
          page: z.coerce.number().int().min(1).max(100_000).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
        req.query,
      );
      const { search, status, demo } = input;
      const query: any = { isArchived: false };
      if (demo === "true") query.isDemo = true;
      const normalizedSearch = search.trim();
      if (normalizedSearch)
        query.$or = ["droneCode", "name", "model", "serialNumber"].map(
          (field) => ({
            [field]: { $regex: escapeRegex(normalizedSearch), $options: "i" },
          }),
        );
      if (status !== "ALL") query.status = status;
      const wantsPagination =
        req.query.page !== undefined || req.query.limit !== undefined;
      const page = input.page ?? 1;
      const limit = input.limit ?? 25;
      const cursor = Drone.find(query).sort({ createdAt: -1 });
      if (!wantsPagination)
        return res.json({ success: true, data: await cursor });
      const [items, total] = await Promise.all([
        cursor.skip((page - 1) * limit).limit(limit),
        Drone.countDocuments(query),
      ]);
      res.json({
        success: true,
        data: items,
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }),
  );
  router.get(
    "/drones/export",
    asyncRoute(async (req, res) => {
      const input = parse(
        z.object({
          search: z.string().max(100).default(""),
          status: z
            .enum(["ALL", "OFFLINE", "ONLINE", "IN_FLIGHT", "WARNING"])
            .default("ALL"),
          demo: z.enum(["true", "false"]).optional(),
        }),
        req.query,
      );
      const query: any = { isArchived: false };
      if (input.demo === "true") query.isDemo = true;
      const normalizedSearch = input.search.trim();
      if (normalizedSearch)
        query.$or = ["droneCode", "name", "model", "serialNumber"].map(
          (field) => ({
            [field]: { $regex: escapeRegex(normalizedSearch), $options: "i" },
          }),
        );
      if (input.status !== "ALL") query.status = input.status;
      const total = await Drone.countDocuments(query);
      if (total > MAX_DRONE_EXPORT_ROWS)
        return res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `Export is limited to ${MAX_DRONE_EXPORT_ROWS.toLocaleString()} drone records. Narrow the filters and try again.`,
          },
        });
      const items = await Drone.find(query).sort({ createdAt: -1 }).lean();
      const headers = [
        "droneId",
        "droneCode",
        "name",
        "model",
        "serialNumber",
        "firmware",
        "status",
        "battery",
        "lastSeen",
        "isDemo",
        "createdAt",
      ];
      const isoTimestamp = (value: unknown) =>
        value instanceof Date ? value.toISOString() : value ?? "";
      const rows = items.map((item: any) => ({
        droneId: String(item._id),
        droneCode: item.droneCode,
        name: item.name,
        model: item.model,
        serialNumber: item.serialNumber,
        firmware: item.firmware,
        status: item.status,
        battery: item.battery,
        lastSeen: isoTimestamp(item.lastSeen),
        isDemo: item.isDemo ? "true" : "false",
        createdAt: isoTimestamp(item.createdAt),
      }));
      const csv = rows.length
        ? toCsv(rows)
        : headers.map((header) => `"${header}"`).join(",");
      const filename = `drones-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${csv}`);
    }),
  );
  router.post(
    "/drones",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const drone = await Drone.create(parse(droneBody, req.body));
      io.emit("drone:updated", drone.toJSON());
      res.status(201).json({ success: true, data: drone });
    }),
  );
  router.post(
    "/drones/seed-demo",
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const drones = await seedDemoFleet();
      io.emit("fleet:updated", {
        reason: "seed-demo",
        count: drones.drones.length,
      });
      res.json({ success: true, data: drones });
    }),
  );
  router.post(
    "/drones/prepare-demo",
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const drones = await prepareDemoFleet();
      io.emit("fleet:updated", {
        reason: "prepare-demo",
        count: drones.drones.length,
      });
      res.json({ success: true, data: drones });
    }),
  );
  router.get(
    "/drones/readiness",
    asyncRoute(async (req, res) => {
      const { demo } = parse(
        z.object({ demo: z.enum(["true", "false"]).optional() }),
        req.query,
      );
      const query: any = { isArchived: false };
      if (demo === "true") query.isDemo = true;
      const drones = await Drone.find(query).sort({ droneCode: 1 });
      const items = await assessFleetReadiness(drones);
      res.json({
        success: true,
        data: {
          items,
          summary: {
            total: items.length,
            ready: items.filter((item) => item.ready).length,
            blocked: items.filter((item) => !item.ready).length,
            warnings: items.filter((item) =>
              item.checks.some((check) => check.status === "WARN"),
            ).length,
          },
        },
      });
    }),
  );
  router.get(
    "/drones/:id",
    asyncRoute(async (req, res) => {
      const drone = await Drone.findOne({
        _id: req.params.id,
        isArchived: false,
      });
      if (!drone)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Drone not found" },
        });
      res.json({ success: true, data: drone });
    }),
  );
  router.get(
    "/drones/:id/readiness",
    asyncRoute(async (req, res) => {
      const drone = await Drone.findOne({
        _id: req.params.id,
        isArchived: false,
      });
      if (!drone)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Drone not found" },
        });
      res.json({ success: true, data: await assessDroneReadiness(drone) });
    }),
  );
  router.patch(
    "/drones/:id",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const drone = await Drone.findOneAndUpdate(
        { _id: req.params.id, isArchived: false },
        parse(droneBody.partial(), req.body),
        { returnDocument: "after", runValidators: true },
      );
      if (!drone)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Drone not found" },
        });
      io.emit("drone:updated", drone.toJSON());
      res.json({ success: true, data: drone });
    }),
  );
  router.delete(
    "/drones/:id",
    requireAdmin,
    asyncRoute(async (req, res) => {
      if (await Flight.exists({ droneId: req.params.id, status: "ACTIVE" }))
        return res.status(409).json({
          success: false,
          error: {
            code: "ACTIVE_FLIGHT",
            message: "Stop the active flight before archiving this drone",
          },
        });
      if (
        await Mission.exists({
          droneId: req.params.id,
          isArchived: false,
          $or: [
            { status: { $in: ["DRAFT", "READY", "RUNNING", "PAUSED"] } },
            { scheduleStatus: { $in: ["SCHEDULED", "PROCESSING"] } },
          ],
        })
      )
        return res.status(409).json({
          success: false,
          error: {
            code: "IN_USE",
            message: "Drone is assigned to an unfinished or scheduled mission",
          },
        });
      const drone = await Drone.findByIdAndUpdate(
        req.params.id,
        { isArchived: true, status: "OFFLINE" },
        { returnDocument: "after" },
      );
      if (!drone)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Drone not found" },
        });
      io.emit("drone:updated", drone.toJSON());
      res.json({ success: true, data: drone });
    }),
  );

  const coordinate = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  });
  const geofenceBody = z
    .object({
      name: z.string().min(2),
      type: z.enum(["POLYGON", "CIRCLE"]),
      polygon: z.array(coordinate).min(3).optional(),
      center: coordinate.optional(),
      radiusMeters: z.number().min(20).max(10000).optional(),
      homePosition: coordinate,
      isActive: z.boolean().default(true),
    })
    .superRefine((value, ctx) => {
      if (value.type === "POLYGON" && !value.polygon)
        ctx.addIssue({
          code: "custom",
          message: "Polygon requires at least three points",
          path: ["polygon"],
        });
      if (value.type === "CIRCLE" && (!value.center || !value.radiusMeters))
        ctx.addIssue({
          code: "custom",
          message: "Circle requires center and radius",
          path: ["center"],
        });
      if (
        (value.type === "POLYGON"
          ? value.polygon
          : value.center && value.radiusMeters) &&
        !insideGeofence(value.homePosition, { ...value, isActive: true })
      )
        ctx.addIssue({
          code: "custom",
          message: "Home position must be inside the geofence",
          path: ["homePosition"],
        });
    });
  router.get(
    "/geofences",
    asyncRoute(async (req, res) => {
      const input = parse(geofenceFilterSchema, req.query);
      const query = buildGeofenceQuery(input);
      const wantsPagination =
        req.query.page !== undefined || req.query.limit !== undefined;
      const page = input.page ?? 1;
      const limit = input.limit ?? 25;
      const cursor = Geofence.find(query).sort({ createdAt: -1 });
      if (!wantsPagination)
        return res.json({ success: true, data: await cursor });
      const [items, total] = await Promise.all([
        cursor.skip((page - 1) * limit).limit(limit),
        Geofence.countDocuments(query),
      ]);
      res.json({
        success: true,
        data: items,
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }),
  );
  router.get(
    "/geofences/export",
    asyncRoute(async (req, res) => {
      const input = parse(geofenceExportFilterSchema, req.query);
      const query = buildGeofenceQuery(input);
      const total = await Geofence.countDocuments(query);
      if (total > MAX_GEOFENCE_EXPORT_ROWS)
        return res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `Export is limited to ${MAX_GEOFENCE_EXPORT_ROWS.toLocaleString()} geofence records. Narrow the filters and try again.`,
          },
        });
      const items = await Geofence.find(query).sort({ createdAt: -1 }).lean();
      const headers = [
        "geofenceId",
        "name",
        "type",
        "status",
        "isActive",
        "vertices",
        "centerLatitude",
        "centerLongitude",
        "radiusMeters",
        "homeLatitude",
        "homeLongitude",
        "createdAt",
      ];
      const isoTimestamp = (value: unknown) =>
        value instanceof Date ? value.toISOString() : value ?? "";
      const rows = items.map((item: any) => ({
        geofenceId: String(item._id),
        name: item.name,
        type: item.type,
        status: item.isActive ? "ACTIVE" : "INACTIVE",
        isActive: item.isActive ? "true" : "false",
        vertices: item.type === "POLYGON" ? item.polygon?.length ?? 0 : "",
        centerLatitude: item.center?.latitude ?? "",
        centerLongitude: item.center?.longitude ?? "",
        radiusMeters: item.radiusMeters ?? "",
        homeLatitude: item.homePosition?.latitude ?? "",
        homeLongitude: item.homePosition?.longitude ?? "",
        createdAt: isoTimestamp(item.createdAt),
      }));
      const csv = rows.length
        ? toCsv(rows)
        : headers.map((header) => `"${header}"`).join(",");
      const filename = `geofences-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${csv}`);
    }),
  );
  router.post(
    "/geofences",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const item = await Geofence.create(parse(geofenceBody, req.body));
      io.emit("geofence:updated", item.toJSON());
      res.status(201).json({ success: true, data: item });
    }),
  );
  router.get(
    "/geofences/:id",
    asyncRoute(async (req, res) => {
      const item = await Geofence.findOne({
        _id: req.params.id,
        isArchived: false,
      });
      if (!item)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Geofence not found" },
        });
      res.json({ success: true, data: item });
    }),
  );
  router.patch(
    "/geofences/:id",
    requireAdmin,
    asyncRoute(async (req, res) => {
      if (
        await Mission.exists({
          geofenceId: req.params.id,
          isArchived: false,
          $or: [
            { status: { $in: ["DRAFT", "READY", "RUNNING", "PAUSED"] } },
            { scheduleStatus: { $in: ["SCHEDULED", "PROCESSING"] } },
          ],
        })
      )
        return res.status(409).json({
          success: false,
          error: {
            code: "IN_USE",
            message:
              "Geofence cannot be edited while assigned to an unfinished or scheduled mission",
          },
        });
      const item = await Geofence.findOneAndUpdate(
        { _id: req.params.id, isArchived: false },
        parse(geofenceBody, req.body),
        { returnDocument: "after", runValidators: true },
      );
      if (!item)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Geofence not found" },
        });
      io.emit("geofence:updated", item.toJSON());
      res.json({ success: true, data: item });
    }),
  );
  router.delete(
    "/geofences/:id",
    requireAdmin,
    asyncRoute(async (req, res) => {
      if (
        await Mission.exists({
          geofenceId: req.params.id,
          isArchived: false,
          $or: [
            { status: { $in: ["DRAFT", "READY", "RUNNING", "PAUSED"] } },
            { scheduleStatus: { $in: ["SCHEDULED", "PROCESSING"] } },
          ],
        })
      )
        return res.status(409).json({
          success: false,
          error: {
            code: "IN_USE",
            message:
              "Geofence is assigned to an unfinished or scheduled mission",
          },
        });
      const item = await Geofence.findByIdAndUpdate(
        req.params.id,
        { isArchived: true },
        { returnDocument: "after" },
      );
      if (!item)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Geofence not found" },
        });
      io.emit("geofence:updated", item.toJSON());
      res.json({ success: true, data: item });
    }),
  );

  router.get("/mission-templates", (_req, res) =>
    res.json({ success: true, data: missionTemplates }),
  );
  router.post(
    "/mission-templates/generate",
    asyncRoute(async (req, res) => {
      const body = parse(
        z.object({
          type: z.enum(MISSION_TEMPLATE_TYPES),
          center: coordinate,
          sizeMeters: z.number().min(20).max(1000),
          altitude: z.number().min(10).max(150),
          speed: z.number().min(1).max(20),
        }),
        req.body,
      );
      res.json({
        success: true,
        data: {
          type: body.type,
          waypoints: generateMissionTemplate(
            body.type,
            body.center,
            body.sizeMeters,
            body.altitude,
            body.speed,
          ),
        },
      });
    }),
  );

  const waypoint = z.object({
    order: z.number().int().min(0),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    altitude: z.number().min(10).max(150),
    speed: z.number().min(1).max(20),
  });
  const missionBody = z
    .object({
      name: z.string().min(2),
      droneId: objectId,
      geofenceId: objectId.nullable().optional(),
      homePosition: coordinate,
      waypoints: z.array(waypoint).min(2),
    })
    .superRefine((value, ctx) => {
      const orders = value.waypoints.map((point) => point.order);
      if (new Set(orders).size !== orders.length)
        ctx.addIssue({
          code: "custom",
          message: "Waypoint order values must be unique",
          path: ["waypoints"],
        });
    });
  const assertMissionResources = async (body: {
    droneId: string;
    geofenceId?: string | null;
  }) => {
    const [drone, geofence] = await Promise.all([
      Drone.findOne({ _id: body.droneId, isArchived: false }).select("_id"),
      body.geofenceId
        ? Geofence.findOne({ _id: body.geofenceId, isArchived: false }).select(
            "isActive",
          )
        : null,
    ]);
    if (!drone)
      throw new Error("The assigned drone was not found or is archived");
    if (body.geofenceId && !geofence)
      throw new Error("The assigned geofence was not found or is archived");
    if (geofence && !geofence.isActive)
      throw new Error("The assigned geofence is inactive");
  };
  router.get(
    "/missions",
    asyncRoute(async (req, res) => {
      const input = parse(
        z.object({
          ...paginationFields,
          limit: paginationFields.limit.default(20),
          search: z.string().max(100).default(""),
          status: z
            .enum([
              "ALL",
              "DRAFT",
              "READY",
              "RUNNING",
              "PAUSED",
              "COMPLETED",
              "FAILED",
              "CANCELLED",
            ])
            .default("ALL"),
        }),
        req.query,
      );
      const query: any = { isArchived: false };
      const normalizedSearch = input.search.trim();
      if (input.status !== "ALL") query.status = input.status;
      if (normalizedSearch)
        query.name = { $regex: escapeRegex(normalizedSearch), $options: "i" };
      const { page, limit } = input;
      const [items, total] = await Promise.all([
        Mission.find(query)
          .populate("droneId", "droneCode name")
          .populate("geofenceId", "name type")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Mission.countDocuments(query),
      ]);
      res.json({
        success: true,
        data: items,
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }),
  );
  router.post(
    "/missions",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const body = parse(missionBody, req.body);
      await assertMissionResources(body);
      const mission = await Mission.create(body);
      io.emit("mission:updated", mission.toJSON());
      res.status(201).json({ success: true, data: mission });
    }),
  );
  router.get(
    "/mission-schedule",
    asyncRoute(async (req, res) => {
      const scheduledStates = [
        "SCHEDULED",
        "PROCESSING",
        "STARTED",
        "FAILED",
        "CANCELLED",
      ] as const;
      const input = parse(
        z
          .object({
            ...paginationFields,
            limit: paginationFields.limit.default(20),
            ...dateFields,
            scheduleStatus: z.enum(["ALL", ...scheduledStates]).default("ALL"),
            timezoneOffsetMinutes: timezoneOffsetField,
          })
          .refine(
            (value) =>
              !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const scheduleMatch =
        input.scheduleStatus === "ALL"
          ? { $in: scheduledStates }
          : input.scheduleStatus;
      const query: any = { isArchived: false, scheduleStatus: scheduleMatch };
      if (input.dateFrom || input.dateTo)
        query.scheduledFor = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      // `Date#getTimezoneOffset()` is minutes west of UTC. Shift a copy of now
      // into the operator's wall-clock day, truncate it, then shift back to UTC.
      const localNow = new Date(
        Date.now() - input.timezoneOffsetMinutes * 60_000,
      );
      localNow.setUTCHours(0, 0, 0, 0);
      const dayStart = new Date(
        localNow.getTime() + input.timezoneOffsetMinutes * 60_000,
      );
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const dueTodayQuery: any = {
        isArchived: false,
        scheduleStatus: "SCHEDULED",
        scheduledFor: { $gte: dayStart, $lt: dayEnd },
      };
      const [items, total, counts, dueToday] = await Promise.all([
        Mission.find(query)
          .populate("droneId", "droneCode name status")
          .populate("scheduledBy", "name email")
          .sort({ scheduledFor: 1 })
          .skip((input.page - 1) * input.limit)
          .limit(input.limit),
        Mission.countDocuments(query),
        Mission.aggregate([
          {
            $match: query,
          },
          { $group: { _id: "$scheduleStatus", count: { $sum: 1 } } },
        ]),
        Mission.countDocuments(dueTodayQuery),
      ]);
      res.json({
        success: true,
        data: items,
        meta: {
          page: input.page,
          limit: input.limit,
          total,
          pages: Math.ceil(total / input.limit),
          counts: Object.fromEntries(
            counts.map((item: any) => [item._id, item.count]),
          ),
          dueToday,
        },
      });
    }),
  );
  router.get(
    "/mission-schedule/export",
    asyncRoute(async (req, res) => {
      const scheduledStates = [
        "SCHEDULED",
        "PROCESSING",
        "STARTED",
        "FAILED",
        "CANCELLED",
      ] as const;
      const input = parse(
        z
          .object({
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
            scheduleStatus: z
              .enum(["ALL", ...scheduledStates])
              .default("ALL"),
          })
          .refine(
            (value) =>
              !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const query: any = {
        isArchived: false,
        scheduleStatus:
          input.scheduleStatus === "ALL"
            ? { $in: scheduledStates }
            : input.scheduleStatus,
      };
      if (input.dateFrom || input.dateTo)
        query.scheduledFor = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      const total = await Mission.countDocuments(query);
      if (total > MAX_SCHEDULE_EXPORT_ROWS)
        return res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `Export is limited to ${MAX_SCHEDULE_EXPORT_ROWS.toLocaleString()} scheduled missions. Narrow the filters and try again.`,
          },
        });
      const items = await Mission.find(query)
        .populate("droneId", "droneCode name")
        .populate("scheduledBy", "name email")
        .sort({ scheduledFor: 1 })
        .lean();
      const headers = [
        "mission",
        "missionId",
        "drone",
        "priority",
        "scheduleStatus",
        "scheduledFor",
        "scheduledBy",
        "scheduleError",
        "createdAt",
      ];
      const isoTimestamp = (value: unknown) =>
        value instanceof Date ? value.toISOString() : value ?? "";
      const rows = items.map((item: any) => ({
        mission: item.name,
        missionId: String(item._id),
        drone:
          typeof item.droneId === "string"
            ? item.droneId
            : item.droneId?.droneCode ?? String(item.droneId?._id ?? ""),
        priority: item.priority ?? "NORMAL",
        scheduleStatus: item.scheduleStatus,
        scheduledFor: isoTimestamp(item.scheduledFor),
        scheduledBy:
          typeof item.scheduledBy === "string"
            ? item.scheduledBy
            : item.scheduledBy?.email ?? "",
        scheduleError: item.scheduleError ?? "",
        createdAt: isoTimestamp(item.createdAt),
      }));
      const csv = rows.length
        ? toCsv(rows)
        : headers.map((header) => `"${header}"`).join(",");
      const filename = `mission-schedule-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${csv}`);
    }),
  );
  router.get(
    "/missions/:id",
    asyncRoute(async (req, res) => {
      const item = await Mission.findOne({
        _id: req.params.id,
        isArchived: false,
      })
        .populate("droneId", "droneCode name")
        .populate("geofenceId");
      if (!item)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Mission not found" },
        });
      res.json({ success: true, data: item });
    }),
  );
  router.patch(
    "/missions/:id",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const existing = await Mission.findOne({
        _id: req.params.id,
        isArchived: false,
      });
      if (!existing)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Mission not found" },
        });
      if (["RUNNING", "PAUSED"].includes(existing.status))
        return res.status(409).json({
          success: false,
          error: {
            code: "MISSION_ACTIVE",
            message: "An active mission cannot be edited",
          },
        });
      if (["SCHEDULED", "PROCESSING"].includes(existing.scheduleStatus))
        return res.status(409).json({
          success: false,
          error: {
            code: "MISSION_SCHEDULED",
            message: "Cancel the scheduled launch before editing this mission",
          },
        });
      const body = parse(missionBody, req.body);
      await assertMissionResources(body);
      Object.assign(existing, body, {
        status: "READY",
        scheduleStatus: "NONE",
        scheduledFor: undefined,
        scheduleError: undefined,
        scheduledBy: null,
      });
      await existing.save();
      io.emit("mission:updated", existing.toJSON());
      res.json({ success: true, data: existing });
    }),
  );
  router.delete(
    "/missions/:id",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const item = await Mission.findOne({
        _id: req.params.id,
        isArchived: false,
      });
      if (!item)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Mission not found" },
        });
      if (["RUNNING", "PAUSED"].includes(item.status))
        return res.status(409).json({
          success: false,
          error: {
            code: "MISSION_ACTIVE",
            message: "An active mission cannot be archived",
          },
        });
      item.isArchived = true;
      item.status = "CANCELLED";
      if (["SCHEDULED", "PROCESSING"].includes(item.scheduleStatus))
        item.scheduleStatus = "CANCELLED";
      await item.save();
      io.emit("mission:updated", item.toJSON());
      res.json({ success: true, data: item });
    }),
  );
  router.post(
    "/missions/:id/validate",
    asyncRoute(async (req, res) => {
      const item: any = await Mission.findOne({
        _id: req.params.id,
        isArchived: false,
      })
        .populate("droneId")
        .populate("geofenceId");
      if (!item)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Mission not found" },
        });
      const inspection = inspectMission(item, item.geofenceId, item.droneId);
      const readiness = item.droneId
        ? await assessDroneReadiness(
            item.droneId,
            missionBatteryRequirement(inspection.estimate.batteryPercent),
          )
        : null;
      const readinessIssues =
        readiness?.blockers.map((message) => ({
          code: "DRONE_NOT_READY",
          message,
        })) ?? [];
      res.json({
        success: true,
        data: {
          ...inspection,
          valid: inspection.valid && Boolean(readiness?.ready),
          issues: [...inspection.issues, ...readinessIssues],
          readiness,
        },
      });
    }),
  );
  router.post(
    "/missions/:id/duplicate",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const item = await Mission.findOne({
        _id: req.params.id,
        isArchived: false,
      });
      if (!item)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Mission not found" },
        });
      await assertMissionResources({
        droneId: String(item.droneId),
        geofenceId: item.geofenceId ? String(item.geofenceId) : null,
      });
      const copy = await Mission.create({
        name: `Copy of ${item.name}`,
        droneId: item.droneId,
        geofenceId: item.geofenceId,
        homePosition: item.homePosition,
        waypoints: item.waypoints.map((point: any) => ({
          order: point.order,
          latitude: point.latitude,
          longitude: point.longitude,
          altitude: point.altitude,
          speed: point.speed,
        })),
        status: "READY",
      });
      io.emit("mission:updated", copy.toJSON());
      res.status(201).json({ success: true, data: copy });
    }),
  );
  router.post(
    "/missions/:id/start",
    requireAdmin,
    asyncRoute(async (req, res) =>
      res
        .status(201)
        .json({ success: true, data: await startMission(io, req.params.id) }),
    ),
  );
  router.post(
    "/missions/:id/schedule",
    requireAdmin,
    asyncRoute(async (req: AuthRequest, res) => {
      const body = parse(
        z.object({
          scheduledFor: z.coerce
            .date()
            .refine(
              (date) => date.getTime() >= Date.now() - 10_000,
              "Scheduled time cannot be in the past",
            )
            .refine(
              (date) => date.getTime() <= Date.now() + 366 * 86_400_000,
              "Scheduled time cannot be more than one year away",
            ),
          priority: z
            .enum(["LOW", "NORMAL", "HIGH", "CRITICAL"])
            .default("NORMAL"),
        }),
        req.body,
      );
      const mission: any = await Mission.findOne({
        _id: req.params.id,
        isArchived: false,
      })
        .populate("droneId")
        .populate("geofenceId");
      if (!mission)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Mission not found" },
        });
      if (["RUNNING", "PAUSED"].includes(mission.status))
        return res.status(409).json({
          success: false,
          error: {
            code: "MISSION_ACTIVE",
            message: "An active mission cannot be scheduled",
          },
        });
      if (["SCHEDULED", "PROCESSING"].includes(mission.scheduleStatus))
        return res.status(409).json({
          success: false,
          error: {
            code: "ALREADY_SCHEDULED",
            message: "Mission is already scheduled",
          },
        });
      const inspection = inspectMission(
        mission,
        mission.geofenceId,
        mission.droneId,
      );
      if (!inspection.valid)
        return res.status(409).json({
          success: false,
          error: {
            code: "PREFLIGHT_FAILED",
            message: inspection.issues.map((issue) => issue.message).join("; "),
          },
        });
      const readiness = await assessDroneReadiness(
        mission.droneId,
        missionBatteryRequirement(inspection.estimate.batteryPercent),
      );
      if (!readiness.ready)
        return res.status(409).json({
          success: false,
          error: {
            code: "PREFLIGHT_FAILED",
            message: readiness.blockers.join("; "),
          },
        });
      const scheduled = await Mission.findOneAndUpdate(
        {
          _id: req.params.id,
          isArchived: false,
          status: { $nin: ["RUNNING", "PAUSED"] },
          scheduleStatus: { $nin: ["SCHEDULED", "PROCESSING"] },
        },
        {
          $set: {
            status: "READY",
            scheduledFor: body.scheduledFor,
            priority: body.priority,
            scheduleStatus: "SCHEDULED",
            scheduledBy: req.user!.id,
          },
          $unset: { scheduleError: 1 },
        },
        { returnDocument: "after", runValidators: true },
      );
      if (!scheduled)
        return res.status(409).json({
          success: false,
          error: {
            code: "ALREADY_SCHEDULED",
            message: "Mission state changed while it was being scheduled",
          },
        });
      io.emit("mission:schedule", [
        { missionId: String(scheduled._id), status: "SCHEDULED" },
      ]);
      res.json({ success: true, data: scheduled });
    }),
  );
  router.delete(
    "/missions/:id/schedule",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const mission = await Mission.findOneAndUpdate(
        { _id: req.params.id, isArchived: false, scheduleStatus: "SCHEDULED" },
        { $set: { scheduleStatus: "CANCELLED" }, $unset: { scheduleError: 1 } },
        { returnDocument: "after", runValidators: true },
      );
      if (!mission) {
        const current = await Mission.findOne({
          _id: req.params.id,
          isArchived: false,
        }).select("scheduleStatus");
        if (!current)
          return res.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Mission not found" },
          });
        return res.status(409).json({
          success: false,
          error: {
            code:
              current.scheduleStatus === "PROCESSING"
                ? "SCHEDULE_IN_PROGRESS"
                : "NOT_SCHEDULED",
            message:
              current.scheduleStatus === "PROCESSING"
                ? "The scheduler is already launching this mission"
                : "Mission has no cancellable schedule",
          },
        });
      }
      io.emit("mission:schedule", [
        { missionId: String(mission._id), status: "CANCELLED" },
      ]);
      res.json({ success: true, data: mission });
    }),
  );

  router.get(
    "/commands",
    asyncRoute(async (req, res) => {
      const input = parse(
        z.object({
          ...paginationFields,
          limit: paginationFields.limit.default(50),
          ...dateFields,
          timezoneOffsetMinutes: timezoneOffsetField,
          flightId: optionalObjectId,
          status: z
            .enum([
              "ALL",
              "REQUESTED",
              "ACKNOWLEDGED",
              "EXECUTING",
              "COMPLETED",
              "FAILED",
            ])
            .default("ALL"),
          type: z
            .enum(["ALL", "PAUSE", "RESUME", "RETURN_HOME", "LAND"])
            .default("ALL"),
        }).refine(
          (value) =>
            !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
          {
            message: "Start date must not be after end date",
            path: ["dateFrom"],
          },
        ),
        req.query,
      );
      const query: any = {};
      if (input.flightId) query.flightId = input.flightId;
      if (input.status !== "ALL") query.status = input.status;
      if (input.type !== "ALL") query.type = input.type;
      if (input.dateFrom || input.dateTo)
        query.requestedAt = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      const { page, limit } = input;
      const [items, total] = await Promise.all([
        Command.find(query)
          .populate("droneId", "droneCode name")
          .populate("requestedBy", "name email")
          .sort({ requestedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Command.countDocuments(query),
      ]);
      res.json({
        success: true,
        data: items,
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }),
  );
  router.get(
    "/commands/export",
    asyncRoute(async (req, res) => {
      const input = parse(
        z
          .object({
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
            flightId: optionalObjectId,
            status: z
              .enum([
                "ALL",
                "REQUESTED",
                "ACKNOWLEDGED",
                "EXECUTING",
                "COMPLETED",
                "FAILED",
              ])
              .default("ALL"),
            type: z
              .enum(["ALL", "PAUSE", "RESUME", "RETURN_HOME", "LAND"])
              .default("ALL"),
          })
          .refine(
            (value) =>
              !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const query: any = {};
      if (input.flightId) query.flightId = input.flightId;
      if (input.status !== "ALL") query.status = input.status;
      if (input.type !== "ALL") query.type = input.type;
      if (input.dateFrom || input.dateTo)
        query.requestedAt = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );

      const total = await Command.countDocuments(query);
      if (total > MAX_COMMAND_EXPORT_ROWS)
        return res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `Export is limited to ${MAX_COMMAND_EXPORT_ROWS.toLocaleString()} command records. Narrow the filters and try again.`,
          },
        });

      const items = await Command.find(query)
        .populate("droneId", "droneCode")
        .populate("requestedBy", "name email")
        .sort({ requestedAt: -1 })
        .lean();
      const headers = [
        "command",
        "flightId",
        "drone",
        "action",
        "source",
        "requestedBy",
        "requestedAt",
        "completedAt",
        "status",
        "failureReason",
        "retryOf",
      ];
      const isoTimestamp = (value: unknown) =>
        value instanceof Date ? value.toISOString() : value ?? "";
      const rows = items.map((item: any) => ({
        command: item.commandCode,
        flightId: String(item.flightId),
        drone:
          typeof item.droneId === "string"
            ? item.droneId
            : item.droneId?.droneCode ?? String(item.droneId?._id ?? ""),
        action: item.type,
        source: item.source,
        requestedBy:
          typeof item.requestedBy === "string"
            ? item.requestedBy
            : item.requestedBy?.email ?? "",
        requestedAt: isoTimestamp(item.requestedAt),
        completedAt: isoTimestamp(item.completedAt),
        status: item.status,
        failureReason: item.failureReason ?? "",
        retryOf: item.retryOf ? String(item.retryOf) : "",
      }));
      const csv = rows.length
        ? toCsv(rows)
        : headers.map((header) => `"${header}"`).join(",");
      const filename = `commands-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${csv}`);
    }),
  );
  router.post(
    "/commands",
    requireAdmin,
    asyncRoute(async (req: AuthRequest, res) => {
      const body = parse(
        z.object({
          flightId: objectId,
          type: z.enum(["PAUSE", "RESUME", "RETURN_HOME", "LAND"]),
        }),
        req.body,
      );
      res.status(201).json({
        success: true,
        data: await executeCommand(io, body.flightId, body.type, req.user!.id),
      });
    }),
  );
  router.post(
    "/commands/:id/retry",
    requireAdmin,
    asyncRoute(async (req: AuthRequest, res) => {
      const original = await Command.findById(req.params.id);
      if (!original)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Command not found" },
        });
      if (original.status !== "FAILED")
        return res.status(409).json({
          success: false,
          error: {
            code: "INVALID_STATE",
            message: "Only failed commands can be retried",
          },
        });
      if (!(await Flight.exists({ _id: original.flightId, status: "ACTIVE" })))
        return res.status(409).json({
          success: false,
          error: {
            code: "FLIGHT_UNAVAILABLE",
            message: "The original flight is no longer active",
          },
        });
      const command = await executeCommand(
        io,
        String(original.flightId),
        original.type,
        req.user!.id,
        String(original._id),
      );
      res.status(201).json({
        success: true,
        data: command,
        meta: { retryOf: String(original._id) },
      });
    }),
  );
  router.post(
    "/commands/fleet",
    requireAdmin,
    asyncRoute(async (req: AuthRequest, res) => {
      const body = parse(
        z.object({
          flightIds: z.array(objectId).min(1).max(10),
          type: z.enum(["PAUSE", "RESUME", "RETURN_HOME", "LAND"]),
        }),
        req.body,
      );
      const data = await executeFleetCommand(
        io,
        body.flightIds,
        body.type,
        req.user!.id,
      );
      res.status(data.failed ? 207 : 200).json({ success: true, data });
    }),
  );

  router.post(
    "/flights/simulate",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const anomaly = z.enum([
        "LOW_BATTERY",
        "GPS_WEAK",
        "SIGNAL_LOSS",
        "WIND_DRIFT",
        "GPS_DRIFT",
        "EMERGENCY_LANDING",
      ]);
      const body = parse(
        z.object({
          droneId: objectId,
          scenario: z
            .enum(["NORMAL", "LOW_BATTERY", "GPS_WEAK"])
            .default("NORMAL"),
          anomalies: z.array(anomaly).max(3).optional(),
          routePattern: z.enum(ROUTE_PATTERNS).default("RANDOM"),
        }),
        req.body,
      );
      const anomalies =
        body.anomalies ?? (body.scenario === "NORMAL" ? [] : [body.scenario]);
      res.status(201).json({
        success: true,
        data: await startSimulation(
          io,
          body.droneId,
          body.scenario,
          body.routePattern,
          anomalies,
        ),
      });
    }),
  );
  router.post(
    "/flights/simulate-fleet",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const body = parse(
        z.object({
          assignments: z
            .array(
              z.object({
                droneId: objectId,
                routePattern: z.enum(ROUTE_PATTERNS),
              }),
            )
            .length(10),
        }),
        req.body,
      );
      res.status(201).json({
        success: true,
        data: await startFleetSimulation(io, body.assignments),
      });
    }),
  );
  router.post(
    "/flights/stop-fleet",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const body = parse(
        z.object({ flightIds: z.array(objectId).min(1).max(10) }),
        req.body,
      );
      res.json({
        success: true,
        data: await stopFleetSimulation(io, body.flightIds),
      });
    }),
  );
  router.post(
    "/flights/:id/stop",
    requireAdmin,
    asyncRoute(async (req, res) => {
      res.json({
        success: true,
        data: await stopSimulation(io, req.params.id),
      });
    }),
  );
  router.get(
    "/flights",
    asyncRoute(async (req, res) => {
      const input = parse(
        z
          .object({
            ...paginationFields,
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
            droneId: optionalObjectId,
            status: z
              .enum(["ALL", "ACTIVE", "COMPLETED", "FAILED"])
              .default("ALL"),
          })
          .refine(
            (value) =>
              !value.dateFrom ||
              !value.dateTo ||
              value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const { page, limit } = input;
      const query: any = {};
      if (input.droneId) query.droneId = input.droneId;
      if (input.status !== "ALL") query.status = input.status;
      if (input.dateFrom || input.dateTo)
        query.startedAt = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      const [items, total] = await Promise.all([
        Flight.find(query)
          .populate("droneId", "droneCode name")
          .sort({ startedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Flight.countDocuments(query),
      ]);
      res.json({
        success: true,
        data: items,
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }),
  );
  router.get(
    "/flights/active/telemetry",
    asyncRoute(async (req, res) => {
      const { limit } = parse(
        z.object({
          limit: z.coerce.number().int().min(1).max(500).default(120),
        }),
        req.query,
      );
      const activeFlights = await Flight.find({ status: "ACTIVE" })
        .select("_id droneId")
        .lean();
      if (!activeFlights.length)
        return res.json({
          success: true,
          data: [],
          meta: { flights: 0, flightsWithTelemetry: 0, limit },
        });
      const flightIds = activeFlights.map((flight) => flight._id);
      const telemetryByFlight = await Telemetry.aggregate([
        { $match: { flightId: { $in: flightIds } } },
        { $sort: { flightId: 1, sequence: -1 } },
        {
          $group: {
            _id: "$flightId",
            points: { $push: "$$ROOT" },
          },
        },
        { $project: { points: { $slice: ["$points", limit] } } },
      ]);
      const droneByFlight = new Map(
        activeFlights.map((flight) => [String(flight._id), String(flight.droneId)]),
      );
      const data = telemetryByFlight.map((item: any) => ({
        flightId: String(item._id),
        droneId: droneByFlight.get(String(item._id)),
        telemetry: (item.points as any[]).reverse(),
      }));
      res.json({
        success: true,
        data,
        meta: {
          flights: activeFlights.length,
          flightsWithTelemetry: data.length,
          limit,
        },
      });
    }),
  );
  router.get(
    "/flights/export",
    asyncRoute(async (req, res) => {
      const input = parse(
        z
          .object({
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
            droneId: optionalObjectId,
            status: z
              .enum(["ALL", "ACTIVE", "COMPLETED", "FAILED"])
              .default("ALL"),
          })
          .refine(
            (value) =>
              !value.dateFrom ||
              !value.dateTo ||
              value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const query: any = {};
      if (input.droneId) query.droneId = input.droneId;
      if (input.status !== "ALL") query.status = input.status;
      if (input.dateFrom || input.dateTo)
        query.startedAt = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );

      const total = await Flight.countDocuments(query);
      if (total > MAX_FLIGHT_EXPORT_ROWS)
        return res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `Export is limited to ${MAX_FLIGHT_EXPORT_ROWS.toLocaleString()} flight records. Narrow the filters and try again.`,
          },
        });

      const items = await Flight.find(query)
        .populate("droneId", "droneCode")
        .sort({ startedAt: -1 })
        .lean();
      const headers = [
        "flight",
        "drone",
        "route",
        "scenario",
        "anomalies",
        "status",
        "flightPhase",
        "startedAt",
        "endedAt",
        "durationSeconds",
        "distanceMeters",
        "maxAltitude",
        "maxSpeed",
        "batteryStart",
        "batteryEnd",
        "missionId",
      ];
      const isoTimestamp = (value: unknown) =>
        value instanceof Date ? value.toISOString() : value ?? "";
      const rows = items.map((item: any) => ({
        flight: item.flightCode,
        drone:
          typeof item.droneId === "string"
            ? item.droneId
            : item.droneId?.droneCode ?? String(item.droneId?._id ?? ""),
        route: item.routePattern,
        scenario: item.scenario,
        anomalies: Array.isArray(item.anomalyTypes)
          ? item.anomalyTypes.join("|")
          : "",
        status: item.status,
        flightPhase: item.flightPhase,
        startedAt: isoTimestamp(item.startedAt),
        endedAt: isoTimestamp(item.endedAt),
        durationSeconds: item.durationSeconds ?? "",
        distanceMeters: item.distanceMeters ?? "",
        maxAltitude: item.maxAltitude ?? "",
        maxSpeed: item.maxSpeed ?? "",
        batteryStart: item.batteryStart ?? "",
        batteryEnd: item.batteryEnd ?? "",
        missionId: item.missionId ? String(item.missionId) : "",
      }));
      const csv = rows.length
        ? toCsv(rows)
        : headers.map((header) => `"${header}"`).join(",");
      const filename = `flights-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${csv}`);
    }),
  );
  router.get(
    "/flights/:id",
    asyncRoute(async (req, res) => {
      const flight = await Flight.findById(req.params.id)
        .populate("droneId", "droneCode name model")
        .populate({
          path: "missionId",
          select: "name homePosition waypoints geofenceId",
          populate: {
            path: "geofenceId",
            select: "name type polygon center radiusMeters homePosition isActive",
          },
        });
      if (!flight)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Flight not found" },
        });
      const [alerts, commands] = await Promise.all([
        Alert.find({ flightId: flight._id }).sort({ occurredAt: 1 }),
        Command.find({ flightId: flight._id })
          .populate("droneId", "droneCode name")
          .populate("requestedBy", "name email")
          .sort({ requestedAt: 1, _id: 1 }),
      ]);
      res.json({ success: true, data: { flight, alerts, commands } });
    }),
  );
  router.get(
    "/flights/:id/telemetry",
    asyncRoute(async (req, res) => {
      const input = parse(
        z
          .object({
            limit: z.coerce.number().int().min(1).max(5000).default(1000),
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
          })
          .refine(
            (value) =>
              !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const exists = await Flight.exists({ _id: req.params.id });
      if (!exists)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Flight not found" },
        });
      const query: any = { flightId: req.params.id };
      if (input.dateFrom || input.dateTo)
        query.timestamp = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      const data = await Telemetry.find(query)
        .sort({ sequence: -1 })
        .limit(input.limit);
      res.json({ success: true, data: data.reverse() });
    }),
  );
  router.get(
    "/flights/:id/telemetry/export",
    asyncRoute(async (req, res) => {
      const input = parse(
        z
          .object({
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
          })
          .refine(
            (value) =>
              !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const flight = await Flight.findById(req.params.id)
        .populate("droneId", "droneCode")
        .lean();
      if (!flight)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Flight not found" },
        });
      const query: any = { flightId: flight._id };
      if (input.dateFrom || input.dateTo)
        query.timestamp = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      const total = await Telemetry.countDocuments(query);
      if (total > MAX_TELEMETRY_EXPORT_ROWS)
        return res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `Export is limited to ${MAX_TELEMETRY_EXPORT_ROWS.toLocaleString()} telemetry packets. Narrow the date filters and try again.`,
          },
        });
      const items = await Telemetry.find(query).sort({ sequence: 1 }).lean();
      const headers = [
        "timestamp",
        "sequence",
        "battery",
        "latitude",
        "longitude",
        "altitude",
        "speed",
        "heading",
        "gpsSatellites",
        "signal",
        "flightMode",
        "flightPhase",
        "routePattern",
        "waypointIndex",
        "waypointCount",
      ];
      const isoTimestamp = (value: unknown) =>
        value instanceof Date ? value.toISOString() : value ?? "";
      const rows = items.map((item: any) => ({
        timestamp: isoTimestamp(item.timestamp),
        sequence: item.sequence,
        battery: item.battery,
        latitude: item.latitude,
        longitude: item.longitude,
        altitude: item.altitude,
        speed: item.speed,
        heading: item.heading ?? 0,
        gpsSatellites: item.gpsSatellites,
        signal: item.signal,
        flightMode: item.flightMode,
        flightPhase: item.flightPhase ?? "",
        routePattern: item.routePattern,
        waypointIndex: item.waypointIndex ?? "",
        waypointCount: item.waypointCount ?? "",
      }));
      const csv = rows.length
        ? toCsv(rows)
        : headers.map((header) => `"${header}"`).join(",");
      const flightCode = String(flight.flightCode).replace(/[^a-zA-Z0-9_-]/g, "_");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="telemetry-${flightCode}.csv"`,
      );
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${csv}`);
    }),
  );
  router.get(
    "/flights/:id/replay",
    asyncRoute(async (req, res) => {
      const flight = await Flight.findById(req.params.id)
        .populate("droneId", "droneCode name model")
        .populate({
          path: "missionId",
          select: "name homePosition waypoints geofenceId",
          populate: {
            path: "geofenceId",
            select: "name type polygon center radiusMeters homePosition isActive",
          },
        });
      if (!flight)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Flight not found" },
        });
      const [telemetry, alerts, commands] = await Promise.all([
        Telemetry.find({ flightId: flight._id })
          .sort({ sequence: 1 })
          .limit(5000),
        Alert.find({ flightId: flight._id }).sort({ occurredAt: 1 }),
        Command.find({ flightId: flight._id }).sort({ requestedAt: 1, _id: 1 }),
      ]);
      res.json({
        success: true,
        data: { flight, telemetry, alerts, commands },
      });
    }),
  );

  router.get(
    "/alerts",
    asyncRoute(async (req, res) => {
      const input = parse(
        z
          .object({
            ...paginationFields,
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
            droneId: optionalObjectId,
            status: z
              .enum(["ALL", "ACTIVE", "ACKNOWLEDGED", "RESOLVED"])
              .default("ALL"),
            severity: z.enum(["ALL", "WARNING", "CRITICAL"]).default("ALL"),
            type: z
              .enum([
                "ALL",
                "BATTERY_LOW",
                "GPS_WEAK",
                "SIGNAL_LOW",
                "SIGNAL_LOSS",
                "WIND_DRIFT",
                "GPS_DRIFT",
                "EMERGENCY_LANDING",
                "GEOFENCE_BREACH",
                "COMMAND_FAILED",
              ])
              .default("ALL"),
          })
          .refine(
            (value) =>
              !value.dateFrom ||
              !value.dateTo ||
              value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const query: any = {};
      if (input.status !== "ALL") query.status = input.status;
      if (input.severity !== "ALL") query.severity = input.severity;
      if (input.type !== "ALL") query.type = input.type;
      if (input.droneId) query.droneId = input.droneId;
      if (input.dateFrom || input.dateTo)
        query.occurredAt = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      const { page, limit } = input;
      const [items, total] = await Promise.all([
        Alert.find(query)
          .populate("droneId", "droneCode name")
          .populate("acknowledgedBy", "name email")
          .populate("resolvedBy", "name email")
          .sort({ occurredAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Alert.countDocuments(query),
      ]);
      res.json({
        success: true,
        data: items,
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }),
  );
  router.get(
    "/alerts/export",
    asyncRoute(async (req, res) => {
      const input = parse(
        z
          .object({
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
            droneId: optionalObjectId,
            status: z
              .enum(["ALL", "ACTIVE", "ACKNOWLEDGED", "RESOLVED"])
              .default("ALL"),
            severity: z.enum(["ALL", "WARNING", "CRITICAL"]).default("ALL"),
            type: z
              .enum([
                "ALL",
                "BATTERY_LOW",
                "GPS_WEAK",
                "SIGNAL_LOW",
                "SIGNAL_LOSS",
                "WIND_DRIFT",
                "GPS_DRIFT",
                "EMERGENCY_LANDING",
                "GEOFENCE_BREACH",
                "COMMAND_FAILED",
              ])
              .default("ALL"),
          })
          .refine(
            (value) =>
              !value.dateFrom ||
              !value.dateTo ||
              value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const query: any = {};
      if (input.status !== "ALL") query.status = input.status;
      if (input.severity !== "ALL") query.severity = input.severity;
      if (input.type !== "ALL") query.type = input.type;
      if (input.droneId) query.droneId = input.droneId;
      if (input.dateFrom || input.dateTo)
        query.occurredAt = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      const total = await Alert.countDocuments(query);
      if (total > MAX_ALERT_EXPORT_ROWS)
        return res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `Export is limited to ${MAX_ALERT_EXPORT_ROWS.toLocaleString()} alert records. Narrow the filters and try again.`,
          },
        });
      const items = await Alert.find(query)
        .populate("droneId", "droneCode")
        .populate("acknowledgedBy", "name email")
        .populate("resolvedBy", "name email")
        .sort({ occurredAt: -1 })
        .lean();
      const headers = [
        "occurredAt",
        "alertId",
        "flightId",
        "drone",
        "type",
        "severity",
        "status",
        "message",
        "acknowledgedBy",
        "acknowledgedAt",
        "acknowledgementNote",
        "resolvedBy",
        "resolvedAt",
        "resolutionNote",
        "latitude",
        "longitude",
      ];
      const isoTimestamp = (value: unknown) =>
        value instanceof Date ? value.toISOString() : value ?? "";
      const actor = (value: any) =>
        typeof value === "string" ? value : value?.email ?? "";
      const rows = items.map((item: any) => ({
        occurredAt: isoTimestamp(item.occurredAt),
        alertId: String(item._id),
        flightId: String(item.flightId),
        drone:
          typeof item.droneId === "string"
            ? item.droneId
            : item.droneId?.droneCode ?? String(item.droneId?._id ?? ""),
        type: item.type,
        severity: item.severity,
        status: item.status,
        message: item.message,
        acknowledgedBy: actor(item.acknowledgedBy),
        acknowledgedAt: isoTimestamp(item.acknowledgedAt),
        acknowledgementNote: item.acknowledgementNote ?? "",
        resolvedBy: actor(item.resolvedBy),
        resolvedAt: isoTimestamp(item.resolvedAt),
        resolutionNote: item.resolutionNote ?? "",
        latitude: item.latitude ?? "",
        longitude: item.longitude ?? "",
      }));
      const csv = rows.length
        ? toCsv(rows)
        : headers.map((header) => `"${header}"`).join(",");
      const filename = `alerts-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${csv}`);
    }),
  );
  router.patch(
    "/alerts/:id/acknowledge",
    requireAdmin,
    asyncRoute(async (req: AuthRequest, res) => {
      const body = parse(
        z.object({ note: z.string().max(500).default("") }),
        req.body ?? {},
      );
      const alert = await Alert.findOneAndUpdate(
        { _id: req.params.id, status: "ACTIVE" },
        {
          status: "ACKNOWLEDGED",
          acknowledgedBy: req.user!.id,
          acknowledgedAt: new Date(),
          acknowledgementNote: body.note,
        },
        { returnDocument: "after" },
      );
      if (!alert) {
        const exists = await Alert.exists({ _id: req.params.id });
        return res.status(exists ? 409 : 404).json({
          success: false,
          error: {
            code: exists ? "INVALID_STATE" : "NOT_FOUND",
            message: exists
              ? "Only active alerts can be acknowledged"
              : "Alert not found",
          },
        });
      }
      io.emit("alert:updated", alert.toJSON());
      res.json({ success: true, data: alert });
    }),
  );
  router.post(
    "/alerts/bulk-acknowledge",
    requireAdmin,
    asyncRoute(async (req: AuthRequest, res) => {
      const body = parse(
        z.object({
          alertIds: z
            .array(objectId)
            .min(1)
            .max(100)
            .transform((ids) => [...new Set(ids)]),
          note: z.string().max(500).default(""),
        }),
        req.body,
      );
      const acknowledgedAt = new Date();
      const result = await Alert.updateMany(
        { _id: { $in: body.alertIds }, status: "ACTIVE" },
        {
          status: "ACKNOWLEDGED",
          acknowledgedBy: req.user!.id,
          acknowledgedAt,
          acknowledgementNote: body.note,
        },
      );
      io.emit("alert:updated", {
        alertIds: body.alertIds,
        status: "ACKNOWLEDGED",
      });
      res.json({
        success: true,
        data: {
          matched: result.matchedCount,
          acknowledged: result.modifiedCount,
          acknowledgedAt,
        },
      });
    }),
  );
  router.patch(
    "/alerts/:id/resolve",
    requireAdmin,
    asyncRoute(async (req: AuthRequest, res) => {
      const body = parse(
        z.object({ note: z.string().trim().min(3).max(1000) }),
        req.body,
      );
      const alert = await Alert.findOneAndUpdate(
        { _id: req.params.id, status: { $in: ["ACTIVE", "ACKNOWLEDGED"] } },
        {
          status: "RESOLVED",
          resolvedBy: req.user!.id,
          resolvedAt: new Date(),
          resolutionNote: body.note,
        },
        { returnDocument: "after" },
      );
      if (!alert) {
        const exists = await Alert.exists({ _id: req.params.id });
        return res.status(exists ? 409 : 404).json({
          success: false,
          error: {
            code: exists ? "INVALID_STATE" : "NOT_FOUND",
            message: exists ? "Alert is already resolved" : "Alert not found",
          },
        });
      }
      io.emit("alert:updated", alert.toJSON());
      res.json({ success: true, data: alert });
    }),
  );

  router.get(
    "/alert-rules",
    asyncRoute(async (_req, res) =>
      res.json({ success: true, data: await ensureAlertRules() }),
    ),
  );
  router.patch(
    "/alert-rules/:key",
    requireAdmin,
    asyncRoute(async (req: AuthRequest, res) => {
      const key = parse(z.enum(ALERT_RULE_KEYS), req.params.key);
      const body = parse(
        z
          .object({
            enabled: z.boolean().optional(),
            threshold: z.number().min(1).max(100).optional(),
            severity: z.enum(["WARNING", "CRITICAL"]).optional(),
            autoAction: z.enum(["NONE", "RETURN_HOME", "LAND"]).optional(),
          })
          .refine(
            (value) => Object.keys(value).length > 0,
            "At least one field is required",
          ),
        req.body,
      );
      if (key === "GEOFENCE_BREACH" && body.threshold !== undefined)
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_THRESHOLD",
            message: "Geofence rules do not use a numeric threshold",
          },
        });
      if (
        key === "GPS_WEAK" &&
        body.threshold !== undefined &&
        body.threshold > 30
      )
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_THRESHOLD",
            message: "GPS threshold cannot exceed 30 satellites",
          },
        });
      await ensureAlertRules();
      const rule = await AlertRule.findOneAndUpdate(
        { key },
        { ...body, updatedBy: req.user!.id },
        { returnDocument: "after", runValidators: true },
      );
      io.emit("alert-rules:updated", rule?.toJSON());
      res.json({ success: true, data: rule });
    }),
  );
  router.post(
    "/alert-rules/reset",
    requireAdmin,
    asyncRoute(async (req: AuthRequest, res) => {
      await ensureAlertRules();
      await AlertRule.bulkWrite(
        defaultAlertRules.map((rule) => ({
          updateOne: {
            filter: { key: rule.key },
            update: { $set: { ...rule, updatedBy: req.user!.id } },
          },
        })) as any,
      );
      const rules = await AlertRule.find({
        key: { $in: ALERT_RULE_KEYS },
      }).sort({ key: 1 });
      io.emit("alert-rules:updated", { reset: true });
      res.json({ success: true, data: rules });
    }),
  );

  router.get(
    "/audit-events",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const input = parse(
        z
          .object({
            ...paginationFields,
            limit: paginationFields.limit.default(25),
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
            action: z.string().max(100).default("ALL"),
            resourceType: z.string().max(50).default("ALL"),
            actorId: optionalObjectId,
          })
          .refine(
            (value) =>
              !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const query: any = {};
      if (input.action !== "ALL") query.action = input.action;
      if (input.resourceType !== "ALL") query.resourceType = input.resourceType;
      if (input.actorId) query.actorId = input.actorId;
      if (input.dateFrom || input.dateTo)
        query.occurredAt = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      const { page, limit } = input;
      const [items, total, actions, resourceTypes] = await Promise.all([
        AuditEvent.find(query)
          .populate("actorId", "name email role")
          .sort({ occurredAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        AuditEvent.countDocuments(query),
        AuditEvent.distinct("action"),
        AuditEvent.distinct("resourceType"),
      ]);
      res.json({
        success: true,
        data: items,
        meta: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          actions: actions.sort(),
          resourceTypes: resourceTypes.sort(),
        },
      });
    }),
  );

  router.get(
    "/audit-events/export",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const input = parse(
        z
          .object({
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
            action: z.string().max(100).default("ALL"),
            resourceType: z.string().max(50).default("ALL"),
            actorId: optionalObjectId,
          })
          .refine(
            (value) =>
              !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const query: any = {};
      if (input.action !== "ALL") query.action = input.action;
      if (input.resourceType !== "ALL") query.resourceType = input.resourceType;
      if (input.actorId) query.actorId = input.actorId;
      if (input.dateFrom || input.dateTo)
        query.occurredAt = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      const total = await AuditEvent.countDocuments(query);
      if (total > MAX_AUDIT_EXPORT_ROWS)
        return res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `Export is limited to ${MAX_AUDIT_EXPORT_ROWS.toLocaleString()} audit events. Narrow the filters and try again.`,
          },
        });
      const items = await AuditEvent.find(query)
        .populate("actorId", "name email role")
        .sort({ occurredAt: -1 })
        .lean();
      const headers = [
        "occurredAt",
        "actor",
        "action",
        "resourceType",
        "resourceId",
        "method",
        "route",
        "statusCode",
        "ipAddress",
      ];
      const isoTimestamp = (value: unknown) =>
        value instanceof Date ? value.toISOString() : value ?? "";
      const rows = items.map((item: any) => ({
        occurredAt: isoTimestamp(item.occurredAt),
        actor:
          typeof item.actorId === "string"
            ? item.actorId
            : item.actorId?.email ?? "",
        action: item.action,
        resourceType: item.resourceType,
        resourceId: item.resourceId ?? "",
        method: item.method,
        route: item.route,
        statusCode: item.statusCode,
        ipAddress: item.ipAddress ?? "",
      }));
      const csv = rows.length
        ? toCsv(rows)
        : headers.map((header) => `"${header}"`).join(",");
      const filename = `audit-events-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${csv}`);
    }),
  );
  router.get(
    "/maintenance/health",
    asyncRoute(async (_req, res) => {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const now = new Date();
      const [drones, flightStats, alertStats, maintenanceStats] =
        await Promise.all([
          Drone.find({ isArchived: false }).sort({ droneCode: 1 }),
          Flight.aggregate([
            { $match: { startedAt: { $gte: since } } },
            {
              $group: {
                _id: "$droneId",
                flights: { $sum: 1 },
                failedFlights: {
                  $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] },
                },
                durationSeconds: { $sum: "$durationSeconds" },
                distanceMeters: { $sum: "$distanceMeters" },
              },
            },
          ]),
          Alert.aggregate([
            { $match: { occurredAt: { $gte: since } } },
            {
              $group: {
                _id: "$droneId",
                criticalAlerts: {
                  $sum: { $cond: [{ $eq: ["$severity", "CRITICAL"] }, 1, 0] },
                },
                warningAlerts: {
                  $sum: { $cond: [{ $eq: ["$severity", "WARNING"] }, 1, 0] },
                },
              },
            },
          ]),
          Maintenance.aggregate([
            { $match: { status: { $in: ["SCHEDULED", "IN_PROGRESS"] } } },
            {
              $group: {
                _id: "$droneId",
                openMaintenance: { $sum: 1 },
                overdueMaintenance: {
                  $sum: { $cond: [{ $lt: ["$scheduledFor", now] }, 1, 0] },
                },
                nextScheduledFor: { $min: "$scheduledFor" },
              },
            },
          ]),
        ]);
      const flights = new Map(
        flightStats.map((item: any) => [String(item._id), item]),
      );
      const alerts = new Map(
        alertStats.map((item: any) => [String(item._id), item]),
      );
      const tasks = new Map(
        maintenanceStats.map((item: any) => [String(item._id), item]),
      );
      const items = drones.map((drone: any) => {
        const flight = (flights.get(String(drone._id)) as any) ?? {};
        const alert = (alerts.get(String(drone._id)) as any) ?? {};
        const task = (tasks.get(String(drone._id)) as any) ?? {};
        const health = calculateDroneHealth(
          {
            battery: drone.battery,
            lastSeen: drone.lastSeen,
            flights: flight.flights ?? 0,
            failedFlights: flight.failedFlights ?? 0,
            criticalAlerts: alert.criticalAlerts ?? 0,
            warningAlerts: alert.warningAlerts ?? 0,
            overdueMaintenance: task.overdueMaintenance ?? 0,
            openMaintenance: task.openMaintenance ?? 0,
          },
          now,
        );
        return {
          drone: {
            _id: drone._id,
            droneCode: drone.droneCode,
            name: drone.name,
            model: drone.model,
            battery: drone.battery,
            status: drone.status,
            lastSeen: drone.lastSeen,
          },
          ...health,
          metrics: {
            flights: flight.flights ?? 0,
            failedFlights: flight.failedFlights ?? 0,
            durationSeconds: flight.durationSeconds ?? 0,
            distanceMeters: flight.distanceMeters ?? 0,
            criticalAlerts: alert.criticalAlerts ?? 0,
            warningAlerts: alert.warningAlerts ?? 0,
            openMaintenance: task.openMaintenance ?? 0,
            overdueMaintenance: task.overdueMaintenance ?? 0,
            nextScheduledFor: task.nextScheduledFor ?? null,
          },
        };
      });
      res.json({
        success: true,
        data: {
          items,
          summary: {
            healthy: items.filter((item) => item.status === "HEALTHY").length,
            watch: items.filter((item) => item.status === "WATCH").length,
            serviceDue: items.filter((item) => item.status === "SERVICE_DUE")
              .length,
            averageScore: items.length
              ? Math.round(
                  items.reduce((sum, item) => sum + item.score, 0) /
                    items.length,
                )
              : 0,
          },
        },
      });
    }),
  );

  const maintenanceType = z.enum([
    "INSPECTION",
    "BATTERY",
    "PROPELLER",
    "FIRMWARE",
    "REPAIR",
  ]);
  const maintenanceStatus = z.enum([
    "SCHEDULED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
  ]);
  router.get(
    "/maintenance",
    asyncRoute(async (req, res) => {
      const input = parse(
        z.object({
          ...paginationFields,
          limit: paginationFields.limit.default(25),
          ...dateFields,
          timezoneOffsetMinutes: timezoneOffsetField,
          status: z
            .enum(["ALL", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
            .default("ALL"),
          droneId: optionalObjectId,
        }).refine(
          (value) =>
            !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
          {
            message: "Start date must not be after end date",
            path: ["dateFrom"],
          },
        ),
        req.query,
      );
      const query: any = {};
      if (input.status !== "ALL") query.status = input.status;
      if (input.droneId) query.droneId = input.droneId;
      if (input.dateFrom || input.dateTo)
        query.scheduledFor = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      const { page, limit } = input;
      const [items, total] = await Promise.all([
        Maintenance.find(query)
          .populate("droneId", "droneCode name model")
          .populate("createdBy", "name email")
          .sort({ scheduledFor: 1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Maintenance.countDocuments(query),
      ]);
      res.json({
        success: true,
        data: items,
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }),
  );
  router.get(
    "/maintenance/export",
    asyncRoute(async (req, res) => {
      const input = parse(
        z
          .object({
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
            status: z
              .enum(["ALL", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
              .default("ALL"),
            droneId: optionalObjectId,
          })
          .refine(
            (value) =>
              !value.dateFrom ||
              !value.dateTo ||
              value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const query: any = {};
      if (input.status !== "ALL") query.status = input.status;
      if (input.droneId) query.droneId = input.droneId;
      if (input.dateFrom || input.dateTo)
        query.scheduledFor = dateRange(
          input.dateFrom,
          input.dateTo,
          input.timezoneOffsetMinutes,
        );
      const total = await Maintenance.countDocuments(query);
      if (total > MAX_MAINTENANCE_EXPORT_ROWS)
        return res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `Export is limited to ${MAX_MAINTENANCE_EXPORT_ROWS.toLocaleString()} maintenance records. Narrow the filters and try again.`,
          },
        });
      const items = await Maintenance.find(query)
        .populate("droneId", "droneCode")
        .populate("createdBy", "name email")
        .sort({ scheduledFor: 1 })
        .lean();
      const headers = [
        "taskId",
        "scheduledFor",
        "drone",
        "type",
        "status",
        "completedAt",
        "notes",
        "createdBy",
        "createdAt",
      ];
      const isoTimestamp = (value: unknown) =>
        value instanceof Date ? value.toISOString() : value ?? "";
      const actor = (value: any) =>
        typeof value === "string" ? value : value?.email ?? "";
      const rows = items.map((item: any) => ({
        taskId: String(item._id),
        scheduledFor: isoTimestamp(item.scheduledFor),
        drone:
          typeof item.droneId === "string"
            ? item.droneId
            : item.droneId?.droneCode ?? String(item.droneId?._id ?? ""),
        type: item.type,
        status: item.status,
        completedAt: isoTimestamp(item.completedAt),
        notes: item.notes ?? "",
        createdBy: actor(item.createdBy),
        createdAt: isoTimestamp(item.createdAt),
      }));
      const csv = rows.length
        ? toCsv(rows)
        : headers.map((header) => `"${header}"`).join(",");
      const filename = `maintenance-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${csv}`);
    }),
  );
  router.post(
    "/maintenance",
    requireAdmin,
    asyncRoute(async (req: AuthRequest, res) => {
      const body = parse(
        z.object({
          droneId: objectId,
          type: maintenanceType,
          scheduledFor: z.coerce.date(),
          notes: z.string().max(1000).default(""),
        }),
        req.body,
      );
      if (!(await Drone.exists({ _id: body.droneId, isArchived: false })))
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Drone not found" },
        });
      const task = await Maintenance.create({
        ...body,
        createdBy: req.user!.id,
      });
      io.emit("maintenance:updated", task.toJSON());
      res.status(201).json({ success: true, data: task });
    }),
  );
  router.patch(
    "/maintenance/:id",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const body = parse(
        z
          .object({
            type: maintenanceType.optional(),
            status: maintenanceStatus.optional(),
            scheduledFor: z.coerce.date().optional(),
            notes: z.string().max(1000).optional(),
          })
          .refine(
            (value) => Object.keys(value).length > 0,
            "At least one field is required",
          ),
        req.body,
      );
      const task = await Maintenance.findById(req.params.id);
      if (!task)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Maintenance task not found" },
        });
      if (
        ["COMPLETED", "CANCELLED"].includes(task.status) &&
        body.status &&
        body.status !== task.status
      )
        return res.status(409).json({
          success: false,
          error: {
            code: "TERMINAL_STATE",
            message: "Completed or cancelled maintenance cannot be reopened",
          },
        });
      const transitions: Record<string, string[]> = {
        SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
        IN_PROGRESS: ["COMPLETED", "CANCELLED"],
        COMPLETED: [],
        CANCELLED: [],
      };
      if (
        body.status &&
        body.status !== task.status &&
        !transitions[task.status].includes(body.status)
      )
        return res.status(409).json({
          success: false,
          error: {
            code: "INVALID_TRANSITION",
            message: `Maintenance cannot move from ${task.status} to ${body.status}`,
          },
        });
      if (
        body.status &&
        ["IN_PROGRESS", "COMPLETED"].includes(body.status) &&
        (await Flight.exists({ droneId: task.droneId, status: "ACTIVE" }))
      )
        return res.status(409).json({
          success: false,
          error: {
            code: "ACTIVE_FLIGHT",
            message: "Stop the active flight before performing maintenance",
          },
        });
      if (
        body.status === "IN_PROGRESS" &&
        (await Maintenance.exists({
          _id: { $ne: task._id },
          droneId: task.droneId,
          status: "IN_PROGRESS",
        }))
      )
        return res.status(409).json({
          success: false,
          error: {
            code: "MAINTENANCE_CONFLICT",
            message:
              "Another maintenance task is already in progress for this drone",
          },
        });
      const previousStatus = task.status;
      Object.assign(task, body);
      if (body.status === "COMPLETED") task.completedAt = new Date();
      await task.save();
      if (body.status === "IN_PROGRESS")
        await Drone.findByIdAndUpdate(task.droneId, { status: "OFFLINE" });
      if (
        body.status === "COMPLETED" ||
        (body.status === "CANCELLED" && previousStatus === "IN_PROGRESS")
      )
        await Drone.findByIdAndUpdate(task.droneId, {
          status: "ONLINE",
          lastSeen: new Date(),
          ...(body.status === "COMPLETED" && task.type === "BATTERY"
            ? { battery: 100 }
            : {}),
        });
      io.emit("maintenance:updated", task.toJSON());
      res.json({ success: true, data: task });
    }),
  );

  router.get(
    "/dashboard/summary",
    asyncRoute(async (_req, res) => {
      const [
        totalDrones,
        online,
        activeFlights,
        activeAlerts,
        recentFlights,
        missionCounts,
        flightTotals,
        alertTypes,
        topDrones,
        recentMissions,
        recentCommands,
      ] = await Promise.all([
        Drone.countDocuments({ isArchived: false }),
        Drone.countDocuments({ isArchived: false, status: { $ne: "OFFLINE" } }),
        Flight.countDocuments({ status: "ACTIVE" }),
        Alert.countDocuments({ status: "ACTIVE" }),
        Flight.find()
          .populate("droneId", "droneCode name")
          .sort({ startedAt: -1 })
          .limit(5),
        Mission.aggregate([
          { $match: { isArchived: false } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Flight.aggregate([
          { $match: { status: { $ne: "ACTIVE" } } },
          {
            $group: {
              _id: null,
              distanceMeters: { $sum: "$distanceMeters" },
              durationSeconds: { $sum: "$durationSeconds" },
            },
          },
        ]),
        Alert.aggregate([
          { $group: { _id: "$type", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Flight.aggregate([
          {
            $group: {
              _id: "$droneId",
              flights: { $sum: 1 },
              distanceMeters: { $sum: "$distanceMeters" },
            },
          },
          { $sort: { flights: -1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: "drones",
              localField: "_id",
              foreignField: "_id",
              as: "drone",
            },
          },
          { $unwind: "$drone" },
          {
            $project: {
              droneCode: "$drone.droneCode",
              name: "$drone.name",
              flights: 1,
              distanceMeters: 1,
            },
          },
        ]),
        Mission.find({ isArchived: false })
          .populate("droneId", "droneCode name")
          .sort({ updatedAt: -1 })
          .limit(5),
        Command.find()
          .populate("droneId", "droneCode name")
          .sort({ requestedAt: -1 })
          .limit(5),
      ]);
      res.json({
        success: true,
        data: {
          totalDrones,
          online,
          activeFlights,
          activeAlerts,
          recentFlights,
          missionCounts: Object.fromEntries(
            missionCounts.map((item: any) => [item._id, item.count]),
          ),
          flightTotals: flightTotals[0] ?? {
            distanceMeters: 0,
            durationSeconds: 0,
          },
          alertTypes: alertTypes.map((item: any) => ({
            type: item._id,
            count: item.count,
          })),
          topDrones,
          recentMissions,
          recentCommands,
        },
      });
    }),
  );

  const getOperationalInsights = async () => {
    const now = new Date();
    const activeFlights = await Flight.find({ status: "ACTIVE" })
      .populate("droneId", "droneCode name")
      .lean();
    const flightIds = activeFlights.map((flight) => flight._id);
    const activeDroneIds = activeFlights.map((flight: any) =>
      flight.droneId?._id ?? flight.droneId,
    );
    const [latestTelemetry, alerts, overdueMaintenance] = await Promise.all([
      flightIds.length
        ? Telemetry.aggregate([
            { $match: { flightId: { $in: flightIds } } },
            { $sort: { sequence: -1 } },
            {
              $group: {
                _id: "$flightId",
                telemetry: { $first: "$$ROOT" },
              },
            },
          ])
        : [],
      flightIds.length
        ? Alert.find({
            status: { $in: ["ACTIVE", "ACKNOWLEDGED"] },
            flightId: { $in: flightIds },
          }).lean()
        : [],
      activeDroneIds.length
        ? Maintenance.find({
            droneId: { $in: activeDroneIds },
            status: "SCHEDULED",
            scheduledFor: { $lt: now },
          })
            .select("droneId type")
            .lean()
        : [],
    ]);
    return buildOperationalInsights({
      flights: activeFlights.map((flight: any) => ({
        id: String(flight._id),
        droneId: String(flight.droneId?._id ?? flight.droneId),
        droneCode: flight.droneId?.droneCode,
        flightPhase: flight.flightPhase,
      })),
      telemetry: latestTelemetry.map((item: any) => ({
        flightId: String(item._id),
        sequence: item.telemetry?.sequence,
        timestamp: item.telemetry?.timestamp,
        battery: item.telemetry?.battery,
        signal: item.telemetry?.signal,
        gpsSatellites: item.telemetry?.gpsSatellites,
      })),
      alerts: alerts.map((alert: any) => ({
        flightId: String(alert.flightId),
        droneId: alert.droneId ? String(alert.droneId) : undefined,
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
      })),
      overdueMaintenance: overdueMaintenance.map((task: any) => ({
        droneId: String(task.droneId),
        type: task.type,
      })),
      now,
    });
  };

  const getEnvironmentSnapshot = async () => {
    const activeFlights = await Flight.find({ status: "ACTIVE" })
      .populate("droneId", "droneCode name")
      .lean();
    const flightIds = activeFlights.map((flight) => flight._id);
    const latestTelemetry = flightIds.length
      ? await Telemetry.aggregate([
          { $match: { flightId: { $in: flightIds } } },
          { $sort: { sequence: -1 } },
          {
            $group: {
              _id: "$flightId",
              telemetry: { $first: "$$ROOT" },
            },
          },
        ])
      : [];
    const telemetryByFlight = new Map(
      latestTelemetry.map((item: any) => [String(item._id), item.telemetry]),
    );
    return buildEnvironmentSnapshot({
      now: new Date(),
      flights: activeFlights.map((flight: any) => {
        const telemetry = telemetryByFlight.get(String(flight._id));
        return {
          droneId: String(flight.droneId?._id ?? flight.droneId),
          droneCode: flight.droneId?.droneCode,
          battery: telemetry?.battery,
          signal: telemetry?.signal,
          altitude: telemetry?.altitude,
        };
      }),
    });
  };

  const getFieldIntelligence = async () => {
    const geofences = await Geofence.find({
      isArchived: false,
      isActive: true,
    })
      .sort({ createdAt: 1 })
      .lean();
    const plots = geofences.length
      ? geofences.map((geofence: any) => ({
          id: String(geofence._id),
          name: geofence.name,
          areaHectares: Math.max(
            0.01,
            estimateBoundaryAreaHectares(geofence),
          ),
          latestScanAt: geofence.updatedAt ?? geofence.createdAt,
        }))
      : [
          { id: "demo-plot-01", name: "Plot 01", areaHectares: 0.8, virtual: true },
          { id: "demo-plot-02", name: "Plot 02", areaHectares: 0.7, virtual: true },
          { id: "demo-plot-03", name: "Plot 03", areaHectares: 0.9, virtual: true },
          { id: "demo-plot-04", name: "Plot 04", areaHectares: 0.8, virtual: true },
        ];
    return buildFieldIntelligence({ now: new Date(), plots });
  };

  router.get(
    "/environment",
    asyncRoute(async (_req, res) => {
      const data = await getEnvironmentSnapshot();
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, data });
    }),
  );

  router.get(
    "/environment/export",
    asyncRoute(async (_req, res) => {
      const data = await getEnvironmentSnapshot();
      const base = {
        generatedAt: data.generatedAt,
        source: data.source,
        station: data.station.name,
        latitude: data.station.latitude,
        longitude: data.station.longitude,
        temperatureC: data.conditions.temperatureC,
        humidityPercent: data.conditions.humidityPercent,
        windSpeedMps: data.conditions.windSpeedMps,
        windDirectionDeg: data.conditions.windDirectionDeg,
        windDirection: data.conditions.windDirection,
        rainMm: data.conditions.rainMm,
        rainStatus: data.conditions.rainStatus,
        visibilityKm: data.conditions.visibilityKm,
        visibilityStatus: data.conditions.visibilityStatus,
        pressureHpa: data.conditions.pressureHpa,
        uvIndex: data.conditions.uvIndex,
        riskScore: data.flightRisk.score,
        riskLevel: data.flightRisk.level,
        activeFlights: data.fleet.activeFlights,
        atRiskFlights: data.fleet.atRiskFlights,
        telemetryCoveragePercent: data.fleet.telemetryCoveragePercent,
        factorKey: "",
        factorSeverity: "",
        factorLabel: "",
        factorMessage: "",
        factorScore: "",
      };
      const rows = [
        { section: "SUMMARY", ...base },
        ...data.flightRisk.factors.map((factor) => ({
          section: "RISK_FACTOR",
          ...Object.fromEntries(
            Object.keys(base).map((key) => [key, ""]),
          ),
          generatedAt: data.generatedAt,
          source: data.source,
          station: data.station.name,
          riskScore: data.flightRisk.score,
          riskLevel: data.flightRisk.level,
          factorKey: factor.key,
          factorSeverity: factor.severity,
          factorLabel: factor.label,
          factorMessage: factor.message,
          factorScore: factor.score,
        })),
      ];
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="environment-${stamp}.csv"`,
      );
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${toCsv(rows)}`);
    }),
  );

  router.get(
    "/field-intelligence",
    asyncRoute(async (_req, res) => {
      const data = await getFieldIntelligence();
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, data });
    }),
  );

  const getMediaLibrary = async () => {
    const flights = await Flight.find({})
      .sort({ startedAt: -1 })
      .limit(50)
      .populate("droneId", "droneCode")
      .lean();
    const flightIds = flights.map((flight) => flight._id);
    const latestTelemetry = flightIds.length
      ? await Telemetry.aggregate([
          { $match: { flightId: { $in: flightIds } } },
          { $sort: { sequence: -1 } },
          {
            $group: {
              _id: "$flightId",
              telemetry: { $first: "$$ROOT" },
            },
          },
        ])
      : [];
    const telemetryByFlight = new Map(
      latestTelemetry.map((item: any) => [String(item._id), item.telemetry]),
    );
    return buildMediaLibrary({
      now: new Date(),
      flights: flights.map((flight: any) => {
        const telemetry = telemetryByFlight.get(String(flight._id));
        return {
          id: String(flight._id),
          droneId: String(flight.droneId?._id ?? flight.droneId),
          droneCode: flight.droneId?.droneCode,
          missionId: flight.missionId ? String(flight.missionId) : undefined,
          startedAt: flight.startedAt,
          status: flight.status,
          telemetry: telemetry
            ? {
                timestamp: telemetry.timestamp,
                latitude: telemetry.latitude,
                longitude: telemetry.longitude,
                altitude: telemetry.altitude,
              }
            : undefined,
        };
      }),
    });
  };

  const filterMediaItems = (
    items: Awaited<ReturnType<typeof getMediaLibrary>>["items"],
    input: z.infer<typeof mediaFilterSchema>,
  ) => {
    const range = dateRange(
      input.dateFrom,
      input.dateTo,
      input.timezoneOffsetMinutes,
    );
    return items.filter((item) => {
      const capturedAt = Date.parse(item.capturedAt);
      if (input.type !== "ALL" && item.mediaType !== input.type) return false;
      if (input.sensorType !== "ALL" && item.sensorType !== input.sensorType)
        return false;
      if (input.droneId && item.droneId !== input.droneId) return false;
      if (range.$gte && capturedAt < range.$gte.getTime()) return false;
      if (range.$lte && capturedAt > range.$lte.getTime()) return false;
      return true;
    });
  };

  router.get(
    "/media",
    asyncRoute(async (req, res) => {
      const input = parse(mediaFilterSchema, req.query);
      const library = await getMediaLibrary();
      const filtered = filterMediaItems(library.items, input);
      const { page, limit } = input;
      const total = filtered.length;
      res.setHeader("Cache-Control", "no-store");
      res.json({
        success: true,
        data: filtered.slice((page - 1) * limit, page * limit),
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
        source: library.source,
        sourceLabel: library.sourceLabel,
        summary: summarizeMediaItems(filtered),
      });
    }),
  );

  router.get(
    "/media/export",
    asyncRoute(async (req, res) => {
      const input = parse(mediaExportFilterSchema, req.query);
      const library = await getMediaLibrary();
      const filtered = filterMediaItems(library.items, {
        ...input,
        page: 1,
        limit: 100,
      });
      if (filtered.length > MAX_MEDIA_EXPORT_ROWS)
        return res.status(413).json({
          success: false,
          error: {
            code: "EXPORT_TOO_LARGE",
            message: `Export is limited to ${MAX_MEDIA_EXPORT_ROWS.toLocaleString()} media records. Narrow the filters and try again.`,
          },
        });
      const rows = filtered.map((item) => ({
        mediaId: item.mediaId,
        mediaType: item.mediaType,
        sensorType: item.sensorType,
        capturedAt: item.capturedAt,
        droneId: item.droneId,
        droneCode: item.droneCode,
        flightId: item.flightId,
        missionId: item.missionId ?? "",
        latitude: item.latitude,
        longitude: item.longitude,
        altitude: item.altitude,
        durationSeconds: item.durationSeconds ?? "",
        fileLocation: item.fileLocation,
        status: item.status,
        virtual: item.virtual ? "true" : "false",
      }));
      const headers = [
        "mediaId",
        "mediaType",
        "sensorType",
        "capturedAt",
        "droneId",
        "droneCode",
        "flightId",
        "missionId",
        "latitude",
        "longitude",
        "altitude",
        "durationSeconds",
        "fileLocation",
        "status",
        "virtual",
      ];
      const csv = rows.length
        ? toCsv(rows)
        : headers.map((header) => `"${header}"`).join(",");
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="media-${stamp}.csv"`,
      );
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${csv}`);
    }),
  );

  router.get(
    "/system/status",
    requireAuth,
    asyncRoute(async (_req, res) => {
      const startedAt = Date.now();
      let databaseConnected = false;
      let databaseLatencyMs: number | null = null;
      if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
        try {
          await mongoose.connection.db.admin().ping();
          databaseConnected = true;
          databaseLatencyMs = Date.now() - startedAt;
        } catch {
          databaseConnected = false;
        }
      }
      const data = buildSystemStatus({
        databaseConnected,
        databaseLatencyMs,
        websocketClients: io.sockets.sockets.size,
        uptimeSeconds: process.uptime(),
        nodeVersion: process.version,
        memoryRssMb: process.memoryUsage().rss / 1024 / 1024,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, data });
    }),
  );

  router.get(
    "/insights",
    asyncRoute(async (_req, res) => {
      const data = await getOperationalInsights();
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, data });
    }),
  );

  router.get(
    "/insights/export",
    asyncRoute(async (_req, res) => {
      const data = await getOperationalInsights();
      const rows = [
        {
          section: "SUMMARY",
          generatedAt: data.generatedAt,
          riskScore: data.risk.score,
          riskLevel: data.risk.level,
          activeFlights: data.summary.activeFlights,
          activeAlerts: data.summary.activeAlerts,
          criticalAlerts: data.summary.criticalAlerts,
          staleTelemetry: data.summary.staleTelemetry,
          overdueMaintenance: data.summary.overdueMaintenance,
          healthyFlights: data.summary.healthyFlights,
          key: "",
          category: "",
          severity: "",
          drone: "",
          title: "",
          evidence: "",
          confidence: "",
          recommendation: "",
        },
        ...data.insights.map((insight) => ({
          section: "INSIGHT",
          generatedAt: data.generatedAt,
          riskScore: data.risk.score,
          riskLevel: data.risk.level,
          activeFlights: "",
          activeAlerts: "",
          criticalAlerts: "",
          staleTelemetry: "",
          overdueMaintenance: "",
          healthyFlights: "",
          key: insight.key,
          category: insight.category,
          severity: insight.severity,
          drone: insight.droneCode ?? insight.droneId ?? "",
          title: insight.title,
          evidence: insight.evidence,
          confidence: insight.confidence,
          recommendation: insight.recommendation,
        })),
      ];
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="operational-insights-${stamp}.csv"`,
      );
      res.setHeader("Cache-Control", "no-store");
      res.send(`\ufeff${toCsv(rows)}`);
    }),
  );

  router.get(
    "/analytics",
    asyncRoute(async (req, res) => {
      const input = parse(
        z
          .object({
            ...dateFields,
            timezoneOffsetMinutes: timezoneOffsetField,
            droneId: optionalObjectId,
          })
          .refine(
            (value) =>
              !value.dateFrom ||
              !value.dateTo ||
              value.dateFrom <= value.dateTo,
            {
              message: "Start date must not be after end date",
              path: ["dateFrom"],
            },
          ),
        req.query,
      );
      const today = new Date(Date.now() - input.timezoneOffsetMinutes * 60_000)
        .toISOString()
        .slice(0, 10);
      const end = dateRange(
        undefined,
        input.dateTo ?? today,
        input.timezoneOffsetMinutes,
      ).$lte!;
      const start = input.dateFrom
        ? dateRange(input.dateFrom, undefined, input.timezoneOffsetMinutes)
            .$gte!
        : new Date(end.getTime() - 30 * 86_400_000 + 1);
      const mongoTimezone = mongoTimezoneOffset(input.timezoneOffsetMinutes);
      if (end.getTime() - start.getTime() > 366 * 86_400_000)
        return res.status(400).json({
          success: false,
          error: {
            code: "RANGE_TOO_LARGE",
            message: "Analytics range cannot exceed 366 days",
          },
        });
      const droneId = input.droneId
        ? new Types.ObjectId(input.droneId)
        : undefined;
      const flightMatch: any = { startedAt: { $gte: start, $lte: end } };
      const alertMatch: any = { occurredAt: { $gte: start, $lte: end } };
      const missionMatch: any = {
        createdAt: { $gte: start, $lte: end },
        isArchived: false,
      };
      if (droneId) {
        flightMatch.droneId = droneId;
        alertMatch.droneId = droneId;
        missionMatch.droneId = droneId;
      }
      const [daily, totals, alertTypes, routes, missionOutcomes] =
        await Promise.all([
          Flight.aggregate([
            { $match: flightMatch },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$startedAt",
                    timezone: mongoTimezone,
                  },
                },
                flights: { $sum: 1 },
                distanceMeters: { $sum: "$distanceMeters" },
                durationSeconds: { $sum: "$durationSeconds" },
                completed: {
                  $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] },
                },
                failed: {
                  $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] },
                },
              },
            },
            { $sort: { _id: 1 } },
            {
              $project: {
                _id: 0,
                date: "$_id",
                flights: 1,
                completed: 1,
                failed: 1,
                distanceMeters: { $round: ["$distanceMeters", 0] },
                durationSeconds: 1,
              },
            },
          ]),
          Flight.aggregate([
            { $match: flightMatch },
            {
              $group: {
                _id: null,
                flights: { $sum: 1 },
                completed: {
                  $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] },
                },
                failed: {
                  $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] },
                },
                distanceMeters: { $sum: "$distanceMeters" },
                durationSeconds: { $sum: "$durationSeconds" },
                averageBatteryUsed: {
                  $avg: {
                    $subtract: [
                      "$batteryStart",
                      { $ifNull: ["$batteryEnd", "$batteryStart"] },
                    ],
                  },
                },
              },
            },
          ]),
          Alert.aggregate([
            { $match: alertMatch },
            { $group: { _id: "$type", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $project: { _id: 0, type: "$_id", count: 1 } },
          ]),
          Flight.aggregate([
            { $match: flightMatch },
            { $group: { _id: "$routePattern", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $project: { _id: 0, routePattern: "$_id", count: 1 } },
          ]),
          Mission.aggregate([
            { $match: missionMatch },
            { $group: { _id: "$status", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $project: { _id: 0, status: "$_id", count: 1 } },
          ]),
        ]);
      res.json({
        success: true,
        data: {
          range: { dateFrom: start.toISOString(), dateTo: end.toISOString() },
          totals: totals[0] ?? {
            flights: 0,
            completed: 0,
            failed: 0,
            distanceMeters: 0,
            durationSeconds: 0,
            averageBatteryUsed: 0,
          },
          daily,
          alertTypes,
          routePatterns: routes,
          missionOutcomes,
        },
      });
    }),
  );

  return router;
}
