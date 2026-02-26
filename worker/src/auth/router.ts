import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { hashPassword, verifyPassword } from "./passwords.js";
import { signToken } from "./jwt.js";
import { authMiddleware } from "./middleware.js";
import type { Env, User } from "../types.js";

const auth = new Hono<{ Bindings: Env }>();

function cookieOpts(c: any, token: string) {
  const isSecure = new URL(c.req.url).protocol === "https:";
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: "Lax",
    path: "/",
    maxAge: token ? 60 * 60 * 24 * 7 : 0,
  } as const;
}

auth.post("/register", async (c) => {
  const { username, email, password } = await c.req.json<{
    username: string;
    email: string;
    password: string;
  }>();

  if (!username || !email || !password) {
    return c.json({ error: "username, email, and password are required" }, 400);
  }

  if (password.length < 6) {
    return c.json({ error: "Password must be at least 6 characters" }, 400);
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

auth.post("/login", async (c) => {
  const { email, password } = await c.req.json<{
    email: string;
    password: string;
  }>();

  if (!email || !password) {
    return c.json({ error: "email and password are required" }, 400);
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
