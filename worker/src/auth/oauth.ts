/**
 * OAuth 2.0 routes for Google and Apple Sign-In.
 *
 * Google flow  : GET /auth/google → GET  /auth/google/callback
 * Apple flow   : GET /auth/apple  → POST /auth/apple/callback  (Apple POSTs back)
 * Link account : POST /auth/oauth/link  (user supplies password to link existing account)
 *
 * State parameter is a short-lived KV entry so we don't rely on cookies across redirects.
 *
 * Secrets required (set via `wrangler secret put` in the worker/ directory):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   APPLE_CLIENT_ID       (your Services ID, e.g. "com.example.chat.web")
 *   APPLE_TEAM_ID
 *   APPLE_KEY_ID
 *   APPLE_PRIVATE_KEY     (PEM content of your .p8 key, newlines as \n)
 */

import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { SignJWT, jwtVerify, importPKCS8, createRemoteJWKSet } from "jose";
import { signToken } from "./jwt.js";
import { verifyPassword } from "./passwords.js";
import { rateLimit } from "../middleware/rateLimit.js";
import type { Env, User } from "../types.js";

const oauth = new Hono<{ Bindings: Env }>();

const APP_ORIGIN = "https://goodshab.com";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

// TTL for OAuth state tokens (10 minutes)
const STATE_TTL = 600;
// TTL for link-pending tokens (15 minutes)
const LINK_TTL = 900;

function cookieOpts(c: any, token: string) {
  const isSecure = new URL(c.req.url).protocol === "https:";
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: token ? 60 * 60 * 24 * 7 : 0,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function generateState(kv: KVNamespace, data: Record<string, string>): Promise<string> {
  const state = crypto.randomUUID();
  await kv.put(`oauth_state:${state}`, JSON.stringify(data), { expirationTtl: STATE_TTL });
  return state;
}

async function consumeState(kv: KVNamespace, state: string): Promise<Record<string, string> | null> {
  const raw = await kv.get(`oauth_state:${state}`);
  if (!raw) return null;
  await kv.delete(`oauth_state:${state}`);
  return JSON.parse(raw);
}

/** Find or create a user from an OAuth profile. Returns { user, linkToken } */
async function findOrCreateOAuthUser(
  db: D1Database,
  kv: KVNamespace,
  provider: "google" | "apple",
  providerUserId: string,
  email: string,
  suggestedUsername: string
): Promise<{ user: User | null; linkToken: string | null }> {
  // 1. Already linked?
  const linked = await db
    .prepare("SELECT u.* FROM oauth_accounts oa JOIN users u ON u.id = oa.user_id WHERE oa.provider = ? AND oa.provider_user_id = ?")
    .bind(provider, providerUserId)
    .first<User>();

  if (linked) return { user: linked, linkToken: null };

  // 2. Email matches an existing account → prompt to link
  const existing = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<User>();

  if (existing) {
    const token = crypto.randomUUID();
    await kv.put(
      `oauth_link:${token}`,
      JSON.stringify({ provider, providerUserId, userId: existing.id }),
      { expirationTtl: LINK_TTL }
    );
    return { user: existing, linkToken: token };
  }

  // 3. New user — create account (no password)
  // Slice to 25 so retries with "_NNNNNN" suffix (7 chars) stay within the 32-char limit
  let username = suggestedUsername.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 25);
  if (username.length < 2) username = "user";

  // Try to insert; on username collision retry up to 3 times with a random suffix
  let newUser: User | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = attempt === 0 ? username : `${username}_${Math.floor(Math.random() * 999999)}`;
    try {
      newUser = await db
        .prepare("INSERT INTO users (username, email, pw_hash, pw_salt) VALUES (?, ?, '', '') RETURNING id, username, email, avatar_url, created_at")
        .bind(candidate, email.toLowerCase())
        .first<User>();
      if (newUser) break;
    } catch (e: any) {
      // UNIQUE constraint on username — retry with a different suffix
      const msg = String(e?.message || "");
      if (!msg.includes("UNIQUE") && !msg.includes("unique")) throw e;
    }
  }

  if (!newUser) throw new Error("Failed to create user after retries");

  // Link OAuth account
  await db
    .prepare("INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)")
    .bind(newUser.id, provider, providerUserId)
    .run();

  return { user: newUser, linkToken: null };
}

// ── Google ────────────────────────────────────────────────────────────────────

