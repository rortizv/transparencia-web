import { NextRequest, NextResponse } from "next/server";

// In-memory store — resets on each cold start (acceptable for demo/competition).
// For production with persistent rate limiting, replace with Upstash Redis.
const rateMap = new Map<string, { count: number; reset: number }>();

const LIMIT = 30;         // requests per window per IP
const WINDOW_MS = 60_000; // 1 minute

export function middleware(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const now = Date.now();
  const entry = rateMap.get(ip);

  if (!entry || now > entry.reset) {
    rateMap.set(ip, { count: 1, reset: now + WINDOW_MS });
    return NextResponse.next();
  }

  if (entry.count >= LIMIT) {
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
  matcher: "/api/chat",
};
