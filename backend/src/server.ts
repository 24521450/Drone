import http from "node:http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { User } from "./models.js";
import { recoverInterruptedFlights, stopSimulatorScheduler } from "./simulator.js";
import { startMissionScheduler, stopMissionScheduler } from "./mission-scheduler.js";

const server = http.createServer();
const io = new Server({ cors: { origin: config.clientOrigin.split(",").map((value) => value.trim()) } });
const app = createApp(io);
server.on("request", app);
io.attach(server);
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string") return next(new Error("Authentication required"));
    const user = jwt.verify(token, config.jwtSecret) as { id: string };
    const account = await User.findOne({ _id: user.id, isActive: true }).select("role");
    if (!account) return next(new Error("User account is unavailable"));
    socket.data.userId = user.id;
    socket.data.role = account.role;
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
});
io.on("connection", (socket) => {
  if (socket.data.role === "ADMIN") socket.join("admins");
  socket.on("subscribe:fleet", () => socket.join("fleet"));
  socket.on("subscribe:drone", (droneId: string) => {
    for (const room of socket.rooms) if (room.startsWith("drone:")) socket.leave(room);
    if (typeof droneId === "string" && /^[a-f\d]{24}$/i.test(droneId)) socket.join(`drone:${droneId}`);
  });
  socket.on("unsubscribe:drone", (droneId: string) => socket.leave(`drone:${droneId}`));
  socket.on("unsubscribe:fleet", () => socket.leave("fleet"));
});

async function bootstrap() {
  await mongoose.connect(config.mongoUri);
  const admin = await User.findOne({ email: config.adminEmail.toLowerCase() });
  if (!admin) await User.create({ name: "System Admin", email: config.adminEmail.toLowerCase(), passwordHash: await bcrypt.hash(config.adminPassword, 12), role: "ADMIN" });
  await recoverInterruptedFlights();
  startMissionScheduler(io);
  server.listen(config.port, "0.0.0.0", () => console.log(`API listening on http://localhost:${config.port}`));
}

let shuttingDown = false;
export async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down gracefully`);
  stopMissionScheduler();
  stopSimulatorScheduler();
  await io.close();
  await mongoose.connection.close(false);
}

if (process.env.DRONE_MEMORY !== "1") {
  process.once("SIGTERM", () => { void shutdown("SIGTERM").finally(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown("SIGINT").finally(() => process.exit(0)); });
}

bootstrap().catch((error) => {
  console.error("Failed to start API", error);
  process.exit(1);
});
