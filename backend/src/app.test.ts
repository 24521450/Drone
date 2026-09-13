import http from "node:http";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { Server } from "socket.io";
import { createApp, rateLimit } from "./app.js";

describe("public service endpoints", () => {
  it("returns health status without authentication", async () => {
    const io = new Server(http.createServer());
    const response = await request(createApp(io)).get("/health");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      status: "degraded",
      database: "disconnected",
    });
    await io.close();
  });

  it("does not report readiness without a database connection", async () => {
    const io = new Server(http.createServer());
    const response = await request(createApp(io)).get("/ready");
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("NOT_READY");
    expect(response.headers["cache-control"]).toBe("no-store");
    await io.close();
  });

  it("returns a client error for malformed JSON", async () => {
    const io = new Server(http.createServer());
    const response = await request(createApp(io))
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":');
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: "INVALID_JSON" });
    await io.close();
  });

  it("publishes an OpenAPI document", async () => {
    const io = new Server(http.createServer());
    const response = await request(createApp(io)).get("/api-docs.json");
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe("3.0.3");
    expect(response.body.paths["/health"]).toBeDefined();
    expect(response.body.paths["/ready"]).toBeDefined();
    expect(response.body.paths["/drones"]).toBeDefined();
    expect(response.body.paths["/drones/export"]).toBeDefined();
    expect(response.body.paths["/users/export"]).toBeDefined();
    expect(response.body.paths["/geofences/export"]).toBeDefined();
    expect(response.body.paths["/commands/export"]).toBeDefined();
    expect(response.body.paths["/commands/{id}/retry"]).toBeDefined();
    expect(response.body.paths["/flights/export"]).toBeDefined();
    expect(response.body.paths["/flights/active/telemetry"]).toBeDefined();
    expect(response.body.paths["/environment"]).toBeDefined();
    expect(response.body.paths["/environment/export"]).toBeDefined();
    expect(response.body.paths["/field-intelligence"]).toBeDefined();
    expect(response.body.paths["/media"]).toBeDefined();
    expect(response.body.paths["/media/export"]).toBeDefined();
    expect(response.body.paths["/system/status"]).toBeDefined();
    expect(
      response.body.paths["/system/status"].get.responses["200"].content[
        "application/json"
      ].schema.properties.data.properties.services.items.properties.latencyMs,
    ).toMatchObject({ type: "number", nullable: true });
    expect(response.body.paths["/insights"]).toBeDefined();
    expect(response.body.paths["/insights/export"]).toBeDefined();
    expect(response.body.paths["/flights/{id}/telemetry/export"]).toBeDefined();
    expect(response.body.paths["/mission-schedule/export"]).toBeDefined();
    expect(response.body.paths["/alerts/export"]).toBeDefined();
    expect(response.body.paths["/maintenance/export"]).toBeDefined();
    expect(response.body.paths["/audit-events/export"]).toBeDefined();
    expect(
      response.body.components.schemas.Telemetry.properties.heading,
    ).toMatchObject({ minimum: 0, maximum: 360 });
    expect(
      response.body.components.schemas.Telemetry.properties.waypointIndex,
    ).toMatchObject({ minimum: 0 });
    expect(
      response.body.components.schemas.Telemetry.properties.waypointCount,
    ).toMatchObject({ minimum: 1 });
    await io.close();
  });
});

describe("rate limiting", () => {
  it("does not consume the login budget for successful responses", async () => {
    const app = express();
    app.use(rateLimit(60_000, 1, { skipSuccessful: true }));
    app.get("/ok", (_req, res) => res.sendStatus(200));

    expect((await request(app).get("/ok")).status).toBe(200);
    expect((await request(app).get("/ok")).status).toBe(200);
  });

  it("keeps failed responses counted", async () => {
    const app = express();
    app.use(rateLimit(60_000, 1, { skipSuccessful: true }));
    app.get("/fail", (_req, res) => res.sendStatus(401));

    expect((await request(app).get("/fail")).status).toBe(401);
    expect((await request(app).get("/fail")).status).toBe(429);
  });
});
