import http from "node:http";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Server } from "socket.io";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import {
  Alert,
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
import { ROUTE_PATTERNS } from "./route-engine.js";
import { seedDemoFleet } from "./seed.js";
import {
  executeCommand,
  recoverInterruptedFlights,
  startFleetSimulation,
  startMission,
  startSimulation,
  stopFleetSimulation,
  stopSimulation,
} from "./simulator.js";
import { processDueMissions } from "./mission-scheduler.js";

describe("core project flow", () => {
  let mongo: MongoMemoryServer | undefined;
  let io: Server | undefined;
  let app: ReturnType<typeof createApp>;
  let token = "";
  let droneId = "";

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    io = new Server(http.createServer());
    app = createApp(io);
    await User.create({
      name: "Admin",
      email: "admin@test.local",
      passwordHash: await bcrypt.hash("Admin123!", 4),
      role: "ADMIN",
    });
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
    await io?.close();
  });

  it("reports database-backed service readiness", async () => {
    const health = await request(app).get("/health");
    const ready = await request(app).get("/ready");
    expect(health.status).toBe(200);
    expect(health.body.data).toMatchObject({
      status: "online",
      database: "connected",
    });
    expect(health.body.data.databaseLatencyMs).toBeTypeOf("number");
    expect(ready.status).toBe(200);
    expect(ready.body.data.status).toBe("ready");
  });

  it("authenticates the seeded admin", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.local", password: "Admin123!" });
    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe("ADMIN");
    token = response.body.data.token;
  });

  it("returns evidence-backed operational insights", async () => {
    const response = await request(app)
      .get("/api/v1/insights")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data.risk).toMatchObject({ score: 0, level: "LOW" });
    expect(response.body.data.summary).toMatchObject({
      activeFlights: 0,
      activeAlerts: 0,
      staleTelemetry: 0,
    });
    expect(response.body.data.insights[0]).toMatchObject({
      category: "RECOMMENDATION",
      severity: "INFO",
    });
    const exported = await request(app)
      .get("/api/v1/insights/export")
      .set("Authorization", `Bearer ${token}`);
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toMatch(/text\/csv/);
    expect(exported.headers["cache-control"]).toBe("no-store");
    expect(exported.headers["content-disposition"]).toMatch(
      /operational-insights-\d{4}-\d{2}-\d{2}\.csv/,
    );
    expect(exported.text).toContain('"section","generatedAt"');
  });

  it("returns transparent environment conditions and flight risk", async () => {
    const response = await request(app)
      .get("/api/v1/environment")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data).toMatchObject({
      source: "SIMULATED",
      station: { name: "Demo operations field" },
      conditions: {
        rainStatus: expect.stringMatching(/^(NONE|LIGHT|MODERATE|HEAVY)$/),
        visibilityStatus: expect.stringMatching(/^(GOOD|REDUCED|POOR)$/),
      },
      flightRisk: {
        score: expect.any(Number),
        level: expect.stringMatching(/^(LOW|WATCH|HIGH|CRITICAL)$/),
      },
      fleet: {
        activeFlights: 0,
        atRiskFlights: 0,
        telemetryCoveragePercent: 100,
      },
    });
    const exported = await request(app)
      .get("/api/v1/environment/export")
      .set("Authorization", `Bearer ${token}`);
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toMatch(/text\/csv/);
    expect(exported.headers["cache-control"]).toBe("no-store");
    expect(exported.headers["content-disposition"]).toMatch(
      /environment-\d{4}-\d{2}-\d{2}\.csv/,
    );
    expect(exported.text).toContain('"section","generatedAt"');
  });

  it("returns a simulated field overview when no zones exist yet", async () => {
    const response = await request(app)
      .get("/api/v1/field-intelligence")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data).toMatchObject({
      source: "SIMULATED_ANALYSIS",
      field: { name: "Demo Field #01", plotsCount: 4, areaHectares: 3.2 },
      summary: {
        averageHealthScore: expect.any(Number),
        lastScanAt: expect.any(String),
      },
    });
    expect(response.body.data.plots).toHaveLength(4);
    expect(response.body.data.plots[0]).toMatchObject({
      name: "Plot 01",
      virtual: true,
    });
  });

  it("browses and exports simulated media metadata", async () => {
    const response = await request(app)
      .get("/api/v1/media?page=1&limit=5")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data).toHaveLength(5);
    expect(response.body.meta).toMatchObject({
      page: 1,
      limit: 5,
      total: 12,
      pages: 3,
    });
    expect(response.body.summary).toMatchObject({ total: 12, photos: 8, videos: 4 });
    expect(response.body.data[0]).toMatchObject({
      mediaId: expect.stringMatching(/^media-/),
      sensorType: expect.stringMatching(/^(RGB|THERMAL|MULTISPECTRAL)$/),
      fileLocation: expect.stringMatching(/^\/demo-media\//),
    });
    const filtered = await request(app)
      .get("/api/v1/media?type=VIDEO&sensorType=MULTISPECTRAL")
      .set("Authorization", `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.meta.total).toBe(4);
    expect(filtered.body.summary).toMatchObject({
      total: 4,
      photos: 0,
      videos: 4,
      rgb: 0,
      thermal: 0,
      multispectral: 4,
    });
    expect(filtered.body.data.every((item: any) => item.mediaType === "VIDEO")).toBe(true);
    const droneFiltered = await request(app)
      .get("/api/v1/media?droneId=507f1f77bcf86cd799439011")
      .set("Authorization", `Bearer ${token}`);
    expect(droneFiltered.status).toBe(200);
    expect(droneFiltered.body.meta.total).toBe(0);
    expect(droneFiltered.body.summary).toMatchObject({
      total: 0,
      photos: 0,
      videos: 0,
      latestCapture: null,
    });
    const exported = await request(app)
      .get("/api/v1/media/export?type=PHOTO&sensorType=THERMAL")
      .set("Authorization", `Bearer ${token}`);
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toMatch(/text\/csv/);
    expect(exported.headers["cache-control"]).toBe("no-store");
    expect(exported.headers["content-disposition"]).toMatch(
      /media-\d{4}-\d{2}-\d{2}\.csv/,
    );
    expect(exported.text).toContain('"mediaId","mediaType","sensorType"');
  });

  it("reports runtime service status without hiding simulated adapters", async () => {
    const response = await request(app)
      .get("/api/v1/system/status")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data).toMatchObject({
      source: "RUNTIME",
      overallStatus: "ONLINE",
      connection: {
        websocketClients: expect.any(Number),
        uptimeSeconds: expect.any(Number),
        nodeVersion: expect.stringMatching(/^v/),
      },
    });
    expect(response.body.data.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "database", status: "ONLINE" }),
        expect.objectContaining({ key: "drone-link", status: "SIMULATED" }),
        expect.objectContaining({ key: "ai-service", status: "SIMULATED" }),
        expect.objectContaining({ key: "mqtt", status: "NOT_CONFIGURED" }),
      ]),
    );
  });

  it("records login and logout session events", async () => {
    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(200);
    expect(logout.body.data.loggedOut).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      await AuditEvent.countDocuments({ action: "LOGIN" }),
    ).toBeGreaterThan(0);
    expect(
      await AuditEvent.countDocuments({ action: "LOGOUT" }),
    ).toBeGreaterThan(0);
  });

  it("filters, paginates and exports users without exposing credentials", async () => {
    const viewer = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Operations Viewer",
        email: "operations-viewer@test.local",
        password: "Viewer123!",
        role: "VIEWER",
      });
    expect(viewer.status).toBe(201);
    const disabled = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Disabled Viewer",
        email: "disabled-viewer@test.local",
        password: "Viewer123!",
        role: "VIEWER",
      });
    expect(disabled.status).toBe(201);
    const disabledUpdate = await request(app)
      .patch(`/api/v1/users/${disabled.body.data.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ isActive: false });
    expect(disabledUpdate.status).toBe(200);

    const paged = await request(app)
      .get(
        "/api/v1/users?search=operations-viewer&role=VIEWER&status=ACTIVE&page=1&limit=1",
      )
      .set("Authorization", `Bearer ${token}`);
    expect(paged.status).toBe(200);
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.data[0]).toMatchObject({
      name: "Operations Viewer",
      email: "operations-viewer@test.local",
      role: "VIEWER",
      isActive: true,
    });
    expect(paged.body.data[0].passwordHash).toBeUndefined();
    expect(paged.body.meta).toMatchObject({
      page: 1,
      limit: 1,
      total: 1,
      pages: 1,
    });

    const disabledOnly = await request(app)
      .get("/api/v1/users?status=DISABLED&page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);
    expect(disabledOnly.status).toBe(200);
    expect(disabledOnly.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "disabled-viewer@test.local",
          isActive: false,
        }),
      ]),
    );

    const exported = await request(app)
      .get("/api/v1/users/export?search=operations-viewer")
      .set("Authorization", `Bearer ${token}`);
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toMatch(/text\/csv/);
    expect(exported.headers["cache-control"]).toBe("no-store");
    expect(exported.headers["content-disposition"]).toMatch(
      /attachment; filename="users-/,
    );
    expect(exported.text).toContain(
      '"userId","name","email","role","status","createdAt"',
    );
    expect(exported.text).toContain("operations-viewer@test.local");
    expect(exported.text).not.toContain("passwordHash");

    const invalid = await request(app)
      .get("/api/v1/users?page=1&limit=101")
      .set("Authorization", `Bearer ${token}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("creates and lists a drone through the REST API", async () => {
    const created = await request(app)
      .post("/api/v1/drones")
      .set("Authorization", `Bearer ${token}`)
      .send({
        droneCode: "DRONE-001",
        name: "Demo aircraft",
        model: "X-Series",
        serialNumber: "SN-001",
        firmware: "1.0.0",
      });
    expect(created.status).toBe(201);
    droneId = created.body.data._id;
    const listed = await request(app)
      .get("/api/v1/drones")
      .set("Authorization", `Bearer ${token}`);
    expect(listed.body.data).toHaveLength(1);
    const paged = await request(app)
      .get("/api/v1/drones?page=1&limit=1")
      .set("Authorization", `Bearer ${token}`);
    expect(paged.status).toBe(200);
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.meta).toMatchObject({
      page: 1,
      limit: 1,
      total: 1,
      pages: 1,
    });
    const exported = await request(app)
      .get("/api/v1/drones/export?status=ALL")
      .set("Authorization", `Bearer ${token}`);
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toMatch(/text\/csv/);
    expect(exported.headers["cache-control"]).toBe("no-store");
    expect(exported.headers["content-disposition"]).toMatch(
      /attachment; filename="drones-/,
    );
    expect(exported.text).toContain(
      '"droneId","droneCode","name","model","serialNumber","firmware","status","battery","lastSeen","isDemo","createdAt"',
    );
    expect(exported.text).toContain("DRONE-001");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const audit = await request(app)
      .get("/api/v1/audit-events?action=DRONE_CREATED")
      .set("Authorization", `Bearer ${token}`);
    expect(audit.status).toBe(200);
    expect(audit.body.data).toHaveLength(1);
    expect(audit.body.data[0]).toMatchObject({
      action: "DRONE_CREATED",
      resourceType: "DRONE",
      resourceId: droneId,
    });
    const auditDate = new Date().toISOString().slice(0, 10);
    const auditExport = await request(app)
      .get(
        `/api/v1/audit-events/export?action=DRONE_CREATED&dateFrom=${auditDate}&dateTo=${auditDate}&timezoneOffsetMinutes=0`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(auditExport.status).toBe(200);
    expect(auditExport.headers["content-type"]).toMatch(/text\/csv/);
    expect(auditExport.headers["cache-control"]).toBe("no-store");
    expect(auditExport.text).toContain(
      '"occurredAt","actor","action","resourceType","resourceId","method","route","statusCode","ipAddress"',
    );
    expect(auditExport.text).toContain("DRONE_CREATED");
  });

  it("filters, paginates and exports geofences while preserving safety fields", async () => {
    const polygon = await request(app)
      .post("/api/v1/geofences")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Survey North",
        type: "POLYGON",
        polygon: [
          { latitude: 10.7615, longitude: 106.6595 },
          { latitude: 10.7615, longitude: 106.661 },
          { latitude: 10.7635, longitude: 106.661 },
          { latitude: 10.7635, longitude: 106.6595 },
        ],
        homePosition: { latitude: 10.762622, longitude: 106.660172 },
        isActive: true,
      });
    expect(polygon.status).toBe(201);
    const inactive = await request(app)
      .post("/api/v1/geofences")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Inactive South",
        type: "CIRCLE",
        center: { latitude: 10.762622, longitude: 106.660172 },
        radiusMeters: 250,
        homePosition: { latitude: 10.762622, longitude: 106.660172 },
        isActive: false,
      });
    expect(inactive.status).toBe(201);

    const paged = await request(app)
      .get("/api/v1/geofences?search=Survey&status=ACTIVE&page=1&limit=1")
      .set("Authorization", `Bearer ${token}`);
    expect(paged.status).toBe(200);
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.data[0]).toMatchObject({
      name: "Survey North",
      type: "POLYGON",
      isActive: true,
    });
    expect(paged.body.meta).toMatchObject({
      page: 1,
      limit: 1,
      total: 1,
      pages: 1,
    });

    const inactiveOnly = await request(app)
      .get("/api/v1/geofences?status=INACTIVE&page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);
    expect(inactiveOnly.status).toBe(200);
    expect(inactiveOnly.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Inactive South", isActive: false }),
      ]),
    );

    const exported = await request(app)
      .get("/api/v1/geofences/export?search=Survey")
      .set("Authorization", `Bearer ${token}`);
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toMatch(/text\/csv/);
    expect(exported.headers["cache-control"]).toBe("no-store");
    expect(exported.headers["content-disposition"]).toMatch(
      /attachment; filename="geofences-/,
    );
    expect(exported.text).toContain(
      '"geofenceId","name","type","status","isActive","vertices","centerLatitude","centerLongitude","radiusMeters","homeLatitude","homeLongitude","createdAt"',
    );
    expect(exported.text).toContain("Survey North");
    expect(exported.text).toContain('"4"');

    const invalid = await request(app)
      .get("/api/v1/geofences?page=1&limit=101")
      .set("Authorization", `Bearer ${token}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missions that reference unavailable resources", async () => {
    const mission = {
      name: "Invalid assignment",
      droneId: new mongoose.Types.ObjectId().toString(),
      homePosition: { latitude: 10.762622, longitude: 106.660172 },
      waypoints: [
        {
          order: 0,
          latitude: 10.7628,
          longitude: 106.6603,
          altitude: 25,
          speed: 6,
        },
        {
          order: 1,
          latitude: 10.763,
          longitude: 106.6605,
          altitude: 30,
          speed: 6,
        },
      ],
    };
    let response = await request(app)
      .post("/api/v1/missions")
      .set("Authorization", `Bearer ${token}`)
      .send(mission);
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain("assigned drone");
    const fence = await Geofence.create({
      name: "Inactive assignment",
      type: "CIRCLE",
      center: mission.homePosition,
      radiusMeters: 300,
      homePosition: mission.homePosition,
      isActive: false,
    });
    response = await request(app)
      .post("/api/v1/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...mission, droneId, geofenceId: String(fence._id) });
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain("inactive");
    expect(await Mission.countDocuments({ name: "Invalid assignment" })).toBe(
      0,
    );
  });

  it("rejects ambiguous waypoint ordering", async () => {
    const response = await request(app)
      .post("/api/v1/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Duplicate waypoint order",
        droneId,
        homePosition: { latitude: 10.762622, longitude: 106.660172 },
        waypoints: [
          {
            order: 0,
            latitude: 10.7628,
            longitude: 106.6603,
            altitude: 25,
            speed: 6,
          },
          {
            order: 0,
            latitude: 10.763,
            longitude: 106.6605,
            altitude: 30,
            speed: 6,
          },
        ],
      });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("applies configurable alert thresholds and automatic safety actions", async () => {
    const catalog = await request(app)
      .get("/api/v1/alert-rules")
      .set("Authorization", `Bearer ${token}`);
    expect(catalog.status).toBe(200);
    expect(catalog.body.data).toHaveLength(4);
    const updated = await request(app)
      .patch("/api/v1/alert-rules/BATTERY_LOW")
      .set("Authorization", `Bearer ${token}`)
      .send({ threshold: 34, severity: "WARNING", autoAction: "RETURN_HOME" });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      threshold: 34,
      severity: "WARNING",
      autoAction: "RETURN_HOME",
    });
    const invalid = await request(app)
      .patch("/api/v1/alert-rules/GEOFENCE_BREACH")
      .set("Authorization", `Bearer ${token}`)
      .send({ threshold: 20 });
    expect(invalid.status).toBe(400);
    const flight = await startSimulation(io!, droneId, "LOW_BATTERY", "CIRCLE");
    await new Promise((resolve) => setTimeout(resolve, 1150));
    const batteryAlert = await Alert.findOne({
      flightId: flight._id,
      type: "BATTERY_LOW",
    });
    expect(batteryAlert).toMatchObject({
      severity: "WARNING",
      message: "Battery level is below 34%",
    });
    expect(
      await Command.countDocuments({
        flightId: flight._id,
        type: "RETURN_HOME",
        source: "SYSTEM",
      }),
    ).toBe(1);
    const acknowledged = await request(app)
      .patch(`/api/v1/alerts/${batteryAlert!._id}/acknowledge`)
      .set("Authorization", `Bearer ${token}`)
      .send({ note: "Operator is monitoring return-home" });
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data.acknowledgedAt).toBeTruthy();
    const manualAlerts = await Alert.create([
      {
        flightId: flight._id,
        droneId,
        type: "GPS_WEAK",
        severity: "WARNING",
        message: "Manual workflow one",
      },
      {
        flightId: flight._id,
        droneId,
        type: "WIND_DRIFT",
        severity: "WARNING",
        message: "Manual workflow two",
      },
    ]);
    const bulk = await request(app)
      .post("/api/v1/alerts/bulk-acknowledge")
      .set("Authorization", `Bearer ${token}`)
      .send({
        alertIds: manualAlerts.map((alert) => String(alert._id)),
        note: "Reviewed together",
      });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.acknowledged).toBe(2);
    const resolved = await request(app)
      .patch(`/api/v1/alerts/${manualAlerts[0]._id}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ note: "GPS receiver checked and stable" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.resolutionNote).toBe(
      "GPS receiver checked and stable",
    );
    const alertExport = await request(app)
      .get("/api/v1/alerts/export?type=GPS_WEAK&status=RESOLVED")
      .set("Authorization", `Bearer ${token}`);
    expect(alertExport.status).toBe(200);
    expect(alertExport.headers["content-type"]).toMatch(/text\/csv/);
    expect(alertExport.headers["cache-control"]).toBe("no-store");
    expect(alertExport.headers["content-disposition"]).toMatch(
      /attachment; filename="alerts-/,
    );
    expect(alertExport.text).toContain(
      '"occurredAt","alertId","flightId","drone","type","severity","status","message","acknowledgedBy","acknowledgedAt","acknowledgementNote","resolvedBy","resolvedAt","resolutionNote","latitude","longitude"',
    );
    expect(alertExport.text).toContain("Manual workflow one");
    await stopSimulation(io!, String(flight._id));
    expect(await Alert.findById(batteryAlert!._id)).toMatchObject({
      status: "RESOLVED",
      acknowledgementNote: "Operator is monitoring return-home",
    });
    expect(await Alert.findById(manualAlerts[1]._id)).toMatchObject({
      status: "RESOLVED",
      resolutionNote: "Automatically resolved when flight completed",
    });
    const reset = await request(app)
      .post("/api/v1/alert-rules/reset")
      .set("Authorization", `Bearer ${token}`);
    expect(reset.status).toBe(200);
    expect(
      reset.body.data.find((rule: any) => rule.key === "BATTERY_LOW"),
    ).toMatchObject({
      threshold: 30,
      severity: "CRITICAL",
      autoAction: "NONE",
    });
  }, 8_000);

  it("persists telemetry and completes a simulation", async () => {
    const flight = await startSimulation(io!, droneId, "GPS_WEAK", "STAR");
    expect(String((await Drone.findById(droneId))!.activeFlightId)).toBe(
      String(flight._id),
    );
    await new Promise((resolve) => setTimeout(resolve, 1150));
    const activeTelemetry = await request(app)
      .get("/api/v1/flights/active/telemetry?limit=1")
      .set("Authorization", `Bearer ${token}`);
    expect(activeTelemetry.status).toBe(200);
    expect(activeTelemetry.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          flightId: String(flight._id),
          droneId,
          telemetry: expect.arrayContaining([
            expect.objectContaining({ flightId: String(flight._id) }),
          ]),
        }),
      ]),
    );
    const activeItem = activeTelemetry.body.data.find(
      (item: any) => item.flightId === String(flight._id),
    );
    expect(activeItem.telemetry).toHaveLength(1);
    const completed = await stopSimulation(io!, String(flight._id));
    expect(completed.status).toBe("COMPLETED");
    const telemetry = await Telemetry.find({ flightId: flight._id }).sort({
      sequence: 1,
    });
    expect(telemetry.length).toBeGreaterThan(0);
    expect(telemetry.at(-1)?.heading).toBeGreaterThanOrEqual(0);
    expect(telemetry.at(-1)?.heading).toBeLessThanOrEqual(360);
    const telemetryDate = new Date(telemetry[0].timestamp)
      .toISOString()
      .slice(0, 10);
    const filteredTelemetry = await request(app)
      .get(
        `/api/v1/flights/${flight._id}/telemetry?dateFrom=${telemetryDate}&dateTo=${telemetryDate}&timezoneOffsetMinutes=0&limit=5000`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(filteredTelemetry.status).toBe(200);
    expect(filteredTelemetry.body.data).toHaveLength(telemetry.length);
    const emptyTelemetry = await request(app)
      .get(
        `/api/v1/flights/${flight._id}/telemetry?dateFrom=2000-01-01&dateTo=2000-01-02`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(emptyTelemetry.status).toBe(200);
    expect(emptyTelemetry.body.data).toHaveLength(0);
    const invalidTelemetryRange = await request(app)
      .get(
        `/api/v1/flights/${flight._id}/telemetry?dateFrom=${telemetryDate}&dateTo=2000-01-01`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(invalidTelemetryRange.status).toBe(400);
    const telemetryExport = await request(app)
      .get(`/api/v1/flights/${flight._id}/telemetry/export`)
      .set("Authorization", `Bearer ${token}`);
    expect(telemetryExport.status).toBe(200);
    expect(telemetryExport.headers["content-type"]).toMatch(/text\/csv/);
    expect(telemetryExport.headers["cache-control"]).toBe("no-store");
    expect(telemetryExport.headers["content-disposition"]).toMatch(
      /attachment; filename="telemetry-FL-/,
    );
    expect(telemetryExport.text).toContain(
      '"timestamp","sequence","battery","latitude","longitude","altitude","speed","heading","gpsSatellites","signal","flightMode","flightPhase","routePattern","waypointIndex","waypointCount"',
    );
    expect(telemetryExport.text).toContain(String(telemetry[0].sequence));
    const flightExport = await request(app)
      .get("/api/v1/flights/export?status=COMPLETED")
      .set("Authorization", `Bearer ${token}`);
    expect(flightExport.status).toBe(200);
    expect(flightExport.headers["content-type"]).toMatch(/text\/csv/);
    expect(flightExport.headers["cache-control"]).toBe("no-store");
    expect(flightExport.headers["content-disposition"]).toMatch(
      /attachment; filename="flights-/,
    );
    expect(flightExport.text).toContain(
      '"flight","drone","route","scenario","anomalies","status","flightPhase","startedAt","endedAt","durationSeconds","distanceMeters","maxAltitude","maxSpeed","batteryStart","batteryEnd","missionId"',
    );
    expect(flightExport.text).toContain(flight.flightCode);
    expect(await Flight.countDocuments({ _id: flight._id, droneId })).toBe(1);
    expect(await Drone.findById(droneId)).toMatchObject({
      status: "ONLINE",
      activeFlightId: null,
    });
    expect(await Alert.countDocuments({ flightId: flight._id })).toBe(0);
  });

  it("schedules maintenance and reflects overdue risk in fleet health", async () => {
    const scheduled = await request(app)
      .post("/api/v1/maintenance")
      .set("Authorization", `Bearer ${token}`)
      .send({
        droneId,
        type: "INSPECTION",
        scheduledFor: new Date(Date.now() - 86_400_000).toISOString(),
        notes: "Routine airframe inspection",
      });
    expect(scheduled.status).toBe(201);
    const taskId = scheduled.body.data._id;
    const maintenanceExport = await request(app)
      .get(`/api/v1/maintenance/export?status=SCHEDULED&droneId=${droneId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(maintenanceExport.status).toBe(200);
    expect(maintenanceExport.headers["content-type"]).toMatch(/text\/csv/);
    expect(maintenanceExport.headers["cache-control"]).toBe("no-store");
    expect(maintenanceExport.headers["content-disposition"]).toMatch(
      /attachment; filename="maintenance-/,
    );
    expect(maintenanceExport.text).toContain(
      '"taskId","scheduledFor","drone","type","status","completedAt","notes","createdBy","createdAt"',
    );
    expect(maintenanceExport.text).toContain("Routine airframe inspection");
    const health = await request(app)
      .get("/api/v1/maintenance/health")
      .set("Authorization", `Bearer ${token}`);
    expect(health.status).toBe(200);
    expect(
      health.body.data.items.find((item: any) => item.drone._id === droneId),
    ).toMatchObject({
      status: "SERVICE_DUE",
      metrics: { overdueMaintenance: 1 },
    });
    const started = await request(app)
      .patch(`/api/v1/maintenance/${taskId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "IN_PROGRESS" });
    expect(started.status).toBe(200);
    const completed = await request(app)
      .patch(`/api/v1/maintenance/${taskId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "COMPLETED" });
    expect(completed.status).toBe(200);
    expect(completed.body.data.completedAt).toBeTruthy();
    expect(await Maintenance.findById(taskId)).toMatchObject({
      status: "COMPLETED",
    });
    expect(await Drone.findById(droneId)).toMatchObject({ status: "ONLINE" });
  });

  it("prevents maintenance from starting during an active flight", async () => {
    const task = await Maintenance.create({
      droneId,
      type: "REPAIR",
      scheduledFor: new Date(),
      notes: "Safety interlock test",
      createdBy: (await User.findOne({ email: "admin@test.local" }))!._id,
    });
    const flight = await startSimulation(io!, droneId, "NORMAL", "RANDOM");
    try {
      const response = await request(app)
        .patch(`/api/v1/maintenance/${task._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "IN_PROGRESS" });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("ACTIVE_FLIGHT");
    } finally {
      await stopSimulation(io!, String(flight._id));
      await Maintenance.findByIdAndUpdate(task._id, { status: "CANCELLED" });
    }
  });

  it("enforces a consistent maintenance lifecycle per aircraft", async () => {
    const admin = await User.findOne({ email: "admin@test.local" });
    const [first, second] = await Maintenance.create([
      {
        droneId,
        type: "PROPELLER",
        scheduledFor: new Date(),
        notes: "Primary service",
        createdBy: admin!._id,
      },
      {
        droneId,
        type: "FIRMWARE",
        scheduledFor: new Date(),
        notes: "Queued service",
        createdBy: admin!._id,
      },
    ]);
    let response = await request(app)
      .patch(`/api/v1/maintenance/${first._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "IN_PROGRESS" });
    expect(response.status).toBe(200);
    response = await request(app)
      .patch(`/api/v1/maintenance/${first._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "SCHEDULED" });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_TRANSITION");
    response = await request(app)
      .patch(`/api/v1/maintenance/${second._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "IN_PROGRESS" });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("MAINTENANCE_CONFLICT");
    await request(app)
      .patch(`/api/v1/maintenance/${first._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "COMPLETED" });
    response = await request(app)
      .patch(`/api/v1/maintenance/${second._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "IN_PROGRESS" });
    expect(response.status).toBe(200);
    await request(app)
      .patch(`/api/v1/maintenance/${second._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "CANCELLED" });
  });

  it("blocks launch when battery or maintenance readiness checks fail", async () => {
    const admin = await User.findOne({ email: "admin@test.local" });
    const task = await Maintenance.create({
      droneId,
      type: "REPAIR",
      status: "IN_PROGRESS",
      scheduledFor: new Date(),
      notes: "Preflight interlock",
      createdBy: admin!._id,
    });
    let response = await request(app)
      .post("/api/v1/flights/simulate")
      .set("Authorization", `Bearer ${token}`)
      .send({ droneId, scenario: "NORMAL", routePattern: "RANDOM" });
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain(
      "Maintenance is currently in progress",
    );
    await Maintenance.findByIdAndUpdate(task._id, { status: "CANCELLED" });
    await Drone.findByIdAndUpdate(droneId, { battery: 12, status: "ONLINE" });
    response = await request(app)
      .post("/api/v1/flights/simulate")
      .set("Authorization", `Bearer ${token}`)
      .send({ droneId, scenario: "NORMAL", routePattern: "RANDOM" });
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain("20% is required");
    const readiness = await request(app)
      .get(`/api/v1/drones/${droneId}/readiness`)
      .set("Authorization", `Bearer ${token}`);
    expect(readiness.status).toBe(200);
    expect(readiness.body.data).toMatchObject({
      ready: false,
      requiredBatteryPercent: 20,
    });
    const lowBatteryMission = await Mission.create({
      name: "Low battery schedule",
      droneId,
      homePosition: { latitude: 10.762622, longitude: 106.660172 },
      waypoints: [
        {
          order: 0,
          latitude: 10.7628,
          longitude: 106.6603,
          altitude: 25,
          speed: 6,
        },
        {
          order: 1,
          latitude: 10.763,
          longitude: 106.6605,
          altitude: 30,
          speed: 6,
        },
      ],
    });
    const rejectedSchedule = await request(app)
      .post(`/api/v1/missions/${lowBatteryMission._id}/schedule`)
      .set("Authorization", `Bearer ${token}`)
      .send({ scheduledFor: new Date(Date.now() + 60_000).toISOString() });
    expect(rejectedSchedule.status).toBe(409);
    expect(rejectedSchedule.body.error).toMatchObject({
      code: "PREFLIGHT_FAILED",
    });
    expect(rejectedSchedule.body.error.message).toContain("20% is required");
    await Mission.deleteOne({ _id: lowBatteryMission._id });
    await Drone.findByIdAndUpdate(droneId, { battery: 90 });
  });

  it("allows only one concurrent launch request per aircraft", async () => {
    const attempts = await Promise.allSettled([
      startSimulation(io!, droneId, "NORMAL", "RANDOM"),
      startSimulation(io!, droneId, "NORMAL", "STAR"),
    ]);
    const started = attempts.filter(
      (result): result is PromiseFulfilledResult<any> =>
        result.status === "fulfilled",
    );
    const rejected = attempts.filter((result) => result.status === "rejected");
    expect(started).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await Flight.countDocuments({ droneId, status: "ACTIVE" })).toBe(1);
    await stopSimulation(io!, String(started[0].value._id));
  });

  it("serializes concurrent operator commands for one flight", async () => {
    const flight = await startSimulation(io!, droneId, "NORMAL", "RANDOM");
    const operatorId = String(
      (await User.findOne({ email: "admin@test.local" }))!._id,
    );
    const outcomes = await Promise.allSettled([
      executeCommand(io!, String(flight._id), "LAND", operatorId),
      executeCommand(io!, String(flight._id), "RETURN_HOME", operatorId),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await stopSimulation(io!, String(flight._id));
  });

  it("releases the command lock when command persistence fails", async () => {
    const flight = await startSimulation(io!, droneId, "NORMAL", "RANDOM");
    const operatorId = String(
      (await User.findOne({ email: "admin@test.local" }))!._id,
    );
    const create = vi
      .spyOn(Command, "create")
      .mockRejectedValueOnce(
        new Error("simulated command persistence failure"),
      );
    await expect(
      executeCommand(io!, String(flight._id), "PAUSE", operatorId),
    ).rejects.toThrow("simulated command persistence failure");
    create.mockRestore();
    try {
      const command = await executeCommand(
        io!,
        String(flight._id),
        "PAUSE",
        operatorId,
      );
      expect(command.status).toBe("COMPLETED");
    } finally {
      await stopSimulation(io!, String(flight._id));
    }
  });

  it("rolls back the in-memory flight phase when command completion persistence fails", async () => {
    const flight = await startSimulation(io!, droneId, "NORMAL", "RANDOM");
    const operatorId = String(
      (await User.findOne({ email: "admin@test.local" }))!._id,
    );
    const save = vi
      .spyOn(Command.prototype, "save")
      .mockRejectedValueOnce(
        new Error("simulated completion persistence failure"),
      );
    let failedCommand: any;
    try {
      await expect(
        executeCommand(io!, String(flight._id), "RETURN_HOME", operatorId),
      ).rejects.toThrow("simulated completion persistence failure");
      const persistedFlight = await Flight.findById(flight._id);
      failedCommand = await Command.findOne({
        flightId: flight._id,
      }).sort({ requestedAt: -1 });
      expect(persistedFlight?.flightPhase).toBe("MISSION");
      expect(failedCommand).toMatchObject({
        type: "RETURN_HOME",
        status: "FAILED",
      });
      save.mockRestore();
      const retried = await request(app)
        .post(`/api/v1/commands/${failedCommand._id}/retry`)
        .set("Authorization", `Bearer ${token}`);
      expect(retried.status).toBe(201);
      expect(retried.body.data).toMatchObject({
        type: "RETURN_HOME",
        status: "COMPLETED",
        retryOf: String(failedCommand._id),
      });
      expect(retried.body.meta.retryOf).toBe(String(failedCommand._id));
    } finally {
      save.mockRestore();
      await stopSimulation(io!, String(flight._id)).catch(() => undefined);
    }
  });

  it("records but does not duplicate a completed return-home command", async () => {
    const flight = await startSimulation(io!, droneId, "NORMAL", "RANDOM");
    const operatorId = String(
      (await User.findOne({ email: "admin@test.local" }))!._id,
    );
    try {
      const first = await executeCommand(
        io!,
        String(flight._id),
        "RETURN_HOME",
        operatorId,
      );
      expect(first.status).toBe("COMPLETED");
      await expect(
        executeCommand(io!, String(flight._id), "RETURN_HOME", operatorId),
      ).rejects.toThrow("already returning home");
      expect(
        await Command.countDocuments({
          flightId: flight._id,
          type: "RETURN_HOME",
          status: "COMPLETED",
        }),
      ).toBe(1);
      expect(
        await Command.countDocuments({
          flightId: flight._id,
          type: "RETURN_HOME",
          status: "FAILED",
        }),
      ).toBe(1);
    } finally {
      await stopSimulation(io!, String(flight._id)).catch(() => undefined);
    }
  });

  it("validates, duplicates and operates a waypoint mission", async () => {
    const fence = await Geofence.create({
      name: "Test zone",
      type: "CIRCLE",
      center: { latitude: 10.762622, longitude: 106.660172 },
      radiusMeters: 300,
      homePosition: { latitude: 10.762622, longitude: 106.660172 },
      isActive: true,
    });
    const mission = await Mission.create({
      name: "Inspection",
      droneId,
      geofenceId: fence._id,
      homePosition: fence.homePosition,
      waypoints: [
        {
          order: 0,
          latitude: 10.7629,
          longitude: 106.6604,
          altitude: 30,
          speed: 5,
        },
        {
          order: 1,
          latitude: 10.7631,
          longitude: 106.6607,
          altitude: 45,
          speed: 7,
        },
      ],
    });
    const validated = await request(app)
      .post(`/api/v1/missions/${mission._id}/validate`)
      .set("Authorization", `Bearer ${token}`);
    expect(validated.status).toBe(200);
    expect(validated.body.data.valid).toBe(true);
    expect(validated.body.data.estimate.distanceMeters).toBeGreaterThan(0);
    const duplicated = await request(app)
      .post(`/api/v1/missions/${mission._id}/duplicate`)
      .set("Authorization", `Bearer ${token}`);
    expect(duplicated.status).toBe(201);
    expect(duplicated.body.data.name).toContain("Copy of");
    const started = await request(app)
      .post(`/api/v1/missions/${mission._id}/start`)
      .set("Authorization", `Bearer ${token}`);
    expect(started.status).toBe(201);
    const flightId = started.body.data._id;
    const detail = await request(app)
      .get(`/api/v1/flights/${flightId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.flight.missionId.geofenceId).toMatchObject({
      name: "Test zone",
      type: "CIRCLE",
    });
    await new Promise((resolve) => setTimeout(resolve, 1150));
    const paused = await request(app)
      .post("/api/v1/commands")
      .set("Authorization", `Bearer ${token}`)
      .send({ flightId, type: "PAUSE" });
    expect(paused.status).toBe(201);
    const rejected = await request(app)
      .post("/api/v1/commands")
      .set("Authorization", `Bearer ${token}`)
      .send({ flightId, type: "PAUSE" });
    expect(rejected.status).toBe(409);
    const resumed = await request(app)
      .post("/api/v1/commands")
      .set("Authorization", `Bearer ${token}`)
      .send({ flightId, type: "RESUME" });
    expect(resumed.status).toBe(201);
    let reachedWaypoint = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (await Telemetry.exists({ flightId, waypointIndex: { $gt: 0 } })) {
        reachedWaypoint = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(reachedWaypoint).toBe(true);
    const landed = await request(app)
      .post("/api/v1/commands")
      .set("Authorization", `Bearer ${token}`)
      .send({ flightId, type: "LAND" });
    expect(landed.status).toBe(201);
    let completedAfterLanding = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (!(await Flight.exists({ _id: flightId, status: "ACTIVE" }))) {
        completedAfterLanding = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(completedAfterLanding).toBe(true);
    const replay = await request(app)
      .get(`/api/v1/flights/${flightId}/replay`)
      .set("Authorization", `Bearer ${token}`);
    expect(replay.status).toBe(200);
    expect(replay.body.data.telemetry.length).toBeGreaterThan(0);
    expect(
      replay.body.data.telemetry.map((item: any) => item.waypointIndex),
    ).toContain(0);
    expect(
      replay.body.data.telemetry.some(
        (item: any) => Number(item.waypointIndex) > 0,
      ),
    ).toBe(true);
    expect(
      replay.body.data.telemetry.every(
        (item: any) => Number(item.waypointCount) === 2,
      ),
    ).toBe(true);
    expect(replay.body.data.flight.missionId.geofenceId).toMatchObject({
      name: "Test zone",
      type: "CIRCLE",
    });
    const detailAfterFlight = await request(app)
      .get(`/api/v1/flights/${flightId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detailAfterFlight.status).toBe(200);
    expect(detailAfterFlight.body.data.commands).toHaveLength(4);
    expect(detailAfterFlight.body.data.commands.map((item: any) => item.type)).toEqual([
      "PAUSE",
      "PAUSE",
      "RESUME",
      "LAND",
    ]);
    expect(await Command.countDocuments({ flightId })).toBe(4);
    expect(
      await Alert.countDocuments({ flightId, type: "COMMAND_FAILED" }),
    ).toBe(1);
    expect(await Mission.findById(mission._id)).toMatchObject({
      status: "CANCELLED",
    });
  }, 12_000);

  it("schedules, cancels and safely starts a due mission when its drone is available", async () => {
    const legacy = await Mission.collection.insertOne({
      name: "Legacy unscheduled mission",
      droneId: new mongoose.Types.ObjectId(droneId),
      homePosition: { latitude: 10.762622, longitude: 106.660172 },
      waypoints: [
        {
          order: 0,
          latitude: 10.7628,
          longitude: 106.6603,
          altitude: 25,
          speed: 6,
        },
        {
          order: 1,
          latitude: 10.763,
          longitude: 106.6605,
          altitude: 30,
          speed: 6,
        },
      ],
      status: "READY",
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const mission = await Mission.create({
      name: "Scheduled inspection",
      droneId,
      homePosition: { latitude: 10.762622, longitude: 106.660172 },
      waypoints: [
        {
          order: 0,
          latitude: 10.7628,
          longitude: 106.6603,
          altitude: 25,
          speed: 6,
        },
        {
          order: 1,
          latitude: 10.763,
          longitude: 106.6605,
          altitude: 30,
          speed: 6,
        },
      ],
      status: "READY",
    });
    const scheduled = await request(app)
      .post(`/api/v1/missions/${mission._id}/schedule`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        priority: "HIGH",
      });
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.data.scheduleStatus).toBe("SCHEDULED");
    const concurrentMission = await Mission.create({
      name: "Concurrent schedule",
      droneId,
      homePosition: { latitude: 10.762622, longitude: 106.660172 },
      waypoints: [
        {
          order: 0,
          latitude: 10.7628,
          longitude: 106.6603,
          altitude: 25,
          speed: 6,
        },
        {
          order: 1,
          latitude: 10.763,
          longitude: 106.6605,
          altitude: 30,
          speed: 6,
        },
      ],
    });
    const concurrentSchedules = await Promise.all([
      request(app)
        .post(`/api/v1/missions/${concurrentMission._id}/schedule`)
        .set("Authorization", `Bearer ${token}`)
        .send({ scheduledFor: new Date(Date.now() + 3_600_000).toISOString() }),
      request(app)
        .post(`/api/v1/missions/${concurrentMission._id}/schedule`)
        .set("Authorization", `Bearer ${token}`)
        .send({ scheduledFor: new Date(Date.now() + 7_200_000).toISOString() }),
    ]);
    expect(
      concurrentSchedules.map((response) => response.status).sort(),
    ).toEqual([200, 409]);
    await request(app)
      .delete(`/api/v1/missions/${concurrentMission._id}/schedule`)
      .set("Authorization", `Bearer ${token}`);
    const queue = await request(app)
      .get("/api/v1/mission-schedule?scheduleStatus=SCHEDULED")
      .set("Authorization", `Bearer ${token}`);
    expect(queue.status).toBe(200);
    expect(
      queue.body.data.some((item: any) => item._id === String(mission._id)),
    ).toBe(true);
    const scheduledDate = new Date(scheduled.body.data.scheduledFor)
      .toISOString()
      .slice(0, 10);
    const dateFilteredQueue = await request(app)
      .get(
        `/api/v1/mission-schedule?dateFrom=${scheduledDate}&dateTo=${scheduledDate}&timezoneOffsetMinutes=0`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(dateFilteredQueue.status).toBe(200);
    expect(dateFilteredQueue.body.meta.counts.SCHEDULED).toBeGreaterThan(0);
    expect(
      dateFilteredQueue.body.data.some(
        (item: any) => item._id === String(mission._id),
      ),
    ).toBe(true);
    const scheduleExport = await request(app)
      .get("/api/v1/mission-schedule/export?scheduleStatus=SCHEDULED")
      .set("Authorization", `Bearer ${token}`);
    expect(scheduleExport.status).toBe(200);
    expect(scheduleExport.headers["content-type"]).toMatch(/text\/csv/);
    expect(scheduleExport.headers["cache-control"]).toBe("no-store");
    expect(scheduleExport.headers["content-disposition"]).toMatch(
      /attachment; filename="mission-schedule-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(scheduleExport.text).toContain(
      '"mission","missionId","drone","priority","scheduleStatus","scheduledFor","scheduledBy","scheduleError","createdAt"',
    );
    expect(scheduleExport.text).toContain("Scheduled inspection");
    const completeQueue = await request(app)
      .get("/api/v1/mission-schedule")
      .set("Authorization", `Bearer ${token}`);
    expect(
      completeQueue.body.data.some(
        (item: any) => item._id === String(legacy.insertedId),
      ),
    ).toBe(false);
    await Mission.findByIdAndUpdate(mission._id, {
      scheduleStatus: "PROCESSING",
    });
    const processingCancel = await request(app)
      .delete(`/api/v1/missions/${mission._id}/schedule`)
      .set("Authorization", `Bearer ${token}`);
    expect(processingCancel.status).toBe(409);
    expect(processingCancel.body.error.code).toBe("SCHEDULE_IN_PROGRESS");
    await Mission.findByIdAndUpdate(mission._id, {
      scheduleStatus: "SCHEDULED",
    });
    const cancelled = await request(app)
      .delete(`/api/v1/missions/${mission._id}/schedule`)
      .set("Authorization", `Bearer ${token}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.scheduleStatus).toBe("CANCELLED");
    await Mission.findByIdAndUpdate(mission._id, {
      scheduleStatus: "SCHEDULED",
      scheduledFor: new Date(Date.now() - 1000),
    });
    const occupyingFlight = await startSimulation(
      io!,
      droneId,
      "NORMAL",
      "RANDOM",
    );
    const waiting = await processDueMissions(io!);
    expect(waiting).toEqual([
      expect.objectContaining({
        missionId: String(mission._id),
        status: "WAITING",
      }),
    ]);
    expect(await Mission.findById(mission._id)).toMatchObject({
      scheduleStatus: "SCHEDULED",
    });
    await stopSimulation(io!, String(occupyingFlight._id));
    const started = await processDueMissions(io!);
    expect(started).toEqual([
      expect.objectContaining({
        missionId: String(mission._id),
        status: "STARTED",
      }),
    ]);
    await stopSimulation(io!, started[0].flightId!);
    expect(await Mission.findById(mission._id)).toMatchObject({
      status: "COMPLETED",
      scheduleStatus: "STARTED",
    });
  });

  it("prevents editing a queued mission and clears stale schedule metadata after cancellation", async () => {
    const body = {
      name: "Editable scheduled mission",
      droneId,
      homePosition: { latitude: 10.762622, longitude: 106.660172 },
      waypoints: [
        {
          order: 0,
          latitude: 10.7628,
          longitude: 106.6603,
          altitude: 25,
          speed: 6,
        },
        {
          order: 1,
          latitude: 10.763,
          longitude: 106.6605,
          altitude: 30,
          speed: 6,
        },
      ],
    };
    const created = await request(app)
      .post("/api/v1/missions")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(created.status).toBe(201);
    const missionId = created.body.data._id;
    const scheduled = await request(app)
      .post(`/api/v1/missions/${missionId}/schedule`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        priority: "NORMAL",
      });
    expect(scheduled.status).toBe(200);
    let response = await request(app)
      .patch(`/api/v1/missions/${missionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ ...body, name: "Should not edit while queued" });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("MISSION_SCHEDULED");
    const cancelled = await request(app)
      .delete(`/api/v1/missions/${missionId}/schedule`)
      .set("Authorization", `Bearer ${token}`);
    expect(cancelled.status).toBe(200);
    response = await request(app)
      .patch(`/api/v1/missions/${missionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ ...body, name: "Edited after cancellation" });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      name: "Edited after cancellation",
      status: "READY",
      scheduleStatus: "NONE",
    });
    expect(response.body.data.scheduledFor).toBeUndefined();
  });

  it("rolls back a launched mission flight when mission persistence fails", async () => {
    const rollbackDrone = await Drone.create({
      droneCode: "ROLLBACK-01",
      name: "Rollback aircraft",
      model: "X-Series",
      serialNumber: "SN-ROLLBACK-01",
      status: "ONLINE",
      battery: 95,
    });
    const mission = await Mission.create({
      name: "Rollback mission",
      droneId: rollbackDrone._id,
      homePosition: { latitude: 10.762622, longitude: 106.660172 },
      waypoints: [
        {
          order: 0,
          latitude: 10.7628,
          longitude: 106.6603,
          altitude: 25,
          speed: 6,
        },
        {
          order: 1,
          latitude: 10.763,
          longitude: 106.6605,
          altitude: 30,
          speed: 6,
        },
      ],
    });
    const save = vi
      .spyOn(Mission.prototype, "save")
      .mockRejectedValueOnce(
        new Error("simulated mission persistence failure"),
      );
    try {
      await expect(startMission(io!, String(mission._id))).rejects.toThrow(
        "simulated mission persistence failure",
      );
    } finally {
      save.mockRestore();
    }
    expect(
      await Flight.countDocuments({ missionId: mission._id, status: "ACTIVE" }),
    ).toBe(0);
    expect(await Drone.findById(rollbackDrone._id)).toMatchObject({
      status: "OFFLINE",
      activeFlightId: null,
    });
    expect(await Mission.findById(mission._id)).toMatchObject({
      status: "FAILED",
    });
  });

  it("marks the flight failed when the drone claim cannot be persisted", async () => {
    const claimDrone = await Drone.create({
      droneCode: "CLAIM-01",
      name: "Claim aircraft",
      model: "X-Series",
      serialNumber: "SN-CLAIM-01",
      status: "ONLINE",
      battery: 95,
    });
    const claim = vi
      .spyOn(Drone, "findOneAndUpdate")
      .mockRejectedValueOnce(new Error("simulated drone claim failure"));
    try {
      await expect(
        startSimulation(io!, String(claimDrone._id), "NORMAL", "RANDOM"),
      ).rejects.toThrow("simulated drone claim failure");
    } finally {
      claim.mockRestore();
    }
    expect(
      await Flight.countDocuments({
        droneId: claimDrone._id,
        status: "ACTIVE",
      }),
    ).toBe(0);
    expect(
      await Flight.countDocuments({
        droneId: claimDrone._id,
        status: "FAILED",
      }),
    ).toBe(1);
    expect(await Drone.findById(claimDrone._id)).toMatchObject({
      status: "ONLINE",
      activeFlightId: null,
    });
  });

  it("protects scheduled mission resources from being archived", async () => {
    const scheduledDrone = await Drone.create({
      droneCode: "SCHEDULED-01",
      name: "Scheduled aircraft",
      model: "X-Series",
      serialNumber: "SN-SCHEDULED-01",
      status: "ONLINE",
      battery: 95,
    });
    const fence = await Geofence.create({
      name: "Scheduled zone",
      type: "CIRCLE",
      center: { latitude: 10.762622, longitude: 106.660172 },
      radiusMeters: 300,
      homePosition: { latitude: 10.762622, longitude: 106.660172 },
      isActive: true,
    });
    const mission = await Mission.create({
      name: "Protected schedule",
      droneId: scheduledDrone._id,
      geofenceId: fence._id,
      homePosition: fence.homePosition,
      waypoints: [
        {
          order: 0,
          latitude: 10.7628,
          longitude: 106.6603,
          altitude: 25,
          speed: 6,
        },
        {
          order: 1,
          latitude: 10.763,
          longitude: 106.6605,
          altitude: 30,
          speed: 6,
        },
      ],
    });
    const scheduled = await request(app)
      .post(`/api/v1/missions/${mission._id}/schedule`)
      .set("Authorization", `Bearer ${token}`)
      .send({ scheduledFor: new Date(Date.now() + 3_600_000).toISOString() });
    expect(scheduled.status).toBe(200);
    const droneArchive = await request(app)
      .delete(`/api/v1/drones/${scheduledDrone._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(droneArchive.status).toBe(409);
    expect(droneArchive.body.error).toMatchObject({ code: "IN_USE" });
    const fenceArchive = await request(app)
      .delete(`/api/v1/geofences/${fence._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(fenceArchive.status).toBe(409);
    expect(fenceArchive.body.error).toMatchObject({ code: "IN_USE" });
    const fenceEdit = await request(app)
      .patch(`/api/v1/geofences/${fence._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Edited scheduled zone",
        type: "CIRCLE",
        center: fence.center,
        radiusMeters: fence.radiusMeters,
        homePosition: fence.homePosition,
        isActive: true,
      });
    expect(fenceEdit.status).toBe(409);
    expect(fenceEdit.body.error).toMatchObject({ code: "IN_USE" });
    const cancelled = await request(app)
      .delete(`/api/v1/missions/${mission._id}/schedule`)
      .set("Authorization", `Bearer ${token}`);
    expect(cancelled.status).toBe(200);
    const readyDroneArchive = await request(app)
      .delete(`/api/v1/drones/${scheduledDrone._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(readyDroneArchive.status).toBe(409);
    expect(readyDroneArchive.body.error.code).toBe("IN_USE");
    expect(
      (
        await request(app)
          .delete(`/api/v1/missions/${mission._id}`)
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .delete(`/api/v1/geofences/${fence._id}`)
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .delete(`/api/v1/drones/${scheduledDrone._id}`)
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(200);
  });

  it("rejects malformed resource IDs and viewer mutations", async () => {
    const invalid = await request(app)
      .get("/api/v1/drones/not-an-id")
      .set("Authorization", `Bearer ${token}`);
    expect(invalid.status).toBe(400);
    const temporaryAdmin = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Temporary Admin",
        email: "temporary-admin@test.local",
        password: "Temporary123!",
        role: "ADMIN",
      });
    expect(temporaryAdmin.status).toBe(201);
    const temporaryLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "temporary-admin@test.local", password: "Temporary123!" });
    expect(temporaryLogin.status).toBe(200);
    const demoted = await request(app)
      .patch(`/api/v1/users/${temporaryAdmin.body.data.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "VIEWER" });
    expect(demoted.status).toBe(200);
    const staleAdmin = await request(app)
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${temporaryLogin.body.data.token}`);
    expect(staleAdmin.status).toBe(403);
    expect(staleAdmin.body.error.code).toBe("FORBIDDEN");
    const viewer = await User.create({
      name: "Viewer",
      email: "viewer@test.local",
      passwordHash: await bcrypt.hash("Viewer123!", 4),
      role: "VIEWER",
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "viewer@test.local", password: "Viewer123!" });
    const denied = await request(app)
      .post("/api/v1/drones")
      .set("Authorization", `Bearer ${login.body.data.token}`)
      .send({
        droneCode: "NOPE-001",
        name: "Denied",
        model: "X",
        serialNumber: "NOPE-001",
      });
    expect(denied.status).toBe(403);
    const auditDenied = await request(app)
      .get("/api/v1/audit-events")
      .set("Authorization", `Bearer ${login.body.data.token}`);
    expect(auditDenied.status).toBe(403);
    const rulesDenied = await request(app)
      .patch("/api/v1/alert-rules/BATTERY_LOW")
      .set("Authorization", `Bearer ${login.body.data.token}`)
      .send({ threshold: 25 });
    expect(rulesDenied.status).toBe(403);
    await User.findByIdAndUpdate(viewer._id, { isActive: false });
    const revoked = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${login.body.data.token}`);
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe("USER_INACTIVE");
  });

  it("runs multiple anomaly scenarios without duplicate alerts", async () => {
    const flight = await startSimulation(io!, droneId, "NORMAL", "CIRCLE", [
      "GPS_DRIFT",
      "WIND_DRIFT",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 6200));
    expect(
      await Alert.countDocuments({ flightId: flight._id, type: "GPS_DRIFT" }),
    ).toBe(1);
    expect(
      await Alert.countDocuments({ flightId: flight._id, type: "WIND_DRIFT" }),
    ).toBe(1);
    const saved = await Flight.findById(flight._id);
    expect(saved?.anomalyTypes).toEqual(
      expect.arrayContaining(["GPS_DRIFT", "WIND_DRIFT"]),
    );
    await stopSimulation(io!, String(flight._id));
  }, 10_000);

  it("reports signal loss and transitions an emergency flight to landing", async () => {
    const flight = await startSimulation(io!, droneId, "NORMAL", "SQUARE", [
      "SIGNAL_LOSS",
      "EMERGENCY_LANDING",
    ]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 12_300));
      expect(
        await Alert.countDocuments({
          flightId: flight._id,
          type: "SIGNAL_LOSS",
        }),
      ).toBe(1);
      expect(
        await Alert.countDocuments({
          flightId: flight._id,
          type: "EMERGENCY_LANDING",
        }),
      ).toBe(1);
      expect(await Flight.findById(flight._id)).toMatchObject({
        flightPhase: "LANDING",
      });
    } finally {
      await stopSimulation(io!, String(flight._id));
    }
  }, 18_000);

  it("returns filtered analytics and rejects invalid ranges", async () => {
    const dateFrom = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const dateTo = new Date().toISOString().slice(0, 10);
    const response = await request(app)
      .get(
        `/api/v1/analytics?dateFrom=${dateFrom}&dateTo=${dateTo}&droneId=${droneId}`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.totals.flights).toBeGreaterThan(0);
    expect(response.body.data.daily.length).toBeGreaterThan(0);
    expect(response.body.data).toHaveProperty("routePatterns");
    const localTimezone = await request(app)
      .get(
        `/api/v1/analytics?dateFrom=${dateFrom}&dateTo=${dateTo}&timezoneOffsetMinutes=-420`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(localTimezone.status).toBe(200);
    expect(localTimezone.body.data.range).toEqual({
      dateFrom: new Date(
        new Date(`${dateFrom}T00:00:00.000Z`).getTime() - 420 * 60_000,
      ).toISOString(),
      dateTo: new Date(
        new Date(`${dateTo}T23:59:59.999Z`).getTime() - 420 * 60_000,
      ).toISOString(),
    });
    const commandDate = new Date().toISOString().slice(0, 10);
    const commandHistory = await request(app)
      .get(
        `/api/v1/commands?dateFrom=${commandDate}&dateTo=${commandDate}&timezoneOffsetMinutes=0`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(commandHistory.status).toBe(200);
    expect(commandHistory.body.data.length).toBeGreaterThan(0);
    const commandExport = await request(app)
      .get(
        `/api/v1/commands/export?dateFrom=${commandDate}&dateTo=${commandDate}&timezoneOffsetMinutes=0`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(commandExport.status).toBe(200);
    expect(commandExport.headers["content-type"]).toMatch(/text\/csv/);
    expect(commandExport.headers["cache-control"]).toBe("no-store");
    expect(commandExport.headers["content-disposition"]).toMatch(
      /attachment; filename="commands-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(commandExport.text).toContain(
      '"command","flightId","drone","action","source","requestedBy","requestedAt","completedAt","status","failureReason"',
    );
    expect(commandExport.text).toContain(commandHistory.body.data[0].commandCode);
    const reversed = await request(app)
      .get(`/api/v1/analytics?dateFrom=${dateTo}&dateTo=${dateFrom}`)
      .set("Authorization", `Bearer ${token}`);
    expect(reversed.status).toBe(400);
    const reversedCommands = await request(app)
      .get(`/api/v1/commands?dateFrom=${dateTo}&dateTo=${dateFrom}`)
      .set("Authorization", `Bearer ${token}`);
    expect(reversedCommands.status).toBe(400);
    const malformed = await request(app)
      .get("/api/v1/analytics?droneId=invalid")
      .set("Authorization", `Bearer ${token}`);
    expect(malformed.status).toBe(400);
  });

  it("validates list filters, dates and pagination consistently", async () => {
    const urls = [
      "/api/v1/flights?page=Infinity",
      "/api/v1/drones?limit=101",
      "/api/v1/alerts?dateFrom=2026-02-31",
      "/api/v1/commands?dateFrom=2026-02-31",
      "/api/v1/alerts?timezoneOffsetMinutes=900",
      "/api/v1/commands?status=UNKNOWN",
      "/api/v1/maintenance?droneId=invalid",
      "/api/v1/drones?status=FLYING",
      "/api/v1/drones/export?status=FLYING",
      "/api/v1/flights/active/telemetry?limit=501",
      "/api/v1/flights/507f1f77bcf86cd799439011/telemetry?limit=0",
    ];
    for (const url of urls) {
      const response = await request(app)
        .get(url)
        .set("Authorization", `Bearer ${token}`);
      expect(response.status, url).toBe(400);
      expect(response.body.error.code, url).toBe("VALIDATION_ERROR");
    }
  });

  it("returns a clear not-found response for telemetry of a missing flight", async () => {
    const missingFlightId = new mongoose.Types.ObjectId().toString();
    const response = await request(app)
      .get(`/api/v1/flights/${missingFlightId}/telemetry`)
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Flight not found",
    });
  });

  it("creates one breach alert and one automatic RTH command", async () => {
    const polygon = [
      { latitude: 10.76, longitude: 106.66 },
      { latitude: 10.76, longitude: 106.6604 },
      { latitude: 10.7604, longitude: 106.6604 },
      { latitude: 10.7604, longitude: 106.6603 },
      { latitude: 10.7601, longitude: 106.6603 },
      { latitude: 10.7601, longitude: 106.6601 },
      { latitude: 10.7604, longitude: 106.6601 },
      { latitude: 10.7604, longitude: 106.66 },
    ];
    const home = { latitude: 10.76035, longitude: 106.66005 };
    const fence = await Geofence.create({
      name: "Concave test zone",
      type: "POLYGON",
      polygon,
      homePosition: home,
      isActive: true,
    });
    const mission = await Mission.create({
      name: "Breach recovery",
      droneId,
      geofenceId: fence._id,
      homePosition: home,
      waypoints: [
        {
          order: 0,
          latitude: 10.7603,
          longitude: 106.66008,
          altitude: 20,
          speed: 20,
        },
        {
          order: 1,
          latitude: 10.76035,
          longitude: 106.66035,
          altitude: 20,
          speed: 20,
        },
      ],
    });
    const createCommand = vi
      .spyOn(Command, "create")
      .mockRejectedValueOnce(new Error("simulated automatic command failure"));
    const flight = await startMission(io!, String(mission._id));
    await new Promise((resolve) => setTimeout(resolve, 6200));
    createCommand.mockRestore();
    expect(
      await Alert.countDocuments({
        flightId: flight._id,
        type: "GEOFENCE_BREACH",
      }),
    ).toBe(1);
    expect(
      await Command.countDocuments({
        flightId: flight._id,
        type: "RETURN_HOME",
        source: "SYSTEM",
      }),
    ).toBe(1);
    expect(await Mission.findById(mission._id)).toMatchObject({
      status: "FAILED",
    });
    await stopSimulation(io!, String(flight._id));
  }, 12_000);

  it("keeps the safety action pending when alert persistence temporarily fails", async () => {
    const polygon = [
      { latitude: 10.76, longitude: 106.66 },
      { latitude: 10.76, longitude: 106.6604 },
      { latitude: 10.7604, longitude: 106.6604 },
      { latitude: 10.7604, longitude: 106.6603 },
      { latitude: 10.7601, longitude: 106.6603 },
      { latitude: 10.7601, longitude: 106.6601 },
      { latitude: 10.7604, longitude: 106.6601 },
      { latitude: 10.7604, longitude: 106.66 },
    ];
    const home = { latitude: 10.76035, longitude: 106.66005 };
    const fence = await Geofence.create({
      name: "Alert retry zone",
      type: "POLYGON",
      polygon,
      homePosition: home,
      isActive: true,
    });
    const mission = await Mission.create({
      name: "Alert retry",
      droneId,
      geofenceId: fence._id,
      homePosition: home,
      waypoints: [
        {
          order: 0,
          latitude: 10.7603,
          longitude: 106.66008,
          altitude: 20,
          speed: 20,
        },
        {
          order: 1,
          latitude: 10.76035,
          longitude: 106.66035,
          altitude: 20,
          speed: 20,
        },
      ],
    });
    const insertAlerts = vi
      .spyOn(Alert, "findOneAndUpdate")
      .mockRejectedValueOnce(new Error("simulated alert persistence failure"));
    const flight = await startMission(io!, String(mission._id));
    try {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      expect(
        await Alert.countDocuments({
          flightId: flight._id,
          type: "GEOFENCE_BREACH",
        }),
      ).toBe(1);
      expect(
        await Command.countDocuments({
          flightId: flight._id,
          type: "RETURN_HOME",
          source: "SYSTEM",
        }),
      ).toBe(1);
    } finally {
      insertAlerts.mockRestore();
      await stopSimulation(io!, String(flight._id)).catch(() => undefined);
    }
  }, 18_000);

  it("seeds exactly 10 demo drones without duplicating records", async () => {
    const first = await seedDemoFleet();
    const second = await seedDemoFleet();
    expect(first.drones).toHaveLength(10);
    expect(second.created).toBe(0);
    expect(
      await Drone.countDocuments({ isDemo: true, isArchived: false }),
    ).toBe(10);
  });

  it("prepares an idle demo fleet and reports every aircraft ready", async () => {
    const drone = await Drone.findOne({ isDemo: true });
    await Drone.findByIdAndUpdate(drone!._id, {
      battery: 8,
      status: "OFFLINE",
      activeFlightId: new mongoose.Types.ObjectId(),
    });
    const before = await request(app)
      .get("/api/v1/drones/readiness?demo=true")
      .set("Authorization", `Bearer ${token}`);
    expect(before.status).toBe(200);
    expect(before.body.data.summary.blocked).toBe(1);
    const prepared = await request(app)
      .post("/api/v1/drones/prepare-demo")
      .set("Authorization", `Bearer ${token}`);
    expect(prepared.status).toBe(200);
    expect(prepared.body.data.drones).toHaveLength(10);
    expect((await Drone.findById(drone!._id))?.activeFlightId).toBeNull();
    const after = await request(app)
      .get("/api/v1/drones/readiness?demo=true")
      .set("Authorization", `Bearer ${token}`);
    expect(after.body.data.summary).toMatchObject({
      total: 10,
      ready: 10,
      blocked: 0,
    });
  });

  it("runs 10 routes concurrently and guarantees two anomaly scenarios", async () => {
    const drones = await Drone.find({ isDemo: true }).sort({ droneCode: 1 });
    const flights = await startFleetSimulation(
      io!,
      drones.map((drone, index) => ({
        droneId: String(drone._id),
        routePattern: ROUTE_PATTERNS[index % ROUTE_PATTERNS.length],
      })),
    );
    expect(flights).toHaveLength(10);
    expect(
      flights.filter((flight) => flight.scenario === "LOW_BATTERY"),
    ).toHaveLength(1);
    expect(
      flights.filter((flight) => flight.scenario === "GPS_WEAK"),
    ).toHaveLength(1);
    expect(
      flights.filter((flight) => flight.scenario === "NORMAL"),
    ).toHaveLength(8);
    await new Promise((resolve) => setTimeout(resolve, 6500));
    expect(
      await Telemetry.countDocuments({
        flightId: { $in: flights.map((flight) => flight._id) },
      }),
    ).toBeGreaterThanOrEqual(50);
    const alerts = await Alert.find({
      flightId: { $in: flights.map((flight) => flight._id) },
    });
    expect(alerts.map((alert) => alert.type).sort()).toEqual([
      "BATTERY_LOW",
      "GPS_WEAK",
    ]);
    const completed = await stopFleetSimulation(
      io!,
      flights.map((flight) => String(flight._id)),
    );
    expect(completed.every((flight) => flight.status === "COMPLETED")).toBe(
      true,
    );
    await expect(
      stopFleetSimulation(
        io!,
        flights.map((flight) => String(flight._id)),
      ),
    ).resolves.toEqual([]);
  }, 20_000);

  it("issues emergency return-home commands to a fleet with partial failure reporting", async () => {
    const drones = await Drone.find({ isDemo: true }).sort({ droneCode: 1 });
    const flights = await startFleetSimulation(
      io!,
      drones.map((drone, index) => ({
        droneId: String(drone._id),
        routePattern: ROUTE_PATTERNS[index % ROUTE_PATTERNS.length],
      })),
    );
    const missingFlightId = new mongoose.Types.ObjectId().toString();
    try {
      const response = await request(app)
        .post("/api/v1/commands/fleet")
        .set("Authorization", `Bearer ${token}`)
        .send({
          flightIds: [
            String(flights[0]._id),
            String(flights[1]._id),
            missingFlightId,
          ],
          type: "RETURN_HOME",
        });
      expect(response.status).toBe(207);
      expect(response.body.data).toMatchObject({
        requested: 3,
        completed: 2,
        failed: 1,
      });
      expect(response.body.data.failures[0]).toMatchObject({
        flightId: missingFlightId,
        message: "Active flight not found",
      });
      expect(await Flight.findById(flights[0]._id)).toMatchObject({
        flightPhase: "RETURN_HOME",
      });
      const controllableFlight = flights[2];
      const pauseResponse = await request(app)
        .post("/api/v1/commands/fleet")
        .set("Authorization", `Bearer ${token}`)
        .send({
          flightIds: [String(controllableFlight._id)],
          type: "PAUSE",
        });
      expect(pauseResponse.status).toBe(200);
      expect(pauseResponse.body.data).toMatchObject({
        requested: 1,
        completed: 1,
        failed: 0,
      });
      expect(await Flight.findById(controllableFlight._id)).toMatchObject({
        flightPhase: "PAUSED",
      });
      const resumeResponse = await request(app)
        .post("/api/v1/commands/fleet")
        .set("Authorization", `Bearer ${token}`)
        .send({
          flightIds: [String(controllableFlight._id)],
          type: "RESUME",
        });
      expect(resumeResponse.status).toBe(200);
      expect(resumeResponse.body.data).toMatchObject({
        requested: 1,
        completed: 1,
        failed: 0,
      });
      const invalidType = await request(app)
        .post("/api/v1/commands/fleet")
        .set("Authorization", `Bearer ${token}`)
        .send({ flightIds: [String(flights[2]._id)], type: "INVALID" });
      expect(invalidType.status).toBe(400);
      expect(invalidType.body.error.code).toBe("VALIDATION_ERROR");
    } finally {
      await stopFleetSimulation(
        io!,
        flights.map((flight) => String(flight._id)),
      );
    }
  }, 20_000);

  it("resolves stale alerts when recovering interrupted flights", async () => {
    const drone = await Drone.findOne({ isDemo: true });
    const orphan = await Drone.findOne({
      isDemo: true,
      _id: { $ne: drone!._id },
    });
    const orphanFlightId = new mongoose.Types.ObjectId();
    await Drone.findByIdAndUpdate(orphan!._id, {
      activeFlightId: orphanFlightId,
      status: "IN_FLIGHT",
    });
    const flight = await Flight.create({
      flightCode: "FL-INTERRUPTED",
      droneId: drone!._id,
      status: "ACTIVE",
      scenario: "GPS_WEAK",
      routePattern: "GRID",
      startedAt: new Date(),
    });
    const alert = await Alert.create({
      flightId: flight._id,
      droneId: drone!._id,
      type: "GPS_WEAK",
      severity: "WARNING",
      message: "GPS signal is weak",
    });
    const stuckMission = await Mission.create({
      name: "Interrupted schedule",
      droneId: drone!._id,
      homePosition: { latitude: 10.7607, longitude: 106.652 },
      waypoints: [
        {
          order: 0,
          latitude: 10.7609,
          longitude: 106.6522,
          altitude: 30,
          speed: 6,
        },
        {
          order: 1,
          latitude: 10.7611,
          longitude: 106.6524,
          altitude: 35,
          speed: 6,
        },
      ],
      status: "READY",
      scheduleStatus: "PROCESSING",
      scheduledFor: new Date(Date.now() - 1_000),
    });
    await recoverInterruptedFlights();
    expect(await Flight.findById(flight._id)).toMatchObject({
      status: "FAILED",
    });
    expect(await Alert.findById(alert._id)).toMatchObject({
      status: "RESOLVED",
    });
    expect(await Mission.findById(stuckMission._id)).toMatchObject({
      scheduleStatus: "SCHEDULED",
      scheduleError: "Rescheduled after server recovery",
    });
    const recoveredOrphan = await Drone.findById(orphan!._id);
    expect(recoveredOrphan?.status).toBe("OFFLINE");
    expect(recoveredOrphan?.activeFlightId).toBeFalsy();
  });
});
