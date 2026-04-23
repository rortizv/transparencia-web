"use client";

import { useChat } from "@ai-sdk/react";
import { isTextUIPart } from "ai";
import { useEffect, useRef, useState } from "react";

export default function ChatPage() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  }

  return (
    <main className="flex flex-col h-screen max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold mb-4">TransparencIA</h1>

      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <p className="text-sm text-gray-500">
            Pregunta sobre contratos públicos colombianos. Ejemplo: &ldquo;¿Cuáles son
            los contratos más grandes del departamento del Chocó en 2025?&rdquo;
          </p>
        )}

        {messages.map((m) => {
          const text = m.parts.filter(isTextUIPart).map((p) => p.text).join("");
          if (!text && m.role !== "user") return null;
          return (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`rounded-lg px-4 py-2 max-w-[80%] text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-900"
                }`}
              >
                {m.role === "assistant" && (
                  <span className="block text-xs font-medium text-gray-500 mb-1">
                    TransparencIA
                  </span>
                )}
                {text}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2 bg-gray-100 text-sm text-gray-500">
              Consultando SECOP II…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 pt-2 border-t">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pregunta sobre contratos públicos…"
          disabled={isLoading}
          className="flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50 hover:bg-blue-700"
        >
          Enviar
        </button>
      </form>
    </main>
  );
}
