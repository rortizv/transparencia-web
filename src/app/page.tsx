"use client";

import { useChat } from "@ai-sdk/react";
import { getToolName, isTextUIPart, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2, Calendar, Download, ExternalLink, MapPin, Moon,
  PanelRight, PenSquare, Search, Send, Sun, Tag, User, Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ConversationSidebar, {
  type Conversation,
  MAX_WIDTH as SIDEBAR_MAX_WIDTH,
} from "./components/ConversationSidebar";
import { getUserId } from "@/lib/user-id";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContractResult {
  id_contrato: string;
  nombre_entidad: string | null;
  objeto_del_contrato: string | null;
  valor_del_contrato: number | null;
  departamento: string | null;
  fecha_de_firma: string | null;
  proveedor_adjudicado: string | null;
  urlproceso: string | null;
  estado_contrato: string | null;
  modalidad_de_contratacion: string | null;
  sector: string | null;
  flags: Record<string, unknown>;
}

interface StoredLog {
  id: string;
  user_message: string;
  assistant_response: string | null;
  created_at: string;
}

const FLAG_LABELS: Record<string, string> = {
  contratacion_directa: "Contratación directa",
  proveedor_frecuente: "Proveedor frecuente",
  valor_alto_sector: "Valor atípico",
  sin_proceso_url: "Sin URL de proceso",
  plazo_muy_corto: "Plazo muy corto",
};

interface ToolPayload {
  results?: ContractResult[];
  total?: number;
  source?: "db" | "socrata";
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  buscarEnDB: { label: "Buscando en base de datos...", icon: "🔍" },
  buscarConBanderas: { label: "Analizando banderas rojas...", icon: "🚩" },
  topProveedores: { label: "Calculando ranking de proveedores...", icon: "📊" },
  consultarSecop: { label: "Consultando SECOP II en tiempo real...", icon: "🌐" },
};

const SUGGESTED_QUERIES = [
  "¿Cuál es el contratista con más contratos en la Gobernación de Antioquia?",
  "Contratos con banderas rojas en Chocó en 2025",
  "¿Qué contratos de obra pública hay en Bolívar superiores a 500 millones?",
  "Muéstrame contratos adjudicados de forma directa en Bogotá en 2026",
];

const SIDEBAR_OPEN_KEY = "transparencia_sidebar_open";
const SIDEBAR_WIDTH_KEY = "transparencia_sidebar_width";
const DEFAULT_SIDEBAR_WIDTH = 280;
const DESKTOP_BREAKPOINT = 1024;

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCOP(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  return `$${value.toLocaleString("es-CO")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric" });
}

// ── Small components ──────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-8 h-8" />;
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      aria-label="Toggle theme"
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </motion.button>
  );
}

function LoadingDots() {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl px-4 py-3 bg-muted flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-2 h-2 rounded-full bg-muted-foreground/60 block"
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
          />
        ))}
      </div>
    </div>
  );
}

function ToolStatusBubble({ toolName }: { toolName: string }) {
  const info = TOOL_LABELS[toolName] ?? { label: `Usando ${toolName}...`, icon: "⚙️" };
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-start"
    >
      <div className="flex items-center gap-2 rounded-xl px-3 py-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-medium">
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          className="inline-block"
        >
          {info.icon}
        </motion.span>
        {info.label}
      </div>
    </motion.div>
  );
}

function ContractCard({ contract }: { contract: ContractResult }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2 hover:border-blue-400/60 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug line-clamp-2 flex-1">
          {contract.objeto_del_contrato ?? "Sin descripción"}
        </p>
        <span className="shrink-0 text-sm font-bold text-blue-600 dark:text-blue-400">
          {formatCOP(contract.valor_del_contrato)}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {contract.nombre_entidad && (
          <span className="flex items-center gap-1"><Building2 size={11} />{contract.nombre_entidad}</span>
        )}
        {contract.proveedor_adjudicado && (
          <span className="flex items-center gap-1"><User size={11} />{contract.proveedor_adjudicado}</span>
        )}
        {contract.departamento && (
          <span className="flex items-center gap-1"><MapPin size={11} />{contract.departamento}</span>
        )}
        {contract.fecha_de_firma && (
          <span className="flex items-center gap-1"><Calendar size={11} />{formatDate(contract.fecha_de_firma)}</span>
        )}
        {contract.sector && (
          <span className="flex items-center gap-1"><Tag size={11} />{contract.sector}</span>
        )}
      </div>

      {contract.flags && Object.keys(contract.flags).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.keys(contract.flags).map((flag) => (
            <span
              key={flag}
              title={`Bandera roja: ${FLAG_LABELS[flag] ?? flag}`}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400 font-medium border border-red-200 dark:border-red-800"
            >
              🚩 {FLAG_LABELS[flag] ?? flag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex gap-1.5 flex-wrap">
          {contract.estado_contrato && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              {contract.estado_contrato}
            </span>
          )}
          {contract.modalidad_de_contratacion && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              {contract.modalidad_de_contratacion}
            </span>
          )}
        </div>
        {contract.urlproceso && (
          <a
            href={contract.urlproceso}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-400 transition-colors shrink-0"
          >
            Ver proceso <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  );
}

function downloadCSV(results: ContractResult[]) {
  const headers = ["id_contrato", "objeto_del_contrato", "nombre_entidad", "proveedor_adjudicado", "valor_del_contrato", "departamento", "sector", "modalidad_de_contratacion", "estado_contrato", "fecha_de_firma", "urlproceso", "banderas"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = results.map((c) => [
    c.id_contrato, c.objeto_del_contrato, c.nombre_entidad, c.proveedor_adjudicado,
    c.valor_del_contrato, c.departamento, c.sector, c.modalidad_de_contratacion,
    c.estado_contrato, c.fecha_de_firma, c.urlproceso,
    Object.keys(c.flags ?? {}).join("|"),
  ].map(escape).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "contratos.csv"; a.click();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 5;

function ToolResultCards({ payload, source }: { payload: ToolPayload; source: string }) {
  const [shown, setShown] = useState(PAGE_SIZE);
  if (payload.error) return null;
  const results = payload.results ?? [];
  if (results.length === 0) return null;

  const sourceLabel = source === "buscarEnDB"
    ? { icon: <Zap size={11} />, text: "Base de datos indexada" }
    : { icon: <Search size={11} />, text: "SECOP II en tiempo real" };

  const total = payload.total ?? results.length;
  const visible = results.slice(0, shown);
  const remaining = results.length - shown;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {sourceLabel.icon}
          <span>{sourceLabel.text} · {total} resultado{total !== 1 ? "s" : ""}</span>
        </div>
        <button
          onClick={() => downloadCSV(results)}
          title="Descargar CSV"
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <Download size={11} /> CSV
        </button>
      </div>
      <div className="space-y-2">
        {visible.map((c) => <ContractCard key={c.id_contrato} contract={c} />)}
        {remaining > 0 && (
          <button
            onClick={() => setShown((s) => s + PAGE_SIZE)}
            className="w-full text-xs text-muted-foreground hover:text-foreground border border-border hover:border-blue-400/60 rounded-xl py-2 transition-all"
          >
            Ver {Math.min(remaining, PAGE_SIZE)} más ({remaining} restantes)
          </button>
        )}
      </div>
    </motion.div>
  );
}

const MD_COMPONENTS = {
  a: ({ href, children }: React.ComponentProps<"a">) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="text-blue-500 underline underline-offset-2 hover:text-blue-400 transition-colors">
      {children}
    </a>
  ),
  p: ({ children }: React.ComponentProps<"p">) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }: React.ComponentProps<"ul">) => <ul className="mb-2 pl-4 space-y-1 list-disc">{children}</ul>,
  ol: ({ children }: React.ComponentProps<"ol">) => <ol className="mb-2 pl-4 space-y-1 list-decimal">{children}</ol>,
  li: ({ children }: React.ComponentProps<"li">) => <li className="leading-snug">{children}</li>,
  strong: ({ children }: React.ComponentProps<"strong">) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }: React.ComponentProps<"code">) => (
    <code className="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
  ),
};

function formatTimestamp(d: Date): string {
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("es-CO", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({ message, timestamp }: { message: UIMessage; timestamp?: Date }) {
  const isUser = message.role === "user";
  const text = message.parts.filter(isTextUIPart).map((p) => p.text).join("");
  const toolParts = message.parts.filter(isToolUIPart);
  const pendingTools = toolParts.filter((p) => p.state === "input-streaming" || p.state === "input-available");
  const completedTools = toolParts.filter((p) => p.state === "output-available");

  if (!text && pendingTools.length === 0 && completedTools.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`flex flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}
    >
      {pendingTools.map((p) => (
        <ToolStatusBubble key={p.toolCallId} toolName={getToolName(p)} />
      ))}

      {isUser && text && (
        <div className="flex flex-col items-end gap-1">
          <div className="rounded-2xl px-4 py-3 max-w-[82%] text-sm leading-relaxed bg-blue-600 text-white rounded-br-sm">
            {text}
          </div>
          {timestamp && (
            <span className="text-[10px] text-muted-foreground/50 pr-1">
              {formatTimestamp(timestamp)}
            </span>
          )}
        </div>
      )}

      {!isUser && (
        <div className="flex flex-col items-start gap-1">
          <div className="rounded-2xl bg-muted text-foreground rounded-bl-sm max-w-[88%] overflow-hidden">
            <div className="px-4 pt-3 pb-1">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                TransparencIA
              </span>
            </div>
            {completedTools.map((p) => {
              const payload = (p as { output: ToolPayload }).output;
              if (!payload?.results?.length) return null;
              return (
                <div key={p.toolCallId} className="px-3 pb-2">
                  <ToolResultCards payload={payload} source={getToolName(p)} />
                </div>
              );
            })}
            {text && (
              <div className="px-4 pb-3 pt-1 text-sm leading-relaxed prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                  {text}
                </ReactMarkdown>
              </div>
            )}
          </div>
          {timestamp && (
            <span className="text-[10px] text-muted-foreground/50 pl-1">
              {formatTimestamp(timestamp)}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ── Conversation API helpers ──────────────────────────────────────────────────

async function apiCreateConversation(userId: string): Promise<Conversation | null> {
  try {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function apiFetchConversations(userId: string): Promise<Conversation[]> {
  try {
    const res = await fetch(`/api/conversations?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

async function apiLoadMessages(
  conversationId: string,
): Promise<{ messages: UIMessage[]; timestamps: Map<string, Date> }> {
  try {
    const res = await fetch(`/api/conversations/${conversationId}`);
    if (!res.ok) return { messages: [], timestamps: new Map() };
    const logs: StoredLog[] = await res.json();
    const timestamps = new Map<string, Date>();
    const messages = logs.flatMap((log) => {
      const date = new Date(log.created_at);
      const userMsg: UIMessage = {
        id: `${log.id}-u`,
        role: "user",
        parts: [{ type: "text", text: log.user_message }],
      };
      timestamps.set(userMsg.id, date);
      const msgs: UIMessage[] = [userMsg];
      if (log.assistant_response) {
        const asstMsg: UIMessage = {
          id: `${log.id}-a`,
          role: "assistant",
          parts: [{ type: "text", text: log.assistant_response }],
        };
        timestamps.set(asstMsg.id, date);
        msgs.push(asstMsg);
      }
      return msgs;
    });
    return { messages, timestamps };
  } catch { return { messages: [], timestamps: new Map() }; }
}

async function apiLogPrediction(
  conversationId: string,
  userId: string,
  userMessage: string,
  assistantResponse: string,
  toolInvocations: unknown[],
  durationMs: number,
): Promise<void> {
  try {
    await fetch(`/api/conversations/${conversationId}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        user_message: userMessage,
        assistant_response: assistantResponse,
        tool_invocations: toolInvocations,
        duration_ms: durationMs,
        is_success: true,
      }),
    });
  } catch { /* fire-and-forget */ }
}

async function apiGenerateTitle(conversationId: string, userMessage: string): Promise<string | null> {
  try {
    const res = await fetch("/api/conversations/generate-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, userMessage }),
    });
    if (!res.ok) return null;
    const { title } = await res.json();
    return title ?? null;
  } catch { return null; }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { messages, sendMessage, status, setMessages } = useChat({});
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "submitted" || status === "streaming";

  // User identity
  const [userId, setUserId] = useState<string | null>(null);

  // Conversation state
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const activeConvRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);

  // Sidebar UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isDesktop, setIsDesktop] = useState(false);

  // Timing & logging refs
  const requestStartRef = useRef<number>(0);
  const prevStatusRef = useRef(status);
  const isFirstMessageRef = useRef(false);

  // Message timestamps: id → Date (populated when message first appears)
  const messageTimestampsRef = useRef<Map<string, Date>>(new Map());
  const [timestampTick, setTimestampTick] = useState(0);

  // Keep refs in sync with state
  useEffect(() => { activeConvRef.current = activeConversationId; }, [activeConversationId]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Initialize after hydration (avoid SSR mismatch)
  useEffect(() => {
    const uid = getUserId();
    setUserId(uid);

    const storedOpen = localStorage.getItem(SIDEBAR_OPEN_KEY);
    if (storedOpen !== null) setSidebarOpen(storedOpen === "true");

    const storedWidth = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? "");
    if (!isNaN(storedWidth)) setSidebarWidth(Math.min(storedWidth, SIDEBAR_MAX_WIDTH));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Responsive layout mode:
  // - < 1024px: sidebar as overlay
  // - >= 1024px: persistent desktop sidebar
  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const sync = (matches: boolean) => setIsDesktop(matches);
    sync(media.matches);

    const onChange = (event: MediaQueryListEvent) => sync(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Fetch conversations when userId is ready
  const refreshConversations = useCallback(async () => {
    if (!userIdRef.current) return;
    const convs = await apiFetchConversations(userIdRef.current);
    setConversations(convs);
  }, []);

  useEffect(() => {
    if (userId) refreshConversations();
  }, [userId, refreshConversations]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Record timestamp for each new message the first time it appears
  useEffect(() => {
    let changed = false;
    const now = new Date();
    for (const m of messages) {
      if (!messageTimestampsRef.current.has(m.id)) {
        messageTimestampsRef.current.set(m.id, now);
        changed = true;
      }
    }
    if (changed) setTimestampTick((n) => n + 1);
  }, [messages]);

  // Log prediction when stream finishes
  useEffect(() => {
    if (prevStatusRef.current === "streaming" && status === "ready") {
      const convId = activeConvRef.current;
      const uid = userIdRef.current;
      if (convId && uid) {
        const userMsg = [...messages].reverse().find((m) => m.role === "user");
        const assistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
        const userText = userMsg?.parts.filter(isTextUIPart).map((p) => p.text).join("") ?? "";
        const assistantText = assistantMsg?.parts.filter(isTextUIPart).map((p) => p.text).join("") ?? "";
        const toolInvocations = assistantMsg?.parts
          .filter(isToolUIPart)
          .filter((p) => p.state === "output-available")
          .map((p) => ({ toolName: getToolName(p), output: (p as { output: unknown }).output })) ?? [];
        const duration = Date.now() - requestStartRef.current;

        void apiLogPrediction(convId, uid, userText, assistantText, toolInvocations, duration);

        if (isFirstMessageRef.current) {
          isFirstMessageRef.current = false;
          void apiGenerateTitle(convId, userText).then((title) => {
            if (title) {
              setConversations((prev) =>
                prev.map((c) => (c.id === convId ? { ...c, title } : c)),
              );
            }
          });
        } else {
          // Update last_message_at in local state
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId ? { ...c, last_message_at: new Date().toISOString() } : c,
            ),
          );
        }
      }
    }
    prevStatusRef.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    let convId = activeConvRef.current;

    // Create conversation on first message
    if (!convId && userId) {
      const conv = await apiCreateConversation(userId);
      if (conv) {
        convId = conv.id;
        setActiveConversationId(conv.id);
        setConversations((prev) => [conv, ...prev]);
        isFirstMessageRef.current = true;
      }
    }

    requestStartRef.current = Date.now();
    sendMessage({ text: input });
    setInput("");
  }

  function handleSuggestion(q: string) {
    if (isLoading) return;
    setInput(q);
  }

  async function newConversation() {
    setMessages([]);
    setActiveConversationId(null);
    isFirstMessageRef.current = false;
  }

  async function handleSelectConversation(id: string) {
    if (id === activeConvRef.current) return;
    const { messages: msgs, timestamps } = await apiLoadMessages(id);
    timestamps.forEach((date, msgId) => messageTimestampsRef.current.set(msgId, date));
    setMessages(msgs);
    setActiveConversationId(id);
    setTimestampTick((n) => n + 1);
  }

  async function handleDeleteConversation(id: string) {
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    } catch { /* ignore */ }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvRef.current === id) {
      setMessages([]);
      setActiveConversationId(null);
    }
  }

  async function handleToggleFavorite(id: string, current: boolean) {
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_favorite: !current }),
      });
    } catch { /* ignore */ }
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, is_favorite: !current } : c))
        .sort((a, b) => {
          if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
          return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
        }),
    );
  }

  function toggleSidebar() {
    setSidebarOpen((v) => {
      localStorage.setItem(SIDEBAR_OPEN_KEY, String(!v));
      return !v;
    });
  }

  function handleSidebarWidthChange(w: number) {
    setSidebarWidth(w);
  }

  return (
    <main className="relative flex h-screen bg-background text-foreground overflow-hidden">
      {/* ── Chat area ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-4 sm:px-6 border-b border-border/60 backdrop-blur-sm bg-background/80 z-10 shrink-0">
          <div className="flex items-center gap-2.5">
            <motion.div
              initial={{ rotate: -10, scale: 0.9 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300 }}
              className="text-blue-500"
            >
              <Search size={22} strokeWidth={2.5} />
            </motion.div>
            <h1 className="text-lg font-semibold tracking-tight">TransparencIA</h1>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={newConversation}
                title="Nueva conversación"
                className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <PenSquare size={18} />
              </motion.button>
            )}
            <ThemeToggle />
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleSidebar}
              title={sidebarOpen ? "Ocultar historial" : "Mostrar historial"}
              className={`p-2 rounded-full transition-colors ${sidebarOpen
                  ? "text-blue-500 bg-blue-50 dark:bg-blue-950/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
            >
              <PanelRight size={18} />
            </motion.button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-5">
            <AnimatePresence initial={false}>
              {messages.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-12 space-y-6"
                >
                  <p className="text-sm text-muted-foreground text-center">
                    Auditor conversacional de contratación pública colombiana.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SUGGESTED_QUERIES.map((q) => (
                      <button
                        key={q}
                        onClick={() => handleSuggestion(q)}
                        className="cursor-pointer text-left text-xs px-3 py-2.5 rounded-xl border border-border bg-muted/40 hover:bg-muted hover:border-blue-400/60 text-muted-foreground hover:text-foreground transition-all"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}

              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  timestamp={messageTimestampsRef.current.get(m.id)}
                />
              ))}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <LoadingDots key="loading" />
              )}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-border/60 bg-background/80 backdrop-blur-sm px-4 py-4 shrink-0">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex items-center gap-3">
            <motion.input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregunta sobre contratos públicos…"
              disabled={isLoading}
              className="flex-1 rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/60 disabled:opacity-50 transition-shadow"
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSubmit(e as unknown as React.FormEvent)}
            />
            <motion.button
              type="submit"
              disabled={isLoading || !input.trim()}
              whileTap={{ scale: 0.93 }}
              whileHover={{ scale: 1.05 }}
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors hover:bg-blue-500"
            >
              <Send size={16} strokeWidth={2} />
            </motion.button>
          </form>
        </div>
      </div>

      {/* ── Right sidebar ── */}
      <AnimatePresence>
        {sidebarOpen && isDesktop && (
          <motion.div
            key="desktop-sidebar"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: sidebarWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden shrink-0"
            style={{ minWidth: sidebarOpen ? sidebarWidth : 0 }}
          >
            <ConversationSidebar
              conversations={conversations}
              activeId={activeConversationId}
              onSelect={handleSelectConversation}
              onNew={newConversation}
              onDelete={handleDeleteConversation}
              onToggleFavorite={handleToggleFavorite}
              width={sidebarWidth}
              onWidthChange={handleSidebarWidthChange}
              isDesktop
            />
          </motion.div>
        )}

        {sidebarOpen && !isDesktop && (
          <>
            <motion.button
              key="sidebar-backdrop"
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-20 bg-black/10 backdrop-blur-[1px]"
              aria-label="Cerrar historial"
              onClick={toggleSidebar}
            />

            <motion.div
              key="overlay-sidebar"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="absolute right-0 top-0 z-30 h-full w-[88%] max-w-full sm:w-88 border-l border-border/60 bg-background shadow-2xl"
            >
              <ConversationSidebar
                conversations={conversations}
                activeId={activeConversationId}
                onSelect={handleSelectConversation}
                onNew={newConversation}
                onDelete={handleDeleteConversation}
                onToggleFavorite={handleToggleFavorite}
                width={Math.min(sidebarWidth, 352)}
                onWidthChange={handleSidebarWidthChange}
                isDesktop={false}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </main>
  );
}
