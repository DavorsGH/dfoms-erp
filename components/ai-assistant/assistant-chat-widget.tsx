"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import AssistantMarkdown from "@/components/ai-assistant/assistant-markdown";
import { useFloatingUiAvoidanceInsets } from "@/components/floating-ui-avoidance";
import { useAssistantBubblePosition } from "@/components/ai-assistant/use-assistant-bubble-position";
import { subscribeRegisterDetailDrawerOpen } from "@/app/dashboard/register-detail-drawer-visibility";
import { useDialogKeyboard } from "@/components/feedback/use-dialog-keyboard";
import { useFocusTrap } from "@/components/feedback/use-focus-trap";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  getAssistantChatSuggestions,
  type AssistantChatPersona,
} from "@/components/ai-assistant/assistant-chat-suggestions";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  isError?: boolean;
};

const WELCOME_MESSAGE =
  "Hi! Ask me anything about your account or how to use DavSuite.";

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

function NewConversationIcon({ className }: { className?: string }) {
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
      <path d="M12 5v14M5 12h14" />
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

type AssistantPanelConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

function AssistantPanelConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: AssistantPanelConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(true, overlayRef);
  useDialogKeyboard(true, {
    onPrimary: onConfirm,
    onDismiss: onCancel,
    primaryButtonRef: confirmRef,
  });

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-3"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="max-h-full w-full max-w-[calc(100%-0.5rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-xl sm:p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="text-base font-semibold text-[#0f2744] sm:text-lg">
          {title}
        </h3>
        <p
          id={bodyId}
          className="mt-2 break-words text-sm leading-relaxed text-slate-700 sm:mt-3"
        >
          {message}
        </p>
        <div className="mt-4 flex flex-col-reverse gap-2 min-[360px]:flex-row min-[360px]:justify-end sm:mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 min-[360px]:w-auto"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="w-full rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] min-[360px]:w-auto"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type AssistantChatWidgetProps = {
  persona?: AssistantChatPersona;
  staffRole?: AppRole | null;
};

export default function AssistantChatWidget({
  persona = "staff",
  staffRole = null,
}: AssistantChatWidgetProps) {
  const titleId = useId();
  const inputId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const newConversationButtonRef = useRef<HTMLButtonElement>(null);
  const sendAbortRef = useRef<AbortController | null>(null);
  const conversationSessionRef = useRef(0);

  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [registerDetailDrawerOpen, setRegisterDetailDrawerOpen] = useState(false);
  const [showNewConversationConfirm, setShowNewConversationConfirm] =
    useState(false);

  const hasConversation = messages.length > 0;

  const suggestionChips = useMemo(
    () => getAssistantChatSuggestions({ persona, staffRole }),
    [persona, staffRole],
  );

  useEffect(
    () => subscribeRegisterDetailDrawerOpen(setRegisterDetailDrawerOpen),
    [],
  );

  const avoidanceInsets = useFloatingUiAvoidanceInsets();
  const {
    isDragging,
    panelAnchorClass,
    fixedStyle,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    dragHandleStyle,
  } = useAssistantBubblePosition(avoidanceInsets);

  const scrollToBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    list.scrollTop = list.scrollHeight;
  }, []);

  useEffect(() => {
    if (isOpen && !showNewConversationConfirm) {
      scrollToBottom();
      inputRef.current?.focus();
    }
  }, [
    isOpen,
    messages.length,
    isLoading,
    showNewConversationConfirm,
    scrollToBottom,
  ]);

  function handleToggleOpen() {
    setIsOpen((current) => !current);
  }

  function handleClose() {
    setIsOpen(false);
  }

  function handleRequestNewConversation() {
    if (!hasConversation || isLoading) {
      return;
    }
    setShowNewConversationConfirm(true);
  }

  function handleCancelNewConversation() {
    setShowNewConversationConfirm(false);
    requestAnimationFrame(() => {
      newConversationButtonRef.current?.focus();
    });
  }

  function handleConfirmNewConversation() {
    sendAbortRef.current?.abort();
    sendAbortRef.current = null;
    setShowNewConversationConfirm(false);
    setMessages([]);
    setDraft("");
    setIsLoading(false);
    conversationSessionRef.current += 1;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    });
  }

  const sendUserMessage = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
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

      const sessionAtSend = conversationSessionRef.current;

      setMessages((current) => [...current, userMessage]);
      setDraft("");
      setIsLoading(true);

      const abortController = new AbortController();
      sendAbortRef.current = abortController;

      try {
        const response = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: abortController.signal,
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

      if (sessionAtSend !== conversationSessionRef.current) {
        return;
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
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      if (sessionAtSend !== conversationSessionRef.current) {
        return;
      }
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
      if (sendAbortRef.current === abortController) {
        sendAbortRef.current = null;
      }
      if (sessionAtSend === conversationSessionRef.current) {
        setIsLoading(false);
      }
    }
    },
    [isLoading, messages],
  );

  async function handleSend(event?: FormEvent) {
    event?.preventDefault();
    await sendUserMessage(draft);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  if (registerDetailDrawerOpen) {
    return null;
  }

  return (
    <div
      className={`fixed z-50 ${isDragging ? "" : "transition-[left,top] duration-200 ease-out motion-reduce:transition-none"}`}
      style={{
        left: fixedStyle.left,
        top: fixedStyle.top,
      }}
    >
      <div className="relative">
        <section
          aria-labelledby={titleId}
          aria-hidden={!isOpen}
          className={`absolute bottom-[calc(100%+0.75rem)] ${panelAnchorClass} flex w-[min(24rem,calc(100vw-2rem))] max-h-[min(32rem,calc(100dvh-8rem))] origin-bottom flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl transition duration-300 ease-out motion-reduce:transition-none ${
            isOpen ? "translate-y-0 scale-100 opacity-100" : "hidden"
          }`}
        >
          <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0f2744] px-4 py-3 text-white">
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-sm font-semibold">
                Ask DavSuite
              </h2>
              <p className="truncate text-xs text-slate-200">
                Your workspace assistant
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                ref={newConversationButtonRef}
                type="button"
                onClick={handleRequestNewConversation}
                disabled={!hasConversation || isLoading}
                title="New conversation"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="New conversation"
              >
                <NewConversationIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
            </div>
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

            {!hasConversation && !isLoading ? (
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Suggested questions"
              >
                {suggestionChips.map((label) => (
                  <button
                    key={label}
                    type="button"
                    disabled={isLoading}
                    onClick={() => void sendUserMessage(label)}
                    className="max-w-full rounded-full border border-slate-300 bg-white px-3 py-1.5 text-left text-xs leading-snug text-[#0f2744] shadow-sm transition-colors hover:border-[#0f2744] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f2744] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}

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

          {showNewConversationConfirm ? (
            <AssistantPanelConfirmDialog
              title="Start a new conversation?"
              message="This clears the current conversation."
              confirmLabel="Start new"
              cancelLabel="Cancel"
              onConfirm={handleConfirmNewConversation}
              onCancel={handleCancelNewConversation}
            />
          ) : null}
        </section>

        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={titleId}
          aria-label={
            isOpen
              ? "Close Ask DavSuite"
              : "Open Ask DavSuite"
          }
          className={`relative z-10 inline-flex h-16 w-16 shrink-0 cursor-grab items-center justify-center rounded-full bg-[#0f2744] text-white shadow-lg hover:bg-[#1a3a5c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f2744] active:cursor-grabbing ${isDragging ? "scale-105 shadow-xl" : "transition-transform duration-150"}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => {
            const wasDrag = handlePointerUp(event);
            if (!wasDrag) {
              handleToggleOpen();
            }
          }}
          onPointerCancel={handlePointerCancel}
          style={dragHandleStyle}
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
