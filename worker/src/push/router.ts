import { Hono } from "hono";
import { authMiddleware } from "../auth/middleware.js";
import type { Env } from "../types.js";

const push = new Hono<{ Bindings: Env }>();

push.use("*", authMiddleware);

const MAX_SUBSCRIPTIONS_PER_USER = 5;

// Allowlist of known push service hostnames to prevent SSRF
const ALLOWED_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "updates-autopush.stage.mozaws.net",
  "notify.windows.com",
  "web.push.apple.com",
  "push.apple.com",
]);

function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    // Exact match or subdomain match against the allowlist
    for (const allowed of ALLOWED_PUSH_HOSTS) {
      if (host === allowed || host.endsWith(`.${allowed}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

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

  // Validate key formats (base64url, expected byte lengths: p256dh=65 bytes uncompressed, auth=16 bytes)
  if (!/^[A-Za-z0-9_-]+$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]+$/.test(keys.auth)) {
    return c.json({ error: "Invalid key format" }, 400);
  }

  // SSRF protection: only allow known push service endpoints
  if (!isAllowedPushEndpoint(endpoint)) {
    return c.json({ error: "Invalid endpoint" }, 400);
  }

  // Cap subscriptions per user to prevent DoS fan-out
  const { results: existing } = await c.env.DB.prepare(
    "SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at ASC"
  )
    .bind(userId)
    .all<{ id: string }>();

  if (existing.length >= MAX_SUBSCRIPTIONS_PER_USER) {
    // Delete the oldest subscription to make room
    const oldest = existing[0];
    await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?")
      .bind(oldest.id)
      .run();
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
