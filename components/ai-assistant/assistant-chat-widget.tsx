"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import AssistantMarkdown from "@/components/ai-assistant/assistant-markdown";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  isError?: boolean;
};

const WELCOME_MESSAGE =
  "Hi! Ask me anything about your account or how to use DAVORS-ERP.";

const ERROR_MESSAGE = "Sorry, something went wrong. Please try again.";

function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M7.5 8.5h9" />
      <path d="M7.5 12h6" />
      <path d="M7 18.5 4 21V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-1 1.5Z" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function renderMessageContent(message: ChatMessage) {
  if (message.role === "user" || message.isError) {
    return message.content;
  }

  return <AssistantMarkdown content={message.content} />;
}

export default function AssistantChatWidget() {
  const titleId = useId();
  const inputId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const scrollToBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    list.scrollTop = list.scrollHeight;
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      inputRef.current?.focus();
    }
  }, [isOpen, messages.length, isLoading, scrollToBottom]);

  function handleToggleOpen() {
    setIsOpen((current) => !current);
  }

  function handleClose() {
    setIsOpen(false);
  }

  async function handleSend(event?: FormEvent) {
    event?.preventDefault();

    const trimmed = draft.trim();
    if (!trimmed || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };

    const conversationHistory = messages
      .filter((message) => !message.isError)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmed,
          conversationHistory,
        }),
      });

      const data = (await response.json()) as { reply?: string; error?: string };
      const reply = data.reply?.trim();

      if (!response.ok || !reply) {
        throw new Error(data.error ?? ERROR_MESSAGE);
      }

      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: reply,
          createdAt: Date.now(),
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: ERROR_MESSAGE,
          createdAt: Date.now(),
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 sm:right-6 sm:bottom-6">
      <div className="relative">
        <section
          aria-labelledby={titleId}
          aria-hidden={!isOpen}
          className={`absolute bottom-[calc(100%+0.75rem)] right-0 flex w-[min(24rem,calc(100vw-2rem))] max-h-[min(32rem,calc(100dvh-8rem))] origin-bottom flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none ${
            isOpen
              ? "translate-y-0 scale-100 opacity-100"
              : "hidden"
          }`}
        >
          <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0f2744] px-4 py-3 text-white">
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-sm font-semibold">
                Ask DAVORS-ERP
              </h2>
              <p className="truncate text-xs text-slate-200">
                Your workspace assistant
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              aria-label="Close assistant"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="h-4 w-4"
                aria-hidden
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-4"
          >
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 shadow-sm">
                {WELCOME_MESSAGE}
              </div>
            </div>

            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
                    message.role === "user"
                      ? "rounded-br-md bg-[#0f2744] text-white"
                      : message.isError
                        ? "rounded-bl-md border border-red-200 bg-red-50 text-red-700"
                        : "rounded-bl-md border border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {renderMessageContent(message)}
                </div>
              </div>
            ))}

            {isLoading ? (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">
                  Typing…
                </div>
              </div>
            ) : null}
          </div>

          <form
            onSubmit={handleSend}
            className="border-t border-slate-200 bg-white p-3"
          >
            <div className="flex items-center gap-2">
              <label htmlFor={inputId} className="sr-only">
                Message
              </label>
              <input
                ref={inputRef}
                id={inputId}
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Type a message…"
                autoComplete="off"
                disabled={isLoading}
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744] disabled:cursor-not-allowed disabled:bg-slate-50"
              />
              <button
                type="submit"
                disabled={!draft.trim() || isLoading}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#0f2744] text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Send message"
              >
                <SendIcon className="h-4 w-4" />
              </button>
            </div>
          </form>
        </section>

        <button
          type="button"
          onClick={handleToggleOpen}
          aria-expanded={isOpen}
          aria-controls={titleId}
          aria-label={isOpen ? "Close Ask DAVORS-ERP" : "Open Ask DAVORS-ERP"}
          className="relative z-10 inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#0f2744] text-white shadow-lg transition-transform duration-300 hover:bg-[#1a3a5c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f2744] motion-reduce:transition-none"
        >
          {isOpen ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-7 w-7"
              aria-hidden
            >
              <path d="M18 15 12 9l-6 6" />
            </svg>
          ) : (
            <ChatBubbleIcon className="h-7 w-7" />
          )}
        </button>
      </div>
    </div>
  );
}
