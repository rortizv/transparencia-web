import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.ANALYTICS_API_URL ?? "http://localhost:8000";
const API_KEY = process.env.ANALYTICS_API_KEY;

function analyticsHeaders() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["X-API-Key"] = API_KEY;
  return h;
}

// GET /api/conversations/[id] → returns conversation_logs for context restoration
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const res = await fetch(`${API_BASE}/api/v1/conversations/${id}/logs`, {
      headers: analyticsHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Analytics API unreachable" }, { status: 503 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const res = await fetch(`${API_BASE}/api/v1/conversations/${id}`, {
      method: "PATCH",
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await fetch(`${API_BASE}/api/v1/conversations/${id}`, {
      method: "DELETE",
      headers: analyticsHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Analytics API unreachable" }, { status: 503 });
  }
}