oauth.get("/google", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) {
    return c.json({ error: "Google SSO is not configured" }, 503);
  }
  const state = await generateState(c.env.RATE_LIMIT, { provider: "google" });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_ORIGIN}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return Response.redirect(`${GOOGLE_AUTH_URL}?${params}`, 302);
});

oauth.get("/google/callback", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Google SSO is not configured")}`);
  }

  const { code, state, error } = c.req.query() as Record<string, string>;

  if (error) return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent(error)}`);
  if (!code || !state) return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Missing OAuth parameters")}`);

  const stateData = await consumeState(c.env.RATE_LIMIT, state);
  if (!stateData || stateData.provider !== "google") {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Invalid or expired state")}`);
  }

  // Exchange code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${APP_ORIGIN}/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Failed to exchange Google code")}`);
  }

  const tokenData = await tokenRes.json<{ id_token?: string }>();
  if (!tokenData.id_token) {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("No ID token from Google")}`);
  }

  // Verify ID token using Google's JWKS
  let payload: any;
  try {
    const JWKS = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
    const { payload: p } = await jwtVerify(tokenData.id_token, JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: c.env.GOOGLE_CLIENT_ID,
    });
    payload = p;
  } catch {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Failed to verify Google ID token")}`);
  }

  const providerUserId = payload.sub as string;
  const email = payload.email as string;
  const name = (payload.name as string) || (payload.given_name as string) || "";
  const suggestedUsername = name.replace(/\s+/g, "_").slice(0, 25) || "user";

  let user: User | null;
  let linkToken: string | null;
  try {
    ({ user, linkToken } = await findOrCreateOAuthUser(
      c.env.DB, c.env.RATE_LIMIT, "google", providerUserId, email, suggestedUsername
    ));
  } catch (err) {
    console.error("Google findOrCreateOAuthUser error:", err);
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Failed to sign in with Google")}`);
  }

  if (linkToken) {
    return c.redirect(`${APP_ORIGIN}/?link_token=${encodeURIComponent(linkToken)}`);
  }
  if (!user) {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Failed to sign in with Google")}`);
  }

  const token = await signToken({ sub: user.id, username: user.username }, c.env.JWT_SECRET);
  setCookie(c, "token", token, cookieOpts(c, token));
  // Use c.redirect() so Hono carries the Set-Cookie header in the redirect response
  return c.redirect(APP_ORIGIN);
});

// ── Apple ─────────────────────────────────────────────────────────────────────

/** Build a client_secret JWT for Apple (valid up to 6 months, we use 5 min) */
async function buildAppleClientSecret(env: Env): Promise<string> {
  const privateKey = await importPKCS8(
    env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    "ES256"
  );
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_KEY_ID })
    .setIssuer(env.APPLE_TEAM_ID)
    .setSubject(env.APPLE_CLIENT_ID)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

oauth.get("/apple", async (c) => {
  if (!c.env.APPLE_CLIENT_ID) {
    return c.json({ error: "Apple SSO is not configured" }, 503);
  }
  const state = await generateState(c.env.RATE_LIMIT, { provider: "apple" });
  const params = new URLSearchParams({
    client_id: c.env.APPLE_CLIENT_ID,
    redirect_uri: `${APP_ORIGIN}/auth/apple/callback`,
    response_type: "code",
    scope: "name email",
    response_mode: "form_post",
    state,
  });
  return Response.redirect(`${APPLE_AUTH_URL}?${params}`, 302);
});

