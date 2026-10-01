"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertDialogUi, type AlertVariant } from "./alert-dialog-ui";
import { ConfirmDialogUi } from "./confirm-dialog-ui";
import { ToastUi } from "./toast-ui";
import {
  FeedbackContext,
  type AlertOptions,
  type ConfirmOptions,
  type FeedbackContextValue,
} from "./feedback-context";
import { formatActionError } from "./format-action-error";

const TOAST_VISIBLE_MS = 4000;

type AlertState = {
  variant: AlertVariant;
  title?: string;
  message: string;
};

type ConfirmState = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [alertState, setAlertState] = useState<AlertState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
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
    setAlertState(null);
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
    setAlertState({
      variant: options.variant ?? "error",
      title: options.title,
      message: options.message,
    });
  }, []);

  const alertError = useCallback(
    (error: unknown, options?: Omit<AlertOptions, "message">) => {
      alert({
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

  const closeConfirm = useCallback((result: boolean) => {
    setConfirmState((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  const value = useMemo<FeedbackContextValue>(
    () => ({ alert, alertError, toast, confirm }),
    [alert, alertError, toast, confirm],
  );

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
          confirmLabel={confirmState.confirmLabel?.trim() || "Confirm"}
          cancelLabel={confirmState.cancelLabel?.trim() || "Cancel"}
          destructive={confirmState.destructive === true}
          onConfirm={() => closeConfirm(true)}
          onCancel={() => closeConfirm(false)}
        />
      ) : null}
      {toastMessage ? <ToastUi message={toastMessage} /> : null}
    </FeedbackContext.Provider>
  );
}
