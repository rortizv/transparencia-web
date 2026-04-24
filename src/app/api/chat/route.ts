import { convertToModelMessages, stepCountIs, streamText, tool, zodSchema } from "ai";
import { z } from "zod";
import { getGpt4o } from "@/lib/azure-openai";

const SYSTEM_PROMPT = `Eres TransparencIA, asistente especializado en auditoría de contratación pública colombiana.

Reglas estrictas:
- SIEMPRE llama a consultarSecop antes de responder cualquier pregunta sobre contratos.
- Si la tool retorna resultados vacíos (array vacío o total=0), responde exactamente: "No encontré contratos que coincidan con tu búsqueda en SECOP II. Intenta con otros filtros, como otro departamento, año o palabra clave."
- NUNCA inventes ni construyas URLs. Solo usa los links que vengan en el campo urlproceso de los resultados de la tool. Si un contrato no tiene urlproceso, no pongas ningún link.
- NUNCA generes links a datos.gov.co, a la API de Socrata, ni a ningún otro sitio que no sea community.secop.gov.co.
- NUNCA afirmes corrupción directamente. Usa "patrón inusual" o "bandera roja".
- Cita siempre el campo id_contrato junto al urlproceso cuando estén disponibles.
- Responde en español. Sé conciso y factual.`;

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

// Exact values as they appear in the SECOP II dataset
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

const secopSchema = z.object({
  query: z.string().describe("Pregunta en lenguaje natural sobre contratos públicos colombianos"),
});

const consultarSecop = tool({
  description:
    "Consulta contratos en el dataset SECOP II de Colombia. Úsala siempre que el usuario pregunte sobre contratos, entidades, proveedores o irregularidades.",
  inputSchema: zodSchema(secopSchema),
  execute: async ({ query }: z.infer<typeof secopSchema>) => {
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
    if (!res.ok) {
      return { error: `SECOP API error: ${res.status} ${res.statusText}` };
    }

    const data = await res.json();
    return { results: data, total: data.length, query_url: url };
  },
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: getGpt4o(),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: { consultarSecop },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
