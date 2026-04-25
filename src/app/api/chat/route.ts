import { convertToModelMessages, stepCountIs, streamText, tool, zodSchema } from "ai";
import { z } from "zod";
import { getGpt4o } from "@/lib/azure-openai";
import { CHAT_SYSTEM_PROMPT } from "@/lib/prompts/chat-system-prompt";

const OUT_OF_SCOPE_REPLIES = [
  "Mi especialidad es la contratación pública colombiana. ¿Quieres que busque contratos, analice proveedores o detecte patrones inusuales en alguna entidad o región?",
  "Ese tema se sale de mi radar. Estoy enfocado en contratación pública colombiana: contratos SECOP, entidades y proveedores. ¿Qué te gustaría auditar?",
  "Suena interesante tu consulta, pero aquí venimos a hablar de contratos públicos en Colombia. Si quieres, revisamos una entidad, un proveedor o una posible bandera roja.",
  "Buena pregunta, pero ese tema no es de mi 'expertise'. Mi fuerte es la contratación pública colombiana. ¿Consultamos contratos por entidad, región o año?",
  "Te sigo la corriente, pero por transparencia debo mantenerme en contratación pública colombiana. ¿Quieres que revisemos contratos, rankings de proveedores o patrones inusuales?",
] as const;

const PROCUREMENT_HINTS = [
  "contrato",
  "contratacion",
  "contratista",
  "licitacion",
  "secop",
  "proveedor",
  "compras publicas",
  "transparencia",
  "corrupcion",
  "bandera roja",
  "irregularidad",
  "adjudic",
  "pliego",
  "interventoria",
  "vigencia",
  "rubr",
  "cdp",
  "rp",
];

const LOCATION_HINTS = [
  // Cobertura completa de departamentos (32 + Bogotá D.C.)
  "amazonas",
  "antioquia",
  "arauca",
  "atlantico",
  "bolivar",
  "boyaca",
  "caldas",
  "caqueta",
  "casanare",
  "cauca",
  "cesar",
  "choco",
  "cordoba",
  "cundinamarca",
  "guainia",
  "guaviare",
  "huila",
  "la guajira",
  "magdalena",
  "meta",
  "narino",
  "norte de santander",
  "putumayo",
  "quindio",
  "risaralda",
  "san andres",
  "santander",
  "sucre",
  "tolima",
  "valle del cauca",
  "vaupes",
  "vichada",
  "bogota",
  // Ciudades frecuentes (intencionalmente no exhaustivo)
  "medellin",
  "cali",
  "barranquilla",
  "cartagena",
  "bucaramanga",
  "cucuta",
  "pereira",
  "manizales",
  "armenia",
  "villavicencio",
  "pasto",
  "ibague",
  "santa marta",
  "monteria",
  "neiva",
  "popayan",
  "sincelejo",
  "valledupar",
  "yopal",
  "tunja",
  "riohacha",
  "quibdo",
  "leticia",
  "inirida",
  "mitu",
  "puerto carreno",
  "colombia",
];

const CONTEXT_HINTS = [
  "entidad",
  "alcaldia",
  "gobernacion",
  "ministerio",
  "secretaria",
  "departamento administrativo",
  "instituto",
  "agencia",
  "superintendencia",
  "hospital",
  "empresa social del estado",
  "empresa industrial y comercial del estado",
  "unidad administrativa especial",
  "establecimiento publico",
  "concejo",
  "personeria",
  "contraloria",
  "fiscalia",
  "rama judicial",
  "fuerzas militares",
  "policia nacional",
  "universidad publica",
  "empresa publica",
  "empresa de servicios publicos",
  "ente territorial",
  "distrito",
  "municipio",
  "departamento",
  "gobierno nacional",
  "orden nacional",
  "orden territorial",
  "proceso",
  "adjudic",
  "proveedor",
  "contratista",
  "licitacion",
  "secop",
  "pliego",
  "cdp",
  "rp",
];

