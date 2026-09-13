import "dotenv/config";

const production = process.env.NODE_ENV === "production";
const environmentValue = (key: string, fallback: string) => {
  const value = process.env[key]?.trim();
  if (value) return value;
  if (production) throw new Error(`Missing required production environment variable: ${key}`);
  return fallback;
};

const port = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer between 1 and 65535");

export const config = {
  port,
  mongoUri: environmentValue("MONGODB_URI", "mongodb://127.0.0.1:27017/drone_monitor"),
  jwtSecret: environmentValue("JWT_SECRET", "development-only-secret-change-me"),
  clientOrigin: environmentValue("CLIENT_ORIGIN", "http://localhost:5173"),
  adminEmail: environmentValue("ADMIN_EMAIL", "admin@drone.local"),
  adminPassword: environmentValue("ADMIN_PASSWORD", "Admin123!"),
};

if (production) {
  const origins = config.clientOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);
  const invalidOrigins = origins.filter((origin) => {
    try { const parsed = new URL(origin); return !["http:", "https:"].includes(parsed.protocol) || /localhost|127\.0\.0\.1/.test(parsed.hostname); }
    catch { return true; }
  });
  const errors = [
    config.jwtSecret.length < 32 ? "JWT_SECRET must contain at least 32 characters" : "",
    config.adminPassword.length < 12 ? "ADMIN_PASSWORD must contain at least 12 characters" : "",
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.adminEmail) ? "ADMIN_EMAIL must be a valid email address" : "",
    !origins.length || invalidOrigins.length ? "CLIENT_ORIGIN must contain one or more public http(s) origins" : "",
    /localhost|127\.0\.0\.1/.test(config.mongoUri) ? "MONGODB_URI must not point to localhost" : "",
  ].filter(Boolean);
  if (errors.length) throw new Error(`Invalid production configuration: ${errors.join("; ")}`);
}
