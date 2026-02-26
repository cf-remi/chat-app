import { Hono } from "hono";
import { cors } from "hono/cors";
import auth from "./auth/router.js";
import channels from "./channels/router.js";
import rtk from "./rtk/router.js";
import { verifyToken } from "./auth/jwt.js";
import { getCookie } from "hono/cookie";
import type { Env } from "./types.js";

export { ChatRoom } from "./durable-objects/ChatRoom.js";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

// Auth routes (public)
app.route("/auth", auth);

// Server & channel routes (authenticated)
app.route("/api", channels);

// RealtimeKit proxy (authenticated)
app.route("/api", rtk);

// WebSocket upgrade for chat — route to ChatRoom Durable Object
app.get("/chat/:channelId", async (c) => {
  const token = getCookie(c, "token") || c.req.query("token");

  if (!token) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  const payload = await verifyToken(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: "Invalid token" }, 401);
  }

  const channelId = c.req.param("channelId");

  // Get the Durable Object for this channel
  const id = c.env.CHAT_ROOM.idFromName(channelId);
  const stub = c.env.CHAT_ROOM.get(id);

  // Forward the WebSocket upgrade request to the DO
  const url = new URL(c.req.url);
  url.pathname = "/websocket";
  url.searchParams.set("userId", payload.sub);
  url.searchParams.set("username", payload.username);

  return stub.fetch(new Request(url.toString(), c.req.raw));
});

export default app;
