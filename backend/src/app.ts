import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import type { Server } from "socket.io";
import { config } from "./config.js";
import { openapi } from "./openapi.js";
import { createApiRouter } from "./routes.js";

export function rateLimit(
  windowMs: number,
  max: number,
  options: { skipSuccessful?: boolean } = {},
) {
  const clients = new Map<string, { count: number; resetAt: number }>();
  const { skipSuccessful = false } = options;
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = clients.get(key);
    const current =
      !entry || entry.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { ...entry, count: entry.count + 1 };
    clients.set(key, current);
    if (skipSuccessful) {
      const resetAt = current.resetAt;
      res.on("finish", () => {
        // Successful logins should not consume the failed-attempt budget. A
        // 4xx/5xx response remains counted so brute-force attempts are still
        // throttled within the window.
        if (res.statusCode >= 400) return;
        const latest = clients.get(key);
        if (!latest || latest.resetAt !== resetAt) return;
        if (latest.count <= 1) clients.delete(key);
        else clients.set(key, { ...latest, count: latest.count - 1 });
      });
    }
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", Math.max(0, max - current.count));
    if (clients.size > 500)
      for (const [client, value] of clients)
        if (value.resetAt <= now) clients.delete(client);
    if (current.count > max) {
      res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
      return res
        .status(429)
        .json({
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Please try again shortly",
          },
        });
    }
    next();
  };
}

export function createApp(io: Server) {
  const app = express();
  const mutationLimiter = rateLimit(60_000, 240);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: config.clientOrigin.split(",").map((value) => value.trim()),
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));
  app.get("/health", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const startedAt = Date.now();
    let database = "disconnected";
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      try {
        await mongoose.connection.db.admin().ping();
        database = "connected";
      } catch {
        database = "disconnected";
      }
    }
    res.json({
      success: true,
      data: {
        status: database === "connected" ? "online" : "degraded",
        database,
        databaseLatencyMs:
          database === "connected" ? Date.now() - startedAt : null,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    });
  });
  app.get("/ready", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (mongoose.connection.readyState !== 1 || !mongoose.connection.db)
        throw new Error("Database disconnected");
      await mongoose.connection.db.admin().ping();
      return res.json({ success: true, data: { status: "ready" } });
    } catch {
      return res
        .status(503)
        .json({
          success: false,
          error: {
            code: "NOT_READY",
            message: "Service is waiting for its database connection",
          },
        });
    }
  });
  app.get("/api-docs.json", (_req, res) => res.json(openapi));
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapi));
  app.use(
    "/api/v1/auth/login",
    rateLimit(15 * 60_000, 20, { skipSuccessful: true }),
  );
  app.use("/api/v1", (req, res, next) =>
    ["POST", "PATCH", "DELETE"].includes(req.method)
      ? mutationLimiter(req, res, next)
      : next(),
  );
  app.use("/api/v1", createApiRouter(io));
  app.use((_req, res) =>
    res
      .status(404)
      .json({
        success: false,
        error: { code: "NOT_FOUND", message: "Route not found" },
      }),
  );
  const errors: ErrorRequestHandler = (error: any, _req, res, _next) => {
    if (error?.type === "entity.parse.failed")
      return res
        .status(400)
        .json({
          success: false,
          error: {
            code: "INVALID_JSON",
            message: "Request body contains invalid JSON",
          },
        });
    if (error?.type === "entity.too.large")
      return res
        .status(413)
        .json({
          success: false,
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "Request body is too large",
          },
        });
    if (error instanceof ZodError)
      return res
        .status(400)
        .json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            fields: error.flatten().fieldErrors,
          },
        });
    if (error?.name === "ValidationError")
      return res
        .status(400)
        .json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
          },
        });
    if (error?.name === "CastError")
      return res
        .status(400)
        .json({
          success: false,
          error: { code: "INVALID_ID", message: "Resource ID is invalid" },
        });
    if (error?.code === 11000)
      return res
        .status(409)
        .json({
          success: false,
          error: {
            code: "DUPLICATE",
            message: "A unique value is already in use",
          },
        });
    const known =
      typeof error?.message === "string" &&
      /not found|unavailable|already has|already being prepared|already executing|already paused|not paused|cannot|requires exactly|duplicate drones|assigned drones|provide between|outside|inactive|archived/i.test(
        error.message,
      );
    console.error(error);
    return res
      .status(known ? 409 : 500)
      .json({
        success: false,
        error: {
          code: known ? "CONFLICT" : "SERVER_ERROR",
          message: known ? error.message : "Unexpected server error",
        },
      });
  };
  app.use(errors);
  return app;
}
