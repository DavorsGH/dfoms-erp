"use client";

import { useEffect, useState, type RefObject } from "react";
import { formatTemplatePlaceholder } from "@/utils/message-template-placeholders";

type TemplatePlaceholderReferenceProps = {
  placeholders: readonly string[];
  /** Controlled body value — required with onChange + textareaRef for insert-at-cursor. */
  value?: string;
  onChange?: (next: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  className?: string;
};

function insertAtCursor(
  textarea: HTMLTextAreaElement,
  value: string,
  token: string,
  onChange: (next: string) => void,
) {
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const next = value.slice(0, start) + token + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    const pos = start + token.length;
    textarea.setSelectionRange(pos, pos);
  });
}

export default function TemplatePlaceholderReference({
  placeholders,
  value,
  onChange,
  textareaRef,
  disabled = false,
  className = "",
}: TemplatePlaceholderReferenceProps) {
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const canInsert =
    typeof value === "string" &&
    typeof onChange === "function" &&
    Boolean(textareaRef);

  useEffect(() => {
    if (!copiedName) return;
    const timer = window.setTimeout(() => setCopiedName(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copiedName]);

  async function handleClick(name: string) {
    if (disabled) return;
    const token = formatTemplatePlaceholder(name);
    const textarea = textareaRef?.current ?? null;

    if (canInsert && textarea && onChange && typeof value === "string") {
      insertAtCursor(textarea, value, token, onChange);
      return;
    }

    try {
      await navigator.clipboard.writeText(token);
      setCopiedName(name);
    } catch {
      setCopiedName(null);
    }
  }

  if (placeholders.length === 0) return null;

  return (
    <div className={`mt-1.5 ${className}`.trim()}>
      <p className="mb-1 text-xs text-slate-500">
        Placeholders
        {canInsert ? " — click to insert" : " — click to copy"}
        {copiedName ? (
          <span className="ml-1.5 font-medium text-emerald-700">
            Copied {"{{"}
            {copiedName}
            {"}}"}
          </span>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {placeholders.map((name) => (
          <button
            key={name}
            type="button"
            disabled={disabled}
            onClick={() => void handleClick(name)}
            title={
              canInsert
                ? `Insert {{${name}}}`
                : `Copy {{${name}}}`
            }
            className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs leading-4 text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {formatTemplatePlaceholder(name)}
          </button>
        ))}
      </div>
    </div>
  );
}
