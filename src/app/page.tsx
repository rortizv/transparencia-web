"use client";

import { useChat } from "@ai-sdk/react";
import { getToolName, isTextUIPart, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, Calendar, ExternalLink, MapPin, Moon, PenSquare, Search, Send, Sun, User, Zap } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  flags: Record<string, unknown>;
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
  consultarSecop: { label: "Consultando SECOP II en tiempo real...", icon: "🌐" },
};

const SUGGESTED_QUERIES = [
  "¿Cuáles son los contratos más grandes del Chocó en 2024?",
  "Contratos de consultoría en Bogotá superiores a 500 millones",
  "¿Qué contratos tiene la Gobernación de Antioquia en 2025?",
  "Muéstrame contratos de obra pública en Nariño",
];

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
          <span className="flex items-center gap-1">
            <Building2 size={11} />
            {contract.nombre_entidad}
          </span>
        )}
        {contract.proveedor_adjudicado && (
          <span className="flex items-center gap-1">
            <User size={11} />
            {contract.proveedor_adjudicado}
          </span>
        )}
        {contract.departamento && (
          <span className="flex items-center gap-1">
            <MapPin size={11} />
            {contract.departamento}
          </span>
        )}
        {contract.fecha_de_firma && (
          <span className="flex items-center gap-1">
            <Calendar size={11} />
            {formatDate(contract.fecha_de_firma)}
          </span>
        )}
      </div>

      {/* Red flags */}
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

function ToolResultCards({ payload, source }: { payload: ToolPayload; source: string }) {
  if (payload.error) return null;
  const results = payload.results ?? [];
  if (results.length === 0) return null;

  const sourceLabel = source === "buscarEnDB"
    ? { icon: <Zap size={11} />, text: "Base de datos indexada" }
    : { icon: <Search size={11} />, text: "SECOP II en tiempo real" };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2"
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {sourceLabel.icon}
        <span>{sourceLabel.text} · {payload.total ?? results.length} resultado{(payload.total ?? results.length) !== 1 ? "s" : ""}</span>
      </div>
      <div className="space-y-2">
        {results.slice(0, 5).map((c) => (
          <ContractCard key={c.id_contrato} contract={c} />
        ))}
        {results.length > 5 && (
          <p className="text-xs text-muted-foreground text-center">
            + {results.length - 5} contratos más en la respuesta
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ── Shared markdown components ────────────────────────────────────────────────

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

// ── Message renderer ──────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts.filter(isTextUIPart).map((p) => p.text).join("");
  const toolParts = message.parts.filter(isToolUIPart);

  const pendingTools = toolParts.filter(
    (p) => p.state === "input-streaming" || p.state === "input-available"
  );
  const completedTools = toolParts.filter((p) => p.state === "output-available");

  if (!text && pendingTools.length === 0 && completedTools.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`flex flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}
    >
      {/* Tool status indicator while waiting */}
      {pendingTools.map((p) => (
        <ToolStatusBubble key={p.toolCallId} toolName={getToolName(p)} />
      ))}

      {/* User bubble */}
      {isUser && text && (
        <div className="rounded-2xl px-4 py-3 max-w-[82%] text-sm leading-relaxed bg-blue-600 text-white rounded-br-sm">
          {text}
        </div>
      )}

      {/* Assistant: single unified bubble with cards + text */}
      {!isUser && (
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
      )}
    </motion.div>
  );
}

// ── localStorage persistence ──────────────────────────────────────────────────

const CURRENT_KEY = "transparencia_current_v1";
const HISTORY_KEY = "transparencia_history_v1";
const MAX_HISTORY = 5;

interface ConversationRecord {
  id: string;
  timestamp: string;
  preview: string;
  messages: UIMessage[];
}

function loadCurrent(): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    return raw ? (JSON.parse(raw) as UIMessage[]) : [];
  } catch { return []; }
}

function loadHistory(): ConversationRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as ConversationRecord[]) : [];
  } catch { return []; }
}

function archiveConversation(messages: UIMessage[]): void {
  if (messages.length === 0) return;
  const userMsg = messages.find((m) => m.role === "user");
  const preview = userMsg?.parts.find(isTextUIPart)?.text ?? "Conversación";
  const record: ConversationRecord = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    preview: preview.slice(0, 80),
    messages: messages.slice(-60),
  };
  try {
    const history = loadHistory();
    history.unshift(record);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch { /* ignore quota */ }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [savedMessages] = useState<UIMessage[]>(loadCurrent);
  const [history, setHistory] = useState<ConversationRecord[]>(loadHistory);
  const { messages, sendMessage, status, setMessages } = useChat({ messages: savedMessages });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (messages.length === 0) return;
    try {
      localStorage.setItem(CURRENT_KEY, JSON.stringify(messages.slice(-100)));
    } catch { /* quota exceeded */ }
  }, [messages]);

  function newConversation() {
    archiveConversation(messages);
    setMessages([]);
    localStorage.removeItem(CURRENT_KEY);
    setHistory(loadHistory());
  }

  function restoreConversation(record: ConversationRecord) {
    if (messages.length > 0) archiveConversation(messages);
    setMessages(record.messages);
    localStorage.setItem(CURRENT_KEY, JSON.stringify(record.messages));
    const updated = loadHistory().filter((h) => h.id !== record.id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    setHistory(updated);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  }

  function handleSuggestion(q: string) {
    if (isLoading) return;
    sendMessage({ text: q });
  }

  return (
    <main className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border/60 backdrop-blur-sm sticky top-0 bg-background/80 z-10">
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
                      className="text-left text-xs px-3 py-2.5 rounded-xl border border-border bg-muted/40 hover:bg-muted hover:border-blue-400/60 text-muted-foreground hover:text-foreground transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>

                {history.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Recientes</p>
                      <button
                        onClick={() => {
                          localStorage.removeItem(HISTORY_KEY);
                          setHistory([]);
                        }}
                        className="text-[10px] text-muted-foreground/60 hover:text-red-400 transition-colors"
                      >
                        Limpiar historial
                      </button>
                    </div>
                    {history.map((rec) => (
                      <button
                        key={rec.id}
                        onClick={() => restoreConversation(rec)}
                        className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/20 hover:bg-muted hover:border-blue-400/60 transition-all group"
                      >
                        <span className="text-xs text-muted-foreground group-hover:text-foreground truncate flex-1">
                          {rec.preview}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">
                          {formatRelativeTime(rec.timestamp)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}

            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <LoadingDots key="loading" />
            )}
          </AnimatePresence>

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border/60 bg-background/80 backdrop-blur-sm px-4 py-4">
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto flex items-center gap-3"
        >
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
    </main>
  );
}
