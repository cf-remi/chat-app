import { Hono } from "hono";
import { authMiddleware } from "../auth/middleware.js";
import type { Env } from "../types.js";

const push = new Hono<{ Bindings: Env }>();

push.use("*", authMiddleware);

// Save a push subscription
push.post("/push/subscribe", async (c) => {
  const userId = c.get("userId");
  const { endpoint, keys } = await c.req.json<{
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }>();

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return c.json({ error: "Invalid subscription" }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = ?, p256dh = ?, auth = ?`
  )
    .bind(userId, endpoint, keys.p256dh, keys.auth, userId, keys.p256dh, keys.auth)
    .run();

  return c.json({ ok: true });
});

// Remove a push subscription
push.post("/push/unsubscribe", async (c) => {
  const userId = c.get("userId");
  const { endpoint } = await c.req.json<{ endpoint: string }>();

  if (!endpoint) {
    return c.json({ error: "endpoint is required" }, 400);
  }

  await c.env.DB.prepare(
    "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?"
  )
    .bind(endpoint, userId)
    .run();

  return c.json({ ok: true });
});

// Get VAPID public key
push.get("/push/vapid-key", (c) => {
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

export default push;
