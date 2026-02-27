import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { hashPassword, verifyPassword } from "./passwords.js";
import { signToken } from "./jwt.js";
import { authMiddleware } from "./middleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import type { Env, User } from "../types.js";

const auth = new Hono<{ Bindings: Env }>();

function cookieOpts(c: any, token: string) {
  const isSecure = new URL(c.req.url).protocol === "https:";
  // For cross-site frontend/API deployments (e.g. goodshab.com vs API),
  // use SameSite=None + Secure. If same-site, Lax is fine.
  // We'll use None/Secure if https is detected to be safe.
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? "None" : "Lax",
    path: "/",
    maxAge: token ? 60 * 60 * 24 * 7 : 0,
  } as const;
}

auth.post(
  "/register",
  rateLimit({ prefix: "register", limit: 3, windowSeconds: 3600 }),
  async (c) => {
  let username: string, email: string, password: string;
  try {
    ({ username, email, password } = await c.req.json<{
      username: string;
      email: string;
      password: string;
    }>());
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!username || !email || !password) {
    return c.json({ error: "username, email, and password are required" }, 400);
  }

  if (!/^[a-zA-Z0-9_]{2,32}$/.test(username)) {
    return c.json({ error: "Username must be 2-32 alphanumeric characters or underscores" }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }

  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  if (password.length > 128) {
    return c.json({ error: "Password must be at most 128 characters" }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ? OR username = ?"
  )
    .bind(email.toLowerCase(), username)
    .first();

  if (existing) {
    return c.json({ error: "Username or email already taken" }, 409);
  }

  const { hash, salt } = await hashPassword(password);

  const result = await c.env.DB.prepare(
    "INSERT INTO users (username, email, pw_hash, pw_salt) VALUES (?, ?, ?, ?) RETURNING id, username, email, created_at"
  )
    .bind(username, email.toLowerCase(), hash, salt)
    .first();

  if (!result) {
    return c.json({ error: "Failed to create user" }, 500);
  }

  const token = await signToken(
    { sub: result.id as string, username: result.username as string },
    c.env.JWT_SECRET
  );

  setCookie(c, "token", token, cookieOpts(c, token));

  return c.json({
    user: {
      id: result.id,
      username: result.username,
      email: result.email,
    },
  });
});

auth.post(
  "/login",
  rateLimit({ prefix: "login", limit: 5, windowSeconds: 60 }),
  async (c) => {
  let email: string, password: string;
  try {
    ({ email, password } = await c.req.json<{
      email: string;
      password: string;
    }>());
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!email || !password) {
    return c.json({ error: "email and password are required" }, 400);
  }

  if (password.length > 128) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const user = await c.env.DB.prepare(
    "SELECT id, username, email, pw_hash, pw_salt FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase())
    .first<User>();

  if (!user) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const valid = await verifyPassword(password, user.pw_hash, user.pw_salt);

  if (!valid) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const token = await signToken(
    { sub: user.id, username: user.username },
    c.env.JWT_SECRET
  );

  setCookie(c, "token", token, cookieOpts(c, token));

  return c.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
    },
  });
});

auth.post("/logout", (c) => {
  setCookie(c, "token", "", cookieOpts(c, ""));
  return c.json({ ok: true });
});

auth.get("/me", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const user = await c.env.DB.prepare(
    "SELECT id, username, email, avatar_url, created_at FROM users WHERE id = ?"
  )
    .bind(userId)
    .first();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user });
});

export default auth;
