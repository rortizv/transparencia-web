import { stepCountIs, streamText, tool, zodSchema } from "ai";
import { z } from "zod";
import { getGpt4o } from "@/lib/azure-openai";

const SYSTEM_PROMPT = `Eres TransparencIA, asistente especializado en auditoría de contratación pública colombiana.

Reglas:
- SIEMPRE usa consultarSecop antes de responder cualquier pregunta sobre contratos.
- NUNCA afirmes corrupción directamente. Usa "patrón inusual" o "bandera roja".
- SIEMPRE cita el número de contrato y el enlace al SECOP original (campo url_proceso).
- Responde en español. Sé conciso y factual.`;

const SECOP_DATASET = "jbjy-vk9h";
const SOCRATA_BASE = "https://www.datos.gov.co/resource";
const SELECT_FIELDS = [
  "nombre_entidad",
  "nit_entidad",
  "nombre_del_proveedor_adjudicado",
  "nit_del_proveedor",
  "objeto_del_contrato",
  "valor_del_contrato",
  "modalidad_de_contratacion",
  "departamento",
  "fecha_de_firma",
  "url_proceso",
].join(",");

const COLOMBIAN_DEPARTMENTS = [
  "AMAZONAS", "ANTIOQUIA", "ARAUCA", "ATLÁNTICO", "BOLÍVAR", "BOYACÁ",
  "CALDAS", "CAQUETÁ", "CASANARE", "CAUCA", "CESAR", "CHOCÓ",
  "CÓRDOBA", "CUNDINAMARCA", "GUAINÍA", "GUAVIARE", "HUILA",
  "LA GUAJIRA", "MAGDALENA", "META", "NARIÑO", "NORTE DE SANTANDER",
  "PUTUMAYO", "QUINDÍO", "RISARALDA", "SAN ANDRÉS", "SANTANDER",
  "SUCRE", "TOLIMA", "VALLE DEL CAUCA", "VAUPÉS", "VICHADA",
];

function buildWhereClause(query: string): string | null {
  const upper = query.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const conditions: string[] = [];

  for (const dept of COLOMBIAN_DEPARTMENTS) {
    const deptNorm = dept.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (upper.includes(deptNorm)) {
      conditions.push(`departamento='${dept}'`);
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
    messages,
    tools: { consultarSecop },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
