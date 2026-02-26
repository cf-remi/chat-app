import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { verifyToken } from "./jwt.js";
import type { Env } from "../types.js";

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const token = getCookie(c, "token");

  if (!token) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  const payload = await verifyToken(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  c.set("userId", payload.sub);
  c.set("username", payload.username);

  return next();
}
