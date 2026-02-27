import { Hono } from "hono";
import { cors } from "hono/cors";
import auth from "./auth/router.js";
import oauthRouter from "./auth/oauth.js";
import channels from "./channels/router.js";
import rtk from "./rtk/router.js";
import push from "./push/router.js";
import filesRouter from "./files/router.js";
import { verifyToken } from "./auth/jwt.js";
import { getCookie } from "hono/cookie";
import type { Env } from "./types.js";

export { ChatRoom } from "./durable-objects/ChatRoom.js";

const app = new Hono<{ Bindings: Env }>();

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "https://goodshab.com",
  "https://www.goodshab.com",
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return "";
      if (ALLOWED_ORIGINS.includes(origin)) return origin;
      return "";
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);

// CSRF: reject mutating requests whose Origin doesn't match an allowed origin.
// Exempts:
//   - Requests with no Origin (same-origin requests in some browsers, server-to-server)
//   - Apple OAuth callback: Apple POSTs from appleid.apple.com with its own Origin
const CSRF_EXEMPT_PATHS = new Set(["/auth/apple/callback"]);

app.use("*", async (c, next) => {
  if (MUTATING_METHODS.has(c.req.method) && !CSRF_EXEMPT_PATHS.has(new URL(c.req.url).pathname)) {
    const origin = c.req.header("Origin");
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return c.json({ error: "Forbidden" }, 403);
    }
  }
  return next();
});

// Content-Security-Policy and other security headers
// NOTE: Response objects in Workers are immutable; we must create a new Response
// with cloned headers rather than mutating c.res.headers directly.
app.use("*", async (c, next) => {
  await next();
  // Never touch WebSocket upgrade responses (status 101) — they carry a webSocket property
  // that would be lost if we reconstruct the Response object.
  if (c.res.status === 101) return;
  // Only inject on HTML responses (not API JSON, file downloads)
  const ct = c.res.headers.get("Content-Type") || "";
  if (!ct.includes("text/html")) return;

  const extraHeaders: Record<string, string> = {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' blob: https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' blob: data: https://*.dyte.io https://dyte-uploads.s3.ap-south-1.amazonaws.com",
      "media-src 'self' blob: https://rtk-assets.realtime.cloudflare.com https://rtk-uploads.realtime.cloudflare.com",
      "connect-src 'self' wss://goodshab.com https://goodshab.com https://www.goodshab.com https://*.cloudflare.com https://realtime.cloudflare.com https://rtk-assets.realtime.cloudflare.com https://rtk-uploads.realtime.cloudflare.com https://api.dyte.io https://*.dyte.io wss://*.dyte.io https://cloudflareinsights.com https://*.r2.cloudflarestorage.com",
      "font-src 'self' https://fonts.gstatic.com",
      "worker-src 'self' blob:",
      "child-src blob:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };

  // Build a new Response, copying existing headers then adding ours
  const newHeaders = new Headers(c.res.headers);
  for (const [k, v] of Object.entries(extraHeaders)) {
    newHeaders.set(k, v);
  }
  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers: newHeaders,
  });
});

// Auth routes (public)
app.route("/auth", auth);

// OAuth routes (Google + Apple SSO)
app.route("/auth", oauthRouter);

// Server & channel routes (authenticated)
app.route("/api", channels);

// RealtimeKit proxy (authenticated)
app.route("/api", rtk);

// Push notification routes (authenticated)
app.route("/api", push);

// File upload/serve routes (authenticated)
app.route("/api", filesRouter);

// WebSocket upgrade for chat — route to ChatRoom Durable Object
app.get("/chat/:channelId", async (c) => {
  const token = getCookie(c, "token");

  if (!token) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  const payload = await verifyToken(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: "Invalid token" }, 401);
  }

  const channelId = c.req.param("channelId");

  // Verify the user is a member of the server that owns this channel
  const member = await c.env.DB.prepare(
    `SELECT 1 FROM channels ch
     JOIN server_members sm ON sm.server_id = ch.server_id AND sm.user_id = ?
     WHERE ch.id = ?`
  )
    .bind(payload.sub, channelId)
    .first();

  if (!member) {
    return c.json({ error: "Not a member of this server" }, 403);
  }

  // Get the Durable Object for this channel
  const id = c.env.CHAT_ROOM.idFromName(channelId);
  const stub = c.env.CHAT_ROOM.get(id);

  // Forward the WebSocket upgrade request to the DO
  const url = new URL(c.req.url);
  url.pathname = "/websocket";
  url.searchParams.set("userId", payload.sub);
  url.searchParams.set("username", payload.username);
  url.searchParams.set("channelId", channelId);

  return stub.fetch(new Request(url.toString(), c.req.raw));
});

// Fallback: serve static assets for all other routes
app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
