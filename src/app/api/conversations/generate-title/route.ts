import { generateText } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { getGpt4o } from "@/lib/azure-openai";

const API_BASE = process.env.ANALYTICS_API_URL ?? "http://localhost:8000";
const API_KEY = process.env.ANALYTICS_API_KEY;

function analyticsHeaders() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["X-API-Key"] = API_KEY;
  return h;
}

export async function POST(req: NextRequest) {
  try {
    const { conversationId, userMessage } = await req.json();

    const { text } = await generateText({
      model: getGpt4o(),
      prompt: `Genera un título corto (máximo 6 palabras) para esta consulta sobre contratación pública colombiana:\n"${String(userMessage).slice(0, 300)}"\n\nResponde SOLO con el título, sin comillas, sin punto final.`,
      maxOutputTokens: 25,
    });

    const title = text.trim().replace(/^["']|["']$/g, "").slice(0, 80) || "Nueva conversación";

    await fetch(`${API_BASE}/api/v1/conversations/${conversationId}`, {
      method: "PATCH",
      headers: analyticsHeaders(),
      body: JSON.stringify({ title }),
      signal: AbortSignal.timeout(5_000),
    });

    return NextResponse.json({ title });
  } catch {
    return NextResponse.json({ error: "Title generation failed" }, { status: 500 });
  }
}
