"use client";

import { useCallback, useEffect } from "react";
import {
  formatActionError,
  preserveScrollDuringAction,
  useAlert,
  useToast,
  type AlertOptions,
} from "@/components/feedback";

/** @deprecated Prefer formatActionError from @/components/feedback */
export const formatLookupSettingsActionError = formatActionError;

export function useLookupSettingsFeedback(initialFetchError: string | null) {
  const { alertError } = useAlert();
  const { toast } = useToast();

  useEffect(() => {
    if (initialFetchError) {
      alertError(initialFetchError);
    }
  }, [alertError, initialFetchError]);

  const showActionError = useCallback(
    (error: unknown, options?: Omit<AlertOptions, "message">) => {
      alertError(error, options);
    },
    [alertError],
  );

  const showActionSuccess = useCallback(
    (message: string) => {
      toast(message);
    },
    [toast],
  );

  const preserveScroll = preserveScrollDuringAction;

  return {
    showActionError,
    showActionSuccess,
    preserveScroll,
  };
}

/** @deprecated Alert/toast UI is rendered by FeedbackProvider in the app layout. */
export function LookupSettingsFeedbackUi() {
  return null;
}

