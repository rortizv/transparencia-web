import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.ANALYTICS_API_URL ?? "http://localhost:8000";
const API_KEY = process.env.ANALYTICS_API_KEY;

function analyticsHeaders() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["X-API-Key"] = API_KEY;
  return h;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const res = await fetch(`${API_BASE}/api/v1/conversations/${id}/logs`, {
      method: "POST",
      headers: analyticsHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Analytics API unreachable" }, { status: 503 });
  }
}
