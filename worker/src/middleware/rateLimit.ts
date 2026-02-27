import type { Context, Next } from "hono";
import type { Env } from "../types.js";

interface RateLimitOptions {
  /** KV key prefix (e.g. "login", "register") */
  prefix: string;
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

/**
 * KV-based sliding-window rate limiter.
 * Keyed on CF-Connecting-IP (falling back to a placeholder).
 * If the RATE_LIMIT binding is unavailable, the middleware passes through safely.
 */
export function rateLimit(opts: RateLimitOptions) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    // Guard: if the KV binding isn't available, skip rate limiting gracefully
    const kv: KVNamespace | undefined = (c.env as any)?.RATE_LIMIT;
    if (!kv) return next();

    try {
      const ip =
        c.req.header("CF-Connecting-IP") ||
        c.req.header("X-Forwarded-For")?.split(",")[0].trim() ||
        "unknown";

      const key = `rl:${opts.prefix}:${ip}`;
      const now = Math.floor(Date.now() / 1000);
      const windowStart = now - opts.windowSeconds;

      // Stored value: JSON array of unix timestamps (seconds)
      const raw = await kv.get(key);
      const timestamps: number[] = raw ? JSON.parse(raw) : [];

      // Drop entries outside the current window
      const inWindow = timestamps.filter((t) => t > windowStart);

      if (inWindow.length >= opts.limit) {
        const retryAfter = inWindow[0] + opts.windowSeconds - now;
        return c.json(
          { error: "Too many requests. Please try again later." },
          429,
          { "Retry-After": String(Math.max(retryAfter, 1)) }
        );
      }

      // Record this request
      inWindow.push(now);
      await kv.put(key, JSON.stringify(inWindow), {
        expirationTtl: opts.windowSeconds + 10,
      });
    } catch {
      // Never let rate-limit errors block the actual request
    }

    return next();
  };
}
