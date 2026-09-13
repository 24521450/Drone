import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import type { AuthRequest, AuthUser } from "./types.js";
import { User } from "./models.js";

export function signToken(user: AuthUser) {
  return jwt.sign(user, config.jwtSecret, { expiresIn: "1h" });
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } });
  try {
    const claims = jwt.verify(token, config.jwtSecret) as AuthUser;
    const account = await User.findById(claims.id).select("role isActive");
    if (!account || !account.isActive) return res.status(401).json({ success: false, error: { code: "USER_INACTIVE", message: "User account is unavailable" } });
    req.user = { ...claims, role: account.role as AuthUser["role"] };
    next();
  } catch {
    return res.status(401).json({ success: false, error: { code: "INVALID_TOKEN", message: "Token is invalid or expired" } });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
  next();
}
