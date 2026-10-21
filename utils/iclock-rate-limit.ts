import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getRequestIp } from "@/utils/login-rate-limit";

let ipLimiter: Ratelimit | null = null;

function getLimiter(): Ratelimit | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  ) {
    return null;
  }
  if (!ipLimiter) {
    ipLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(120, "1 m"),
      prefix: "rl:iclock:ip",
      analytics: false,
    });
  }
  return ipLimiter;
}

export async function assertIclockRequestAllowed(
  request: Request,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const limiter = getLimiter();
  if (!limiter) {
    return { ok: true };
  }

  const ip = getRequestIp(request.headers);
  try {
    const { success } = await limiter.limit(ip);
    if (!success) {
      return {
        ok: false,
        response: new Response("Too Many Requests", {
          status: 429,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
