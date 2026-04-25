import { convertToModelMessages, stepCountIs, streamText, tool, zodSchema } from "ai";
import { z } from "zod";
import { getGpt4o } from "@/lib/azure-openai";

const SYSTEM_PROMPT = `Eres TransparencIA, asistente especializado en auditoría de contratación pública colombiana.

Reglas estrictas:
- Para preguntas sobre contratos, usa primero buscarEnDB con los filtros apropiados:
  * Si mencionan una entidad específica (alcaldía, gobernación, ministerio, etc.), pasa su nombre en el campo "entidad".
  * Si mencionan un municipio o ciudad, pasa el departamento correspondiente en "departamento" Y el nombre del municipio/entidad en "entidad".
  * Si mencionan un año, pásalo en "year".
  * Si mencionan un proveedor/contratista, pásalo en "proveedor".
- Para preguntas sobre irregularidades, banderas rojas, contratos sospechosos o anomalías, usa buscarConBanderas con el flag apropiado:
  * "contratacion_directa" — contratos adjudicados sin licitación
  * "proveedor_frecuente" — mismo proveedor con más de 5 contratos en la misma entidad
  * "valor_alto_sector" — valor más de 3× la mediana del sector/departamento
  * "sin_proceso_url" — contratos sin URL del proceso publicada
  * "plazo_muy_corto" — contratos con plazo menor a 7 días
- Solo usa consultarSecop como fallback si buscarEnDB retorna results:[] SIN error. Si buscarEnDB retorna un error, responde: "El servicio de búsqueda no está disponible en este momento."
- Si ambas tools retornan resultados vacíos (results:[]), responde: "No encontré contratos que coincidan con tu búsqueda. Intenta con otros filtros."
- Cuando la tool retorne contratos, la UI ya los muestra como tarjetas visuales. NO los repitas ni los listes en tu respuesta de texto. Solo escribe un párrafo breve con el hallazgo principal o patrón relevante (ej: "Encontré 50 contratos, el más grande es el Túnel del Toyo por $465B adjudicado a Consorcio Vías Colombia 061.").
- NUNCA inventes ni construyas URLs. Solo usa urlproceso si viene en los resultados. NUNCA links a datos.gov.co ni Socrata.
- NUNCA afirmes corrupción directamente. Usa "patrón inusual" o "bandera roja".
- Responde en español. Sé conciso.`;

// ── Socrata fallback ──────────────────────────────────────────────────────────

const SECOP_DATASET = "jbjy-vk9h";
const SOCRATA_BASE = "https://www.datos.gov.co/resource";
const SELECT_FIELDS = [
  "nombre_entidad",
  "nit_entidad",
  "proveedor_adjudicado",
  "documento_proveedor",
  "objeto_del_contrato",
  "valor_del_contrato",
  "modalidad_de_contratacion",
  "departamento",
  "fecha_de_firma",
  "urlproceso",
  "id_contrato",
].join(",");

const COLOMBIAN_DEPARTMENTS: Record<string, string> = {
  AMAZONAS: "Amazonas",
  ANTIOQUIA: "Antioquia",
  ARAUCA: "Arauca",
  ATLANTICO: "Atlántico",
  BOLIVAR: "Bolívar",
  BOYACA: "Boyacá",
  CALDAS: "Caldas",
  CAQUETA: "Caquetá",
  CASANARE: "Casanare",
  CAUCA: "Cauca",
  CESAR: "Cesar",
  CHOCO: "Chocó",
  CORDOBA: "Córdoba",
  CUNDINAMARCA: "Cundinamarca",
  HUILA: "Huila",
  "LA GUAJIRA": "La Guajira",
  MAGDALENA: "Magdalena",
  META: "Meta",
  NARINO: "Nariño",
  "NORTE DE SANTANDER": "Norte de Santander",
  PUTUMAYO: "Putumayo",
  QUINDIO: "Quindío",
  RISARALDA: "Risaralda",
  "SAN ANDRES": "San Andrés, Providencia y Santa Catalina",
  SANTANDER: "Santander",
  SUCRE: "Sucre",
  TOLIMA: "Tolima",
  "VALLE DEL CAUCA": "Valle del Cauca",
  VICHADA: "Vichada",
  BOGOTA: "Distrito Capital de Bogotá",
};

function buildWhereClause(query: string): string | null {
  const upper = query.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const conditions: string[] = [];

  for (const [key, exactValue] of Object.entries(COLOMBIAN_DEPARTMENTS)) {
    if (upper.includes(key)) {
      conditions.push(`departamento='${exactValue}'`);
      break;
    }
  }

  const yearMatch = query.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const y = yearMatch[1];
    conditions.push(
      `fecha_de_firma >= '${y}-01-01T00:00:00.000' AND fecha_de_firma <= '${y}-12-31T23:59:59.000'`
    );
  }

  return conditions.length > 0 ? conditions.join(" AND ") : null;
}

// ── Tools ─────────────────────────────────────────────────────────────────────