const CONTEXT_ACRONYM_HINTS = ["ese", "eice", "uae", "fse", "eseh", "esehosp", "eps", "ips"] as const;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";

      const candidate = part as { text?: unknown; type?: unknown };
      if (typeof candidate.text === "string") return candidate.text;
      if (candidate.type === "text" && typeof candidate.text === "string") return candidate.text;
      return "";
    })
    .join(" ")
    .trim();
}

function latestUserMessageText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const candidate = msg as { role?: unknown; content?: unknown; parts?: unknown };
    if (candidate.role !== "user") continue;

    const contentText = extractTextContent(candidate.content);
    if (contentText) return contentText;

    const partsText = extractTextContent(candidate.parts);
    if (partsText) return partsText;
  }

  return "";
}

function isInScopeQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return true;

  const hasProcurementHint = PROCUREMENT_HINTS.some((hint) => normalized.includes(hint));
  const hasLocationHint = LOCATION_HINTS.some((hint) => normalized.includes(hint));
  const hasContextHint =
    CONTEXT_HINTS.some((hint) => normalized.includes(hint)) ||
    CONTEXT_ACRONYM_HINTS.some((hint) => new RegExp(`\\b${hint}\\b`).test(normalized));

  const hasInstitutionLocationPattern =
    /\b(alcaldia|gobernacion|secretaria|instituto|agencia|superintendencia|hospital|ministerio|empresa social del estado|empresa industrial y comercial del estado|unidad administrativa especial|concejo|personeria|contraloria)\s+(de|del)\s+[a-z0-9\s]{2,}\b/.test(
      normalized
    );

  return hasProcurementHint || (hasLocationHint && hasContextHint) || hasInstitutionLocationPattern;
}

function pickOutOfScopeReply(): string {
  const index = Math.floor(Math.random() * OUT_OF_SCOPE_REPLIES.length);
  return OUT_OF_SCOPE_REPLIES[index];
}

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

const topProveedoresSchema = z.object({
  entidad: z.string().optional().describe("Nombre parcial de la entidad contratante"),
  departamento: z.string().optional().describe("Departamento colombiano"),
  year: z.number().int().optional().describe("Año de firma del contrato"),
  limit: z.number().int().optional().describe("Cuántos proveedores devolver (default 10, max 20)"),
});

const topProveedores = tool({
  description:
    "Ranking de proveedores con más contratos o mayor valor en una entidad o región. " +
    "Úsala cuando pregunten por 'el contratista que más contratos tiene', 'top proveedores', " +
    "'¿quién más contrata con X entidad?', 'empresa que más contrata'.",
  inputSchema: zodSchema(topProveedoresSchema),
  execute: async ({ entidad, departamento, year, limit }: z.infer<typeof topProveedoresSchema>) => {
    const apiBase = process.env.ANALYTICS_API_URL ?? "http://localhost:8000";
    const params = new URLSearchParams();
    if (entidad) params.set("entidad", entidad);
    if (departamento) params.set("departamento", departamento);
    if (year) params.set("year", String(year));
    params.set("limit", String(Math.min(limit ?? 10, 20)));

    const url = `${apiBase}/api/v1/contracts/stats/top-providers?${params}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: process.env.ANALYTICS_API_KEY ? { "X-API-Key": process.env.ANALYTICS_API_KEY } : {},
      });
      if (!res.ok) return { service_error: true, message: `Analytics API error: ${res.status}`, results: [] };
      const data = await res.json();
      return { results: data, source: "db" };
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
  const userText = latestUserMessageText(messages);

  if (!isInScopeQuestion(userText)) {
    const blockedReply = pickOutOfScopeReply();
    const blocked = streamText({
      model: getGpt4o(),
      system:
        "Eres un asistente que debe responder solo con el texto indicado, sin agregar nada más.",
      prompt: `Responde exactamente con este texto: "${blockedReply}"`,
      stopWhen: stepCountIs(1),
    });

    return blocked.toUIMessageStreamResponse();
  }

  const result = streamText({
    model: getGpt4o(),
    system: CHAT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: { buscarEnDB, buscarConBanderas, topProveedores, consultarSecop },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
