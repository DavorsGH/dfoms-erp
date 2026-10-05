"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { bindAppDialogBridge } from "./app-dialogs";
import { AlertDialogUi, type AlertVariant } from "./alert-dialog-ui";
import { ConfirmDialogUi } from "./confirm-dialog-ui";
import { PromptDialogUi } from "./prompt-dialog-ui";
import { ToastUi } from "./toast-ui";
import {
  FeedbackContext,
  type AlertOptions,
  type ConfirmOptions,
  type FeedbackContextValue,
  type PromptOptions,
} from "./feedback-context";
import { formatActionError } from "./format-action-error";

const TOAST_VISIBLE_MS = 4000;

type AlertState = AlertOptions & {
  variant: AlertVariant;
  resolve: () => void;
};

type ConfirmState = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

type PromptState = PromptOptions & {
  resolve: (value: string | null) => void;
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [alertState, setAlertState] = useState<AlertState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastQueueRef = useRef<string[]>([]);
  const toastBusyRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    },
    [],
  );

  const closeAlert = useCallback(() => {
    setAlertState((current) => {
      current?.resolve();
      return null;
    });
  }, []);

  const drainToastQueue = useCallback(() => {
    if (toastBusyRef.current) {
      return;
    }
    const next = toastQueueRef.current.shift();
    if (!next) {
      setToastMessage(null);
      return;
    }
    toastBusyRef.current = true;
    setToastMessage(next);
    toastTimeoutRef.current = setTimeout(() => {
      toastBusyRef.current = false;
      toastTimeoutRef.current = null;
      drainToastQueue();
    }, TOAST_VISIBLE_MS);
  }, []);

  const toast = useCallback(
    (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) {
        return;
      }
      toastQueueRef.current.push(trimmed);
      if (!toastBusyRef.current) {
        drainToastQueue();
      }
    },
    [drainToastQueue],
  );

  const alert = useCallback((options: AlertOptions) => {
    return new Promise<void>((resolve) => {
      setAlertState({
        variant: options.variant ?? "info",
        title: options.title,
        message: options.message,
        resolve,
      });
    });
  }, []);

  const alertError = useCallback(
    (error: unknown, options?: Omit<AlertOptions, "message">) => {
      return alert({
        ...options,
        variant: options?.variant ?? "error",
        message: formatActionError(error),
      });
    },
    [alert],
  );

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...options, resolve });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setPromptState({ ...options, resolve });
    });
  }, []);

  const closeConfirm = useCallback((result: boolean) => {
    setConfirmState((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  const closePrompt = useCallback((result: string | null) => {
    setPromptState((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  const value = useMemo<FeedbackContextValue>(
    () => ({ alert, alertError, toast, confirm, prompt }),
    [alert, alertError, toast, confirm, prompt],
  );

  useEffect(() => {
    bindAppDialogBridge({
      confirm: value.confirm,
      alert: value.alert,
      prompt: value.prompt,
    });
    return () => bindAppDialogBridge(null);
  }, [value]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {alertState ? (
        <AlertDialogUi
          variant={alertState.variant}
          title={alertState.title}
          message={alertState.message}
          onClose={closeAlert}
        />
      ) : null}
      {confirmState ? (
        <ConfirmDialogUi
          title={confirmState.title?.trim() || "Confirm"}
          message={confirmState.message}
          detail={confirmState.detail}
          details={confirmState.details}
          confirmLabel={confirmState.confirmLabel?.trim() || "Confirm"}
          cancelLabel={confirmState.cancelLabel?.trim() || "Cancel"}
          destructive={confirmState.destructive === true}
          onConfirm={() => closeConfirm(true)}
          onCancel={() => closeConfirm(false)}
        />
      ) : null}
      {promptState ? (
        <PromptDialogUi
          title={promptState.title?.trim() || "Enter value"}
          message={promptState.message}
          defaultValue={promptState.defaultValue}
          inputLabel={promptState.inputLabel}
          confirmLabel={promptState.confirmLabel?.trim() || "OK"}
          cancelLabel={promptState.cancelLabel?.trim() || "Cancel"}
          required={promptState.required}
          onConfirm={(next) => closePrompt(next)}
          onCancel={() => closePrompt(null)}
        />
      ) : null}
      {toastMessage ? <ToastUi message={toastMessage} /> : null}
    </FeedbackContext.Provider>
  );
}