const buscarEnDBSchema = z.object({
  q: z.string().describe("Búsqueda en lenguaje natural — se usará para búsqueda semántica"),
  departamento: z.string().optional().describe("Nombre del departamento colombiano (ej: Chocó, Antioquia)"),
  year: z.number().int().optional().describe("Año de firma del contrato (ej: 2024)"),
  entidad: z.string().optional().describe("Nombre parcial de la entidad contratante"),
  proveedor: z.string().optional().describe("Nombre parcial del proveedor adjudicado"),
  min_valor: z.number().optional().describe("Valor mínimo del contrato en COP"),
  page_size: z.number().int().optional().describe("Número de resultados (default 20, max 50)"),
});

const consultarSecopSchema = z.object({
  query: z.string().describe("Pregunta en lenguaje natural sobre contratos públicos colombianos"),
});

const buscarEnDB = tool({
  description:
    "Busca contratos en nuestra base de datos indexada con búsqueda semántica (pgvector). " +
    "Úsala primero para cualquier pregunta sobre contratos — es más precisa y rápida que Socrata.",
  inputSchema: zodSchema(buscarEnDBSchema),
  execute: async ({ q, departamento, year, entidad, proveedor, min_valor, page_size }: z.infer<typeof buscarEnDBSchema>) => {
    const apiBase = process.env.ANALYTICS_API_URL ?? "http://localhost:8000";
    const params = new URLSearchParams({ q });
    if (departamento) params.set("departamento", departamento);
    if (year) params.set("year", String(year));
    if (entidad) params.set("entidad", entidad);
    if (proveedor) params.set("proveedor", proveedor);
    if (min_valor) params.set("min_valor", String(min_valor));
    params.set("page_size", String(Math.min(page_size ?? 20, 50)));

    const url = `${apiBase}/api/v1/contracts?${params.toString()}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: process.env.ANALYTICS_API_KEY ? { "X-API-Key": process.env.ANALYTICS_API_KEY } : {},
      });
      if (!res.ok) return { service_error: true, message: `Analytics API error: ${res.status}`, results: [] };
      const data = await res.json();
      return { results: data.data, total: data.total, source: "db" };
    } catch {
      return { service_error: true, message: "Analytics API unreachable", results: [] };
    }
  },
});

const buscarConBanderasSchema = z.object({
  flag: z.enum(["contratacion_directa", "proveedor_frecuente", "valor_alto_sector", "sin_proceso_url", "plazo_muy_corto"])
    .describe("Tipo de bandera roja a buscar"),
  departamento: z.string().optional().describe("Filtrar por departamento"),
  year: z.number().int().optional().describe("Filtrar por año de firma"),
  entidad: z.string().optional().describe("Filtrar por entidad"),
  page_size: z.number().int().optional().describe("Número de resultados (default 20, max 50)"),
});

const buscarConBanderas = tool({
  description:
    "Busca contratos con banderas rojas o patrones irregulares en la base de datos. " +
    "Úsala cuando pregunten por irregularidades, corrupción, contratos sospechosos o anomalías.",
  inputSchema: zodSchema(buscarConBanderasSchema),
  execute: async ({ flag, departamento, year, entidad, page_size }: z.infer<typeof buscarConBanderasSchema>) => {
    const apiBase = process.env.ANALYTICS_API_URL ?? "http://localhost:8000";
    const params = new URLSearchParams({ flag });
    if (departamento) params.set("departamento", departamento);
    if (year) params.set("year", String(year));
    if (entidad) params.set("entidad", entidad);
    params.set("page_size", String(Math.min(page_size ?? 20, 50)));

    const url = `${apiBase}/api/v1/contracts?${params.toString()}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: process.env.ANALYTICS_API_KEY ? { "X-API-Key": process.env.ANALYTICS_API_KEY } : {},
      });
      if (!res.ok) return { service_error: true, message: `Analytics API error: ${res.status}`, results: [] };
      const data = await res.json();
      return { results: data.data, total: data.total, source: "db", flag };
    } catch {
      return { service_error: true, message: "Analytics API unreachable", results: [] };
    }
  },
});

const consultarSecop = tool({
  description:
    "Fallback: consulta contratos en tiempo real desde SECOP II (Socrata). " +
    "Úsala solo si buscarEnDB no retorna resultados.",
  inputSchema: zodSchema(consultarSecopSchema),
  execute: async ({ query }: z.infer<typeof consultarSecopSchema>) => {
    const params = new URLSearchParams({
      $select: SELECT_FIELDS,
      $order: "valor_del_contrato DESC",
      $limit: "50",
    });

    const where = buildWhereClause(query);
    if (where) params.set("$where", where);

    const url = `${SOCRATA_BASE}/${SECOP_DATASET}.json?${params.toString()}`;
    const appToken = process.env.SOCRATA_APP_TOKEN;
    const headers: HeadersInit = { Accept: "application/json" };
    if (appToken) headers["X-App-Token"] = appToken;

    const res = await fetch(url, { headers });
    if (!res.ok) return { error: `SECOP API error: ${res.status} ${res.statusText}` };

    const data = await res.json();
    // urlproceso comes as {url: "https://..."} from Socrata — normalize to string
    const results = data.map((r: Record<string, unknown>) => ({
      ...r,
      urlproceso: typeof r.urlproceso === "object" && r.urlproceso !== null
        ? (r.urlproceso as { url?: string }).url ?? null
        : r.urlproceso ?? null,
    }));
    return { results, total: results.length, source: "socrata" };
  },
});

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: getGpt4o(),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: { buscarEnDB, buscarConBanderas, consultarSecop },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
