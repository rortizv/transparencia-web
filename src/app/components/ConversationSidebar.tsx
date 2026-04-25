"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, MoreVertical, PenSquare, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string, current: boolean) => void;
  width: number;
  onWidthChange: (w: number) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_WIDTH = 220;
const DEFAULT_WIDTH = 280;
export const MAX_WIDTH = Math.round(DEFAULT_WIDTH * 1.3); // 364
const WIDTH_KEY = "transparencia_sidebar_width";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `hace ${days}d`;
  return new Date(iso).toLocaleDateString("es-CO", { month: "short", day: "numeric" });
}

// ── ConversationMenu ──────────────────────────────────────────────────────────

function ConversationMenu({
  isFavorite,
  onFavorite,
  onDelete,
}: {
  isFavorite: boolean;
  onFavorite: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="p-1 rounded hover:bg-muted-foreground/20 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        title="Opciones"
      >
        <MoreVertical size={13} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 top-7 z-50 w-44 bg-popover border border-border rounded-lg shadow-lg py-1 text-sm"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFavorite();
                setOpen(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted transition-colors text-left"
            >
              <Star size={13} className={isFavorite ? "fill-yellow-400 text-yellow-400" : ""} />
              {isFavorite ? "Quitar favorito" : "Marcar favorito"}
            </button>
            <div className="my-1 border-t border-border" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
                setOpen(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 transition-colors text-left"
            >
              <Trash2 size={13} />
              Eliminar
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onToggleFavorite,
  width,
  onWidthChange,
}: Props) {
  const widthRef = useRef(width);
  useEffect(() => { widthRef.current = width; }, [width]);

  // Drag-to-resize: drag the left edge to adjust width
  function handleResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;

    function onMove(ev: MouseEvent) {
      // Moving left (negative delta) → wider; moving right → narrower
      const delta = startX - ev.clientX;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + delta));
      onWidthChange(next);
    }

    function onUp() {
      localStorage.setItem(WIDTH_KEY, String(widthRef.current));
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const favorites = conversations.filter((c) => c.is_favorite);
  const recents = conversations.filter((c) => !c.is_favorite);

  return (
    <aside
      className="relative flex border-l border-border/60 bg-muted/20 flex-col h-full overflow-hidden"
      style={{ width }}
    >
      {/* Drag handle — left edge */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 z-10 transition-colors"
        onMouseDown={handleResizeStart}
        title="Arrastra para redimensionar"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border/60 pl-4">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Conversaciones
        </span>
        <button
          onClick={onNew}
          title="Nueva conversación"
          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <PenSquare size={14} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2 pl-3 pr-2 space-y-0.5">
        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground/50">
            <MessageSquare size={24} strokeWidth={1.5} />
            <p className="text-xs text-center">Aún no hay conversaciones</p>
          </div>
        )}

        {favorites.length > 0 && (
          <>
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide px-1 pt-1 pb-0.5">
              Favoritas
            </p>
            {favorites.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                isActive={conv.id === activeId}
                onSelect={onSelect}
                onDelete={onDelete}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
            {recents.length > 0 && (
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide px-1 pt-3 pb-0.5">
                Recientes
              </p>
            )}
          </>
        )}

        {recents.map((conv) => (
          <ConversationItem
            key={conv.id}
            conv={conv}
            isActive={conv.id === activeId}
            onSelect={onSelect}
            onDelete={onDelete}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </aside>
  );
}

// ── ConversationItem ──────────────────────────────────────────────────────────

function ConversationItem({
  conv,
  isActive,
  onSelect,
  onDelete,
  onToggleFavorite,
}: {
  conv: Conversation;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string, current: boolean) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className={`group flex items-center gap-1 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
        isActive
          ? "bg-blue-600/15 text-foreground"
          : "hover:bg-muted text-muted-foreground hover:text-foreground"
      }`}
      onClick={() => onSelect(conv.id)}
    >
      {conv.is_favorite && (
        <Star size={10} className="shrink-0 fill-yellow-400 text-yellow-400" />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate leading-snug">{conv.title}</p>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
          {formatRelativeTime(conv.last_message_at)}
        </p>
      </div>

      <ConversationMenu
        isFavorite={conv.is_favorite}
        onFavorite={() => onToggleFavorite(conv.id, conv.is_favorite)}
        onDelete={() => onDelete(conv.id)}
      />
    </motion.div>
  );
}
