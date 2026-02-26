import { Hono } from "hono";
import { authMiddleware } from "../auth/middleware.js";
import type { Env } from "../types.js";

const channels = new Hono<{ Bindings: Env }>();

channels.use("*", authMiddleware);

// List servers the user is a member of
channels.get("/servers", async (c) => {
  const userId = c.get("userId");

  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.owner_id, s.invite_code, s.created_at, sm.role
     FROM servers s
     JOIN server_members sm ON sm.server_id = s.id
     WHERE sm.user_id = ?
     ORDER BY s.created_at`
  )
    .bind(userId)
    .all();

  return c.json({ servers: results });
});

// Browse public servers the user is NOT a member of
channels.get("/servers/browse", async (c) => {
  const userId = c.get("userId");

  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.owner_id, s.created_at,
            (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) AS member_count
     FROM servers s
     WHERE s.is_public = 1
       AND s.id NOT IN (SELECT server_id FROM server_members WHERE user_id = ?)
     ORDER BY member_count DESC, s.created_at DESC
     LIMIT 50`
  )
    .bind(userId)
    .all();

  return c.json({ servers: results });
});

// Join a server by invite code
channels.post("/servers/join-by-invite", async (c) => {
  const userId = c.get("userId");
  const { inviteCode } = await c.req.json<{ inviteCode: string }>();

  if (!inviteCode?.trim()) {
    return c.json({ error: "Invite code is required" }, 400);
  }

  const server = await c.env.DB.prepare(
    "SELECT id, name FROM servers WHERE invite_code = ?"
  )
    .bind(inviteCode.trim().toLowerCase())
    .first<{ id: string; name: string }>();

  if (!server) {
    return c.json({ error: "Invalid invite code" }, 404);
  }

  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO server_members (server_id, user_id, role) VALUES (?, ?, 'member')"
  )
    .bind(server.id, userId)
    .run();

  return c.json({ server });
});

// Create a server
channels.post("/servers", async (c) => {
  const userId = c.get("userId");
  const { name } = await c.req.json<{ name: string }>();

  if (!name?.trim()) {
    return c.json({ error: "Server name is required" }, 400);
  }

  const server = await c.env.DB.prepare(
    "INSERT INTO servers (name, owner_id, invite_code) VALUES (?, ?, substr(lower(hex(randomblob(4))),1,8)) RETURNING id, name, owner_id, invite_code, created_at"
  )
    .bind(name.trim(), userId)
    .first();

  if (!server) {
    return c.json({ error: "Failed to create server" }, 500);
  }

  // Add the creator as owner
  await c.env.DB.prepare(
    "INSERT INTO server_members (server_id, user_id, role) VALUES (?, ?, 'owner')"
  )
    .bind(server.id, userId)
    .run();

  // Create default channels
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO channels (server_id, name, type) VALUES (?, 'general', 'text')"
    ).bind(server.id),
    c.env.DB.prepare(
      "INSERT INTO channels (server_id, name, type) VALUES (?, 'random', 'text')"
    ).bind(server.id),
    c.env.DB.prepare(
      "INSERT INTO channels (server_id, name, type) VALUES (?, 'General Voice', 'voice')"
    ).bind(server.id),
  ]);

  return c.json({ server }, 201);
});

// List channels in a server (must be a member)
channels.get("/servers/:serverId/channels", async (c) => {
  const userId = c.get("userId");
  const serverId = c.req.param("serverId");

  const member = await c.env.DB.prepare(
    "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?"
  )
    .bind(serverId, userId)
    .first();

  if (!member) {
    return c.json({ error: "Not a member of this server" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT id, server_id, name, type, created_at FROM channels WHERE server_id = ? ORDER BY type, created_at"
  )
    .bind(serverId)
    .all();

  return c.json({ channels: results });
});

// Create a channel in a server (must be owner or admin)
channels.post("/servers/:serverId/channels", async (c) => {
  const userId = c.get("userId");
  const serverId = c.req.param("serverId");
  const { name, type } = await c.req.json<{ name: string; type: "text" | "voice" }>();

  if (!name?.trim()) {
    return c.json({ error: "Channel name is required" }, 400);
  }
  if (!["text", "voice"].includes(type)) {
    return c.json({ error: "Type must be 'text' or 'voice'" }, 400);
  }

  const member = await c.env.DB.prepare(
    "SELECT role FROM server_members WHERE server_id = ? AND user_id = ?"
  )
    .bind(serverId, userId)
    .first<{ role: string }>();

  if (!member || member.role === "member") {
    return c.json({ error: "Only owners and admins can create channels" }, 403);
  }

  const channel = await c.env.DB.prepare(
    "INSERT INTO channels (server_id, name, type) VALUES (?, ?, ?) RETURNING id, server_id, name, type, created_at"
  )
    .bind(serverId, name.trim(), type)
    .first();

  return c.json({ channel }, 201);
});

// Join a server by ID
channels.post("/servers/:serverId/join", async (c) => {
  const userId = c.get("userId");
  const serverId = c.req.param("serverId");

  const server = await c.env.DB.prepare("SELECT id, is_public FROM servers WHERE id = ?")
    .bind(serverId)
    .first<{ id: string; is_public: number }>();

  if (!server) {
    return c.json({ error: "Server not found" }, 404);
  }

  if (!server.is_public) {
    return c.json({ error: "This server is private. Use an invite code to join." }, 403);
  }

  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO server_members (server_id, user_id, role) VALUES (?, ?, 'member')"
  )
    .bind(serverId, userId)
    .run();

  return c.json({ ok: true });
});

export default channels;
