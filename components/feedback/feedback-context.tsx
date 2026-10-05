"use client";

import { createContext, useContext } from "react";
import type { AlertVariant } from "./alert-dialog-ui";
import type { DialogDetailRow } from "./dialog-detail-list";

export type AlertOptions = {
  title?: string;
  message: string;
  variant?: AlertVariant;
};

export type ConfirmOptions = {
  title?: string;
  message: string;
  detail?: string;
  details?: DialogDetailRow[];
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export type PromptOptions = {
  title?: string;
  message: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputLabel?: string;
  required?: boolean;
};

export type FeedbackContextValue = {
  alert: (options: AlertOptions) => Promise<void>;
  alertError: (
    error: unknown,
    options?: Omit<AlertOptions, "message">,
  ) => Promise<void>;
  toast: (message: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

export const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function useAlert(): Pick<FeedbackContextValue, "alert" | "alertError"> {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error("useAlert must be used within FeedbackProvider.");
  }
  return { alert: ctx.alert, alertError: ctx.alertError };
}

export function useToast(): Pick<FeedbackContextValue, "toast"> {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error("useToast must be used within FeedbackProvider.");
  }
  return { toast: ctx.toast };
}

export function useConfirm(): FeedbackContextValue["confirm"] {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within FeedbackProvider.");
  }
  return ctx.confirm;
}

export function usePrompt(): FeedbackContextValue["prompt"] {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error("usePrompt must be used within FeedbackProvider.");
  }
  return ctx.prompt;
}
