"use client";

import { useChat } from "@ai-sdk/react";
import { isTextUIPart } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { Moon, Search, Send, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

export default function ChatPage() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
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
        <ThemeToggle />
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          <AnimatePresence initial={false}>
            {messages.length === 0 && (
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-muted-foreground text-center mt-16"
              >
                Pregunta sobre contratos públicos colombianos.{" "}
                <span className="italic">
                  &ldquo;¿Cuáles son los contratos más grandes del Chocó en 2025?&rdquo;
                </span>
              </motion.p>
            )}

            {messages.map((m) => {
              const text = m.parts.filter(isTextUIPart).map((p) => p.text).join("");
              if (!text) return null;
              const isUser = m.role === "user";
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`rounded-2xl px-4 py-3 max-w-[82%] text-sm leading-relaxed ${
                      isUser
                        ? "bg-blue-600 text-white rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}
                  >
                    {!isUser && (
                      <span className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                        TransparencIA
                      </span>
                    )}
                    <div className={`prose prose-sm max-w-none ${isUser ? "prose-invert" : "dark:prose-invert"}`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 underline underline-offset-2 hover:text-blue-400 transition-colors"
                            >
                              {children}
                            </a>
                          ),
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="mb-2 pl-4 space-y-1 list-disc">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-2 pl-4 space-y-1 list-decimal">{children}</ol>,
                          li: ({ children }) => <li className="leading-snug">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          code: ({ children }) => (
                            <code className="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-xs font-mono">
                              {children}
                            </code>
                          ),
                        }}
                      >
                        {text}
                      </ReactMarkdown>
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {isLoading && <LoadingDots key="loading" />}
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
