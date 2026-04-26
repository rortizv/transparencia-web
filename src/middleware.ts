import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ── In-memory fallback (resets on cold start — used only if Upstash is not configured) ──
const rateMap = new Map<string, { count: number; reset: number }>();
const FALLBACK_LIMIT = 30;
const FALLBACK_WINDOW_MS = 60_000;

// ── Upstash Redis — persistent rate limiting across cold starts ──────────────
const upstashRatelimit =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(30, "1 m"),
        analytics: false,
        prefix: "transparencia:rl",
      })
    : null;

function getIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function middleware(request: NextRequest) {
  const ip = getIp(request);

  if (upstashRatelimit) {
    // Persistent rate limiting via Upstash Redis
    const { success, reset, remaining } = await upstashRatelimit.limit(ip);
    if (!success) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      return new NextResponse(
        JSON.stringify({ error: "Demasiadas solicitudes. Intenta en un minuto." }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }
    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    return response;
  }

  // Fallback: in-memory (resets on cold start)
  const now = Date.now();
  const entry = rateMap.get(ip);

  if (!entry || now > entry.reset) {
    rateMap.set(ip, { count: 1, reset: now + FALLBACK_WINDOW_MS });
    return NextResponse.next();
  }

  if (entry.count >= FALLBACK_LIMIT) {
    return new NextResponse(
      JSON.stringify({ error: "Demasiadas solicitudes. Intenta en un minuto." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil((entry.reset - now) / 1000)),
        },
      }
    );
  }

  entry.count++;
  return NextResponse.next();
}

export const config = {
  // Cover all API routes: chat, conversations, and future endpoints
  matcher: ["/api/chat", "/api/conversations/:path*"],
};