// Apple POSTs the callback (response_mode: form_post)
// NOTE: /auth/apple/callback is exempt from the CSRF middleware in index.ts
//       because Apple sends Origin: https://appleid.apple.com
oauth.post("/apple/callback", async (c) => {
  if (!c.env.APPLE_CLIENT_ID || !c.env.APPLE_TEAM_ID || !c.env.APPLE_KEY_ID || !c.env.APPLE_PRIVATE_KEY) {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Apple SSO is not configured")}`);
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Invalid Apple callback")}`);
  }

  const code = formData.get("code") as string | null;
  const state = formData.get("state") as string | null;
  const errorParam = formData.get("error") as string | null;

  if (errorParam) return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent(errorParam)}`);
  if (!code || !state) return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Missing OAuth parameters")}`);

  const stateData = await consumeState(c.env.RATE_LIMIT, state);
  if (!stateData || stateData.provider !== "apple") {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Invalid or expired state")}`);
  }

  // Apple only sends user info on the FIRST authorization
  const userField = formData.get("user") as string | null;
  let appleUser: { name?: { firstName?: string; lastName?: string }; email?: string } = {};
  if (userField) {
    try { appleUser = JSON.parse(userField); } catch {}
  }

  // Exchange code for tokens
  let clientSecret: string;
  try {
    clientSecret = await buildAppleClientSecret(c.env);
  } catch {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Failed to build Apple client secret")}`);
  }

  const tokenRes = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.APPLE_CLIENT_ID,
      client_secret: clientSecret,
      redirect_uri: `${APP_ORIGIN}/auth/apple/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Failed to exchange Apple code")}`);
  }

  const tokenData = await tokenRes.json<{ id_token?: string }>();
  if (!tokenData.id_token) {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("No ID token from Apple")}`);
  }

  // Verify Apple ID token
  let applePayload: any;
  try {
    const JWKS = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
    const { payload: p } = await jwtVerify(tokenData.id_token, JWKS, {
      issuer: "https://appleid.apple.com",
      audience: c.env.APPLE_CLIENT_ID,
    });
    applePayload = p;
  } catch {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Failed to verify Apple ID token")}`);
  }

  const providerUserId = applePayload.sub as string;
  const email = (applePayload.email as string) || (appleUser.email as string) || "";
  if (!email) {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Apple did not provide an email address")}`);
  }

  const firstName = appleUser.name?.firstName || "";
  const lastName = appleUser.name?.lastName || "";
  const suggestedUsername = `${firstName}${lastName}`.replace(/\s+/g, "_").slice(0, 25) || "user";

  let user: User | null;
  let linkToken: string | null;
  try {
    ({ user, linkToken } = await findOrCreateOAuthUser(
      c.env.DB, c.env.RATE_LIMIT, "apple", providerUserId, email, suggestedUsername
    ));
  } catch (err) {
    console.error("Apple findOrCreateOAuthUser error:", err);
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Failed to sign in with Apple")}`);
  }

  if (linkToken) {
    return c.redirect(`${APP_ORIGIN}/?link_token=${encodeURIComponent(linkToken)}`);
  }
  if (!user) {
    return c.redirect(`${APP_ORIGIN}/?oauth_error=${encodeURIComponent("Failed to sign in with Apple")}`);
  }

  const token = await signToken({ sub: user.id, username: user.username }, c.env.JWT_SECRET);
  setCookie(c, "token", token, cookieOpts(c, token));
  return c.redirect(APP_ORIGIN);
});

// ── Account Linking ───────────────────────────────────────────────────────────

/**
 * POST /auth/oauth/link
 * Body: { linkToken: string, password: string }
 *
 * Verifies the user's password, then links the pending OAuth account.
 * On success, issues a session cookie and returns the user object.
 */
oauth.post(
  "/oauth/link",
  rateLimit({ prefix: "oauth-link", limit: 5, windowSeconds: 60 }),
  async (c) => {
  let linkToken: string;
  let password: string;
  try {
    const body = await c.req.json<{ linkToken: string; password: string }>();
    linkToken = body.linkToken;
    password = body.password;
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!linkToken || !password) {
    return c.json({ error: "linkToken and password are required" }, 400);
  }

  if (password.length > 128) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Retrieve pending link data
  const raw = await c.env.RATE_LIMIT.get(`oauth_link:${linkToken}`);
  if (!raw) return c.json({ error: "Link token expired or invalid" }, 400);

  const { provider, providerUserId, userId } = JSON.parse(raw) as {
    provider: "google" | "apple";
    providerUserId: string;
    userId: string;
  };

  // Fetch the user and verify password
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<User>();

  if (!user) return c.json({ error: "User not found" }, 404);

  // OAuth-only accounts have empty pw_hash — cannot link via password
  if (!user.pw_hash) {
    return c.json({ error: "This account has no password set. Please use a social login." }, 400);
  }

  const valid = await verifyPassword(password, user.pw_hash, user.pw_salt);
  if (!valid) return c.json({ error: "Invalid credentials" }, 401);

  // Link the OAuth account
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)"
  )
    .bind(userId, provider, providerUserId)
    .run();

  // Consume the link token
  await c.env.RATE_LIMIT.delete(`oauth_link:${linkToken}`);

  // Issue session
  const token = await signToken({ sub: user.id, username: user.username }, c.env.JWT_SECRET);

  const isSecure = new URL(c.req.url).protocol === "https:";
  setCookie(c, "token", token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.json({
    user: { id: user.id, username: user.username, email: user.email },
  });
});

export default oauth;
